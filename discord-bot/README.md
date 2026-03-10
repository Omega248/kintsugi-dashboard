# Kintsugi Discord Bot

A lightweight Discord bot that puts a **permanent "Request Job Logs" panel** in any channel. Anyone with access clicks the button, picks a mechanic and time period from private dropdowns, and instantly gets their formatted job-log report — all without leaving Discord or opening the dashboard.

```
┌─────────────────────────────────────────────────────┐
│ 📋 Kintsugi Job Logs                                │
│ Click Request Job Logs below to view a mechanic's   │
│ repair history.                                     │
│                                                     │
│  1. Select a mechanic from the dropdown             │
│  2. Select a time period                            │
│  3. Your job log appears privately                  │
│                                                     │
│  [ 📋 Request Job Logs ]                            │
└─────────────────────────────────────────────────────┘
```

The panel message **never changes** — it lives in the channel permanently. All interactions are handled privately (ephemeral), so the channel stays clean no matter how many people use it.

---

## How it works

```
User clicks  📋 Request Job Logs  button
          │
          ▼  (panel is never touched again)
Bot sends private "thinking…" message visible only to that user
          │
          ▼
Bot fetches mechanic names from Google Sheets
          │
          ▼
Private message updates → mechanic dropdown appears
          │
          ▼
User picks a mechanic → private message updates → period dropdown appears
   ┌──────────────────────────────────┐
   │  📅 Current Week                │
   │  📆 This Month                  │
   │  📋 All Time                    │
   └──────────────────────────────────┘
          │
          ▼
Bot fetches full job data from Google Sheets
          │
          ▼
Private message updates → formatted job-log embed appears
```

**Stack — 100 % free:**

| Layer | Service | Free tier |
|---|---|---|
| Bot hosting | Cloudflare Workers | 100k req/day |
| Interactions delivery | Discord Components API | Free |
| Data source | Google Sheets (public CSV) | Free |
| CI/CD | GitHub Actions | Free |

No server, no database, no cold starts.  The Worker is stateless — the mechanic name is encoded directly into each select menu's `custom_id`, so nothing needs to be stored between steps.

---

## Prerequisites

