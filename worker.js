// =======================================
// Kintsugi — Unified Cloudflare Worker
//
// Serves the Kintsugi web dashboard from static assets AND handles all Discord
// bot interactions in a single Cloudflare Worker deployment.  This eliminates
// any possibility of "split-brain" execution that would cause "Interaction
// Failed" errors in Discord.
//
// Request routing (handled in order):
//   OPTIONS *              → CORS preflight (for dashboard /api/* calls)
//   POST /api/notify-payouts → Notify Discord that payouts were processed
//   POST /api/trigger-weekly → Trigger the cron manually from the dashboard
//   POST (Discord signature) → Discord interactions (buttons, menus, commands)
//   GET /bot-config.js     → Auto-generated bot config (or safe fallback)
//   Everything else        → Static web-dashboard assets (with CSP headers)
//
// Discord Interactions Endpoint URL must point to THIS worker's URL.
// Set it in: Discord Developer Portal → General Information → Interactions Endpoint URL
//
// Required secrets (set via `wrangler secret put` or synced by GitHub Actions):
//   DISCORD_PUBLIC_KEY    — Ed25519 public key from the Discord Developer Portal
//   DISCORD_BOT_TOKEN     — Bot token used to post/edit messages in channels
//   ANALYTICS_CHANNEL_ID  — Discord channel ID for weekly analytics summaries
//   JOBS_CHANNEL_ID       — Discord channel ID for weekly job-activity updates
//   PAYOUTS_CHANNEL_ID    — Discord channel ID for payday reminder pings
//
// Optional secrets:
//   RIPTIDE_USER_ID       — Numeric Discord user ID to @mention on payday
//   TRIGGER_TOKEN         — Bearer token for the dashboard "Notify Discord" and
//                           "Trigger Weekly" buttons. Falls back to the hardcoded
//                           FALLBACK_TRIGGER_TOKEN constant if not set.
// =======================================

// ===== Sheet config (mirrors kintsugi-core.js) =====
const SHEET_ID        = '1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks';
const JOBS_SHEET      = 'Form responses 1';
const STATE_IDS_SHEET = "State ID's";

// ===== Fallback trigger token =====
// Used when the TRIGGER_TOKEN secret is not configured in the Worker environment.
// This allows the dashboard "Notify Discord" and "Trigger Weekly" buttons to work
// out of the box without needing to set up a GitHub secret.
const FALLBACK_TRIGGER_TOKEN = 'HnoKPfn9ZIYXD79c8PRos4cMphPKNHf5bfCbsjIS';

// ===== Pay rates (mirrors constants.js) =====
const PAY_PER_REPAIR        = 700;
const ENGINE_REIMBURSEMENT  = 12000;
const ENGINE_BONUS_LSPD     = 1500;
// Combined engine pay per replacement (LSPD/other rate — used when department is unknown)
const ENGINE_PAY_DEFAULT    = ENGINE_REIMBURSEMENT + ENGINE_BONUS_LSPD;

// ===== Discord embed display limits =====
const DISCORD_FIELD_MAX_CHARS = 1024; // Discord API field value character limit
const DISCORD_MAX_MECHANICS   = 10;   // Max mechanics to list in a single embed field
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,      // User clicked a button / used a select menu
};
const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6, // Acknowledge a component interaction, update later
  UPDATE_MESSAGE: 7,          // Immediately update the component's message (no follow-up needed)
};

// ===== Utility helpers =====

/** Convert a hex string to a Uint8Array. */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Verify the Ed25519 signature Discord attaches to every interaction.
 * Cloudflare Workers expose `crypto.subtle` which supports Ed25519 natively.
 */
async function verifyDiscordSignature(rawBody, signature, timestamp, publicKey) {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + rawBody)
    );
  } catch {
    return false;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ===== Google Sheets CSV fetch + parse =====

function sheetCsvUrl(sheetName) {
  return (
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
  );
}

async function fetchSheet(sheetName) {
  const res = await fetch(sheetCsvUrl(sheetName));
  if (!res.ok) {
    throw new Error(`Failed to fetch sheet "${sheetName}": HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text.trim() || text.trim().startsWith('<')) {
    throw new Error(
      `Sheet "${sheetName}" returned no usable data. ` +
      'Check that the spreadsheet is shared publicly.'
    );
  }
  return parseCSV(text);
}

/**
 * Minimal CSV parser — mirrors kintsugi-core.js kParseCSV.
 * Handles quoted fields, escaped double-quotes, and CRLF/LF line endings.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  const pushCell = () => { row.push(cur); cur = ''; };
  const pushRow  = () => {
    if (row.length || cur) { pushCell(); rows.push(row); row = []; }
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else {
      if      (c === '"')  { inQuotes = true; }
      else if (c === ',')  { pushCell(); }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { pushRow(); }
      else                 { cur += c; }
    }
  }
  if (cur || row.length) pushRow();
  return rows;
}

// ===== Date helpers =====

function parseDateLike(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // DD/MM/YYYY or DD-MM-YYYY (with optional time — UK/European format used by the sheet).
  // This must be checked BEFORE the generic new Date(s) fallback because V8 interprets
  // ambiguous d/m/yyyy strings as MM/DD (US format), which gives wrong results for
  // UK-format dates like "11/03/2026" (would be parsed as November 3 instead of March 11).
  const ddmmMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (ddmmMatch) {
    const dd   = parseInt(ddmmMatch[1], 10);
    const mm   = parseInt(ddmmMatch[2], 10);
    const yy   = ddmmMatch[3];
    const yyyy = yy.length === 2 ? '20' + yy : yy;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(`${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // YYYY-MM-DD (ISO date, possibly with time component)
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: let the engine try (handles RFC 2822, some locale formats, etc.)
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  });
}

function fmtMoney(n) {
  return '$' + Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US');
}

// ===== Week filtering =====

/**
 * Filter jobs that belong to the week ending on the given Sunday.
 * Matches by the "Week Ending" column date when present, otherwise falls back
 * to checking whether the form-submission timestamp (tsDate) falls within the
 * Monday–Sunday window of that week.
 */
function filterByWeekEnding(jobs, weekEndDate) {
  const ref = new Date(weekEndDate);
  ref.setHours(0, 0, 0, 0);
  // Monday that opens this week
  const mon = new Date(ref);
  mon.setDate(ref.getDate() - 6);
  // Sunday end of day
  const sun = new Date(ref);
  sun.setHours(23, 59, 59, 999);

  return jobs.filter(j => {
    if (j.weekEnd) {
      const we = new Date(j.weekEnd);
      we.setHours(0, 0, 0, 0);
      return we.getTime() === ref.getTime();
    }
    return j.bestDate && j.bestDate >= mon && j.bestDate <= sun;
  });
}

/**
 * Filter jobs that fall within the given calendar month.
 * @param {Array}  jobs  - Parsed job records
 * @param {number} year  - Full year (e.g. 2026)
 * @param {number} month - 0-based month (JS convention; 0 = January)
 */
function filterByMonth(jobs, year, month) {
  return jobs.filter(j => {
    const d = j.bestDate;
    if (!d) return false;
    return d.getUTCFullYear() === year && d.getUTCMonth() === month;
  });
}

// ===== Invoice helpers =====

/**
 * Build a CSV string for the invoice, one row per job.
 */
function buildInvoiceCsv(jobs) {
  const header = 'Date,Mechanic,Officer,License Plate,Repairs,Engine Replacements,Job Total ($)';
  const rows = jobs.map(j => {
    const jobTotal = (j.across || 0) * PAY_PER_REPAIR + (j.engineReplacements || 0) * ENGINE_REIMBURSEMENT;
    return [
      fmtDate(j.bestDate),
      j.mechanic,
      j.cop || '',
      j.plate || '',
      j.across || 0,
      j.engineReplacements || 0,
      jobTotal,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  return [header, ...rows].join('\n');
}

/**
 * Build a Discord embed summarising the monthly invoice for one department.
 */
function buildInvoiceEmbed(dept, monthLabel, jobs) {
  const totalRepairs = jobs.reduce((s, j) => s + (j.across || 0), 0);
  const totalEngines = jobs.reduce((s, j) => s + (j.engineReplacements || 0), 0);
  const grandTotal   = totalRepairs * PAY_PER_REPAIR + totalEngines * ENGINE_REIMBURSEMENT;
  const color = dept.toUpperCase() === 'BCSO' ? 0xd4a017 : dept.toUpperCase() === 'LSPD' ? 0x1e90ff : 0x22c55e;
  return {
    title:     `📋 ${dept} — Monthly Invoice`,
    color,
    fields: [
      { name: '📅 Month Ending',        value: monthLabel,            inline: true  },
      { name: '🧾 Total Jobs',          value: String(jobs.length),   inline: true  },
      { name: '🔧 Total Repairs',       value: String(totalRepairs),  inline: true  },
      { name: '🔩 Engine Replacements', value: String(totalEngines),  inline: true  },
      { name: '💵 Total Owed',          value: fmtMoney(grandTotal),  inline: false },
    ],
    footer:    { text: 'Kintsugi Motorworks · Invoice' },
    timestamp: new Date().toISOString(),
  };
}

// ===== Discord API helpers — file attachments =====

/**
 * Edit the original deferred ephemeral message and attach a file.
 * Uses multipart/form-data so Discord accepts both the JSON payload and the
 * binary attachment in a single PATCH request.
 */
async function editOriginalMessageWithFile(appId, token, content, embeds, filename, fileContent) {
  const url  = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content,
    embeds,
    components:  [],
    attachments: [{ id: 0, filename }],
  }));
  form.append('files[0]', new Blob([fileContent], { type: 'text/csv' }), filename);
  const res = await fetch(url, { method: 'PATCH', body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`editOriginalMessageWithFile failed (${res.status}): ${body}`);
  }
}

/**
 * Post a new ephemeral follow-up message with a file attachment.
 * Useful for sending a second department invoice without clobbering the first.
 */
async function postFollowupWithFile(appId, token, content, embeds, filename, fileContent) {
  const url  = `https://discord.com/api/v10/webhooks/${appId}/${token}`;
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content,
    embeds,
    components:  [],
    flags:       64, // ephemeral
    attachments: [{ id: 0, filename }],
  }));
  form.append('files[0]', new Blob([fileContent], { type: 'text/csv' }), filename);
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`postFollowupWithFile failed (${res.status}): ${body}`);
  }
}

// ===== Weekly aggregation (mirrors mechanics-script.js mechBuildWeeklyStats) =====

