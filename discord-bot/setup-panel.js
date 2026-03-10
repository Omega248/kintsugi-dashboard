#!/usr/bin/env node
// =======================================
// Kintsugi Discord Bot — Panel Setup
//
// Posts the permanent "Request Job Logs" panel to a Discord channel.
// Run this ONCE.  The message will stay there forever; the bot handles
// all interactions without ever editing the panel itself.
//
// Requirements:
//   - Node.js 18+ (built-in fetch)
//   - DISCORD_BOT_TOKEN  — Bot token from the Discord Developer Portal
//   - DISCORD_CHANNEL_ID — ID of the channel to post the panel in
//     (right-click the channel in Discord → Copy Channel ID)
//
// Usage:
//   DISCORD_BOT_TOKEN=... DISCORD_CHANNEL_ID=... node setup-panel.js
//
// Tip: After running, pin the message so it stays at the top of the channel.
// =======================================

const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error(
    'Error: DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID environment variables are required.\n\n' +
    'Example:\n' +
    '  DISCORD_BOT_TOKEN=Bot.xxxxx DISCORD_CHANNEL_ID=1234567890 node setup-panel.js'
  );
  process.exit(1);
}

// ===== Panel message payload =====
// The panel is entirely static — no mechanic list needed here.
// The bot fetches mechanics fresh from the sheet each time the button is pressed.
const panelPayload = {
  embeds: [
    {
      title:       '📋 Kintsugi Job Logs',
      description:
        'Click **Request Job Logs** below to view a mechanic\'s repair history.\n\n' +
        '> 1. **Select a mechanic** from the dropdown\n' +
        '> 2. **Select a time period** — Current Week, This Month, or All Time\n' +
        '> 3. Your job log will appear **privately** (only you can see it)\n\n' +
        '_The mechanic list is loaded live from the job sheet each time._',
      color:  0x4f46e5,
      footer: { text: 'Kintsugi Motorworks · Job Logs Panel' },
    },
  ],
  components: [
    {
      type: 1, // ACTION_ROW
      components: [
        {
          type:      2,    // BUTTON
          custom_id: 'joblogs_start',
          label:     'Request Job Logs',
          style:     1,    // PRIMARY (blurple)
          emoji:     { name: '📋' },
        },
      ],
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
    console.error('Failed to post panel:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('✅ Panel posted!');
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
