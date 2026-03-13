# Kintsugi Discord Bot

A lightweight Discord bot that puts **three permanent panels** in your Discord channels. Members click a button, make a selection if needed, and instantly get a private result — all without leaving Discord or opening the dashboard.

```
#jobs channel                 #analytics channel            #payouts channel
┌─────────────────────┐       ┌─────────────────────┐       ┌─────────────────────┐
│ 📋 Kintsugi Job Logs│       │ 📊 Kintsugi Analytics│       │ 💸 Kintsugi Payouts │
│                     │       │                     │       │                     │
│  1. Select mechanic │       │ Click View Analytics│       │  1. Select mechanic │
│  2. Select week     │       │ to see this week's  │       │  2. See their payout│
│  3. See job log     │       │ repair summary      │       │     privately       │
│  [ 📋 Request Logs ]│       │  [ 📊 View Analytics]│       │  [ 💸 View My Payout]│
└─────────────────────┘       └─────────────────────┘       └─────────────────────┘
```

All interaction results are **private (ephemeral)** — only the person who clicked the button sees them. Channels stay clean no matter how many people use the panels.

---

## How it works

**Job Logs panel** (in #jobs):
```
Click 📋 Request Job Logs
  → Private mechanic dropdown
  → Private week dropdown
  → Private job-log embed
```

**Analytics panel** (in #analytics):
```
Click 📊 View Analytics
  → Private analytics summary for the current week
     (falls back to most recent week if no data yet)
```

**Payouts panel** (in #payouts):
```
Click 💸 View My Payout
  → Private mechanic dropdown
  → Private payout embed for the most recent completed week
```

The bot also:
- Posts/edits a weekly analytics summary in #analytics every Sunday at 18:00 UTC
- Posts weekly job-activity to #jobs every Sunday at 18:00 UTC
- Sends a payday reminder ping in #payouts every Sunday at 18:00 UTC
- Handles `/analytics` and `/payouts` slash commands

**Stack — 100 % free:**

| Layer | Service | Free tier |
|---|---|---|
| Bot hosting | Cloudflare Workers (named `kintsugi-bot`) | 100k req/day |
| Interactions delivery | Discord Components API | Free |
| Data source | Google Sheets (public CSV) | Free |
| State persistence | Cloudflare Workers KV | 1 GB / 100k reads / 1k writes per day |
| CI/CD | GitHub Actions | Free |

---

## Architecture

Two separate Cloudflare Workers:

| Worker | Name | Purpose |
|---|---|---|
| Static assets | `kintsugi` | Serves the web dashboard, CORS gateway |
| Discord bot | `kintsugi-bot` | Handles all Discord interactions |

The **Interactions Endpoint URL** in the Discord Developer Portal must point to the **`kintsugi-bot` worker URL** (e.g. `https://kintsugi-bot.<subdomain>.workers.dev`).

---

## Prerequisites

- A [Discord account](https://discord.com) with permission to add bots to your server
- A [Cloudflare account](https://cloudflare.com) (free tier is enough)
- [Node.js 18+](https://nodejs.org) on your machine (only for the setup scripts if running locally)

---

## Setup — step by step

### 1 · Create a Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Name it (e.g. *Kintsugi Bot*) and click **Create**.
3. **General Information** tab → copy the **Application ID** and **Public Key**.
4. **Bot** tab → **Reset Token** → copy the **Bot Token** (keep it secret).

### 2 · Invite the bot to your server

1. **OAuth2 → URL Generator** in the Developer Portal.
2. **Scopes**: tick `bot` and `applications.commands`.
3. **Bot Permissions**: tick `Send Messages` and `Read Message History`.
4. Copy the generated URL, open it in a browser, and invite the bot.

### 3 · Set up Cloudflare Workers

1. Log in to <https://dash.cloudflare.com> → **Workers & Pages** → **Create**.
2. Give it any temporary name (the `wrangler.toml` sets `kintsugi-bot` on deploy).
3. Note your **Account ID** from the dashboard URL or right-hand sidebar.

### 4 · Add GitHub repository secrets

**Settings → Secrets and variables → Actions → New repository secret**

**Required secrets:**

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Workers Scripts:Edit** and **Workers KV Storage:Edit** permissions ([create one here](https://dash.cloudflare.com/profile/api-tokens)) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `DISCORD_PUBLIC_KEY` | The **Public Key** from step 1 |
| `DISCORD_APP_ID` | The **Application ID** from step 1 (used to register slash commands) |
| `DISCORD_BOT_TOKEN` | The **Bot Token** from step 1 (keep it secret) |
| `ANALYTICS_CHANNEL_ID` | Discord channel ID for your **#analytics** channel |
| `JOBS_CHANNEL_ID` | Discord channel ID for your **#jobs** channel |
| `PAYOUTS_CHANNEL_ID` | Discord channel ID for your **#payouts** channel |
| `INVOICE_CHANNEL_ID` | Discord channel ID for your **#invoice** channel |

**Optional secrets:**

| Secret name | Value |
|---|---|
| `RIPTIDE_USER_ID` | Numeric Discord user ID to @mention on payday (e.g. `123456789012345678`) |
| `TRIGGER_TOKEN` | A strong random secret (e.g. `openssl rand -hex 32`) for the dashboard **"Notify Discord"** and **"Trigger Weekly"** buttons |

> **How to get a channel ID:** Enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click any channel and choose **Copy Channel ID**.

### 5 · Deploy the Bot Worker

Push any change to `discord-bot/` on the `main` branch, **or** go to:  
**Actions → Deploy Discord Bot → Run workflow**

The deploy workflow automatically:
1. Provisions the `KINTSUGI_BOT` KV namespace in Cloudflare (creates it if needed).
2. Binds it to the Worker as `KV` for persistent analytics/reminder state.
3. Deploys `worker.js` to Cloudflare as **`kintsugi-bot`**.
4. Syncs required secrets to the Worker's secret store.
5. Pushes optional secrets if they are configured (skips gracefully if not).
6. Registers `/payouts` and `/analytics` slash commands with Discord (if `DISCORD_APP_ID` is set).

### 6 · Set the Interactions Endpoint URL

After the deploy finishes, find the Worker URL in Cloudflare:  
**Workers & Pages → kintsugi-bot → Settings** — copy the URL (e.g. `https://kintsugi-bot.reecestangoe0824.workers.dev`).

1. Discord Developer Portal → your app → **General Information**.
2. Paste the **`kintsugi-bot` worker URL** into **Interactions Endpoint URL**.
3. Click **Save Changes** — Discord sends a PING; the Worker responds with PONG automatically. ✅

> ⚠️ **Important:** Use the `kintsugi-bot` worker URL, NOT the static-assets (`kintsugi`) worker URL.

### 7 · Post the panel messages

Post all three panels using GitHub Actions (no terminal required):

**Job Logs panel** (in #jobs):
1. **Actions → Post Job Logs Panel → Run workflow**
2. Leave channel ID blank to use `JOBS_CHANNEL_ID`, or enter a different ID.

**Analytics panel** (in #analytics):
1. **Actions → Post Analytics Panel → Run workflow**
2. Leave channel ID blank to use `ANALYTICS_CHANNEL_ID`, or enter a different ID.

**Invoice panel** (in #invoice):
1. **Actions → Post Invoice Panel → Run workflow**
2. Leave channel ID blank to use `INVOICE_CHANNEL_ID`, or enter a different ID.

After posting each panel, **pin the message** in Discord (right-click → Pin) so it stays at the top.

That's it — all three panels are live! 🎉

<details>
<summary>Alternatively, run locally</summary>

```bash
# Job Logs panel
DISCORD_BOT_TOKEN=<token> DISCORD_CHANNEL_ID=<jobs-channel-id> node discord-bot/setup-panel.js

# Analytics panel
DISCORD_BOT_TOKEN=<token> DISCORD_CHANNEL_ID=<analytics-channel-id> node discord-bot/setup-analytics-panel.js

# Invoice panel
DISCORD_BOT_TOKEN=<token> DISCORD_CHANNEL_ID=<invoice-channel-id> node discord-bot/setup-invoice-panel.js
```

> To get a channel ID: right-click the channel in Discord → **Copy Channel ID**  
> (enable Developer Mode first: Discord Settings → Advanced → Developer Mode).

</details>

---

## Using the panels

### Job Logs panel

1. Any member clicks **📋 Request Job Logs**.
2. A private mechanic dropdown appears — only they can see it.
3. They pick a mechanic.
4. A private week dropdown appears — they pick a week.
5. The private message updates with the formatted job log.

### Analytics panel

1. Any member clicks **📊 View Analytics**.
2. The current week's analytics summary appears privately.
   - If the current week has no jobs yet, the most recent week with data is shown instead.

### Payouts panel

1. Any member clicks **💸 View My Payout**.
2. A private mechanic dropdown appears — only they can see it.
3. They pick their name.
4. Their payout for the most recent completed week appears privately, showing repairs, engine replacements, and total amount.

---

## Slash commands

After running the deploy workflow (or **Register Slash Commands**), three slash commands are available:

| Command | Description |
|---|---|
| `/analytics` | Shows the current week's analytics summary publicly in the channel |
| `/update-analytics [channel]` | Immediately refreshes the pinned analytics summary (edits the existing message — never spams new ones). If `channel` is specified, that channel is saved as the auto-update target for all future 5-minute refreshes. |
| `/payouts` | Posts the payouts-processed embed publicly, listing all mechanics and amounts |

All commands require **Manage Guild** permission by default. This can be changed per-server in **Server Settings → Integrations → Kintsugi Bot**.

### /update-analytics — auto-update target

The `channel` option lets you configure **which channel auto-updates every 5 minutes**, directly from Discord — no need to change GitHub secrets or redeploy.

```
/update-analytics channel:#analytics
```

What happens:
1. Analytics are posted / edited in `#analytics` immediately.
2. The channel ID is saved in Cloudflare KV (`analytics_channel_id`).
3. From that point on, every automatic 5-minute refresh targets this channel.

The saved channel persists until you run `/update-analytics channel:#other-channel` again.

> **Without a `channel` argument** the command uses the KV-stored channel from a previous run, or falls back to the `ANALYTICS_CHANNEL_ID` GitHub secret. At least one of these must be configured for the command to work.

---

## "Notify Discord: Payouts Processed" button (web dashboard)

The **Payouts** page has a **📢 Notify Discord: Payouts Processed** button. When clicked, it reads the most recent week's data from the Google Sheet and posts a "Payouts Processed" embed to your **#payouts** channel.

**First-time setup:**
1. Copy the bot worker URL from Cloudflare (e.g. `https://kintsugi-bot.reecestangoe0824.workers.dev`).
2. Generate a `TRIGGER_TOKEN` if you haven't already: `openssl rand -hex 32`
3. Add it as a GitHub secret named **`TRIGGER_TOKEN`** and redeploy.
4. Open the **Payouts** page and click **📢 Notify Discord: Payouts Processed**.
5. Enter the Worker URL and token in the config panel → **Save & Send**. Values are saved in your browser.

---

## File overview

```
discord-bot/
├── worker.js                  Cloudflare Worker — all bot logic (interactions + cron)
├── setup-panel.js             Post the Job Logs panel (run once)
├── setup-analytics-panel.js   Post the Analytics panel (run once)
├── setup-invoice-panel.js     Post the Invoice panel (run once)
├── register-commands.js       Register /analytics, /update-analytics, and /payouts slash commands
├── wrangler.toml              Cloudflare Workers deployment config (worker: kintsugi-bot)
└── README.md                  This file

.github/workflows/
├── deploy-bot.yml             Auto-deploy bot on push to discord-bot/**
├── setup-panel.yml            Post the Job Logs panel on demand
├── setup-analytics-panel.yml  Post the Analytics panel on demand
├── setup-invoice-panel.yml    Post the Invoice panel on demand
└── register-commands.yml      Register slash commands on demand
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "The specified interactions endpoint URL could not be verified" | Ensure you are using the **`kintsugi-bot` worker URL** (not the static-assets `kintsugi` worker). Check that `DISCORD_PUBLIC_KEY` in Cloudflare matches the Developer Portal value exactly. |
| "Invalid signature" in Worker logs | Confirm `DISCORD_PUBLIC_KEY` in Cloudflare exactly matches the Developer Portal value. |
| Button does nothing / shows error | Check Cloudflare Worker logs → likely the Google Sheet is private or the URL has changed. |
| Mechanic not in list | The sheet must be publicly accessible. Check that the **Mechanic** column name matches exactly. |
| Panel disappeared | Re-run the relevant **Post … Panel** Action to post a new one and pin it. |
| Slash commands not working | Run **Register Slash Commands** workflow (or add `DISCORD_APP_ID` to GitHub Secrets and redeploy). |
| `/update-analytics` shows "No analytics channel configured" | Run `/update-analytics` and pick a channel from the **channel** dropdown, or add `ANALYTICS_CHANNEL_ID` as a GitHub secret and redeploy. |
| Deploy fails at KV provisioning | Verify `CLOUDFLARE_API_TOKEN` has **Workers Scripts:Edit** and **Workers KV Storage:Edit** permissions. |
| Cron posts nothing / "missing required configuration" in logs | At least one channel ID secret is not set. Add all required secrets and redeploy. |
| Analytics posts a new message every week instead of editing | Confirm the KV namespace was provisioned (check deploy workflow logs) and the Worker has a `KV` binding in Cloudflare → Workers & Pages → kintsugi-bot → Settings → Bindings. |
| "Notify Discord" button shows config panel every time | Enter the bot Worker URL and `TRIGGER_TOKEN` — they are stored in your browser's localStorage. |
| "Notify Discord" returns 401 | The token doesn't match `TRIGGER_TOKEN` in the Worker. Re-check the secret and redeploy. |
| "Notify Discord" returns 501 | `TRIGGER_TOKEN` is not set. Add it to GitHub Secrets and redeploy. |
| "Notify Discord" returns 503 | `DISCORD_BOT_TOKEN` or `PAYOUTS_CHANNEL_ID` is missing. Add both and redeploy. |

---

## Data privacy

The Worker fetches the Google Sheet in read-only mode each time a user interacts. All panel interaction results are ephemeral (private to the requesting user). The only data persisted in Cloudflare KV is: the Discord message ID of the weekly analytics embed (so it can be edited rather than re-posted) and the date of the last payday reminder (to prevent duplicate pings). No personal data is stored.