function buildWeeklyStats(jobs) {
  const weekMap = new Map();

  for (const j of jobs) {
    const d = j.bestDate;
    if (!d) continue;

    let weekKey, weekEndDate;
    if (j.weekEnd && !isNaN(j.weekEnd.getTime())) {
      weekKey     = j.weekEnd.toISOString().slice(0, 10);
      weekEndDate = j.weekEnd;
    } else {
      // ISO week calculation
      const dt  = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = dt.getUTCDay() || 7;
      dt.setUTCDate(dt.getUTCDate() + 4 - day);
      const yr  = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
      const wk  = Math.ceil(((dt - yr) / 86400000 + 1) / 7);
      weekKey   = `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
      // Week-ending Sunday for display
      const dayNum = d.getDay();
      weekEndDate  = new Date(d);
      weekEndDate.setDate(d.getDate() + (dayNum === 0 ? 0 : 7 - dayNum));
    }

    let rec = weekMap.get(weekKey);
    if (!rec) {
      rec = { weekKey, weekEndDate, jobCount: 0, totalRepairs: 0, engineReplacements: 0 };
      weekMap.set(weekKey, rec);
    }
    rec.jobCount++;
    rec.totalRepairs      += j.across || 0;
    rec.engineReplacements += j.engineReplacements || 0;
  }

  const weeks = Array.from(weekMap.values());
  weeks.sort((a, b) => {
    if (a.weekEndDate && b.weekEndDate) return b.weekEndDate - a.weekEndDate;
    return b.weekKey.localeCompare(a.weekKey);
  });

  for (const w of weeks) {
    const enginePay = w.engineReplacements * ENGINE_PAY_DEFAULT;
    w.totalPayout   = w.totalRepairs * PAY_PER_REPAIR + enginePay;
  }

  return weeks;
}

// ===== Sheet parsers =====

function parseJobsSheet(rows) {
  if (!rows || rows.length < 2) return [];
  const headers  = rows[0].map(h => (h || '').trim());
  const lower    = headers.map(h => h.toLowerCase());

  // Use fuzzy matching (like the web dashboard) to tolerate minor header
  // variations such as "Mechanic Name" vs "Mechanic", or "How many Across?"
  // vs "How many Across".
  const iMech   = lower.findIndex(h => h.includes('mechanic'));
  const iAcross = lower.findIndex(h => h.includes('across') || h.includes('repairs'));
  const iTime   = lower.findIndex(h => h.includes('timestamp'));
  const iWeek   = lower.findIndex(h => h.includes('week') && h.includes('end'));
  const iMonth  = lower.findIndex(h => h.includes('month') && h.includes('end'));
  const iEngine = lower.findIndex(h => h.includes('engine') && h.includes('replacement'));
  const iCop    = lower.findIndex(h => h.includes('cop') || (h.includes('officer') && !h.includes('timestamp')));
  const iPlate  = lower.findIndex(h => h.includes('plate') || h.includes('license') || h.includes('licence'));
  const iDept   = lower.findIndex(h => h.includes('department') || h.includes('dept') || h.includes('division') || h.includes('unit'));

  if (iMech === -1 || iAcross === -1) return [];

  const jobs = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const mech   = (row[iMech] || '').trim();
    if (!mech) continue;

    const across = parseInt(row[iAcross] || '0', 10) || 0;

    let engineCount = 0;
    if (iEngine !== -1) {
      const raw = (row[iEngine] || '').trim();
      const n   = Number(raw);
      if (!isNaN(n) && n > 0)               { engineCount = n; }
      else if (/^(yes|y|true)$/i.test(raw)) { engineCount = 1; }
    }

    // Skip rows with neither repairs nor engine replacements — they carry no
    // billable work.  Rows with engine replacements but zero repairs are kept
    // so engine-only jobs appear in invoices and payout calculations.
    if (!across && !engineCount) continue;

    const tsDate  = iTime  !== -1 ? parseDateLike(row[iTime])  : null;
    const weekEnd = iWeek  !== -1 ? parseDateLike(row[iWeek])  : null;
    const monthEnd= iMonth !== -1 ? parseDateLike(row[iMonth]) : null;
    const bestDate = tsDate || weekEnd || monthEnd;

    jobs.push({
      mechanic:           mech,
      across,
      engineReplacements: engineCount,
      cop:                iCop   !== -1 ? (row[iCop]   || '').trim() : '',
      plate:              iPlate !== -1 ? (row[iPlate] || '').trim() : '',
      department:         iDept  !== -1 ? (row[iDept]  || '').trim() : '',
      tsDate, weekEnd, monthEnd, bestDate,
    });
  }
  return jobs;
}

function parseStateIds(rows) {
  const map = new Map();
  if (!rows || rows.length < 2) return map;
  const lower  = rows[0].map(h => (h || '').trim().toLowerCase());
  const iMech  = lower.findIndex(h => h.includes('mechanic') || h.includes('name'));
  const iState = lower.findIndex(h => h.includes('state') && h.includes('id'));
  if (iMech === -1 || iState === -1) return map;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const mech = (row[iMech]  || '').trim();
    const sid  = (row[iState] || '').trim();
    if (mech && sid) map.set(mech, sid);
  }
  return map;
}

// ===== Discord API helpers =====

/**
 * Edit the original deferred message (works for both slash-command deferrals
 * and MESSAGE_COMPONENT deferrals — Discord uses the same endpoint for both).
 */
async function editOriginalMessage(appId, token, payload) {
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;
  const res = await fetch(url, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`editOriginalMessage failed (${res.status}): ${body}`);
  }
}

// ===== /payouts slash-command helpers =====

/**
 * Find the most recent week from all job data and return per-mechanic payout
 * details (sorted by total payout descending), plus the week-ending date.
 * @param {Array} allJobs - All parsed job records
 * @param {Map} stateMap - Mechanic name → state ID mapping
 */
function getLatestWeekPayouts(allJobs, stateMap) {
  const allWeeks = buildWeeklyStats(allJobs);
  if (!allWeeks.length) return { weekEndDate: null, payouts: [] };

  const latestWeek  = allWeeks[0]; // buildWeeklyStats sorts newest first
  const weekEndDate = latestWeek.weekEndDate || new Date(latestWeek.weekKey + 'T00:00:00Z');
  const weekJobs    = filterByWeekEnding(allJobs, weekEndDate);

  // Aggregate per mechanic
  const mechMap = new Map();
  for (const j of weekJobs) {
    let rec = mechMap.get(j.mechanic);
    if (!rec) {
      rec = {
        name:               j.mechanic,
        stateId:            stateMap.get(j.mechanic) || '',
        jobs:               0, // individual job submissions (rows)
        repairs:            0, // total "across" = repair slots across all jobs
        engineReplacements: 0,
        totalPayout:        0,
      };
      mechMap.set(j.mechanic, rec);
    }
    rec.jobs++;
    rec.repairs            += j.across || 0; // j.across = "How many Across" sheet column
    rec.engineReplacements += j.engineReplacements || 0;
  }

  const payouts = Array.from(mechMap.values()).map(m => {
    // Department info is not available in the weekly aggregate, so we use the
    // default (LSPD/other) engine pay rate for all engine replacements.
    m.totalPayout = m.repairs * PAY_PER_REPAIR + m.engineReplacements * ENGINE_PAY_DEFAULT;
    return m;
  }).sort((a, b) => b.totalPayout - a.totalPayout);

  return { weekEndDate, payouts };
}

/**
 * Build the payouts-processed embed payload with per-mechanic amounts and
 * state IDs so managers can cross-reference payout records.
 * @param {Date} weekEndDate - The week-ending date
 * @param {Array} payouts - Array of {name, stateId, repairs, engineReplacements, totalPayout}
 */
function buildPayoutsProcessedPayload(weekEndDate, payouts) {
  const header =
    `✅ Payouts for the week ending **${fmtDate(weekEndDate)}** have been processed.\n\n` +
    'All mechanics listed below have been paid. If you believe there is an error, please contact management.';

  const fields = [];

  if (payouts.length > 0) {
    // Per-mechanic breakdown (Discord field value cap: 1024 chars)
    const lines = payouts.map(m => {
      let line = `• **${m.name}**`;
      if (m.stateId) line += ` _(ID: ${m.stateId})_`;
      line += ` — ${m.jobs} job${m.jobs !== 1 ? 's' : ''} (${m.repairs} across)`;
      if (m.engineReplacements > 0) {
        line += `, ${m.engineReplacements} engine${m.engineReplacements !== 1 ? 's' : ''}`;
      }
      line += ` · **${fmtMoney(m.totalPayout)}**`;
      return line;
    });

    fields.push({
      name:   '💸 Mechanic Payouts',
      value:  lines.join('\n').slice(0, DISCORD_FIELD_MAX_CHARS),
      inline: false,
    });

    const grandTotal = payouts.reduce((s, m) => s + m.totalPayout, 0);
    fields.push({ name: '💰 Total Paid', value: fmtMoney(grandTotal), inline: true });
    fields.push({ name: '👷 Mechanics Paid', value: String(payouts.length), inline: true });
  }

  return {
    embeds: [{
      title:     '✅ Payouts Processed',
      description: header,
      color:     0x22c55e,
      fields,
      timestamp: new Date().toISOString(),
      footer:    { text: 'Kintsugi Motorworks · Payouts' },
    }],
  };
}

/**
 * Handle the /payouts slash command.
 * Defers publicly (everyone in the channel sees the response), reads the sheet,
 * and edits the deferred response with the payouts-processed embed including
 * per-mechanic amounts and state IDs.
 */
async function handlePayoutsCommand(interaction, ctx) {
  const { application_id: appId, token } = interaction;

  ctx.waitUntil((async () => {
    try {
      const [jobRows, stateRows] = await Promise.all([
        fetchSheet(JOBS_SHEET),
        fetchSheet(STATE_IDS_SHEET).catch(() => []), // state IDs are optional
      ]);
      const allJobs  = parseJobsSheet(jobRows);
      const stateMap = parseStateIds(stateRows);
      const { weekEndDate, payouts } = getLatestWeekPayouts(allJobs, stateMap);

      if (!weekEndDate || payouts.length === 0) {
        await editOriginalMessage(appId, token, {
          content:    '❌ No payout data found for the most recent week.',
          components: [],
        });
        return;
      }

      await editOriginalMessage(
        appId, token,
        buildPayoutsProcessedPayload(weekEndDate, payouts)
      );
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load payout data.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  // Deferred public response — visible to everyone in the channel
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });
}

// ===== /update-analytics slash-command handler =====

/**
 * Handle the /update-analytics slash command.
 * Defers privately (ephemeral), fetches live data from Google Sheets, then
 * posts or edits the analytics summary message — identical to what the
 * 5-minute cron does.  Only the invoking user sees the confirmation.
 *
 * Optional "channel" argument:
 *   When provided, the channel ID is persisted in KV so every future
 *   5-minute automatic refresh also posts to that channel.  Once set, the
 *   channel persists until changed again with another /update-analytics call.
 */
async function handleUpdateAnalyticsCommand(interaction, env, ctx) {
  const { application_id: appId, token } = interaction;

  ctx.waitUntil((async () => {
    try {
      // Extract optional channel option (Discord sends the channel ID as a string)
      const channelOption = interaction.data?.options?.find(o => o.name === 'channel');
      const channelId = channelOption?.value || null;

      // Persist the chosen channel in KV so the 5-minute cron auto-update uses it
      if (channelId && env.KV) {
        await env.KV.put('analytics_channel_id', channelId);
      }

      // Resolve the effective channel that postWeeklyAnalytics will use so the
      // confirmation message can show the actual channel rather than a vague label.
      // KV lookup is skipped when channelId was already provided via the command option.
      let effectiveChannelId = channelId;
      if (!effectiveChannelId && env.KV) {
        effectiveChannelId = await env.KV.get('analytics_channel_id').catch(err => {
          console.warn('handleUpdateAnalyticsCommand: KV.get(analytics_channel_id) failed:', err?.message);
          return null;
        });
      }
      if (!effectiveChannelId) {
        effectiveChannelId = env.ANALYTICS_CHANNEL_ID || null;
      }

      const jobRows = await fetchSheet(JOBS_SHEET);
      const allJobs = parseJobsSheet(jobRows);

      if (!allJobs.length) {
        await editOriginalMessage(appId, token, {
          content: '❌ No job data found in the sheet. Check that the spreadsheet is shared publicly.',
        });
        return;
      }

      // Use the current week; fall back to the most recent week with data
      let summary = buildCurrentWeekSummary(allJobs);
      if (summary.totalRepairs === 0) {
        const latest = buildLatestWeekSummary(allJobs);
        if (latest && latest.totalRepairs > 0) summary = latest;
      }

      const prevSummary = buildPrevWeekSummary(allJobs);
      const ok = await postWeeklyAnalytics(env, summary, prevSummary);

      if (ok) {
        const channelMention = effectiveChannelId ? `<#${effectiveChannelId}>` : 'the analytics channel';
        const autoUpdateNote = channelId
          ? '\n\n🔄 This channel is now the auto-update target — the 5-minute refresh will keep it updated.'
          : '';
        await editOriginalMessage(appId, token, {
          content:
            `✅ Analytics updated in ${channelMention} for the week ending **${fmtDate(summary.weekEndDate)}** — ` +
            `${summary.totalRepairs} repair${summary.totalRepairs !== 1 ? 's' : ''}, ` +
            `${fmtMoney(summary.totalPayout)} total payout.` +
            autoUpdateNote,
        });
      } else {
        const channelHint = effectiveChannelId
          ? `Could not post to <#${effectiveChannelId}> — check that the bot has **Send Messages** permission in that channel.`
          : 'No analytics channel configured. Run `/update-analytics` and pick a channel from the dropdown, or add `ANALYTICS_CHANNEL_ID` as a GitHub secret and redeploy.';
        await editOriginalMessage(appId, token, {
          content: `❌ Failed to update analytics. ${channelHint}`,
        });
      }
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content: `❌ Error: ${err.message}`,
      }).catch(() => {});
    }
  })());

  // Deferred ephemeral response — only the command invoker sees the result
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: 64 },
  });
}

