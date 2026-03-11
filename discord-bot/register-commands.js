#!/usr/bin/env node
// =======================================
// Kintsugi Discord Bot — Command Registration
//
// Registers application commands with Discord.
// Run this once after initial deployment or whenever commands change.
//
// Registered commands:
//   /payouts   — Post a payouts-processed announcement for the most recent week
//   /analytics — Post this week's analytics summary with per-mechanic leaderboard
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

// ===== Command definitions =====

const commands = [
  {
    name:                       'payouts',
    description:                'Post a payouts-processed announcement for the most recent week.',
    dm_permission:              false,
    // Requires Manage Guild permission by default — configurable per-server in
    // Discord Server Settings → Integrations → Kintsugi Bot → /payouts.
    default_member_permissions: '32',
  },
  {
    name:                       'analytics',
    description:                'Post the current week\'s analytics summary (repairs, payout, leaderboard).',
    dm_permission:              false,
    default_member_permissions: '32',
  },
];

// ===== Register commands =====

async function registerCommands() {
  const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  console.log(GUILD_ID
    ? `Registering commands for guild ${GUILD_ID}…`
    : 'Registering global commands…'
  );

  // PUT replaces the full command list atomically
  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(commands),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Failed to register commands:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`✅ Registered ${commands.length} command(s):`);
  for (const cmd of data) {
    console.log(`   /${cmd.name} — ${cmd.description}`);
  }
}

registerCommands().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
