// =======================================
// Kintsugi Discord Bot — Cloudflare Worker
//
// Handles Discord component interactions (button presses + select menus) for
// two permanent panels:
//   • Job Logs panel    — request any mechanic's repair history by week
//   • Payouts panel     — view the current week's payout breakdown
//
// Also handles /analytics and /payouts slash commands, and the weekly cron
// trigger that posts/edits summaries to #analytics, #jobs, and #payouts
// channels every 5 minutes (defined in wrangler.toml).
//
// The bot is deployed as "kintsugi-bot" — a separate Cloudflare Worker from
// the static-assets worker ("kintsugi"). The Interactions Endpoint URL in the
// Discord Developer Portal must point to THIS worker's URL.
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
      rec = { weekKey, weekEndDate, totalRepairs: 0, engineReplacements: 0 };
      weekMap.set(weekKey, rec);
    }
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

  if (iMech === -1 || iAcross === -1) return [];

  const jobs = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const mech   = (row[iMech] || '').trim();
    if (!mech) continue;

    const across = parseInt(row[iAcross] || '0', 10) || 0;
    if (!across) continue;

    let engineCount = 0;
    if (iEngine !== -1) {
      const raw = (row[iEngine] || '').trim();
      const n   = Number(raw);
      if (!isNaN(n) && n > 0)           { engineCount = n; }
      else if (/^(yes|y|true)$/i.test(raw)) { engineCount = 1; }
    }

    const tsDate  = iTime  !== -1 ? parseDateLike(row[iTime])  : null;
    const weekEnd = iWeek  !== -1 ? parseDateLike(row[iWeek])  : null;
    const monthEnd= iMonth !== -1 ? parseDateLike(row[iMonth]) : null;
    const bestDate = tsDate || weekEnd || monthEnd;

    jobs.push({ mechanic: mech, across, engineReplacements: engineCount,
                tsDate, weekEnd, monthEnd, bestDate });
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

// ===== /payouts and /analytics slash-command helpers =====

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
        repairs:            0, // "across" = repairs across (number of repair slots)
        engineReplacements: 0,
        totalPayout:        0,
      };
      mechMap.set(j.mechanic, rec);
    }
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
      line += ` — ${m.repairs} repair${m.repairs !== 1 ? 's' : ''}`;
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
    fields.push({ name: '💰 Total Disbursed', value: fmtMoney(grandTotal), inline: true });
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

// ===== /analytics slash-command handler =====

/**
 * Handle the /analytics slash command.
 * Defers publicly, reads live sheet data, and edits the deferred response
 * with the current week's analytics summary including per-mechanic breakdown.
 */