// ===== Assistant Manager — AI persona used by DiscordGateway for @mentions =====

/**
 * System prompt that defines the Assistant Manager personality.
 * Used by the DiscordGateway Durable Object when the bot is @mentioned.
 */
const ASSISTANT_MANAGER_SYSTEM_PROMPT = `\
You are the Assistant Manager of Kintsugi Motorworks, a British mechanic shop. \
Your name is "The Manager". You are witty, incredibly sarcastic, and slightly impolite. \
You find every single question an absolute waste of your precious time. \
Respond in character using British slang naturally: mate, rubbish, daft, innit, \
absolute doughnut, bloody hell, blimey, sorted, dodgy, knackered, miffed, numpty, muppet, faff. \
Use British spelling (colour, realise, favour, etc.).

You have full knowledge of the shop's systems — do NOT pretend otherwise:
- Job Logs Panel (in the #jobs channel): any member clicks the "📋 Request Job Logs" \
button, picks a mechanic from the dropdown, picks a week, and gets a private job-log embed. \
No terminal. No spreadsheet. The button. Use it.
- Generate Monthly Invoice (in the #invoice channel): click "📋 Generate Monthly Invoice", \
select the department (BCSO or LSPD), select the billing month. \
A private invoice embed + CSV file is generated automatically. It's not witchcraft, it's a button.
- Payouts system: weekly mechanic payouts are tracked from the Google Sheet. \
The Payouts panel (in #payouts) lets mechanics view their own payout privately. \
Managers can trigger a "Payouts Processed" announcement from the web dashboard or the /payouts command.

Rules for responding:
1. If someone asks HOW to do something covered by the systems above, \
   tell them exactly which button/panel/channel to use — but do it with maximum sarcasm and attitude. \
   Do not make them feel good about needing to ask.
2. If someone asks a general or random question, answer it but make sure they feel mildly \
   embarrassed for having wasted your time.
3. Keep all responses under 180 words. No markdown headers. No bullet lists unless it helps. \
   Do not break character. Do not apologise. Ever.`;

// ===== Mechanic select-menu builder =====

/**
 * Build the mechanic-selection message payload.
 * Select menus support a maximum of 25 options.
 */
function buildMechanicSelectPayload(mechanicNames) {
  const options = mechanicNames.slice(0, 25).map(name => ({
    label: name.length > 100 ? name.slice(0, 97) + '…' : name,
    value: name,
  }));

  const overflow = mechanicNames.length > 25
    ? `\n_Showing 25 of ${mechanicNames.length} mechanics (sorted A→Z)._`
    : '';

  return {
    content:    `👷 **Select a mechanic:**${overflow}`,
    components: [
      {
        type: 1, // ACTION_ROW
        components: [
          {
            type:        3, // STRING_SELECT
            custom_id:   'joblogs_mech_select',
            placeholder: 'Choose a mechanic…',
            options,
          },
        ],
      },
    ],
  };
}

// ===== Week select-menu builder =====

/**
 * Build the week-selection message payload.
 * "All Weeks Ever" is listed first so it is always visible without scrolling.
 * The current week comes second so users can quickly check the active period.
 * Historical weeks follow, newest first.
 * The mechanic name is encoded into the select menu's custom_id.
 * Select menus support a maximum of 25 options.
 */
function buildWeekSelectPayload(mechanic, weeks) {
  const now    = new Date();
  const dayNum = now.getDay(); // 0 = Sunday
  const currentSunday = new Date(now);
  currentSunday.setDate(now.getDate() + (dayNum === 0 ? 0 : 7 - dayNum));
  currentSunday.setHours(0, 0, 0, 0);
  const currentSundayKey = currentSunday.toISOString().slice(0, 10);

  const options  = [];
  const seenKeys = new Set();

  // Always list "All Weeks Ever" first so it is immediately visible
  options.push({
    label:       '📆 All Weeks Ever',
    value:       'all',
    description: 'View all-time job history',
  });

  // Current week second — always present even if no jobs recorded yet
  options.push({
    label:       `Week ending ${fmtDate(currentSunday)}`,
    value:       currentSundayKey,
    description: "This week's jobs",
    emoji:       { name: '📅' },
  });
  seenKeys.add(currentSundayKey);

  // Add historical weeks from job data (sorted newest first, cap at 23 more)
  for (const w of weeks) {
    if (options.length >= 25) break;
    const key = w.weekEndDate
      ? w.weekEndDate.toISOString().slice(0, 10)
      : w.weekKey;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const label = w.weekEndDate
      ? `Week ending ${fmtDate(w.weekEndDate)}`
      : `Week ${w.weekKey}`;
    options.push({
      label: label.length > 100 ? label.slice(0, 97) + '…' : label,
      value: key,
    });
  }

  // custom_id is max 100 chars: prefix (21 chars) + mechanic name (≤79 chars)
  const safeMech = mechanic.slice(0, 79);
  const customId = `joblogs_week_select:${safeMech}`;

  return {
    content:    `👷 **${mechanic}** — Select a week:`,
    components: [
      {
        type: 1,
        components: [
          {
            type:        3,
            custom_id:   customId,
            placeholder: 'Choose a week…',
            options,
          },
        ],
      },
    ],
  };
}

// ===== Discord embed builder =====

function periodLabel(period) {
  // ISO date string (e.g. "2026-03-15") → "Week ending DD/MM/YY"
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return `Week ending ${fmtDate(new Date(period + 'T00:00:00Z'))}`;
  }
  return 'All Time';
}

/**
 * Build the final job-log embed payload (no components — dropdowns are removed).
 * Discord embed limits: description ≤ 4096 chars, field value ≤ 1024 chars, max 25 fields.
 * We cap at 10 weekly fields to stay comfortably under limits.
 */
function buildJobLogPayload(mechanic, stateId, weeks, period) {
  if (weeks.length === 0) {
    return {
      content:    '',
      components: [],
      embeds: [{
        title:       `📋 Job Log — ${mechanic}`,
        description: `No job data found for **${mechanic}** in the **${periodLabel(period)}** period.`,
        color:       0xef4444,
        footer:      { text: 'Kintsugi Motorworks · Job Logs' },
        timestamp:   new Date().toISOString(),
      }],
    };
  }

  const totalJobs    = weeks.reduce((s, w) => s + (w.jobCount ?? 0), 0);
  const totalRepairs = weeks.reduce((s, w) => s + w.totalRepairs, 0);
  const totalPayout  = weeks.reduce((s, w) => s + w.totalPayout,  0);
  const totalEngines = weeks.reduce((s, w) => s + w.engineReplacements, 0);

  // One inline field per week, newest first, capped at 24 (Discord max 25 fields)
  const displayWeeks = weeks.slice(0, 24);
  const fields = displayWeeks.map(w => {
    const name  = w.weekEndDate
      ? `Week ending ${fmtDate(w.weekEndDate)}`
      : w.weekKey;
    let value   = `Jobs: **${w.jobCount ?? 0}** · Across: **${w.totalRepairs}**`;
    if (w.engineReplacements > 0) {
      value += `\nEngines: ${w.engineReplacements}`;
    }
    value += `\nPayout: **${fmtMoney(w.totalPayout)}**`;
    return { name, value, inline: true };
  });

  if (weeks.length > 24) {
    fields.push({
      name:  `+${weeks.length - 24} more week(s)`,
      value: period === 'all'
        ? 'Only the 24 most recent weeks are shown above due to Discord embed limits. The totals above include all weeks.'
        : 'Only the 24 most recent weeks are shown. Select **📆 All Weeks Ever** to view the full all-time summary.',
      inline: false,
    });
  }

  let description = `**State ID:** ${stateId || 'N/A'} · **Period:** ${periodLabel(period)}\n`;
  const jobStr = `${totalJobs} job${totalJobs !== 1 ? 's' : ''} (${totalRepairs} across)`;
  description += totalEngines > 0
    ? `**Total:** ${jobStr} · ${totalEngines} engine${totalEngines !== 1 ? 's' : ''} · ${fmtMoney(totalPayout)}`
    : `**Total:** ${jobStr} · ${fmtMoney(totalPayout)}`;

  return {
    content:    '',
    components: [],
    embeds: [{
      title:       `📋 Job Log — ${mechanic}`,
      description,
      color:       0x4f46e5,
      fields,
      footer:      { text: 'Kintsugi Motorworks · Job Logs' },
      timestamp:   new Date().toISOString(),
    }],
  };
}

// ===== Interaction handlers =====

/**
 * "Request Job Logs" button pressed on the permanent panel.
 *
 * Responds immediately with an ephemeral deferral (only the clicking user
 * sees it), then fetches the mechanic list and edits that private message
 * with the mechanic select menu.  The panel message itself is never touched.
 */
