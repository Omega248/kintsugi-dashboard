#!/usr/bin/env bash
# push-worker-secrets.sh <worker-name>
#
# Reads the standard Kintsugi secret env vars and uploads them to the named
# Cloudflare Worker via the Cloudflare REST API (script-level secrets endpoint).
# Using the REST API directly avoids Wrangler error 10214, which occurs when
# `wrangler secret bulk` uses the version-level settings API on a worker
# where the latest uploaded version is not yet the active/deployed version.
#
# Required env vars (set in the calling workflow step):
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#   DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN, ANALYTICS_CHANNEL_ID,
#   JOBS_CHANNEL_ID, PAYOUTS_CHANNEL_ID, RIPTIDE_USER_ID,
#   TRIGGER_TOKEN, DEBUG_CHANNEL_ID
set -euo pipefail

WORKER_NAME="${1:?Usage: push-worker-secrets.sh <worker-name>}"

node - "${WORKER_NAME}" << 'EOF'
const https = require('https');

const workerName = process.argv[2];
const accountId  = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken   = process.env.CLOUDFLARE_API_TOKEN;

// Validate that workerName and accountId contain only safe characters
// (alphanumeric, hyphens, underscores) to prevent accidental path manipulation.
if (!/^[\w-]+$/.test(workerName)) {
  console.error(`Invalid worker name: ${workerName}`);
  process.exit(1);
}
if (!accountId || !/^[\w-]+$/.test(accountId)) {
  console.error('CLOUDFLARE_ACCOUNT_ID is missing or contains invalid characters.');
  process.exit(1);
}

const keys = [
  'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN', 'ANALYTICS_CHANNEL_ID',
  'JOBS_CHANNEL_ID', 'PAYOUTS_CHANNEL_ID', 'RIPTIDE_USER_ID',
  'TRIGGER_TOKEN', 'DEBUG_CHANNEL_ID', 'BOT_APP_ID',
];

// PUT /secrets — standard script-level secrets endpoint.
// Fails with error 10215 when the Worker uses Worker Versions and the latest
// uploaded version is not yet the active/deployed version.
function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ name, text: value, type: 'secret_text' });
    const req = https.request({
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success) resolve(parsed);
          else reject(Object.assign(
            new Error(`API error for ${name}: ${JSON.stringify(parsed.errors)}`),
            { errors: parsed.errors || [] },
          ));
        } catch (e) {
          reject(new Error(`Failed to parse response for ${name}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// PATCH /settings — versions-compatible secrets endpoint.
// Works even when Worker Versions is enabled and the latest version is not
// yet deployed (avoids error 10215).  Accepts multiple secrets at once as
// "secret_text" bindings and merges them with existing settings.
function patchSettings(secrets) {
  return new Promise((resolve, reject) => {
    const bindings = secrets.map(({ name, value }) => ({
      type: 'secret_text',
      name,
      text: value,
    }));
    const body = JSON.stringify({ bindings });
    const req = https.request({
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${accountId}/workers/scripts/${workerName}/settings`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success) resolve(parsed);
          else reject(new Error(`Settings API error: ${JSON.stringify(parsed.errors)}`));
        } catch (e) {
          reject(new Error(`Failed to parse settings response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // Collect secrets to push, skipping any that are not set.
  const allSecrets = [];
  let skipped = 0;
  for (const key of keys) {
    const val = process.env[key];
    if (!val) { skipped++; continue; }
    allSecrets.push({ name: key, value: val });
  }

  let pushed = 0;
  let useSettingsApi = false;
  const pendingForSettings = [];

  for (const secret of allSecrets) {
    // Once error 10215 is encountered, queue all remaining secrets for the
    // PATCH /settings call rather than trying PUT again.
    if (useSettingsApi) {
      pendingForSettings.push(secret);
      continue;
    }
    try {
      await putSecret(secret.name, secret.value);
      console.log(`✓ ${secret.name}`);
      pushed++;
    } catch (err) {
      const has10215 = (err.errors || []).some(e => e.code === 10215);
      if (has10215) {
        // Worker Versions detected: the latest deployed version does not match
        // the uploaded version, so PUT /secrets is blocked.  Fall back to the
        // PATCH /settings endpoint for this and all remaining secrets.
        console.log(`⚠ Worker Versions detected (10215) — switching to settings API for remaining secrets.`);
        useSettingsApi = true;
        pendingForSettings.push(secret);
      } else {
        throw err;
      }
    }
  }

  if (pendingForSettings.length > 0) {
    await patchSettings(pendingForSettings);
    for (const { name } of pendingForSettings) {
      console.log(`✓ ${name} (via settings API)`);
      pushed++;
    }
  }

  console.log(`Done: ${pushed} secret(s) pushed to "${workerName}", ${skipped} skipped.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
EOF