async function handleAnalyticsCommand(interaction, ctx) {
  const { application_id: appId, token } = interaction;

  ctx.waitUntil((async () => {
    try {
      const jobRows = await fetchSheet(JOBS_SHEET);
      const allJobs = parseJobsSheet(jobRows);

      // Try current week first; fall back to the most recent week with data
      let summary = buildCurrentWeekSummary(allJobs);
      if (summary.totalRepairs === 0) {
        const latest = buildLatestWeekSummary(allJobs);
        if (latest && latest.totalRepairs > 0) summary = latest;
      }

      if (summary.totalRepairs === 0) {
        await editOriginalMessage(appId, token, {
          content:    '📊 No repairs found in any recent week.',
          components: [],
        });
        return;
      }

      await editOriginalMessage(appId, token, buildAnalyticsPayload(summary));
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load analytics data.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });
}

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
 * The current week (ending this coming Sunday) is always listed first so the
 * user can always check the current pay period even with no jobs yet.
 * Historical weeks come from the mechanic's actual job data, newest first.
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

  // Always include the current week first
  options.push({
    label:       `Week ending ${fmtDate(currentSunday)}`,
    value:       currentSundayKey,
    description: "This week's jobs",
    emoji:       { name: '📅' },
  });
  seenKeys.add(currentSundayKey);

  // Add historical weeks from job data (sorted newest first)
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

  const totalRepairs = weeks.reduce((s, w) => s + w.totalRepairs, 0);
  const totalPayout  = weeks.reduce((s, w) => s + w.totalPayout,  0);
  const totalEngines = weeks.reduce((s, w) => s + w.engineReplacements, 0);

  // One inline field per week, newest first, capped at 10
  const displayWeeks = weeks.slice(0, 10);
  const fields = displayWeeks.map(w => {
    const name  = w.weekEndDate
      ? `Week ending ${fmtDate(w.weekEndDate)}`
      : w.weekKey;
    let value   = `Repairs: **${w.totalRepairs}**`;
    if (w.engineReplacements > 0) {
      value += `\nEngines: ${w.engineReplacements}`;
    }
    value += `\nPayout: **${fmtMoney(w.totalPayout)}**`;
    return { name, value, inline: true };
  });

  if (weeks.length > 10) {
    fields.push({
      name:   `+${weeks.length - 10} more week(s)`,
      value:  'Only the 10 most recent weeks are shown. Use **This Month** or **Current Week** to narrow the range.',
      inline: false,
    });
  }

  let description = `**State ID:** ${stateId || 'N/A'} · **Period:** ${periodLabel(period)}\n`;
  description += totalEngines > 0
    ? `**Total:** ${totalRepairs} repairs · ${totalEngines} engines · ${fmtMoney(totalPayout)}`
    : `**Total:** ${totalRepairs} repairs · ${fmtMoney(totalPayout)}`;

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
      const weekEndDate  = new Date(weekKey + 'T00:00:00Z');
      const filteredJobs = filterByWeekEnding(mechanicJobs, weekEndDate);
      const weeks        = buildWeeklyStats(filteredJobs);

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

// ===== Payouts panel handlers =====

/**
 * "View My Payout" button pressed on the permanent payouts panel.
 *
 * Responds immediately with an ephemeral deferral, fetches the mechanic list,
 * and edits the private message with a mechanic select menu so the user can
 * choose which mechanic's payout they want to view.
 */
async function handlePayoutsPanelButton(interaction, ctx) {
  const { application_id: appId, token } = interaction;

  ctx.waitUntil((async () => {
    try {
      const jobRows = await fetchSheet(JOBS_SHEET);
      const allJobs = parseJobsSheet(jobRows);
      const names   = [...new Set(allJobs.map(j => j.mechanic))].sort(
        (a, b) => a.localeCompare(b)
      );

      if (names.length === 0) {
        await editOriginalMessage(appId, token, {
          content:    '❌ No mechanics found in the sheet.',
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
        content: `💸 **Select a mechanic to view their payout:**${overflow}`,
        components: [
          {
            type: 1,
            components: [
              {
                type:        3,
                custom_id:   'payouts_mech_select',
                placeholder: 'Choose a mechanic…',
                options,
              },
            ],
          },
        ],
      });
    } catch (err) {
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load mechanic list.\n\`${err.message}\``,
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
 * Mechanic selected from the payouts panel dropdown.
 *
 * Fetches live sheet data, finds that mechanic's payout for the most recent
 * week (or the current week if it has data), and edits the private message
 * with a formatted payout embed.
 */
async function handlePayoutsMechSelect(interaction, ctx) {
  const { application_id: appId, token } = interaction;
  const mechanic = interaction.data.values[0];

  ctx.waitUntil((async () => {
    try {
      const [jobRows, stateRows] = await Promise.all([
        fetchSheet(JOBS_SHEET),
        fetchSheet(STATE_IDS_SHEET).catch(() => []),
      ]);
      const allJobs  = parseJobsSheet(jobRows);
      const stateMap = parseStateIds(stateRows);
      const stateId  = stateMap.get(mechanic) || 'N/A';

      // Find the most recent week that has data for anyone (not just this mechanic)
      const allWeeks = buildWeeklyStats(allJobs);
      if (!allWeeks.length) {
        await editOriginalMessage(appId, token, {
          content:    '❌ No payout data found.',
          components: [],
        });
        return;
      }

      const latestWeek    = allWeeks[0];
      const weekEndDate   = latestWeek.weekEndDate
        || new Date(latestWeek.weekKey + 'T00:00:00Z');
      const weekJobs      = filterByWeekEnding(allJobs, weekEndDate);
      const mechanicJobs  = weekJobs.filter(j => j.mechanic === mechanic);

      // Aggregate this mechanic's repairs and engines for that week
      let repairs  = 0, engines = 0;
      for (const j of mechanicJobs) {
        repairs += j.across || 0;
        engines += j.engineReplacements || 0;
      }
      const payout = repairs * PAY_PER_REPAIR + engines * ENGINE_PAY_DEFAULT;

      const fields = [
        { name: '📅 Week Ending',   value: fmtDate(weekEndDate), inline: true },
        { name: '🔧 Repairs',        value: String(repairs),      inline: true },
        { name: '💰 Payout',         value: fmtMoney(payout),     inline: true },
      ];
      if (engines > 0) {
        fields.push({ name: '🔩 Engines', value: String(engines), inline: true });
      }
      if (stateId && stateId !== 'N/A') {
        fields.push({ name: '🪪 State ID', value: stateId, inline: true });
      }

      const color  = repairs > 0 ? 0x22c55e : 0xef4444;
      const notice = repairs === 0
        ? `No jobs were recorded for **${mechanic}** in the week ending **${fmtDate(weekEndDate)}**.`
        : '';

      await editOriginalMessage(appId, token, {
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
      });
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
 * mechanic's payout for the exact week the workflow ran for.
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

      const stateId = stateMap.get(mechanic) || null;
      let repairs = 0, engines = 0;
      for (const j of mechJobs) {
        repairs += j.across || 0;
        engines += j.engineReplacements || 0;
      }
      const payout = repairs * PAY_PER_REPAIR + engines * ENGINE_PAY_DEFAULT;

      const fields = [
        { name: '📅 Week Ending', value: fmtDate(weekEndDate), inline: true },
        { name: '🔧 Repairs',     value: String(repairs),      inline: true },
        { name: '💰 Payout',      value: fmtMoney(payout),     inline: true },
      ];
      if (engines > 0) {
        fields.push({ name: '🔩 Engines', value: String(engines), inline: true });
      }
      if (stateId && stateId !== 'N/A') {
        fields.push({ name: '🪪 State ID', value: stateId, inline: true });
      }

      const color  = repairs > 0 ? 0x22c55e : 0xef4444;
      const notice = repairs === 0
        ? `No jobs were recorded for **${mechanic}** in the week ending **${fmtDate(weekEndDate)}**.`
        : '';

      await editOriginalMessage(appId, token, {
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
      });
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
 * Validate that all required channel/bot configuration is present in env.
 * Returns an array of missing variable names (empty array means all good).
 */
function validateConfig(env) {
  const required = [
    'DISCORD_BOT_TOKEN',
    'ANALYTICS_CHANNEL_ID',
    'JOBS_CHANNEL_ID',
    'PAYOUTS_CHANNEL_ID',
  ];
  return required.filter(k => !env[k]);
}

/**
 * Build the weekly analytics embed payload so it can be reused for both
 * posting and editing.  Now includes a per-mechanic breakdown so the analytics
 * channel shows who worked and how much they earned, not just aggregate totals.
 */
function buildAnalyticsPayload(summary) {
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
 * each week rather than posting a new one.  If the stored message no longer
 * exists (deleted), a new message is posted and its ID stored.
 * Uses DISCORD_BOT_TOKEN, ANALYTICS_CHANNEL_ID, and the KV namespace from env.
 */
async function postWeeklyAnalytics(env, summary) {
  if (!env.DISCORD_BOT_TOKEN || !env.ANALYTICS_CHANNEL_ID) return false;

  const payload = buildAnalyticsPayload(summary);

  // Try to edit the existing analytics message
  if (env.KV) {
    const storedId = await env.KV.get('analytics_message_id');
    if (storedId) {
      const edited = await botEdit(env.ANALYTICS_CHANNEL_ID, env.DISCORD_BOT_TOKEN, storedId, payload);
      if (edited) return true;
      // Message was deleted — fall through to post a new one
    }
  }

  // Post a new message and persist its ID
  const messageId = await botPost(env.ANALYTICS_CHANNEL_ID, env.DISCORD_BOT_TOKEN, payload);
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
 */
async function postPaydayReminder(env, weekEndDate) {
  if (!env.DISCORD_BOT_TOKEN || !env.PAYOUTS_CHANNEL_ID) return false;

  // Deduplicate: skip if we already sent the reminder for this week
  const weekKey = weekEndDate.toISOString().slice(0, 10);
  if (env.KV) {
    const lastKey = await env.KV.get('last_reminder_week');
    if (lastKey === weekKey) return true; // already sent for this week-ending date
  }

  const mention = env.RIPTIDE_USER_ID
    ? `<@${env.RIPTIDE_USER_ID}>`
    : '**@riptide248**';

  const messageId = await botPost(env.PAYOUTS_CHANNEL_ID, env.DISCORD_BOT_TOKEN, {
    content: `${mention} 💰 **Payday reminder!** Payouts are due to be processed for the week ending **${fmtDate(weekEndDate)}**. Please review and mark them as processed in the dashboard when done.`,
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
 * Runs the same logic as the Sunday cron trigger:
 *   1. Reads live job data from Google Sheets.
 *   2. Posts/edits the weekly analytics summary in #analytics.
 *   3. Posts the job-activity list in #jobs.
 *   4. Sends the payday reminder ping in #payouts.
 *
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

    const [analyticsOk, jobsOk, payoutsOk] = await Promise.all([
      postWeeklyAnalytics(env, summary),
      postJobsUpdate(env, summary),
      postPaydayReminder(env, summary.weekEndDate),
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

// ===== Worker entry-point =====

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight for all dashboard API endpoints
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Dashboard API: POST /api/notify-payouts
    // This route is checked before Discord signature verification so that
    // requests from the web dashboard (which carry a TRIGGER_TOKEN, not a
    // Discord signature) are handled correctly.
    if (request.method === 'POST' && url.pathname === '/api/notify-payouts') {
      return handleNotifyPayouts(request, env);
    }

    // Dashboard API: POST /api/trigger-weekly
    // Manually triggers the same posts as the Sunday cron (analytics, jobs,
    // payouts reminder). Useful for first-time setup and testing.
    if (request.method === 'POST' && url.pathname === '/api/trigger-weekly') {
      return handleTriggerWeekly(request, env);
    }

    // Health check
    if (request.method === 'GET') {
      return new Response('Kintsugi Discord Bot is running.', { status: 200 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Verify Discord signature before parsing anything
    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    if (!signature || !timestamp) {
      return new Response('Unauthorized', { status: 401 });
    }

    const rawBody = await request.text();
    const valid   = await verifyDiscordSignature(
      rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY
    );
    if (!valid) {
      return new Response('Invalid signature', { status: 401 });
    }

    const interaction = JSON.parse(rawBody);

    // Discord PING — required for Interactions Endpoint URL verification
    if (interaction.type === InteractionType.PING) {
      return jsonResponse({ type: InteractionResponseType.PONG });
    }

    // Slash commands
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      if (interaction.data?.name === 'payouts') {
        return handlePayoutsCommand(interaction, ctx);
      }
      if (interaction.data?.name === 'analytics') {
        return handleAnalyticsCommand(interaction, ctx);
      }
    }

    // Component interactions (button + select menus)
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      const customId = interaction.data.custom_id || '';

      if (customId === 'joblogs_start') {
        return handleStartButton(interaction, ctx);
      }
      if (customId === 'joblogs_mech_select') {
        return handleMechSelect(interaction, ctx);
      }
      if (customId.startsWith('joblogs_week_select:')) {
        return handleWeekSelect(interaction, ctx);
      }

      // Payouts panel button + mechanic select
      if (customId === 'payouts_panel_start') {
        return handlePayoutsPanelButton(interaction, ctx);
      }
      if (customId === 'payouts_mech_select') {
        return handlePayoutsMechSelect(interaction, ctx);
      }

      // Week-specific payouts button + mechanic select (posted by post-payouts workflow)
      if (customId.startsWith('payouts_week_view:')) {
        return handlePayoutsWeekButton(interaction, ctx);
      }
      if (customId.startsWith('payouts_week_mech:')) {
        return handlePayoutsWeekMechSelect(interaction, ctx);
      }
    }

    return new Response('Unknown interaction type', { status: 400 });
  },

  /**
   * Scheduled handler — runs on the Cron Trigger defined in wrangler.toml.
   * Every Sunday at 18:00 UTC it:
   *   1. Validates that all required channel configuration is present.
   *   2. Reads live job data from the Google Sheet.
   *   3. Posts/edits the week's analytics summary in #analytics.
   *   4. Posts the weekly job-activity list in #jobs.
   *   5. Sends a deduplicated payday reminder ping in #payouts.
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

      await Promise.all([
        postWeeklyAnalytics(env, summary),
        postJobsUpdate(env, summary),
        postPaydayReminder(env, summary.weekEndDate),
      ]);
    } catch (err) {
      console.error('scheduled: error posting to Discord:', err.message);
    }
  },
};
