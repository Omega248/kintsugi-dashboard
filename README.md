# Kintsugi Dashboard

A combined **web dashboard** and **Discord bot** for Kintsugi Motorworks. The dashboard displays job logs, analytics, payouts, and bank records from a Google Sheet. The Discord bot brings the same data into Discord through permanent channel panels and slash commands — no web browser required.

```
Web Dashboard                         Discord Bot
┌──────────────────────────────┐      ┌──────────────────────────────┐
│  /         Analytics         │      │  #jobs    Job Logs panel      │
│  /Payouts  Payout tracker    │      │  #invoice Invoice panel       │
│  /Mechanics Mechanic records │      │  /payouts  /update-analytics  │
│  /Bank_Record Bank ledger    │      │  Cron: analytics every 5 min  │
└──────────────────────────────┘      └──────────────────────────────┘
```

Both are hosted on **Cloudflare's free tier** and deployed automatically by GitHub Actions.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup — Step by Step](#setup--step-by-step)
   - [Step 1 — Discord Application](#step-1--discord-application)
   - [Step 2 — Invite the Bot](#step-2--invite-the-bot)
   - [Step 3 — Cloudflare API Token](#step-3--cloudflare-api-token)
   - [Step 4 — GitHub Secrets](#step-4--github-secrets)
   - [Step 5 — Deploy the Bot Worker](#step-5--deploy-the-bot-worker)
   - [Step 6 — Set the Interactions Endpoint URL](#step-6--set-the-interactions-endpoint-url)
   - [Step 7 — Register Slash Commands](#step-7--register-slash-commands)
   - [Step 8 — Post the Panel Messages](#step-8--post-the-panel-messages)
3. [Verification Checklist](#verification-checklist)
4. [All Secrets — Quick Reference](#all-secrets--quick-reference)
5. [Troubleshooting](#troubleshooting)
6. [File Overview](#file-overview)

---

## Prerequisites

| Requirement | Notes |
|---|---|
| [Discord account](https://discord.com) | Must have permission to add bots to your server |
| [Cloudflare account](https://cloudflare.com) | Free tier is sufficient |
| [GitHub account](https://github.com) | For CI/CD via GitHub Actions |
| Google Sheet | The spreadsheet must be **publicly readable** (Share → Anyone with the link → Viewer) |

No local tooling is required for a normal deployment — everything runs through GitHub Actions.

---

## Setup — Step by Step

### Step 1 — Discord Application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Name it (e.g. *Kintsugi Bot*) and click **Create**.
3. **General Information** tab — copy and save two values:
   - **Application ID** → used as `DISCORD_APP_ID` secret
   - **Public Key** → used as `DISCORD_PUBLIC_KEY` secret
4. **Bot** tab → click **Reset Token** → copy and save the **Bot Token** → used as `DISCORD_BOT_TOKEN` secret.

> ⚠️ The Bot Token is shown only once. If you lose it, click **Reset Token** again.

---

### Step 2 — Invite the Bot

1. **OAuth2 → URL Generator** in the Developer Portal.
2. **Scopes**: tick `bot` and `applications.commands`.
3. **Bot Permissions**: tick `Send Messages` and `Read Message History`.
4. Copy the generated URL → open it in a browser → select your server → **Authorise**.

Verify the bot appears in your server's member list (it will be offline until the Worker is deployed).

---

### Step 3 — Cloudflare API Token

1. Log in to <https://dash.cloudflare.com> → top-right avatar → **My Profile** → **API Tokens** → **Create Token**.
2. Start from the **Edit Cloudflare Workers** template.
3. Add a **second permission row**: Account → **Workers KV Storage** → **Edit**.
4. Click **Continue to summary** → **Create Token**.
5. Copy the token → save as `CLOUDFLARE_API_TOKEN` secret.
6. Also note your **Account ID**: visible in the Cloudflare dashboard URL or the right-hand sidebar of the **Workers & Pages** section → save as `CLOUDFLARE_ACCOUNT_ID` secret.

> ⚠️ The token needs **both** `Workers Scripts:Edit` **and** `Workers KV Storage:Edit` permissions. Missing either will cause the deploy workflow to fail.

---

### Step 4 — GitHub Secrets

Go to your GitHub repository → **Settings → Secrets and variables → Actions → New repository secret** and add each of the following.

#### Required secrets

| Secret name | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | From Step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | From Step 3 |
| `DISCORD_PUBLIC_KEY` | From Step 1 — General Information → Public Key |
| `DISCORD_APP_ID` | From Step 1 — General Information → Application ID |
| `DISCORD_BOT_TOKEN` | From Step 1 — Bot → Reset Token |
| `ANALYTICS_CHANNEL_ID` | Discord channel ID for your **#analytics** channel |
| `JOBS_CHANNEL_ID` | Discord channel ID for your **#jobs** channel |
| `PAYOUTS_CHANNEL_ID` | Discord channel ID for your **#payouts** channel |
| `INVOICE_CHANNEL_ID` | Discord channel ID for your **#invoice** channel |

#### Optional secrets

| Secret name | Purpose |
|---|---|
| `RIPTIDE_USER_ID` | Discord user ID to @mention in the weekly payday reminder ping |
| `TRIGGER_TOKEN` | Strong random secret (e.g. `openssl rand -hex 32`) — enables the **"Notify Discord"** button on the web dashboard and the **Post Payouts** workflow |

> **How to get a channel ID:** In Discord, go to **Settings → Advanced** and enable **Developer Mode**. Then right-click any channel and choose **Copy Channel ID**.

---

### Step 5 — Deploy the Bot Worker

Trigger the deploy from GitHub Actions:

**Actions → Deploy Discord Bot → Run workflow → Run workflow**

What the workflow does automatically:
1. Creates (or reuses) a Cloudflare KV namespace named `KINTSUGI_BOT`.
2. Binds it to the Worker as `KV` for state persistence.
3. Deploys `discord-bot/worker.js` as the **`kintsugi-discord-bot`** Worker.
4. Syncs all required and optional secrets to the Worker's secret store.
5. Registers the `/payouts` and `/update-analytics` slash commands (if `DISCORD_APP_ID` is set).

After the workflow finishes, confirm it succeeded:
- Open the workflow run in GitHub Actions — all steps should show green ✅.
- Go to **Cloudflare Dashboard → Workers & Pages** — the `kintsugi-discord-bot` Worker should appear.

---

### Step 6 — Set the Interactions Endpoint URL

1. In Cloudflare: **Workers & Pages → kintsugi-discord-bot → Settings** — copy the Worker URL.
   - It looks like `https://kintsugi-discord-bot.<subdomain>.workers.dev`
2. In the Discord Developer Portal → your application → **General Information**.
3. Paste the Worker URL into **Interactions Endpoint URL**.
4. Click **Save Changes**.

Discord immediately sends a `PING` request to verify the endpoint. If the Worker responds with `PONG`, you will see a success confirmation. If it fails, see [Troubleshooting](#troubleshooting).

> ⚠️ Use the `kintsugi-discord-bot` Worker URL — **not** the static-assets `kintsugi` Worker URL.

---

### Step 7 — Register Slash Commands

The deploy workflow (Step 5) registers commands automatically if `DISCORD_APP_ID` is set. If you need to re-register them manually:

**Actions → Register Slash Commands → Run workflow → Run workflow**

After completion, the following commands are available in your server:

| Command | Description |
|---|---|
| `/payouts` | Posts the payouts-processed embed publicly |
| `/update-analytics [channel]` | Refreshes the pinned analytics summary; optionally sets the auto-update channel |

Both commands require **Manage Guild** permission by default. This can be changed per-server in **Server Settings → Integrations → Kintsugi Bot**.

---

### Step 8 — Post the Panel Messages

Post each panel using GitHub Actions. Each panel is a permanent Discord message that stays in the channel — members use the buttons to interact with the bot privately.

#### Job Logs panel (in #jobs)

**Actions → Post Job Logs Panel → Run workflow**

- Leave the channel input blank to use `JOBS_CHANNEL_ID`, or enter a specific channel ID.

#### Invoice panel (in #invoice)

**Actions → Post Invoice Panel → Run workflow**

- Leave the channel input blank to use `INVOICE_CHANNEL_ID`, or enter a specific channel ID.
- To update an existing panel message instead of posting a new one, enter its message ID in the **Panel Message ID** field.

After posting each panel, **right-click the message → Pin** to keep it visible at the top of the channel.

---

## Verification Checklist

Use this checklist to confirm every part of the setup is working before handing it over.

### Discord Application

- [ ] Application created in the Discord Developer Portal
- [ ] Bot invited to the server with `bot` + `applications.commands` scopes and `Send Messages` + `Read Message History` permissions
- [ ] Bot appears in the server member list

### GitHub Secrets

- [ ] `CLOUDFLARE_API_TOKEN` — set and has both `Workers Scripts:Edit` and `Workers KV Storage:Edit` permissions
- [ ] `CLOUDFLARE_ACCOUNT_ID` — set
- [ ] `DISCORD_PUBLIC_KEY` — set and matches the Developer Portal **exactly**
- [ ] `DISCORD_APP_ID` — set
- [ ] `DISCORD_BOT_TOKEN` — set
- [ ] `ANALYTICS_CHANNEL_ID` — set
- [ ] `JOBS_CHANNEL_ID` — set
- [ ] `PAYOUTS_CHANNEL_ID` — set
- [ ] `INVOICE_CHANNEL_ID` — set

### Cloudflare Worker

- [ ] **Deploy Discord Bot** workflow ran successfully (all steps green ✅)
- [ ] `kintsugi-discord-bot` Worker appears in **Cloudflare → Workers & Pages**
- [ ] Worker has a `KV` binding in **Worker Settings → Bindings** (namespace: `KINTSUGI_BOT`)
- [ ] Worker secrets are populated: open **Worker Settings → Variables and Secrets** and confirm `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, and the channel IDs are listed

### Discord Interactions Endpoint

- [ ] Worker URL is pasted into the Discord Developer Portal **Interactions Endpoint URL** field
- [ ] Discord showed a success confirmation when saving (PING → PONG verified)
- [ ] Clicking any panel button in Discord shows a private ephemeral response (not "This interaction failed")

### Slash Commands

- [ ] `/payouts` and `/update-analytics` appear in the slash command menu in Discord
- [ ] `/payouts` returns a payouts embed when run
- [ ] `/update-analytics` returns an analytics embed when run

### Panels

- [ ] Job Logs panel is posted in #jobs and pinned
- [ ] Invoice panel is posted in #invoice and pinned
- [ ] Clicking **📋 Request Job Logs** shows a private mechanic dropdown
- [ ] Completing the Job Logs flow (mechanic → week) shows a private job-log embed
- [ ] Clicking **📋 Generate Monthly Invoice** shows a private department dropdown
- [ ] Completing the Invoice flow (department → month) shows a private invoice embed with the CSV file attached

### Google Sheet

- [ ] The spreadsheet is shared as **Anyone with the link → Viewer**
- [ ] The sheet has a tab named exactly `Form responses 1` (the jobs tab)
- [ ] The **Mechanic**, **Department**, **Month Ending**, **# of across** (repairs), and **# of engine replacements** columns are present and populated

### Cron / Auto-updates

- [ ] Go to **Cloudflare → Workers & Pages → kintsugi-discord-bot → Logs** — confirm cron events appear every 5 minutes
- [ ] The analytics summary message in #analytics is being edited (not new messages posted every 5 minutes)

---

## All Secrets — Quick Reference

| Secret | Required? | Set in | Purpose |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | GitHub | Deploys the Worker and provisions KV |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | GitHub | Identifies your Cloudflare account |
| `DISCORD_PUBLIC_KEY` | ✅ | GitHub → Worker | Verifies Discord interaction signatures |
| `DISCORD_APP_ID` | ✅ | GitHub | Registers slash commands |
| `DISCORD_BOT_TOKEN` | ✅ | GitHub → Worker | Posts and edits messages in Discord |
| `ANALYTICS_CHANNEL_ID` | ✅ | GitHub → Worker | Channel for the auto-updated analytics embed |
| `JOBS_CHANNEL_ID` | ✅ | GitHub → Worker | Channel for the job-activity cron post |
| `PAYOUTS_CHANNEL_ID` | ✅ | GitHub → Worker | Channel for the payday reminder ping |
| `INVOICE_CHANNEL_ID` | ✅ | GitHub → Worker | Channel where the Invoice panel is posted |
| `RIPTIDE_USER_ID` | Optional | GitHub → Worker | Discord user ID to @mention in payday reminder |
| `TRIGGER_TOKEN` | Optional | GitHub → Worker | Auth token for the "Notify Discord" web dashboard button |

> Secrets marked **GitHub → Worker** are set in GitHub and automatically synced to the Cloudflare Worker secret store by the **Deploy Discord Bot** workflow.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "The specified interactions endpoint URL could not be verified" | Wrong Worker URL, or `DISCORD_PUBLIC_KEY` mismatch | Use the `kintsugi-discord-bot` Worker URL (not `kintsugi`). Confirm `DISCORD_PUBLIC_KEY` in Cloudflare matches the Developer Portal value exactly. |
| "Invalid signature" in Worker logs | `DISCORD_PUBLIC_KEY` incorrect | Copy the key again from **Discord Developer Portal → General Information → Public Key** and redeploy. |
| "This interaction failed" after clicking a button | Worker returned an error or timed out | Check **Cloudflare → Workers & Pages → kintsugi-discord-bot → Logs** for errors. Most commonly caused by the Google Sheet being private or a missing secret. |
| Invoice button shows "This interaction failed" | Invoice flow error | Filter Cloudflare Logs by `svc:"kintsugi-invoice"` and find the `invoice_generation_failed` event — it contains an `errorId` and full stack trace. |
| Slash commands not showing in Discord | `DISCORD_APP_ID` not set or commands not registered | Add `DISCORD_APP_ID` to GitHub Secrets and run **Register Slash Commands** workflow. |
| Mechanic list is empty | Google Sheet not publicly readable | Share the Sheet as **Anyone with the link → Viewer**. |
| Departments missing from invoice dropdown | **Department** column empty or sheet not public | Ensure the Department column is populated for recent jobs and the sheet is public. |
| Deploy workflow fails at "Provision KV" | `CLOUDFLARE_API_TOKEN` missing `Workers KV Storage:Edit` | Recreate the token with both `Workers Scripts:Edit` and `Workers KV Storage:Edit` permissions. |
| Analytics posts a new message every 5 minutes instead of editing | KV namespace not bound | Check **Cloudflare → kintsugi-discord-bot → Settings → Bindings** — there should be a `KV` binding pointing to the `KINTSUGI_BOT` namespace. Re-run the deploy workflow to fix. |
| Panel message disappeared | Message was deleted | Re-run the relevant **Post … Panel** workflow, then pin the new message. |
| "Notify Discord" button always shows the config panel | Worker URL and token not saved | Enter the bot Worker URL and `TRIGGER_TOKEN` in the config panel — they are saved in browser localStorage. |
| "Notify Discord" returns 401 | Token mismatch | Confirm `TRIGGER_TOKEN` in GitHub Secrets matches what you entered in the config panel, then redeploy. |
| Cron does nothing / "missing required configuration" in Logs | Channel ID secrets not set | Add all required channel ID secrets and redeploy. |

### Checking Cloudflare Worker Logs

1. Go to **Cloudflare Dashboard → Workers & Pages → kintsugi-discord-bot**.
2. Click **Logs** in the left sidebar.
3. Use the filter bar to narrow down by service or event type (e.g. `svc:"kintsugi-invoice"`).

Invoice interactions produce structured JSON logs. Key fields to look for:

| Field | Meaning |
|---|---|
| `correlationId` | Unique 8-character ID per interaction flow — use this to trace one request end-to-end |
| `event` | What happened (e.g. `invoice_generated`, `invoice_generation_failed`) |
| `errorId` | Short ID shown to the user in the error message — use it to find the matching log line |
| `timings` | Per-step durations in ms (useful for diagnosing slow sheet fetches) |

To enable verbose invoice logging, add an `INVOICE_DEBUG` Worker secret set to `true` (via Cloudflare dashboard or `wrangler secret put INVOICE_DEBUG`).

---

## File Overview

```
kintsugi-dashboard/
│
├── README.md                       ← This file
│
├── index.html                      Web dashboard (Analytics)
├── dashboard-script.js             Dashboard data logic
├── dashboard-style.css             Dashboard styles
├── constants.js                    Shared constants (pay rates, sheet IDs)
├── kintsugi-core.js                Core business logic
├── shared-styles.css               Shared CSS
├── utils.js                        Shared utilities
├── worker.js                       Static-assets Cloudflare Worker (kintsugi)
├── wrangler.jsonc                  Static-assets Worker config
│
├── Analytics/                      Analytics sub-page
├── Bank_Record/                    Bank Record sub-page
├── Mechanics/                      Mechanics sub-page
├── Payouts/                        Payouts sub-page
│
└── discord-bot/                    Discord bot (separate Worker)
    ├── README.md                   Detailed bot documentation
    ├── worker.js                   Bot Worker — all interactions + cron logic
    ├── wrangler.toml               Bot Worker config (name: kintsugi-discord-bot)
    ├── register-commands.js        Register /payouts and /update-analytics commands
    ├── setup-panel.js              Post the Job Logs panel (run once)
    ├── setup-analytics-panel.js    Post the Analytics panel (run once)
    ├── setup-invoice-panel.js      Post the Invoice panel (run once)
    ├── post-payouts.js             Post payouts notification
    └── test-invoice-flow.mjs       Invoice flow test suite

.github/workflows/
    ├── deploy-bot.yml              Auto-deploy bot on push to discord-bot/**
    ├── deploy-site.yml             Auto-deploy web dashboard on push to main
    ├── register-commands.yml       Register slash commands on demand
    ├── setup-panel.yml             Post Job Logs panel on demand
    ├── setup-invoice-panel.yml     Post Invoice panel on demand
    ├── post-payouts.yml            Post payouts notification on demand
    └── update-analytics.yml       Post/edit analytics summary on demand
```

For detailed bot documentation, see [`discord-bot/README.md`](discord-bot/README.md).