- A [Discord account](https://discord.com) with permission to add bots to your server
- A [Cloudflare account](https://cloudflare.com) (free tier is enough)
- [Node.js 18+](https://nodejs.org) on your machine (only for the two setup scripts)

---

## Setup — step by step

### 1 · Create a Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Name it (e.g. *Kintsugi Bot*) and click **Create**.
3. **General Information** tab → copy the **Public Key**.
4. **Bot** tab → **Reset Token** → copy the **Bot Token** (keep it secret).

### 2 · Invite the bot to your server

1. **OAuth2 → URL Generator** in the Developer Portal.
2. **Scopes**: tick `bot`.
3. **Bot Permissions**: tick `Send Messages` and `Read Message History`.
4. Copy the generated URL, open it in a browser, and invite the bot.

> No `applications.commands` scope is needed — the bot uses no slash commands.

### 3 · Set up Cloudflare Workers

1. Log in to <https://dash.cloudflare.com> → **Workers & Pages** → **Create**.
2. Give it any temporary name (the `wrangler.toml` sets `kintsugi-discord-bot` on deploy).
3. Note your **Account ID** from the dashboard URL or right-hand sidebar.

### 4 · Add GitHub repository secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Workers Scripts:Edit** permission ([create one here](https://dash.cloudflare.com/profile/api-tokens)) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `DISCORD_PUBLIC_KEY` | The Public Key from step 1 |
| `DISCORD_BOT_TOKEN` | The Bot Token from step 1 (keep it secret — treat it like a password) |
| `ANALYTICS_CHANNEL_ID` | The Discord channel ID for your **#analytics** channel |
| `JOBS_CHANNEL_ID` | The Discord channel ID for your **#jobs** channel |
| `PAYOUTS_CHANNEL_ID` | The Discord channel ID for your **#payouts** channel |
| `RIPTIDE_USER_ID` | *(Optional)* Numeric Discord user ID to @mention on payday |

> **How to get a channel ID:** Enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click any channel and choose **Copy Channel ID**.

The deploy workflow automatically syncs all of these into the Cloudflare Worker's secret store on every deploy — you don't need to run `wrangler secret put` by hand.

### 5 · Deploy the Worker

Push any change to `discord-bot/` on the `main` branch, **or** go to:  
**Actions → Deploy Discord Bot → Run workflow**

The Action deploys `worker.js` and automatically syncs all secrets listed above (`DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `ANALYTICS_CHANNEL_ID`, `JOBS_CHANNEL_ID`, `PAYOUTS_CHANNEL_ID`, `RIPTIDE_USER_ID`) into the Worker's secret store.

After it finishes, copy the Worker URL from Cloudflare (e.g. `https://kintsugi-discord-bot.<subdomain>.workers.dev`).

### 6 · Set the Interactions Endpoint URL

1. Discord Developer Portal → your app → **General Information**.
2. Paste the Worker URL into **Interactions Endpoint URL**.
3. Click **Save Changes** — Discord sends a PING; the Worker responds with PONG automatically. ✅

### 7 · Post the panel message

The easiest way — no terminal required:

1. Go to **Actions → Post Job Logs Panel → Run workflow** in GitHub.
2. Leave **channel ID** blank to post to your `#jobs` channel (uses the `JOBS_CHANNEL_ID` secret), or type a different channel ID to post elsewhere.
3. Click **Run workflow**.

The Action prints the new message ID in its logs. **Pin the message** in Discord (right-click → Pin) so it stays at the top of the channel.

That's it — the panel is live! 🎉

<details>
<summary>Alternatively, run locally</summary>

```bash
DISCORD_BOT_TOKEN=<your bot token> \
DISCORD_CHANNEL_ID=<channel id> \
node discord-bot/setup-panel.js
```

> To get a channel ID: right-click the channel in Discord → **Copy Channel ID**  
> (enable Developer Mode first: Discord Settings → Advanced → Developer Mode).

</details>

---

## Using the panel

1. Any member with access to the channel clicks **📋 Request Job Logs**.
2. A private dropdown appears — only they can see it.
3. They pick a mechanic from the list.
4. A second private dropdown appears — they pick a time period.
5. The private message updates with the formatted job log.

No other members see the interaction — the channel panel stays clean.

---

## File overview

```
discord-bot/
├── worker.js             Cloudflare Worker — all bot logic
├── setup-panel.js        Run once to post the permanent panel message
├── register-commands.js  Utility to clear old slash commands (if any)
├── wrangler.toml         Cloudflare Workers deployment config
└── README.md             This file

.github/
└── workflows/
    ├── deploy-bot.yml    GitHub Actions — auto-deploy on push
    └── setup-panel.yml   GitHub Actions — post the panel message on demand
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Invalid signature" in Worker logs | Confirm `DISCORD_PUBLIC_KEY` in Cloudflare exactly matches the Developer Portal value. |
| Button does nothing / shows error | Check Cloudflare Worker logs → likely the Google Sheet is private or the URL has changed. |
| Mechanic not in list | The sheet must be publicly accessible. Check that the **Mechanic** column name matches exactly. |
| Panel disappeared | Re-run the **Post Job Logs Panel** Action (or `setup-panel.js` locally) to post a new one and pin it. |
| Bot was already using `/joblogs` | Run `node discord-bot/register-commands.js` to clear the old slash command. |
| Deploy Action fails | Verify `CLOUDFLARE_API_TOKEN` has Workers Scripts:Edit permission and `CLOUDFLARE_ACCOUNT_ID` is correct. |
| Cron posts nothing / "missing required configuration" in logs | At least one channel ID secret is not set. Add `DISCORD_BOT_TOKEN`, `ANALYTICS_CHANNEL_ID`, `JOBS_CHANNEL_ID`, and `PAYOUTS_CHANNEL_ID` to GitHub Secrets and re-deploy. |
| Cron posts to wrong channel | Double-check the channel IDs in GitHub Secrets — copy each ID fresh from Discord (right-click channel → Copy Channel ID). |

---

## Data privacy

The Worker fetches the Google Sheet in read-only mode each time a user interacts. No data is stored by Cloudflare — every request is stateless and discarded after the reply. Job log results are always ephemeral (private to the requesting user).
