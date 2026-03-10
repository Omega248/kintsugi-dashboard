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
  analyticsWebhookUrl: '',   // Webhook for auto-posting data updates
  payoutsWebhookUrl: '',     // Webhook for payouts-processed + payday reminder
  riptide248UserId: '',      // Discord user ID to ping on payday (e.g. "123456789012345678")
  autoPostEnabled: false,    // Whether to auto-post on data change
  paydayDay: 1,              // Day to send payday reminder: 0=Sun 1=Mon 2=Tue …
  lastDataFingerprint: '',   // Last seen data fingerprint (for change detection)
  lastReminderDate: '',      // ISO date (YYYY-MM-DD) of last payday reminder sent
  lastAutoPostDate: '',      // ISO date of last auto analytics post
  liveMessageId: ''          // Discord message ID of the live view message (for editing in-place)
};

// Pay per repair — kept in sync with PAYMENT_RATES.PAY_PER_REPAIR in constants.js
const DISCORD_PAY_PER_REPAIR = (typeof PAYMENT_RATES !== 'undefined' ? PAYMENT_RATES.PAY_PER_REPAIR : null) || 700;

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

// ===== Core webhook helpers =====

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

/**
 * POST a payload to a Discord webhook using ?wait=true so Discord returns the
 * created message object. Returns { ok, messageId } where messageId is the
 * Discord snowflake ID of the posted message (null on failure).
 */
async function kDiscordPostWithId(webhookUrl, payload) {
  if (
    !webhookUrl ||
    !webhookUrl.startsWith('https://discord.com/api/webhooks/')
  ) {
    console.warn('kDiscordPostWithId: invalid or missing webhook URL');
    return { ok: false, messageId: null };
  }
  try {
    const res = await fetch(webhookUrl + '?wait=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return { ok: false, messageId: null };
    const data = await res.json();
    return { ok: true, messageId: data.id || null };
  } catch (err) {
    console.error('kDiscordPostWithId: fetch failed', err);
    return { ok: false, messageId: null };
  }
}

/**
 * PATCH (edit) an existing Discord webhook message in-place.
 * Returns true on success, false on failure.
 * @param {string} webhookUrl  The webhook URL (without trailing slash)
 * @param {string} messageId   The snowflake ID of the message to edit
 * @param {object} payload     The new embed/content payload
 */
async function kDiscordPatch(webhookUrl, messageId, payload) {
  if (
    !webhookUrl ||
    !webhookUrl.startsWith('https://discord.com/api/webhooks/') ||
    !messageId
  ) {
    console.warn('kDiscordPatch: invalid or missing webhook URL / message ID');
    return false;
  }
  try {
    const res = await fetch(
      webhookUrl + '/messages/' + encodeURIComponent(messageId),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    return res.ok;
  } catch (err) {
    console.error('kDiscordPatch: fetch failed', err);
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
 * Post (or edit in-place) a Discord embed that mirrors the "This Week — Live View"
 * panel exactly: repairs, payout, top mechanic, active count, and mechanic breakdown.
 *
 * On the first call the message is POSTed and its ID is saved to localStorage so
 * every subsequent update edits that same message instead of creating a new one.
 *
 * @param {{ weekISO: string, totalRepairs: number, payoutThisWeek: number,
 *           topMechanic: string|null, topMechRepairs: number,
 *           perMechWeek: Object.<string,number>|null }} weekData
 */
async function kDiscordPostAnalyticsUpdate(weekData) {
  const config = kDiscordGetConfig();
  if (!config.autoPostEnabled || !config.analyticsWebhookUrl) return false;

  const {
    totalRepairs,
    payoutThisWeek,
    topMechanic,
    topMechRepairs,
    perMechWeek
  } = weekData;

  // ── 4 KPI inline fields (match the 4 cards in the UI panel) ──
  const fields = [
    {
      name: 'REPAIRS THIS WEEK',
      value: String(totalRepairs || 0),
      inline: true
    },
    {
      name: 'PAYOUT THIS WEEK',
      value: '$' + Number(payoutThisWeek || 0).toLocaleString(),
      inline: true
    }
  ];

  if (topMechanic) {
    fields.push({
      name: 'TOP MECHANIC',
      value:
        '**' +
        kEscapeHtml(topMechanic) +
        '**\n' +
        topMechRepairs +
        ' repairs · $' +
        (topMechRepairs * DISCORD_PAY_PER_REPAIR).toLocaleString(),
      inline: true
    });
  } else {
    fields.push({ name: 'TOP MECHANIC', value: '—', inline: true });
  }

  const activeMechanics = perMechWeek ? Object.keys(perMechWeek).length : 0;
  fields.push({
    name: 'ACTIVE THIS WEEK',
    value: String(activeMechanics),
    inline: true
  });

  // ── Mechanic breakdown list ──
  if (perMechWeek && Object.keys(perMechWeek).length > 0) {
    const sorted = Object.entries(perMechWeek).sort((a, b) => b[1] - a[1]);
    const lines = sorted.map(([name, reps]) => {
      const pay = reps * DISCORD_PAY_PER_REPAIR;
      return (
        '`' +
        kEscapeHtml(name) +
        '` — ' +
        reps +
        ' repair' +
        (reps !== 1 ? 's' : '') +
        ' · $' +
        pay.toLocaleString()
      );
    });
    fields.push({
      name: 'Mechanic Breakdown',
      value: lines.join('\n').slice(0, 1024),
      inline: false
    });
  }

  const payload = {
    embeds: [
      {
        title: '📊 This Week — Live View',
        color: 0x4f46e5,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'Kintsugi Dashboard · Live · auto-refresh every 5 min' }
      }
    ]
  };

  const { liveMessageId } = config;

  if (liveMessageId) {
    // Try to edit the existing message in-place (no new message posted)
    const patched = await kDiscordPatch(
      config.analyticsWebhookUrl,
      liveMessageId,
      payload
    );
    if (patched) return true;

    // Edit failed (message deleted / channel changed) — fall through to a fresh post
    kDiscordSaveConfig({ liveMessageId: '' });
  }

  // First-time post (or re-post after a failed edit): use ?wait=true to get the message ID
  const { ok, messageId } = await kDiscordPostWithId(
    config.analyticsWebhookUrl,
    payload
  );
  if (ok && messageId) {
    kDiscordSaveConfig({ liveMessageId: messageId });
  }
  return ok;
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