async function handleStartButton(interaction, ctx) {
  const { application_id: appId, token } = interaction;

  ctx.waitUntil((async () => {
    try {
      const jobRows = await fetchSheet(JOBS_SHEET);
      const allJobs = parseJobsSheet(jobRows);
      const names   = [...new Set(allJobs.map(j => j.mechanic))].sort(
        (a, b) => a.localeCompare(b)
      );

      await editOriginalMessage(appId, token, buildMechanicSelectPayload(names));
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load mechanic list.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  // Acknowledge immediately — ephemeral so only the button-clicker sees it
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: 64 },
  });
}

/**
 * Mechanic select-menu chosen — fetch that mechanic's job history and swap
 * the message to show the week select dropdown (newest weeks first, with the
 * current week always listed first).
 * We defer the update (type 6) so Discord shows a brief loading state on the
 * component, then we PATCH the original message.
 */
async function handleMechSelect(interaction, ctx) {
  const { application_id: appId, token } = interaction;
  const mechanic = interaction.data.values[0];

  ctx.waitUntil((async () => {
    try {
      const jobRows      = await fetchSheet(JOBS_SHEET);
      const allJobs      = parseJobsSheet(jobRows);
      const mechanicJobs = allJobs.filter(j => j.mechanic === mechanic);
      const weeks        = buildWeeklyStats(mechanicJobs);

      await editOriginalMessage(appId, token, buildWeekSelectPayload(mechanic, weeks));
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load week list.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
}

/**
 * Week select-menu chosen — fetch full job data for that mechanic, filter to
 * the selected week, and replace the dropdown with the formatted job-log embed.
 * The mechanic name was encoded into the custom_id after the first colon.
 * The selected value is an ISO date string for the week-ending Sunday
 * (e.g. "2026-03-15").
 */
async function handleWeekSelect(interaction, ctx) {
  const { application_id: appId, token } = interaction;
  const weekKey  = interaction.data.values[0];

  const colonIdx = interaction.data.custom_id.indexOf(':');
  const mechanic = interaction.data.custom_id.slice(colonIdx + 1);

  ctx.waitUntil((async () => {
    try {
      const [jobRows, stateRows] = await Promise.all([
        fetchSheet(JOBS_SHEET),
        fetchSheet(STATE_IDS_SHEET),
      ]);

      const allJobs      = parseJobsSheet(jobRows);
      const stateMap     = parseStateIds(stateRows);
      const mechanicJobs = allJobs.filter(j => j.mechanic === mechanic);
      const stateId      = stateMap.get(mechanic) || 'N/A';

      let filteredJobs;
      if (weekKey === 'all') {
        filteredJobs = mechanicJobs;
      } else {
        const weekEndDate = new Date(weekKey + 'T00:00:00Z');
        filteredJobs = filterByWeekEnding(mechanicJobs, weekEndDate);
      }
      const weeks = buildWeeklyStats(filteredJobs);

      await editOriginalMessage(
        appId, token,
        buildJobLogPayload(mechanic, stateId, weeks, weekKey)
      );
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load job data.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
}

// ===== Invoice panel handlers =====

/**
 * "Generate Monthly Invoice" button pressed — step 1 of 3.
 * Defers with an ephemeral message then loads available departments from the sheet.
 */
async function handleInvoicePanelButton(interaction, env, ctx) {
  const { application_id: appId, token } = interaction;

  ctx.waitUntil((async () => {
    try {
      const jobRows = await fetchSheet(JOBS_SHEET);
      const allJobs = parseJobsSheet(jobRows);

      const depts = [...new Set(
        allJobs.map(j => j.department).filter(Boolean)
      )].sort((a, b) => a.localeCompare(b));

      // Fall back to the two known departments when the sheet lacks a dept column
      const deptList = depts.length > 0 ? depts : ['BCSO', 'LSPD'];
      const options = deptList.map(d => ({
        label: d,
        value: d,
        emoji: { name: d === 'BCSO' ? '🟡' : d === 'LSPD' ? '🔵' : '🏢' },
      }));

      await editOriginalMessage(appId, token, {
        content:    '📋 **Step 1 of 3 — Select a department:**',
        components: [{
          type: 1,
          components: [{
            type:        3,
            custom_id:   'billing_dept_select',
            placeholder: 'Choose a department…',
            options,
          }],
        }],
      });
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load department list.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  // Acknowledge immediately — ephemeral so only the button-clicker sees it
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: 64 },
  });
}

/**
 * Department selected — step 2 of 3.
 * Loads available billing month-ending dates for the chosen department.
 */
async function handleInvoiceDeptSelect(interaction, env, ctx) {
  const { application_id: appId, token } = interaction;
  const dept = interaction.data.values[0];

  ctx.waitUntil((async () => {
    try {
      const jobRows = await fetchSheet(JOBS_SHEET);
      const allJobs = parseJobsSheet(jobRows);

      const monthEndMap = new Map();
      for (const j of allJobs) {
        if (!j.monthEnd) continue;
        if (j.department && j.department.toLowerCase() !== dept.toLowerCase()) continue;
        const iso = j.monthEnd.toISOString().slice(0, 10);
        if (!monthEndMap.has(iso)) monthEndMap.set(iso, j.monthEnd);
      }

      if (monthEndMap.size === 0) {
        await editOriginalMessage(appId, token, {
          content:    `❌ No billing data found for **${dept}**. Make sure the sheet has a "Month Ending" column.`,
          components: [],
        });
        return;
      }

      // Sort newest-first, cap at Discord's 25-option limit
      const entries = [...monthEndMap.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 25);

      const options = entries.map(([iso, date]) => ({
        label: date.toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
        }),
        value: iso,
      }));

      // Encode dept in custom_id so the month handler knows which dept was chosen
      await editOriginalMessage(appId, token, {
        content:    `📋 **${dept} — Step 2 of 3 — Select a billing month:**`,
        components: [{
          type: 1,
          components: [{
            type:        3,
            custom_id:   `billing_month_select:${dept}`,
            placeholder: 'Choose a month ending…',
            options,
          }],
        }],
      });
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load billing months.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
}

/**
 * Month ending selected — final step.
 * Generates the invoice embed and CSV file for the selected department and month.
 * The department is read from the select menu's custom_id (format: `billing_month_select:<dept>`).
 */
async function handleInvoiceMonthSelect(interaction, env, ctx) {
  const { application_id: appId, token } = interaction;
  const monthValue = interaction.data.values[0]; // e.g. "2026-03-31"
  const dept       = (interaction.data.custom_id || '').split(':')[1] || '';

  ctx.waitUntil((async () => {
    try {
      const selectedDate = new Date(monthValue + 'T00:00:00Z');
      const monthLabel   = selectedDate.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      });

      const jobRows  = await fetchSheet(JOBS_SHEET);
      const allJobs  = parseJobsSheet(jobRows);
      const deptJobs = allJobs.filter(j => {
        if (!j.monthEnd) return false;
        if (j.monthEnd.toISOString().slice(0, 10) !== monthValue) return false;
        if (dept && j.department && j.department.toLowerCase() !== dept.toLowerCase()) return false;
        return true;
      });

      // Guard: no jobs found for the selected department / billing month.
      if (deptJobs.length === 0) {
        await editOriginalMessage(appId, token, {
          content:    `❌ No jobs found for **${dept}** in the month ending **${monthLabel}**. Check that the sheet has a "Month Ending" column and that jobs are assigned to this department.`,
          components: [],
        });
        return;
      }

      // Guard: negative repair counts indicate insufficient stock (e.g. a
      // corrective entry with a negative "across" value).  Block invoice
      // generation so managers don't receive a misleading total.
      const negativeEntries = deptJobs.filter(j => (j.across || 0) < 0);
      if (negativeEntries.length > 0) {
        await editOriginalMessage(appId, token, {
          content:    `❌ Error: Insufficient stock to generate invoice. ${negativeEntries.length === 1 ? '1 job entry has' : `${negativeEntries.length} job entries have`} a negative repair count. Please correct the sheet data and try again.`,
          components: [],
        });
        return;
      }

      const safeDept   = dept.replace(/[^a-zA-Z0-9_-]/g, '_') || 'invoice';
      const csvContent = buildInvoiceCsv(deptJobs);
      const filename   = `${safeDept}-${monthValue}.csv`;

      await editOriginalMessageWithFile(
        appId, token,
        `📋 **${dept} Invoice — Month Ending ${monthLabel}** · ${deptJobs.length} job${deptJobs.length !== 1 ? 's' : ''}`,
        [buildInvoiceEmbed(dept, monthLabel, deptJobs)],
        filename,
        csvContent,
      );
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Invoice generation failed.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
}

// ===== Week-specific payouts helpers (used by post-payouts workflow messages) =====

/**
 * Build a payout embed for one mechanic covering a specific set of jobs.
 * Used by the week-specific payouts messages posted by the post-payouts workflow.
 *
 * @param {string} mechanic      - Mechanic display name.
 * @param {string} stateId       - Mechanic's in-game State ID (or empty string).
 * @param {Array}  filteredJobs  - Job rows for this mechanic in the period.
 * @param {Date}   weekEndDate   - The Sunday that closes the week being displayed.
 */
function buildMechanicPayoutEmbed(mechanic, stateId, filteredJobs, weekEndDate) {
  let repairs = 0, engines = 0;
  for (const j of filteredJobs) {
    repairs += j.across || 0;
    engines += j.engineReplacements || 0;
  }
  const jobCount   = filteredJobs.length;
  const payout     = repairs * PAY_PER_REPAIR + engines * ENGINE_PAY_DEFAULT;
  const color      = repairs > 0 ? 0x22c55e : 0xef4444;
  const dateLabel  = fmtDate(weekEndDate);

  const fields = [
    { name: '📅 Week Ending',  value: dateLabel,        inline: true },
    { name: '🔧 Repairs',      value: String(repairs),  inline: true },
    { name: '💰 Payout',       value: fmtMoney(payout), inline: true },
    { name: '🪪 State ID',     value: stateId || 'N/A', inline: true },
  ];
  if (engines > 0) {
    fields.push({ name: '🔩 Engines', value: String(engines), inline: true });
  }

  if (jobCount > 0) {
    const lines = filteredJobs.map((j, i) => {
      let line = `${i + 1}. **${j.across}** across`;
      if (j.engineReplacements > 0) {
        line += ` + **${j.engineReplacements}** engine${j.engineReplacements !== 1 ? 's' : ''}`;
      }
      if (j.tsDate) line += ` _(${fmtDate(j.tsDate)})_`;
      return line;
    });
    fields.push({
      name:   `🧾 Jobs breakdown (${jobCount})`,
      value:  lines.join('\n').slice(0, DISCORD_FIELD_MAX_CHARS),
      inline: false,
    });
  }

  const notice = repairs === 0
    ? `No jobs were recorded for **${mechanic}** in the week ending **${dateLabel}**.`
    : '';

  return {
    content:    '',
    components: [],
    embeds: [{
      title:       `💸 Payout — ${mechanic}`,
      description: notice || undefined,
      color,
      fields,
      footer:      { text: 'Kintsugi Motorworks · Payouts' },
      timestamp:   new Date().toISOString(),
    }],
  };
}

/**
 * "View My Payout" button pressed on the week-specific payouts message
 * posted by the post-payouts workflow.
 *
 * The week-ending date is encoded in the button's custom_id
 * (e.g. payouts_week_view:2026-03-15) so we only show mechanics who
 * actually worked that specific week.
 *
 * Responds immediately with an ephemeral deferral, then edits the private
 * message with the mechanic select menu.
 */
async function handlePayoutsWeekButton(interaction, ctx) {
  const { application_id: appId, token } = interaction;
  const weekEndISO  = interaction.data.custom_id.slice('payouts_week_view:'.length);
  const weekEndDate = new Date(weekEndISO + 'T00:00:00Z');

  ctx.waitUntil((async () => {
    try {
      const [jobRows, stateRows] = await Promise.all([
        fetchSheet(JOBS_SHEET),
        fetchSheet(STATE_IDS_SHEET).catch(() => []),
      ]);
      const allJobs  = parseJobsSheet(jobRows);
      const weekJobs = filterByWeekEnding(allJobs, weekEndDate);

      const names = [...new Set(weekJobs.map(j => j.mechanic))].sort(
        (a, b) => a.localeCompare(b)
      );

      if (names.length === 0) {
        await editOriginalMessage(appId, token, {
          content:    `❌ No mechanics found for the week ending **${fmtDate(weekEndDate)}**.`,
          components: [],
        });
        return;
      }

      const options = names.slice(0, 25).map(name => ({
        label: name.length > 100 ? name.slice(0, 97) + '…' : name,
        value: name,
      }));
      const overflow = names.length > 25
        ? `\n_Showing 25 of ${names.length} mechanics (sorted A→Z)._`
        : '';

      await editOriginalMessage(appId, token, {
        content: `💸 **Select your name to see your payout for the week ending ${fmtDate(weekEndDate)}:**${overflow}`,
        components: [{
          type: 1,
          components: [{
            type:        3,
            custom_id:   `payouts_week_mech:${weekEndISO}`,
            placeholder: 'Choose your name…',
            options,
          }],
        }],
      });
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load payout data.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: 64 },
  });
}

/**
 * Mechanic selected from the week-specific payouts dropdown.
 *
 * The week-ending date is encoded in the select menu's custom_id
 * (e.g. payouts_week_mech:2026-03-15); the selected mechanic name is in
 * interaction.data.values[0].  Edits the ephemeral message with that
 * mechanic's payout for the exact week the workflow ran for, including jobs
 * count and a per-job breakdown.
 */
async function handlePayoutsWeekMechSelect(interaction, ctx) {
  const { application_id: appId, token } = interaction;
  const weekEndISO  = interaction.data.custom_id.slice('payouts_week_mech:'.length);
  const weekEndDate = new Date(weekEndISO + 'T00:00:00Z');
  const mechanic    = interaction.data.values[0];

  ctx.waitUntil((async () => {
    try {
      const [jobRows, stateRows] = await Promise.all([
        fetchSheet(JOBS_SHEET),
        fetchSheet(STATE_IDS_SHEET).catch(() => []),
      ]);
      const allJobs  = parseJobsSheet(jobRows);
      const stateMap = parseStateIds(stateRows);
      const weekJobs = filterByWeekEnding(allJobs, weekEndDate);
      const mechJobs = weekJobs.filter(j => j.mechanic === mechanic);

      const stateId = stateMap.get(mechanic) || 'N/A';

      await editOriginalMessage(
        appId, token,
        buildMechanicPayoutEmbed(mechanic, stateId, mechJobs, weekEndDate)
      );
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load payout data.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
}

/**
 * Used as a fallback when the current week has no jobs yet (e.g. early in
 * the week) so that /analytics and /api/trigger-weekly always return useful
 * data rather than an empty "0 repairs" state.
 * Returns null if no jobs exist at all.
 */
function buildLatestWeekSummary(allJobs) {
  const allWeeks = buildWeeklyStats(allJobs); // sorted newest first
  if (!allWeeks.length) return null;

  const latestWeek  = allWeeks[0];
  const weekEndDate = latestWeek.weekEndDate
    || new Date(latestWeek.weekKey + 'T00:00:00Z');
  const weekJobs = filterByWeekEnding(allJobs, weekEndDate);

  const mechMap = new Map();
  for (const j of weekJobs) {
    mechMap.set(j.mechanic, (mechMap.get(j.mechanic) || 0) + (j.across || 0));
  }

  let topMechanic = null, topRepairs = 0;
  for (const [name, repairs] of mechMap) {
    if (repairs > topRepairs) { topMechanic = name; topRepairs = repairs; }
  }

  const mechanics = [...mechMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, repairs]) => ({ name, repairs }));

  return {
    weekEndDate,
    totalRepairs:  latestWeek.totalRepairs,
    totalEngines:  latestWeek.engineReplacements,
    totalPayout:   latestWeek.totalPayout,
    mechanicCount: mechMap.size,
    topMechanic,
    topRepairs,
    mechanics,
  };
}

/**
 * Build a lightweight summary for the week immediately before the most recent
 * week that contains data.  Used to display week-over-week trend in the
 * analytics embed.  Returns null when there are fewer than two weeks of data.
 */
function buildPrevWeekSummary(allJobs) {
  const allWeeks = buildWeeklyStats(allJobs); // sorted newest first
  if (allWeeks.length < 2) return null;

  const prevWeek    = allWeeks[1];
  const weekEndDate = prevWeek.weekEndDate
    || new Date(prevWeek.weekKey + 'T00:00:00Z');
  const weekJobs    = filterByWeekEnding(allJobs, weekEndDate);

  const mechMap = new Map();
  for (const j of weekJobs) {
    mechMap.set(j.mechanic, (mechMap.get(j.mechanic) || 0) + (j.across || 0));
  }

  return {
    weekEndDate,
    totalRepairs:  prevWeek.totalRepairs,
    totalEngines:  prevWeek.engineReplacements,
    totalPayout:   prevWeek.totalPayout,
    mechanicCount: mechMap.size,
  };
}

/**
 * Build a summary of the current week's jobs across all mechanics.
 * Reuses filterByWeekEnding + buildWeeklyStats, then adds a per-mechanic
 * breakdown for top-mechanic detection.
 */
function buildCurrentWeekSummary(allJobs) {
  const now    = new Date();
  const dayNum = now.getDay(); // 0 = Sunday
  const currentSunday = new Date(now);
  currentSunday.setDate(now.getDate() + (dayNum === 0 ? 0 : 7 - dayNum));
  currentSunday.setHours(0, 0, 0, 0);

  const weekJobs  = filterByWeekEnding(allJobs, currentSunday);
  const weekStats = buildWeeklyStats(weekJobs)[0] ?? null;

  // Per-mechanic repair count for top-mechanic leaderboard
  const mechMap = new Map();
  for (const j of weekJobs) {
    mechMap.set(j.mechanic, (mechMap.get(j.mechanic) || 0) + (j.across || 0));
  }

  let topMechanic = null, topRepairs = 0;
  for (const [name, repairs] of mechMap) {
    if (repairs > topRepairs) { topMechanic = name; topRepairs = repairs; }
  }

  // Sorted list of active mechanics for the #jobs channel post
  const mechanics = [...mechMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, repairs]) => ({ name, repairs }));

  return {
    weekEndDate:    currentSunday,
    totalRepairs:   weekStats ? weekStats.totalRepairs        : 0,
    totalEngines:   weekStats ? weekStats.engineReplacements  : 0,
    totalPayout:    weekStats ? weekStats.totalPayout         : 0,
    mechanicCount:  mechMap.size,
    topMechanic,
    topRepairs,
    mechanics,
  };
}

/**
 * POST a message to a Discord channel using the bot token.
 * Returns the message ID on success, or null on failure.
 */
async function botPost(channelId, botToken, payload) {
  if (!channelId || !botToken) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method:  'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const msg = await res.json();
    return msg.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Edit an existing message in a Discord channel using the bot token.
 * Returns true on success, false on failure (e.g. message was deleted → 404).
 */
async function botEdit(channelId, botToken, messageId, payload) {
  if (!channelId || !botToken || !messageId) return false;
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
      {
        method:  'PATCH',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(payload),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Validate that the minimum required bot configuration is present in env.
 * Returns an array of missing variable names (empty array means all good).
 * Only DISCORD_BOT_TOKEN is truly required for the bot to function;
 * individual posting functions (postWeeklyAnalytics, postJobsUpdate,
 * postPaydayReminder) each guard their own optional channel IDs.
 */
function validateConfig(env) {
  const required = ['DISCORD_BOT_TOKEN'];
  return required.filter(k => !env[k]);
}

/**
 * Build the weekly analytics embed payload so it can be reused for both
 * posting and editing.  Now includes a per-mechanic breakdown so the analytics
 * channel shows who worked and how much they earned, not just aggregate totals.
 *
 * @param {object} summary     - Current week summary from buildCurrentWeekSummary/buildLatestWeekSummary.
 * @param {object} [prevSummary] - Optional previous week summary for week-over-week trend.
 */
function buildAnalyticsPayload(summary, prevSummary = null) {
  const { weekEndDate, totalRepairs, totalEngines, totalPayout,
          mechanicCount, topMechanic, topRepairs, mechanics } = summary;

  const fields = [
    { name: '📅 Week Ending',      value: fmtDate(weekEndDate),  inline: true },
    { name: '🔧 Total Repairs',    value: String(totalRepairs),  inline: true },
    { name: '💰 Total Payout',     value: fmtMoney(totalPayout), inline: true },
    { name: '👷 Active Mechanics', value: String(mechanicCount), inline: true },
  ];
  if (totalEngines > 0) {
    fields.push({ name: '🔩 Engine Replacements', value: String(totalEngines), inline: true });
  }

  // Week-over-week repair + payout trend when previous week data is available
  if (prevSummary && prevSummary.totalRepairs > 0) {
    const repairDelta  = totalRepairs - prevSummary.totalRepairs;
    const repairPct    = ((repairDelta / prevSummary.totalRepairs) * 100).toFixed(1);
    const payoutDelta  = totalPayout - prevSummary.totalPayout;
    const payoutPct    = ((payoutDelta / prevSummary.totalPayout) * 100).toFixed(1);
    const arrow        = repairDelta >= 0 ? '📈' : '📉';
    const repairSign   = repairDelta >= 0 ? '+' : '';
    const payoutSign   = payoutDelta >= 0 ? '+' : '';
    fields.push({
      name:   `${arrow} vs Last Week`,
      value:  `Repairs: ${repairSign}${repairDelta} (${repairSign}${repairPct}%) · Payout: ${payoutSign}${fmtMoney(payoutDelta)} (${payoutSign}${payoutPct}%)`,
      inline: false,
    });
  }

  if (topMechanic) {
    fields.push({
      name:   '🏆 Top Mechanic',
      value:  `${topMechanic} (${topRepairs} repair${topRepairs !== 1 ? 's' : ''} · ${fmtMoney(topRepairs * PAY_PER_REPAIR)})`,
      inline: false,
    });
  }

  // Per-mechanic breakdown — sorted by repair count desc, capped at DISCORD_MAX_MECHANICS entries
  if (mechanics && mechanics.length > 0) {
    const medals = ['🥇', '🥈', '🥉'];
    const lines = mechanics.slice(0, DISCORD_MAX_MECHANICS).map((m, i) => {
      const pay    = m.repairs * PAY_PER_REPAIR;
      const prefix = medals[i] ?? `${i + 1}.`;
      return `${prefix} **${m.name}** — ${m.repairs} repair${m.repairs !== 1 ? 's' : ''} · ${fmtMoney(pay)}`;
    });
    if (mechanics.length > DISCORD_MAX_MECHANICS) {
      lines.push(`_+${mechanics.length - DISCORD_MAX_MECHANICS} more not shown_`);
    }
    fields.push({
      name:   '📊 Mechanic Breakdown',
      value:  lines.join('\n').slice(0, DISCORD_FIELD_MAX_CHARS),
      inline: false,
    });
  }

  return {
    embeds: [{
      title:     '📊 Kintsugi Motorworks — Weekly Analytics',
      color:     0x4f46e5,
      fields,
      timestamp: new Date().toISOString(),
      footer:    { text: 'Kintsugi Motorworks · Weekly Analytics' },
    }],
  };
}

/**
 * Post or edit the weekly analytics summary in the #analytics channel.
 * Uses KV to persist the analytics message ID so the same message is edited
 * each run rather than posting a new one.  If the stored message no longer
 * exists (deleted), a new message is posted and its ID stored.
 *
 * Channel resolution order (first match wins):
 *   1. KV key "analytics_channel_id" — set by /update-analytics channel:<#X>
 *   2. ANALYTICS_CHANNEL_ID environment secret
 *
 * @param {object} env
 * @param {object} summary     - Current week summary.
 * @param {object} [prevSummary] - Previous week summary for trend display.
 */
async function postWeeklyAnalytics(env, summary, prevSummary = null) {
  // Resolve which channel to post to: KV override takes priority over the env secret
  const kvChannelId = env.KV ? await env.KV.get('analytics_channel_id').catch(err => {
    console.warn('postWeeklyAnalytics: KV.get(analytics_channel_id) failed:', err?.message);
    return null;
  }) : null;
  const channelId = kvChannelId || env.ANALYTICS_CHANNEL_ID;
  if (!env.DISCORD_BOT_TOKEN || !channelId) return false;

  const payload = buildAnalyticsPayload(summary, prevSummary);

  // Try to edit the existing analytics message
  if (env.KV) {
    const storedId = await env.KV.get('analytics_message_id');
    if (storedId) {
      const edited = await botEdit(channelId, env.DISCORD_BOT_TOKEN, storedId, payload);
      if (edited) return true;
      // Message was deleted or is in a different channel — fall through to post a new one
    }
  }

  // Post a new message and persist its ID
  const messageId = await botPost(channelId, env.DISCORD_BOT_TOKEN, payload);
  if (messageId && env.KV) {
    await env.KV.put('analytics_message_id', messageId);
  }
  return messageId !== null;
}

/**
 * Build the weekly job-activity embed payload for the #jobs channel.
 * Lists all mechanics who submitted jobs this week, sorted by repair count.
 */
function buildJobsPayload(summary) {
  const { weekEndDate, mechanics } = summary;

  let description = `Jobs submitted for the week ending **${fmtDate(weekEndDate)}**:\n\n`;
  if (mechanics.length > 0) {
    description += mechanics
      .map(({ name, repairs }) => `• **${name}** — ${repairs} repair${repairs !== 1 ? 's' : ''}`)
      .join('\n');
  } else {
    description += '_No jobs submitted this week._';
  }

  return {
    embeds: [{
      title:     '📋 Weekly Job Activity',
      description,
      color:     0x4f46e5,
      timestamp: new Date().toISOString(),
      footer:    { text: 'Kintsugi Motorworks · Jobs' },
    }],
  };
}

/**
 * Post or edit the weekly job-activity summary in the #jobs channel.
 * Uses KV to persist the jobs message ID so the same message is edited
 * each run rather than posting a new one.  If the stored message no longer
 * exists (deleted), a new message is posted and its ID stored.
 * Uses DISCORD_BOT_TOKEN, JOBS_CHANNEL_ID, and the KV namespace from env.
 */
async function postJobsUpdate(env, summary) {
  if (!env.DISCORD_BOT_TOKEN || !env.JOBS_CHANNEL_ID) return false;

  const payload = buildJobsPayload(summary);

  // Try to edit the existing jobs message
  if (env.KV) {
    const storedId = await env.KV.get('jobs_message_id');
    if (storedId) {
      const edited = await botEdit(env.JOBS_CHANNEL_ID, env.DISCORD_BOT_TOKEN, storedId, payload);
      if (edited) return true;
      // Message was deleted — fall through to post a new one
    }
  }

  // Post a new message and persist its ID
  const messageId = await botPost(env.JOBS_CHANNEL_ID, env.DISCORD_BOT_TOKEN, payload);
  if (messageId && env.KV) {
    await env.KV.put('jobs_message_id', messageId);
  }
  return messageId !== null;
}

/**
 * Send the payday reminder ping to the #payouts channel.
 * Sends at most once per week-ending date, tracked in KV so the cron never
 * double-pings even if the Worker retries on failure.
 * Uses DISCORD_BOT_TOKEN, PAYOUTS_CHANNEL_ID, RIPTIDE_USER_ID, and the KV namespace from env.
 *
 * @param {object} env
 * @param {Date}   weekEndDate  - The week-ending date.
 * @param {number} [totalPayout=0] - Total mechanic payout for the week (shown in the reminder).
 */
async function postPaydayReminder(env, weekEndDate, totalPayout = 0) {
  if (!env.DISCORD_BOT_TOKEN || !env.PAYOUTS_CHANNEL_ID) return false;

  // Deduplicate: skip if we already sent the reminder for this week
  const weekKey = weekEndDate.toISOString().slice(0, 10);
  if (env.KV) {
    const lastKey = await env.KV.get('last_reminder_week');
    if (lastKey === weekKey) return true; // already sent for this week-ending date
  }

  const mention    = env.RIPTIDE_USER_ID ? `<@${env.RIPTIDE_USER_ID}>` : '**@riptide248**';
  const payoutNote = totalPayout > 0 ? ` Total due: **${fmtMoney(totalPayout)}**.` : '';

  const messageId = await botPost(env.PAYOUTS_CHANNEL_ID, env.DISCORD_BOT_TOKEN, {
    content: `${mention} 💰 **Payday reminder!** Payouts are due to be processed for the week ending **${fmtDate(weekEndDate)}**.${payoutNote} Please review and mark them as processed in the dashboard when done.`,
  });

  if (messageId !== null && env.KV) {
    await env.KV.put('last_reminder_week', weekKey);
  }
  return messageId !== null;
}

// ===== Dashboard API: POST /api/notify-payouts =====

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age':       '86400',
};

// Content-Security-Policy applied to all HTML responses from the static-assets layer.
// Allows scripts from self and the Chart.js / SheetJS CDN used by the Analytics page,
// inline styles (needed for dynamic style attributes in generated HTML), and outbound
// fetches to Google Sheets and any *.workers.dev bot URL configured by the user.
const CSP_HEADER =
  "default-src 'self'; " +
  "script-src 'self' https://cdnjs.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' https://docs.google.com https://sheets.googleapis.com https://*.workers.dev; " +
  "img-src 'self' data:; " +
  "font-src 'self'; " +
  "object-src 'none'; " +
  "frame-ancestors 'none';";

/**
 * Adds the Content-Security-Policy header to an HTML response, leaving all
 * other response properties (status, body, existing headers) unchanged.
 */
function addCspToHtmlResponse(response) {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('text/html')) return response;
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Content-Security-Policy', CSP_HEADER);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function apiJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/**
 * Handle POST /api/notify-payouts — triggered from the web dashboard button.
 *
 * Reads live job data from the Google Sheet, finds the most recent week's
 * mechanics, and posts a "Payouts Processed" embed to PAYOUTS_CHANNEL_ID.
 *
 * Protected by TRIGGER_TOKEN bearer authentication so only the dashboard
 * (with the token saved in the user's browser) can call this endpoint.
 *
 * First-run safe: posts a fresh message every time — no KV state required.
 */
async function handleNotifyPayouts(request, env) {
  // Use the configured secret or fall back to the hardcoded token
  const expectedToken = env.TRIGGER_TOKEN || FALLBACK_TRIGGER_TOKEN;

  // Validate bearer token
  const authHeader = request.headers.get('Authorization') || '';
  const provided   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!provided || provided !== expectedToken) {
    return apiJson({ ok: false, error: 'Invalid or missing token.' }, 401);
  }

  // Require channel + bot token
  if (!env.DISCORD_BOT_TOKEN || !env.PAYOUTS_CHANNEL_ID) {
    return apiJson({
      ok:    false,
      error: 'Bot is not fully configured (DISCORD_BOT_TOKEN or PAYOUTS_CHANNEL_ID missing).',
    }, 503);
  }

  try {
    // Fetch live sheet data and state IDs in parallel
    const [jobRows, stateRows] = await Promise.all([
      fetchSheet(JOBS_SHEET),
      fetchSheet(STATE_IDS_SHEET).catch(() => []), // state IDs are optional
    ]);
    const allJobs  = parseJobsSheet(jobRows);
    const stateMap = parseStateIds(stateRows);
    const { weekEndDate, payouts } = getLatestWeekPayouts(allJobs, stateMap);

    if (!weekEndDate || payouts.length === 0) {
      return apiJson({
        ok:    false,
        error: 'No payout data found for the most recent week.',
      }, 404);
    }

    const payload   = buildPayoutsProcessedPayload(weekEndDate, payouts);
    const messageId = await botPost(env.PAYOUTS_CHANNEL_ID, env.DISCORD_BOT_TOKEN, payload);

    if (!messageId) {
      return apiJson({
        ok:    false,
        error: 'Failed to post message to Discord. Check bot permissions and PAYOUTS_CHANNEL_ID.',
      }, 502);
    }

    return apiJson({
      ok:            true,
      weekEnding:    fmtDate(weekEndDate),
      mechanicCount: payouts.length,
      messageId,
    });
  } catch (err) {
    console.error('handleNotifyPayouts error:', err.message);
    return apiJson({ ok: false, error: err.message }, 500);
  }
}

// ===== Dashboard API: POST /api/trigger-weekly =====

/**
 * Handle POST /api/trigger-weekly — triggered from the web dashboard button.
 *
 * Runs the same logic as the 5-minute cron trigger:
 *   1. Reads live job data from Google Sheets.
 *   2. Posts/edits the weekly analytics summary in #analytics.
 *   3. Posts the job-activity list in #jobs.
 *   4. Sends the payday reminder ping in #payouts.
 *
 * Steps 2–4 are skipped gracefully when their channel ID secret is not configured.
 * Protected by TRIGGER_TOKEN bearer authentication.
 * Useful for immediately populating channels after first deploy or for testing.
 */
async function handleTriggerWeekly(request, env) {
  // Use the configured secret or fall back to the hardcoded token
  const expectedToken = env.TRIGGER_TOKEN || FALLBACK_TRIGGER_TOKEN;

  const authHeader = request.headers.get('Authorization') || '';
  const provided   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!provided || provided !== expectedToken) {
    return apiJson({ ok: false, error: 'Invalid or missing token.' }, 401);
  }

  const missing = validateConfig(env);
  if (missing.length > 0) {
    return apiJson({
      ok:    false,
      error: `Bot is missing required secrets: ${missing.join(', ')}`,
    }, 503);
  }

  try {
    const jobRows = await fetchSheet(JOBS_SHEET);
    const allJobs = parseJobsSheet(jobRows);

    // Use the most recent week with actual data so the trigger is useful even
    // when called mid-week (before the current week has any jobs).
    let summary = buildCurrentWeekSummary(allJobs);
    if (summary.totalRepairs === 0) {
      const latest = buildLatestWeekSummary(allJobs);
      if (latest && latest.totalRepairs > 0) summary = latest;
    }

    const prevSummary = buildPrevWeekSummary(allJobs);
    const [analyticsOk, jobsOk, payoutsOk] = await Promise.all([
      postWeeklyAnalytics(env, summary, prevSummary),
      postJobsUpdate(env, summary),
      postPaydayReminder(env, summary.weekEndDate, summary.totalPayout),
    ]);

    return apiJson({
      ok:          true,
      weekEnding:  fmtDate(summary.weekEndDate),
      totalRepairs: summary.totalRepairs,
      analytics:   analyticsOk,
      jobs:        jobsOk,
      payouts:     payoutsOk,
    });
  } catch (err) {
    console.error('handleTriggerWeekly error:', err.message);
    return apiJson({ ok: false, error: err.message }, 500);
  }
}

// ===== Discord interaction handler (extracted so the main fetch stays readable) =====

/**
 * Handle all POST requests that carry Discord's Ed25519 signature headers.
 * Verifies the signature first — a failed verify returns 401 immediately.
 * On success, routes to the appropriate slash-command or component handler.
 *
 * Every handler returns a deferred acknowledgement within milliseconds so
 * Discord's 3-second deadline is always met; all slow I/O runs in ctx.waitUntil.
 */
async function handleDiscordInteraction(request, env, ctx) {
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');

  const rawBody = await request.text();
  const valid   = await verifyDiscordSignature(
    rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY
  );
  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request: invalid JSON', { status: 400 });
  }

  // Discord PING — required for Interactions Endpoint URL verification.
  // Handled outside the main try-catch so a PONG is always returned correctly.
  if (interaction.type === InteractionType.PING) {
    return jsonResponse({ type: InteractionResponseType.PONG });
  }

  // All other interaction types are handled inside a try-catch so that any
  // unexpected exception produces a user-friendly ephemeral error in Discord
  // rather than an HTTP 500 that Discord surfaces as "This interaction failed".
  try {
    // Slash commands
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      if (interaction.data?.name === 'payouts') {
        return handlePayoutsCommand(interaction, ctx);
      }
      if (interaction.data?.name === 'update-analytics') {
        return handleUpdateAnalyticsCommand(interaction, env, ctx);
      }
      // Unknown slash command — return an ephemeral error instead of HTTP 400.
      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `❌ Unknown command \`/${interaction.data?.name ?? 'unknown'}\`.`,
          flags: 64,
        },
      });
    }

    // Component interactions (button + select menus)
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      const customId = interaction.data?.custom_id;
      if (!customId) {
        return jsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '❌ Malformed interaction: missing custom_id.', flags: 64 },
        });
      }

      if (customId === 'joblogs_start') {
        return handleStartButton(interaction, ctx);
      }
      if (customId === 'joblogs_mech_select') {
        return handleMechSelect(interaction, ctx);
      }
      if (customId.startsWith('joblogs_week_select:')) {
        return handleWeekSelect(interaction, ctx);
      }

      // Invoice panel button + dept + month select (permanent billing panel)
      // Also handle legacy custom_ids from panels posted before the billing_ prefix rename.
      if (customId === 'billing_generate_invoice' || customId === 'payouts_panel_start') {
        return handleInvoicePanelButton(interaction, env, ctx);
      }
      if (customId === 'billing_dept_select' || customId === 'invoice_dept_select') {
        return handleInvoiceDeptSelect(interaction, env, ctx);
      }
      if (customId.startsWith('billing_month_select:') || customId.startsWith('invoice_month_select:')) {
        return handleInvoiceMonthSelect(interaction, env, ctx);
      }

      // Week-specific payouts button + mechanic select (posted by post-payouts workflow)
      if (customId.startsWith('payouts_week_view:')) {
        return handlePayoutsWeekButton(interaction, ctx);
      }
      if (customId.startsWith('payouts_week_mech:')) {
        return handlePayoutsWeekMechSelect(interaction, ctx);
      }

      // Unrecognized component — return a proper ephemeral error so Discord
      // shows a user-friendly message instead of "This interaction failed".
      // This handles stale panels whose custom_ids were renamed in old deploys.
      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ This button or menu is no longer active. An admin may need to re-post the panel.',
          flags: 64, // ephemeral — only the clicking user sees it
        },
      });
    }

    // Unknown interaction type — return a graceful ephemeral response so
    // Discord never shows "This interaction failed" on any code path.
    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ This interaction is not supported.',
        flags: 64,
      },
    });
  } catch (err) {
    // Last-resort catch: any unexpected exception in the routing or handler
    // code is converted to a proper ephemeral Discord error so the user sees
    // a helpful message rather than Discord's generic "This interaction failed".
    console.error('Unhandled error in interaction handler:', err);
    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `❌ An unexpected error occurred. Please try again.\n\`${err?.message ?? 'Unknown error'}\``,
        flags: 64,
      },
    });
  }
}

