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
          else reject(new Error(`API error for ${name}: ${JSON.stringify(parsed.errors)}`));
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

async function main() {
  let pushed = 0;
  let skipped = 0;
  for (const key of keys) {
    const val = process.env[key];
    // Skip secrets that are not set (undefined or empty string).
    if (!val) { skipped++; continue; }
    await putSecret(key, val);
    console.log(`✓ ${key}`);
    pushed++;
  }
  console.log(`Done: ${pushed} secret(s) pushed to "${workerName}", ${skipped} skipped.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
EOF
