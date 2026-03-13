#!/usr/bin/env node
// =======================================
// Kintsugi Discord Bot — Invoice Panel Setup
//
// Posts the permanent "Generate Monthly Invoice" panel to a Discord channel.
// Run this ONCE.  The message will stay there forever; the bot handles
// all interactions without ever editing the panel itself.
//
// Requirements:
//   - Node.js 18+ (built-in fetch)
//   - DISCORD_BOT_TOKEN  — Bot token from the Discord Developer Portal
//   - DISCORD_CHANNEL_ID — ID of the #payouts channel to post the panel in
//     (right-click the channel in Discord → Copy Channel ID)
//
// Usage:
//   DISCORD_BOT_TOKEN=... DISCORD_CHANNEL_ID=... node setup-payouts-panel.js
//
// Tip: After running, pin the message so it stays at the top of the channel.
// =======================================

const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error(
    'Error: DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID environment variables are required.\n\n' +
    'Example:\n' +
    '  DISCORD_BOT_TOKEN=Bot.xxxxx DISCORD_CHANNEL_ID=1234567890 node setup-payouts-panel.js'
  );
  process.exit(1);
}

// ===== Panel message payload =====
// The panel is entirely static.  The bot fetches live job data from
// Google Sheets each time the button is pressed.
const panelPayload = {
  embeds: [
    {
      title:       '📋 Kintsugi Department Invoices',
      description:
        'Click **Generate Monthly Invoice** below to produce billing invoices for BCSO and LSPD.\n\n' +
        '> 1. **Select a month** from the dropdown\n' +
        '> 2. Two invoices are generated **privately** (only you can see them):\n' +
        '>    — one for **BCSO**, one for **LSPD**\n' +
        '> 3. Each invoice includes a **CSV file** with every job — mechanic,\n' +
        '>    officer, license plate, date, repairs, engine replacements & total\n\n' +
        '_Data is loaded live from the job sheet each time you press the button._',
      color:  0x22c55e,
      footer: { text: 'Kintsugi Motorworks · Invoice Panel' },
    },
  ],
  components: [
    {
      type: 1, // ACTION_ROW
      components: [
        {
          type:      2,    // BUTTON
          custom_id: 'payouts_panel_start',
          label:     'Generate Monthly Invoice',
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
    console.error('Failed to post invoice panel:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('✅ Invoice panel posted!');
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

