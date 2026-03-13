# Kintsugi Dashboard

A **web dashboard** and **Discord bot** for Kintsugi Motorworks. Displays job logs, analytics, payouts, and bank records from a Google Sheet, and brings the same data into Discord through permanent channel panels and slash commands.

Hosted on **Cloudflare's free tier** and deployed automatically by GitHub Actions.

---

## Deployment

Push to `main` triggers the **Deploy** workflow automatically. To deploy manually:

**Actions → Deploy → Run workflow**

The workflow:
1. Creates (or reuses) a Cloudflare KV namespace named `KINTSUGI_BOT` and binds it to the Worker.
2. Deploys `worker.js` as two Cloudflare Workers:
   - **`kintsugi`** — the primary Worker (web dashboard + Discord bot)
   - **`kintsugi-discord-bot`** — a backward-compatible alias for existing Discord Interactions Endpoint URLs
3. Syncs all configured secrets to both Workers' secret stores.
4. Registers slash commands if `DISCORD_APP_ID` is set.

---

## GitHub Actions Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| **Deploy** | Push to `main` or manual | Deploys both Workers to Cloudflare |
| **Register Slash Commands** | Manual | Registers `/payouts` and `/update-analytics` slash commands |
| **Post Job Logs Panel** | Manual | Posts (or updates) the Job Logs panel in #jobs |
| **Post Invoice Panel** | Manual | Posts (or updates) the Invoice panel in #invoice |
| **Post Payouts Processed** | Manual | Posts a payouts embed to #payouts |
| **Update Analytics** | Manual or every 5 min | Posts/edits the analytics summary in #analytics |

---

## Secrets Reference

| Secret | Required? | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | Deploys the Worker and provisions KV (`Workers Scripts:Edit` + `Workers KV Storage:Edit`) |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | Identifies your Cloudflare account |
| `DISCORD_PUBLIC_KEY` | ✅ | Verifies Discord interaction signatures |
| `DISCORD_APP_ID` | ✅ | Registers slash commands |
| `DISCORD_BOT_TOKEN` | ✅ | Posts and edits messages in Discord |
| `ANALYTICS_CHANNEL_ID` | ✅ | Channel for the auto-updated analytics embed |
| `JOBS_CHANNEL_ID` | ✅ | Channel for the Job Logs panel |
| `PAYOUTS_CHANNEL_ID` | ✅ | Channel for the payday reminder ping |
| `INVOICE_CHANNEL_ID` | ✅ | Channel for the Invoice panel |
| `RIPTIDE_USER_ID` | Optional | Discord user ID to @mention in payday reminder |
| `TRIGGER_TOKEN` | Optional | Auth token for the "Notify Discord" button on the web dashboard |
| `DEBUG_CHANNEL_ID` | Optional | Discord channel ID for debug/error embed logs |

All secrets are set in **GitHub → Settings → Secrets and variables → Actions** and synced to the Worker automatically on deploy.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "This interaction failed" — Google Sheet error | Sheet is private | Share the Sheet as **Anyone with the link → Viewer** |
| "This interaction failed" — missing secret | Required secret not set | Check **Cloudflare → Workers & Pages → kintsugi → Logs** and confirm all channel ID secrets are set |
| Invoice button shows "This interaction failed" | Invoice flow error | Check Cloudflare Logs for `invoice_generation_failed` — it contains an `errorId` and stack trace |
| Slash commands not showing in Discord | Commands not registered | Run **Register Slash Commands** workflow |
| Mechanic list or department dropdown is empty | Google Sheet not publicly readable | Share the Sheet as **Anyone with the link → Viewer** |
| Analytics posts a new message every 5 minutes | KV namespace not bound | Check **Cloudflare → kintsugi → Settings → Bindings** for a `KV` binding; re-run Deploy |
| Panel message disappeared | Message was deleted | Re-run the relevant **Post … Panel** workflow and pin the new message |
| "Notify Discord" returns 401 | Token mismatch | Confirm `TRIGGER_TOKEN` in GitHub Secrets matches what's saved in the dashboard config panel |
| Deploy fails at "Provision KV" | API token missing KV permission | Recreate the token with both `Workers Scripts:Edit` and `Workers KV Storage:Edit` permissions |

---

## File Overview

```
kintsugi-dashboard/
│
├── index.html                      Web dashboard (Analytics)
├── dashboard-script.js             Dashboard data logic
├── dashboard-style.css             Dashboard styles
├── constants.js                    Shared constants (pay rates, sheet IDs)
├── kintsugi-core.js                Core business logic
├── shared-styles.css               Shared CSS
├── utils.js                        Shared utilities
├── worker.js                       Unified Cloudflare Worker (dashboard + Discord bot)
├── wrangler.jsonc                  Config for the primary "kintsugi" Worker
├── wrangler-bot.jsonc              Config for the "kintsugi-discord-bot" alias Worker
│
├── Analytics/                      Analytics sub-page
├── Bank_Record/                    Bank Record sub-page
├── Mechanics/                      Mechanics sub-page
├── Payouts/                        Payouts sub-page
│
└── scripts/                        One-time / on-demand scripts (run via GitHub Actions)
    ├── register-commands.js        Register slash commands
    ├── setup-panel.js              Post the Job Logs panel
    ├── setup-invoice-panel.js      Post the Invoice panel
    ├── update-analytics.js         Post/edit the analytics summary
    └── post-payouts.js             Post payouts notification

.github/workflows/
    ├── deploy.yml                  Auto-deploy on push to main
    ├── register-commands.yml       Register slash commands on demand
    ├── setup-panel.yml             Post Job Logs panel on demand
    ├── setup-invoice-panel.yml     Post Invoice panel on demand
    ├── post-payouts.yml            Post payouts notification on demand
    └── update-analytics.yml        Post/edit analytics summary on demand
```
