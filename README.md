# Getting Up and Running

## 1. GitHub Secrets

Go to **GitHub → Settings → Secrets and variables → Actions** and add the following:

| Secret | Where to find it | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens (needs `Workers Scripts:Edit` + `Workers KV Storage:Edit`) | Deploy the Worker and provision KV storage |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → Account Home | Identifies your Cloudflare account |
| `DISCORD_PUBLIC_KEY` | Discord Developer Portal → Application → General Information | Verifies interaction signatures |
| `DISCORD_APP_ID` | Discord Developer Portal → Application → General Information | Registers slash commands |
| `DISCORD_BOT_TOKEN` | Discord Developer Portal → Application → Bot → Reset Token | Posts and edits messages in Discord |
| `ANALYTICS_CHANNEL_ID` | Discord → right-click channel → Copy Channel ID | Auto-updated analytics embed |
| `JOBS_CHANNEL_ID` | Discord → right-click channel → Copy Channel ID | Job Logs panel |
| `PAYOUTS_CHANNEL_ID` | Discord → right-click channel → Copy Channel ID | Payday reminder |
| `INVOICE_CHANNEL_ID` | Discord → right-click channel → Copy Channel ID | Invoice panel |
| `TRIGGER_TOKEN` | Any secure random string you generate | Protects dashboard API endpoints |
| `RIPTIDE_USER_ID` | Discord → right-click user → Copy User ID | *(Optional)* `@mention` on payday |
| `DEBUG_CHANNEL_ID` | Discord → right-click channel → Copy Channel ID | *(Optional)* Error embeds |

> **Tip:** Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode) to unlock the Copy ID options.

---

## 2. Discord Developer Portal

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and open your application.
2. **General Information** — copy the **Application ID** and **Public Key** into `DISCORD_APP_ID` and `DISCORD_PUBLIC_KEY`.
3. **Bot** — click **Reset Token**, copy it into `DISCORD_BOT_TOKEN`.
4. **Bot → Privileged Gateway Intents** — enable **Message Content Intent** (required for `@mention` replies).
5. **OAuth2 → URL Generator** — select scope `bot`, grant `Send Messages` / `Edit Messages` / `Read Message History`, then use the generated URL to invite the bot to your server.

---

## 3. Deploy

Push to `main` — the **Deploy** workflow runs automatically and:

1. Creates (or reuses) a KV namespace named `KINTSUGI_BOT` and binds it to the Worker.
2. Deploys `worker.js` as two Cloudflare Workers (`kintsugi` and `kintsugi-discord-bot`).
3. Syncs all secrets to both Workers.
4. Registers slash commands.

To deploy manually: **Actions → Deploy → Run workflow**

After the deploy finishes, copy your worker URL from Cloudflare (`https://kintsugi.<subdomain>.workers.dev`).

---

## 4. Finish Discord Setup

Back in the Discord Developer Portal → **General Information → Interactions Endpoint URL** — paste your worker URL. Discord will send a `PING` to verify; the Worker responds automatically.

---

## 5. Activate the Bot

Run **Actions → Activate Bot → Run workflow** once after the first deploy. This:

- Registers slash commands (`/payouts`, `/update-analytics`, `/ask`)
- Starts the Discord Gateway WebSocket for real-time `@mention` replies
- Posts the initial analytics summary and job logs panel to their channels

---

## 6. Set Up Channel Panels (optional, one-time)

Run these workflows as needed from the **Actions** tab:

| Workflow | What it posts |
|---|---|
| **Post Job Logs Panel** | Permanent panel in `#jobs` |
| **Post Invoice Panel** | Permanent panel in `#invoice` |
| **Post Payouts Processed** | Payday embed in `#payouts` |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy fails at "Provision KV" | Recreate the Cloudflare API token with both `Workers Scripts:Edit` and `Workers KV Storage:Edit` permissions |
| Slash commands don't appear in Discord | Run **Register Slash Commands** or **Activate Bot** from the Actions tab |
| Bot doesn't reply to `@mentions` | Run **Activate Bot** or click **Start Gateway** on the Logs page |
| "This interaction failed" in Discord | Share the Google Sheet as **Anyone with the link → Viewer** and confirm all channel ID secrets are set |
| Analytics posts a duplicate message every 5 minutes | Re-run **Deploy** — the KV namespace binding is missing |
| `/api/logs` returns 401 | Use the exact value of `TRIGGER_TOKEN` as the Bearer token |
| `/api/logs` returns 503 | Re-run **Deploy** to provision and bind the `KINTSUGI_BOT` KV namespace |