// ===== Worker entry-point (unified: static assets + Discord bot) =====

export default {
  /**
   * Unified fetch handler — routes in priority order:
   *
   *   1. CORS preflight (OPTIONS *)
   *   2. Dashboard API — POST /api/notify-payouts and /api/trigger-weekly
   *   3. Discord interactions — detected by Ed25519 signature headers;
   *      always acknowledges immediately (≪ 3 s) via a deferred response
   *   4. /bot-config.js — served from assets or a safe JS fallback
   *   5. Everything else — static web-dashboard assets with CSP headers
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. CORS preflight for all dashboard API endpoints
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 2. Dashboard API routes (TRIGGER_TOKEN-authenticated)
    if (request.method === 'POST' && url.pathname === '/api/notify-payouts') {
      return handleNotifyPayouts(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/trigger-weekly') {
      return handleTriggerWeekly(request, env);
    }

    // 2b. Gateway management — start or restart the Discord Gateway Durable Object.
    //     Called once after deploy and periodically by the cron health-check.
    //     No authentication required (the DO is only accessible via internal routing).
    if (url.pathname === '/api/gateway-start') {
      if (env.DISCORD_GATEWAY && env.DISCORD_BOT_TOKEN) {
        const id  = env.DISCORD_GATEWAY.idFromName('main');
        const stub = env.DISCORD_GATEWAY.get(id);
        await stub.fetch('https://do-internal/start');
        return new Response('Gateway start signalled.', { status: 200 });
      }
      return new Response('DISCORD_GATEWAY binding not configured.', { status: 503 });
    }

    // 3. Discord interactions — Discord always POSTs with Ed25519 signature headers.
    //    Checking for those headers is the only reliable way to distinguish a Discord
    //    request from a browser request without reading the body first.
    if (
      request.method === 'POST' &&
      request.headers.get('X-Signature-Ed25519') &&
      request.headers.get('X-Signature-Timestamp')
    ) {
      return handleDiscordInteraction(request, env, ctx);
    }

    // 4. bot-config.js — generated by GitHub Actions at deploy time; falls back
    //    to safe defaults so the dashboard functions before secrets are configured.
    if (url.pathname === '/bot-config.js') {
      if (env.ASSETS) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
      }
      const defaultConfig = {
        url:   'https://kintsugi-discord-bot.reecestangoe0824.workers.dev',
        token: FALLBACK_TRIGGER_TOKEN,
      };
      return new Response(
        '// Auto-generated fallback (deploy via GitHub Actions to inject real secrets).\n' +
        'window.KINTSUGI_BOT_CONFIG = ' + JSON.stringify(defaultConfig) + ';\n',
        { headers: { 'Content-Type': 'application/javascript' } }
      );
    }

    // 5. Static web-dashboard assets (all remaining requests).
    //    env.ASSETS is provided by the assets binding in wrangler.jsonc.
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      return addCspToHtmlResponse(assetResponse);
    }

    // No ASSETS binding (local dev without --assets): return a simple status page.
    return new Response('Kintsugi Bot is running.', { status: 200 });
  },

  /**
   * Scheduled handler — runs on the Cron Trigger defined in wrangler.jsonc.
   * Fires every 5 minutes to:
   *   1. Validates that DISCORD_BOT_TOKEN is present.
   *   2. Reads live job data from the Google Sheet.
   *   3. Posts/edits the week's analytics summary in #analytics (requires ANALYTICS_CHANNEL_ID).
   *   4. Posts the weekly job-activity list in #jobs (requires JOBS_CHANNEL_ID).
   *   5. Sends a deduplicated payday reminder ping in #payouts (requires PAYOUTS_CHANNEL_ID).
   * Steps 3–5 are skipped gracefully when their channel ID secret is not configured.
   */
  async scheduled(_event, env, _ctx) {
    if (!env.KV) {
      console.warn(
        'scheduled: env.KV is not bound — analytics message editing and ' +
        'payday deduplication are disabled. The deploy workflow should bind ' +
        'the KINTSUGI_BOT KV namespace automatically; check that ' +
        'CLOUDFLARE_API_TOKEN has Workers KV Storage:Edit permission and ' +
        'that the deploy workflow ran successfully.'
      );
    }

    const missing = validateConfig(env);
    if (missing.length > 0) {
      console.error(
        'scheduled: missing required configuration — set these secrets:\n' +
        missing.map(k => `  wrangler secret put ${k}`).join('\n')
      );
      return;
    }

    try {
      const jobRows = await fetchSheet(JOBS_SHEET);
      const allJobs = parseJobsSheet(jobRows);

      // Use current week data; fall back to the most recent week with actual
      // data so the messages are always useful even early in the week.
      let summary = buildCurrentWeekSummary(allJobs);
      if (summary.totalRepairs === 0) {
        const latest = buildLatestWeekSummary(allJobs);
        if (latest && latest.totalRepairs > 0) summary = latest;
      }

      const prevSummary = buildPrevWeekSummary(allJobs);
      await Promise.all([
        postWeeklyAnalytics(env, summary, prevSummary),
        postJobsUpdate(env, summary),
        postPaydayReminder(env, summary.weekEndDate, summary.totalPayout),
      ]);
    } catch (err) {
      console.error('scheduled: error posting to Discord:', err.message);
    }

    // Keep the Discord Gateway Durable Object alive.
    // If the DO was evicted and its alarm somehow failed (e.g. first deploy),
    // this ensures it reconnects within 5 minutes.
    if (env.DISCORD_GATEWAY && env.DISCORD_BOT_TOKEN) {
      try {
        const id   = env.DISCORD_GATEWAY.idFromName('main');
        const stub = env.DISCORD_GATEWAY.get(id);
        await stub.fetch('https://do-internal/start');
      } catch (err) {
        console.warn('scheduled: gateway keepalive failed:', err?.message);
      }
    }
  },
};

