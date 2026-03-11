#!/usr/bin/env node
// =======================================
// Kintsugi Discord Bot — Analytics Panel Setup
//
// Posts the permanent analytics panel to a Discord channel.
// Run this ONCE.  The message will stay there forever.
//
// The bot's scheduled cron (every 5 minutes) automatically posts/edits a
// separate analytics summary message in the same channel with live data from
// Google Sheets.  The panel itself is a static informational embed with no
// button — analytics are always visible to everyone in the channel.
//
// Requirements:
//   - Node.js 18+ (built-in fetch)
//   - DISCORD_BOT_TOKEN  — Bot token from the Discord Developer Portal
//   - DISCORD_CHANNEL_ID — ID of the #analytics channel to post the panel in
//     (right-click the channel in Discord → Copy Channel ID)
//
// Usage:
//   DISCORD_BOT_TOKEN=... DISCORD_CHANNEL_ID=... node setup-analytics-panel.js
//
// Tip: After running, pin the message so it stays at the top of the channel.
// =======================================

const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error(
    'Error: DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID environment variables are required.\n\n' +
    'Example:\n' +
    '  DISCORD_BOT_TOKEN=Bot.xxxxx DISCORD_CHANNEL_ID=1234567890 node setup-analytics-panel.js'
  );
  process.exit(1);
}

// ===== Panel message payload =====
// The panel is static.  The bot automatically edits this channel's pinned
// analytics summary every 5 minutes via the scheduled cron trigger.
const panelPayload = {
  embeds: [
    {
      title:       '📊 Kintsugi Analytics',
      description:
        "The weekly analytics summary is shown above and automatically updated every 5 minutes.\n\n" +
        '> • The **current week\'s** analytics are shown (falling back to the most recent week with data)\n' +
        '> • Data is loaded live from the job sheet\n' +
        '> • Updates are visible to **everyone in the channel**',
      color:  0x4f46e5,
      footer: { text: 'Kintsugi Motorworks · Analytics Panel' },
    },
  ],
};

// ===== Post to channel =====
async function postPanel() {
  const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(panelPayload),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Failed to post analytics panel:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('✅ Analytics panel posted!');
  console.log(`   Channel : ${CHANNEL_ID}`);
  console.log(`   Message : ${data.id}`);
  console.log('');
  console.log('Tip: Right-click the message in Discord and select "Pin Message"');
  console.log('     so it stays visible at the top of the channel.');
}

postPanel().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
