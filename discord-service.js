// =======================================
// Kintsugi Discord Service
// Handles Discord webhook integrations for auto-posting updates,
// payouts-processed announcements, and payday reminders.
//
// Security: Webhook URLs and user IDs are stored in localStorage only —
// they are never committed to the repository.
// =======================================

const DISCORD_STORAGE_KEY = 'kintsugi_discord_config';

const DISCORD_CONFIG_DEFAULTS = {
  analyticsWebhookUrl: '',      // Webhook for auto-posting data updates
  payoutsWebhookUrl: '',        // Webhook for payouts-processed + payday reminder
  riptide248UserId: '',         // Discord user ID to ping on payday (e.g. "123456789012345678")
  autoPostEnabled: false,       // Whether to auto-post on data change
  paydayDay: 1,                 // Day to send payday reminder: 0=Sun 1=Mon 2=Tue …
  lastDataFingerprint: '',      // Last seen data fingerprint (for change detection)
  lastReminderDate: '',         // ISO date (YYYY-MM-DD) of last payday reminder sent
  lastAutoPostDate: '',         // ISO date of last auto analytics post
  lastAnalyticsMessageId: ''    // Discord message ID of the last analytics embed (for editing)
};

// ===== Config helpers =====

function kDiscordGetConfig() {
  try {
    const raw = localStorage.getItem(DISCORD_STORAGE_KEY);
    if (!raw) return { ...DISCORD_CONFIG_DEFAULTS };
    return { ...DISCORD_CONFIG_DEFAULTS, ...JSON.parse(raw) };
  } catch (_e) {
    return { ...DISCORD_CONFIG_DEFAULTS };
  }
}

function kDiscordSaveConfig(partial) {
  const current = kDiscordGetConfig();
  const updated = { ...current, ...partial };
  try {
    localStorage.setItem(DISCORD_STORAGE_KEY, JSON.stringify(updated));
  } catch (_e) {
    console.warn('kDiscordSaveConfig: localStorage write failed');
  }
  return updated;
}

// ===== Core webhook post =====

/**
 * POST a payload to a Discord webhook URL.
 * Returns true on success, false on failure.
 * Validates that the URL starts with the official Discord webhook prefix.
 */