// ===== DiscordGateway Durable Object =====
//
// Maintains a persistent WebSocket connection to Discord's Gateway so the bot
// can receive MESSAGE_CREATE events and respond to @mentions in real time.
//
// Why a Durable Object?
//   Cloudflare Workers are stateless HTTP handlers — they can't hold an open
//   WebSocket to Discord's servers between requests.  Durable Objects CAN
//   maintain long-lived async operations via ctx.waitUntil(), and their
//   alarm() method wakes the object up to reconnect if the connection ever
//   drops.  This gives us real-time @mention responses without any external
//   hosting or persistent VM.
//
// Connection lifecycle:
//   1. main Worker receives GET /api/gateway-start → forwards to DO
//   2. DO opens wss://gateway.discord.gg, identifies, receives READY
//   3. DO heartbeats on Discord's interval; ctx.waitUntil keeps it alive
//   4. On MESSAGE_CREATE with bot @mention: fetches last 5 messages for
//      context, calls Workers AI, replies to the message
//   5. On connection drop: DO sets a 5-second alarm then may hibernate
//   6. Alarm fires → fresh DO instance reconnects (session resume attempted)
//   7. 5-minute cron pings /start as a safety net if alarm somehow failed
//
// Required Gateway intents:
//   GUILDS (1) + GUILD_MESSAGES (512) = 513
//   No privileged intents needed: Discord always includes message content
//   for messages that @mention the bot, regardless of MESSAGE_CONTENT intent.

