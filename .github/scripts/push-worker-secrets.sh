#!/usr/bin/env bash
# push-worker-secrets.sh <worker-name>
#
# Reads the standard Kintsugi secret env vars, writes them to a temp JSON
# file, and uploads them to the named Cloudflare Worker via wrangler secret
# bulk.  Called after wrangler deploy so the latest version is already
# deployed, avoiding Cloudflare API error 10214.
#
# Required env vars (set in the calling workflow step):
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#   DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN, ANALYTICS_CHANNEL_ID,
#   JOBS_CHANNEL_ID, PAYOUTS_CHANNEL_ID, RIPTIDE_USER_ID,
#   TRIGGER_TOKEN, DEBUG_CHANNEL_ID
set -euo pipefail

WORKER_NAME="${1:?Usage: push-worker-secrets.sh <worker-name>}"
TMP_FILE="/tmp/wrangler-secrets-${WORKER_NAME}.json"

node -e "
  const keys = [
    'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN', 'ANALYTICS_CHANNEL_ID',
    'JOBS_CHANNEL_ID', 'PAYOUTS_CHANNEL_ID', 'RIPTIDE_USER_ID',
    'TRIGGER_TOKEN', 'DEBUG_CHANNEL_ID',
  ];
  const obj = {};
  for (const k of keys) { if (process.env[k]) obj[k] = process.env[k]; }
  require('fs').writeFileSync(process.argv[1], JSON.stringify(obj));
" "${TMP_FILE}"

npx wrangler@4.72.0 secret bulk "${TMP_FILE}" --name "${WORKER_NAME}"
rm -f "${TMP_FILE}"
