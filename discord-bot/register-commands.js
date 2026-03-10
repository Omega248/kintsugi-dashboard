#!/usr/bin/env node
// =======================================
// Kintsugi Discord Bot — Command Cleanup
//
// The bot no longer uses any slash commands — everything is driven by the
// permanent panel message.  Run this once to remove any previously-registered
// /joblogs command from your Discord application.
//
// Requirements:
//   - Node.js 18+ (built-in fetch)
//   - DISCORD_APP_ID environment variable
//   - DISCORD_BOT_TOKEN environment variable
//
// Usage:
//   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node register-commands.js
//
// To target a specific guild (server) instead of global commands:
//   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=<id> node register-commands.js
// =======================================

const APP_ID    = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID  = process.env.DISCORD_GUILD_ID || '';

if (!APP_ID || !BOT_TOKEN) {
  console.error(
    'Error: DISCORD_APP_ID and DISCORD_BOT_TOKEN environment variables are required.'
  );
  process.exit(1);
}

async function clearCommands() {
  const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  console.log(GUILD_ID
    ? `Clearing commands for guild ${GUILD_ID}…`
    : 'Clearing global commands…'
  );

  // PUT with an empty array removes all registered commands
  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify([]),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Failed to clear commands:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('✅ All slash commands cleared.');
}

clearCommands().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
