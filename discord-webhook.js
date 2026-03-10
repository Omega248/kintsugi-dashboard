// =======================================
// Kintsugi Discord Webhook Integration
// Send analytics and payout data to Discord
// Works entirely client-side for GitHub Pages hosting
// =======================================

const DISCORD_WEBHOOK_STORAGE_KEY = 'kintsugi_discord_webhook_url';
const DISCORD_ERROR_DETAIL_MAX_LEN = 120;
const DISCORD_DEFAULT_PAY_PER_REPAIR = 700;

// ----- URL management -----

/**
 * Get the stored Discord webhook URL from localStorage.
 * @returns {string} Webhook URL or empty string if not set
 */
function kGetDiscordWebhookUrl() {
  try {
    return localStorage.getItem(DISCORD_WEBHOOK_STORAGE_KEY) || '';
  } catch (_) {
    return '';
  }
}

/**
 * Save the Discord webhook URL to localStorage.
 * @param {string} url - Discord webhook URL
 * @returns {boolean} True if saved successfully
 */
function kSetDiscordWebhookUrl(url) {
  try {
    if (url && url.trim()) {
      localStorage.setItem(DISCORD_WEBHOOK_STORAGE_KEY, url.trim());
    } else {
      localStorage.removeItem(DISCORD_WEBHOOK_STORAGE_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Validate a Discord webhook URL.
 * Accepts discord.com and discordapp.com webhook paths.
 * @param {string} url - URL to validate
 * @returns {boolean} True if this looks like a valid Discord webhook URL
 */
function kValidateDiscordWebhookUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url.trim());
    return (
      (parsed.hostname === 'discord.com' || parsed.hostname === 'discordapp.com') &&
      parsed.pathname.startsWith('/api/webhooks/')
    );
  } catch (_) {
    return false;
  }
}

// ----- Sending -----

/**
 * POST a payload to the configured Discord webhook.
 * @param {Object} payload - Discord webhook payload (embeds, content, etc.)
 * @returns {Promise<boolean>} True if posted successfully
 */
async function kSendDiscordWebhook(payload) {
  const webhookUrl = kGetDiscordWebhookUrl();
  if (!webhookUrl) {
    kShowToast('No Discord webhook URL configured. Add one in ⚙️ Settings.', 'error', 5000);
    return false;
  }
  if (!kValidateDiscordWebhookUrl(webhookUrl)) {
    kShowToast('Invalid Discord webhook URL. Update it in ⚙️ Settings.', 'error', 5000);
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) { /* ignore */ }
      throw new Error(`Discord responded ${res.status}${detail ? ': ' + detail.slice(0, DISCORD_ERROR_DETAIL_MAX_LEN) : ''}`);
    }
    return true;
  } catch (err) {
    console.error('Discord webhook error:', err);
    kShowToast('Failed to post to Discord: ' + err.message, 'error', 6000);
    return false;
  }
}

// ----- Analytics embed -----

/**
 * Post an analytics summary embed to Discord.
 * @param {Object} data
 * @param {number}   data.totalRepairs     - Total repairs in selected period
 * @param {number}   data.totalPayout      - Total mechanic payout
 * @param {number}   data.activeMechanics  - Count of distinct mechanics
 * @param {string|number} data.avgPerPeriod - Average repairs per period
 * @param {string}   data.timeRange        - Human-readable time range label
 * @param {string}   data.groupBy          - "week" or "month"
 * @param {Array<{name:string, repairs:number}>} data.topMechanics - Ranked list
 * @returns {Promise<boolean>}
 */
async function kPostAnalyticsSummaryToDiscord(data) {
  const {
    totalRepairs = 0,
    totalPayout = 0,
    activeMechanics = 0,
    avgPerPeriod = '–',
    timeRange = 'All time',
    groupBy = 'week',
    topMechanics = [],
  } = data;

  const periodLabel = groupBy === 'month' ? 'month' : 'week';

  const fields = [
    { name: '🔧 Total Repairs',      value: totalRepairs.toLocaleString(), inline: true },
    { name: '💰 Total Payout',       value: kFmtMoney(totalPayout),        inline: true },
    { name: '👷 Active Mechanics',   value: String(activeMechanics),       inline: true },
    { name: `📊 Avg / ${periodLabel}`, value: String(avgPerPeriod),        inline: true },
  ];

  if (topMechanics.length) {
    const medals = ['🥇', '🥈', '🥉'];
    const lines = topMechanics
      .slice(0, 5)
      .map((m, i) => {
        const medal = medals[i] || `${i + 1}.`;
        return `${medal} **${m.name}** — ${m.repairs.toLocaleString()} repairs (${kFmtMoney(m.repairs * (typeof PAY_PER_REPAIR !== 'undefined' ? PAY_PER_REPAIR : DISCORD_DEFAULT_PAY_PER_REPAIR))})`;
      })
      .join('\n');
    fields.push({ name: '🏆 Top Mechanics', value: lines, inline: false });
  }

  const payload = {
    embeds: [{
      title: '📊 Kintsugi Motorworks — Analytics Report',
      description: `Period: **${timeRange}** · Grouped by **${periodLabel}**`,
      color: 0x4f46e5,
      fields,
      footer: { text: 'Kintsugi Dashboard · Live from Google Sheets' },
      timestamp: new Date().toISOString(),
    }],
  };

  return kSendDiscordWebhook(payload);
}

// ----- Weekly payout embed -----

/**
 * Post a weekly payout summary embed to Discord.
 * @param {Object} data
 * @param {string} data.weekEnd        - Week ending date string (formatted)
 * @param {number} data.totalPayout    - Total payout for the week
 * @param {number} data.totalRepairs   - Total repairs for the week
 * @param {Array<{mechanic:string, repairs:number, engineReplacements:number, payout:number}>} data.entries
 * @returns {Promise<boolean>}
 */
async function kPostWeeklyPayoutToDiscord(data) {
  const {
    weekEnd = '–',
    totalPayout = 0,
    totalRepairs = 0,
    entries = [],
  } = data;

  const fields = [
    { name: '🔧 Total Repairs',  value: totalRepairs.toLocaleString(), inline: true },
    { name: '💰 Total Payout',   value: kFmtMoney(totalPayout),        inline: true },
    { name: '👷 Mechanics Paid', value: String(entries.length),        inline: true },
  ];

  if (entries.length) {
    const lines = entries
      .slice(0, 10)
      .map(e => {
        const engineNote = e.engineReplacements > 0
          ? ` +${e.engineReplacements} eng`
          : '';
        return `**${e.mechanic}** — ${e.repairs} repairs${engineNote} → **${kFmtMoney(e.payout)}**`;
      })
      .join('\n');
    const extra = entries.length > 10 ? `\n_…and ${entries.length - 10} more_` : '';
    fields.push({ name: '📋 Mechanic Breakdown', value: lines + extra, inline: false });
  }

  const payload = {
    embeds: [{
      title: '💰 Kintsugi Motorworks — Weekly Payout',
      description: `Week ending **${weekEnd}**`,
      color: 0xd4af37,
      fields,
      footer: { text: 'Kintsugi Dashboard · Live from Google Sheets' },
      timestamp: new Date().toISOString(),
    }],
  };

  return kSendDiscordWebhook(payload);
}