async function kDiscordPost(webhookUrl, payload) {
  if (
    !webhookUrl ||
    !webhookUrl.startsWith('https://discord.com/api/webhooks/')
  ) {
    console.warn('kDiscordPost: invalid or missing webhook URL');
    return false;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (err) {
    console.error('kDiscordPost: fetch failed', err);
    return false;
  }
}

// ===== Data change detection =====

/**
 * Compute a lightweight fingerprint used to detect new data.
 * @param {number} totalRepairs
 * @param {string} latestWeekISO  e.g. "2025-06-09"
 */
function kDiscordComputeFingerprint(totalRepairs, latestWeekISO) {
  return `${totalRepairs}|${latestWeekISO || ''}`;
}

// ===== Payday helpers =====

function kDiscordIsPayday(config) {
  return new Date().getDay() === Number(config.paydayDay);
}

function kDiscordReminderSentToday(config) {
  const today = new Date().toISOString().slice(0, 10);
  return config.lastReminderDate === today;
}

function kDiscordAutoPostSentToday(config) {
  const today = new Date().toISOString().slice(0, 10);
  return config.lastAutoPostDate === today;
}

// ===== Analytics update post =====

/**
 * Post or edit an embed on the analytics webhook announcing updated weekly stats.
 * On first call (or if the previous message was deleted) a new message is posted
 * using `?wait=true` so that the message ID can be stored. Subsequent calls edit
 * that same message with PATCH so the channel is not flooded with new posts.
 *
 * @param {{ weekISO: string, totalRepairs: number, payoutThisWeek: number,
 *           topMechanic: string|null, topMechRepairs: number,
 *           mechanicsBreakdown: Object.<string,number>|null }} weekData
 */
async function kDiscordPostAnalyticsUpdate(weekData) {
  const config = kDiscordGetConfig();
  if (!config.autoPostEnabled || !config.analyticsWebhookUrl) return false;

  const { weekISO, totalRepairs, payoutThisWeek, mechanicsBreakdown } = weekData;

  const fields = [
    { name: '📅 Week Ending', value: weekISO || '—', inline: true },
    { name: '🔧 Repairs', value: String(totalRepairs), inline: true },
    {
      name: '💵 Mechanic Payout',
      value: '$' + Number(payoutThisWeek).toLocaleString(),
      inline: true
    }
  ];

  // List every mechanic sorted by repairs descending
  if (mechanicsBreakdown && Object.keys(mechanicsBreakdown).length > 0) {
    const sorted = Object.entries(mechanicsBreakdown).sort((a, b) => b[1] - a[1]);
    const mechLines = sorted
      .map(([name, reps]) => `• ${kEscapeHtml(name)}: ${reps} repair${reps !== 1 ? 's' : ''}`)
      .join('\n');
    fields.push({ name: '👥 Mechanic Breakdown', value: mechLines, inline: false });
  }

  const payload = {
    embeds: [
      {
        title: '📊 Kintsugi Motorworks — Weekly Update',
        color: 0x4f46e5,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'Kintsugi Dashboard · Auto Update' }
      }
    ]
  };

  const webhookUrl = config.analyticsWebhookUrl;
  const today = new Date().toISOString().slice(0, 10);

  // ── Try to edit the existing message first ──────────────────────────────
  if (config.lastAnalyticsMessageId) {
    try {
      const editRes = await fetch(
        `${webhookUrl}/messages/${config.lastAnalyticsMessageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      if (editRes.ok) {
        kDiscordSaveConfig({ lastAutoPostDate: today });
        return true;
      }
      // Message not found or inaccessible — fall through to post a new one
    } catch (err) {
      console.warn(
        'kDiscordPostAnalyticsUpdate: failed to edit existing Discord message ' +
        '(it may have been deleted) — posting a new message instead',
        err
      );
    }
  }

  // ── Post a new message (capture ID via ?wait=true) ──────────────────────
  try {
    const postRes = await fetch(`${webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (postRes.ok) {
      const msg = await postRes.json();
      kDiscordSaveConfig({ lastAutoPostDate: today, lastAnalyticsMessageId: msg.id || '' });
      return true;
    }
    return false;
  } catch (err) {
    console.error('kDiscordPostAnalyticsUpdate: post failed', err);
    return false;
  }
}

// ===== Payouts-processed announcement =====

/**
 * Post a public payouts-processed message WITHOUT @ing anyone.
 * @param {string} weekEnding  Human-readable week-ending string
 * @param {string[]} mechanicList  Names of mechanics paid
 */
async function kDiscordPostPayoutsProcessed(weekEnding, mechanicList) {
  const config = kDiscordGetConfig();
  if (!config.payoutsWebhookUrl) return false;

  let description =
    `✅ Payouts for the week ending **${weekEnding}** have been processed.\n\n` +
    `All mechanics listed below have been paid. If you believe there is an error, please contact management.`;

  if (mechanicList && mechanicList.length > 0) {
    const safeNames = mechanicList.map(m => `• ${kEscapeHtml(m)}`).join('\n');
    description += `\n\n**Mechanics paid this week:**\n${safeNames}`;
  }

  const payload = {
    embeds: [
      {
        title: '✅ Payouts Processed',
        description,
        color: 0x22c55e,
        timestamp: new Date().toISOString(),
        footer: { text: 'Kintsugi Motorworks · Payouts' }
      }
    ]
  };

  return await kDiscordPost(config.payoutsWebhookUrl, payload);
}

// ===== Payday reminder (pings @riptide248) =====

/**
 * Send a payday reminder that pings @riptide248 to process payouts.
 * The user ID must be configured in settings.
 * @param {string} weekEnding  Human-readable week-ending string
 */
async function kDiscordSendPaydayReminder(weekEnding) {
  const config = kDiscordGetConfig();
  if (!config.payoutsWebhookUrl) return false;

  const mention = config.riptide248UserId
    ? `<@${config.riptide248UserId}>`
    : '**@riptide248**';

  const payload = {
    content:
      `${mention} 💰 **Payday reminder!** Payouts are due to be processed for the week ending **${weekEnding}**. Please review and mark them as processed in the dashboard when done.`
  };

  const ok = await kDiscordPost(config.payoutsWebhookUrl, payload);
  if (ok) {
    kDiscordSaveConfig({ lastReminderDate: new Date().toISOString().slice(0, 10) });
  }
  return ok;
}

// ===== Orchestration helpers =====

/**
 * Compare data fingerprint against stored value; post an analytics update to
 * Discord if the data has changed (new repairs or new week detected).
 *
 * @param {{ totalRepairs: number, weekISO: string, payoutThisWeek: number,
 *           topMechanic: string|null, topMechRepairs: number }} weekData
 */
async function kDiscordCheckAndPostUpdate(weekData) {
  const config = kDiscordGetConfig();
  if (!config.autoPostEnabled || !config.analyticsWebhookUrl) return;

  const fp = kDiscordComputeFingerprint(weekData.totalRepairs, weekData.weekISO);
  if (fp === config.lastDataFingerprint) return; // No change since last check

  // Persist the new fingerprint before posting (avoids duplicate sends on
  // concurrent rapid refreshes).
  kDiscordSaveConfig({ lastDataFingerprint: fp });

  const ok = await kDiscordPostAnalyticsUpdate(weekData);
  if (ok && typeof kShowToast === 'function') {
    kShowToast('Discord: Weekly update posted', 'success', 3000);
  }
}

/**
 * On payday, send a ping to @riptide248 reminding them to process payouts.
 * Sends at most once per calendar day.
 *
 * @param {string} weekEnding  Human-readable week-ending string
 */
async function kDiscordCheckAndSendPaydayReminder(weekEnding) {
  const config = kDiscordGetConfig();
  if (!config.payoutsWebhookUrl) return;
  if (!config.riptide248UserId) return;
  if (!kDiscordIsPayday(config)) return;
  if (kDiscordReminderSentToday(config)) return;

  const ok = await kDiscordSendPaydayReminder(weekEnding);
  if (ok && typeof kShowToast === 'function') {
    kShowToast('Discord: Payday reminder sent to @riptide248', 'info', 4000);
  }
}