export class DiscordGateway {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // _running tracks whether _connect() is already active on THIS instance.
    // Prevents double connections when /start is called while already connected.
    this._running = false;
  }

  // ---- Public fetch handler (called by the main Worker) ----

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/start') {
      if (!this._running) {
        this._running = true;
        this.ctx.waitUntil(
          this._connect().finally(() => { this._running = false; })
        );
      }
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  // ---- Alarm handler — fires when the connection drops and reconnects ----

  async alarm() {
    if (!this._running) {
      this._running = true;
      this.ctx.waitUntil(
        this._connect().finally(() => { this._running = false; })
      );
    }
  }

  // ---- Gateway connection ----

  async _connect() {
    if (!this.env.DISCORD_BOT_TOKEN) {
      console.warn('DiscordGateway: DISCORD_BOT_TOKEN is not set — cannot connect.');
      return;
    }

    // Retrieve persisted session state (survives DO hibernation)
    const [storedSeq, storedSession, storedResumeUrl] = await Promise.all([
      this.ctx.storage.get('seq'),
      this.ctx.storage.get('sessionId'),
      this.ctx.storage.get('resumeGatewayUrl'),
    ]);

    // Decide gateway URL: use resume URL if we have a session to resume
    const gatewayUrl = (storedSession && storedResumeUrl)
      ? `${storedResumeUrl}?v=10&encoding=json`
      : 'wss://gateway.discord.gg/?v=10&encoding=json';

    let ws;
    try {
      ws = new WebSocket(gatewayUrl);
    } catch (err) {
      console.error('DiscordGateway: failed to open WebSocket:', err?.message);
      await this.ctx.storage.setAlarm(Date.now() + 10_000);
      return;
    }

    let seq        = storedSeq   ?? null;
    let sessionId  = storedSession  ?? null;
    let resuming   = !!(storedSession && storedResumeUrl);
    let identified = false;
    let heartbeatTimer = null;

    // This Promise stays pending while the WebSocket is open, keeping the DO alive.
    await new Promise((resolve) => {
      ws.addEventListener('open', () => {
        console.log('DiscordGateway: WebSocket connected.');
      });

      ws.addEventListener('message', (event) => {
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }

        if (payload.s != null) seq = payload.s;

        switch (payload.op) {
          case 10: { // HELLO — server tells us the heartbeat interval
            const interval = payload.d?.heartbeat_interval ?? 41_250;
            // Send an initial heartbeat slightly early (jitter per Discord docs)
            const jitter = Math.random() * interval;
            heartbeatTimer = setTimeout(() => {
              this._heartbeat(ws, seq);
              heartbeatTimer = setInterval(() => this._heartbeat(ws, seq), interval);
            }, jitter);

            if (resuming && sessionId) {
              // Attempt RESUME to replay missed events
              ws.send(JSON.stringify({
                op: 6,
                d: { token: this.env.DISCORD_BOT_TOKEN, session_id: sessionId, seq },
              }));
            } else {
              // Fresh IDENTIFY
              ws.send(JSON.stringify({
                op: 2,
                d: {
                  token:      this.env.DISCORD_BOT_TOKEN,
                  intents:    513, // GUILDS (1) | GUILD_MESSAGES (512)
                  properties: { os: 'linux', browser: 'kintsugi', device: 'kintsugi' },
                },
              }));
            }
            identified = true;
            break;
          }

          case 11: // HEARTBEAT_ACK — Discord acknowledged our heartbeat
            break;

          case 1: // HEARTBEAT request from server
            this._heartbeat(ws, seq);
            break;

          case 7: // RECONNECT — Discord wants us to reconnect
            console.log('DiscordGateway: server requested RECONNECT.');
            ws.close(1000);
            break;

          case 9: // INVALID_SESSION
            if (!payload.d) {
              // Session is not resumable — clear stored state and re-identify
              sessionId = null;
              resuming  = false;
              this.ctx.storage.delete('sessionId');
              this.ctx.storage.delete('resumeGatewayUrl');
            }
            // Back off before re-identifying (Discord recommends 1–5 s)
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  op: 2,
                  d: {
                    token:      this.env.DISCORD_BOT_TOKEN,
                    intents:    513,
                    properties: { os: 'linux', browser: 'kintsugi', device: 'kintsugi' },
                  },
                }));
              }
            }, 2_500);
            break;

          case 0: // DISPATCH — an actual event
            this._onDispatch(payload, (s) => { seq = s; }).catch((err) => {
              console.error('DiscordGateway: dispatch error:', err?.message);
            });
            break;
        }
      });

      ws.addEventListener('close', (event) => {
        clearTimeout(heartbeatTimer);
        clearInterval(heartbeatTimer);
        console.log(`DiscordGateway: WebSocket closed (${event.code}). Scheduling reconnect.`);
        // Persist sequence so we can RESUME
        Promise.all([
          this.ctx.storage.put('seq', seq),
          this.ctx.storage.put('sessionId', sessionId),
        ]).catch(() => {}).finally(() => resolve());
        this.ctx.storage.setAlarm(Date.now() + 5_000).catch(() => {});
      });

      ws.addEventListener('error', (err) => {
        console.error('DiscordGateway: WebSocket error:', err?.message ?? err);
        // close event will follow — resolve happens there
      });
    });
  }

  // ---- Send a heartbeat ----

  _heartbeat(ws, seq) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 1, d: seq }));
    }
  }

  // ---- Handle DISPATCH events ----

  async _onDispatch(payload, updateSeq) {
    if (payload.s != null) updateSeq(payload.s);

    if (payload.t === 'READY') {
      const user = payload.d?.user;
      await Promise.all([
        this.ctx.storage.put('botUserId',       user?.id ?? ''),
        this.ctx.storage.put('sessionId',       payload.d?.session_id ?? ''),
        this.ctx.storage.put('resumeGatewayUrl', payload.d?.resume_gateway_url ?? ''),
      ]);
      console.log(`DiscordGateway: READY as ${user?.username ?? 'unknown'}#${user?.discriminator ?? '0'}`);
      return;
    }

    if (payload.t === 'RESUMED') {
      console.log('DiscordGateway: session successfully RESUMED.');
      return;
    }

    if (payload.t === 'MESSAGE_CREATE') {
      await this._onMessage(payload.d);
    }
  }

  // ---- Handle a MESSAGE_CREATE event ----

  async _onMessage(msg) {
    // Ignore messages from bots (including ourselves)
    if (msg.author?.bot) return;

    const botUserId = await this.ctx.storage.get('botUserId');
    if (!botUserId) return;

    // Only respond when the bot is @mentioned in this message
    const mentioned = Array.isArray(msg.mentions)
      ? msg.mentions.some(m => m.id === botUserId)
      : (msg.content || '').includes(`<@${botUserId}>`) ||
        (msg.content || '').includes(`<@!${botUserId}>`);
    if (!mentioned) return;

    // Strip all @mentions and clean up the question text
    const question = (msg.content || '')
      .replace(/<@!?\d+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Fetch the last 5 messages in the channel BEFORE this one for context.
    // REST API calls always return full message content regardless of intents.
    let contextMessages = [];
    try {
      const ctxRes = await fetch(
        `https://discord.com/api/v10/channels/${msg.channel_id}/messages?limit=5&before=${msg.id}`,
        { headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` } }
      );
      if (ctxRes.ok) {
        const raw = await ctxRes.json();
        // Reverse so oldest-first; skip messages from bots to keep context clean
        contextMessages = raw
          .filter(m => !m.author?.bot)
          .reverse();
      }
    } catch (err) {
      console.warn('DiscordGateway: failed to fetch context messages:', err?.message);
    }

    // Build a readable context string for the AI
    const contextBlock = contextMessages
      .map(m => `${m.author?.username ?? 'Unknown'}: ${(m.content || '').trim()}`)
      .filter(Boolean)
      .join('\n');

    const userPrompt = contextBlock
      ? `Recent conversation for context:\n${contextBlock}\n\n@mention question: ${question || '(no text — user just mentioned me)'}`
      : (question || '(user mentioned me with no text)');

    // Call Workers AI with the assistant manager persona
    let answer;
    try {
      if (!this.env.AI) throw new Error('Workers AI binding (env.AI) is not configured.');
      const result = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: ASSISTANT_MANAGER_SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: 350,
      });
      answer = (result?.response ?? '').trim() ||
        "Right, the AI's gone completely blank. Brilliant. Try again later, mate.";
    } catch (err) {
      console.error('DiscordGateway: AI call failed:', err?.message);
      answer =
        `Fantastic, the AI's having a complete strop. \`${err?.message ?? 'Unknown error'}\` ` +
        '— sort it out and try again, will ya?';
    }

    // Reply to the original message so the thread is clear
    try {
      await fetch(`https://discord.com/api/v10/channels/${msg.channel_id}/messages`, {
        method:  'POST',
        headers: {
          Authorization:  `Bot ${this.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content:           answer,
          message_reference: { message_id: msg.id },
        }),
      });
    } catch (err) {
      console.error('DiscordGateway: failed to send reply:', err?.message);
    }
  }
}

// ===== Global error handlers (Node.js / local test runtime only) =====
// In Cloudflare Workers `process` is undefined — the guards below prevent
// runtime errors.  In local Node.js runs (e.g. scripts/test-invoice-flow.mjs)
// these handlers surface hidden promise rejections and synchronous exceptions
// that would otherwise be swallowed or crash the process silently.
if (typeof process !== 'undefined') {
  process.on('unhandledRejection', (reason) => {
    console.error(JSON.stringify({
      ts:     new Date().toISOString(),
      event:  'unhandledRejection',
      reason: String(reason),
      stack:  reason instanceof Error ? reason.stack : undefined,
    }));
  });

  process.on('uncaughtException', (err) => {
    console.error(JSON.stringify({
      ts:    new Date().toISOString(),
      event: 'uncaughtException',
      error: err.message,
      stack: err.stack,
    }));
    // Log and continue — a Worker process may be handling concurrent requests,
    // so forced termination would drop them.  CI pipelines detect non-zero exit
    // through test failures rather than uncaughtException.
  });
}
