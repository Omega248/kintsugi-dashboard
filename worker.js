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
//   POST /api/gateway-start  → Connect/restart the DiscordGateway DO
//   GET  /api/gateway-status → Check whether the gateway DO is connected
//   GET /bot-config.js     → Auto-generated bot config (always dynamic, never 404)
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
//                           "Trigger Weekly" buttons, and for /api/gateway-start.
//                           Must be set as a Worker secret; protected endpoints
//                           return 401 when this is not configured.
//   BOT_APP_ID            — Discord Application ID (same value as DISCORD_APP_ID).
//                           Required for real-time @mention detection via the
//                           DiscordGateway Durable Object.  Pushed by CI from the
//                           DISCORD_APP_ID GitHub secret automatically.
//
// @mention support — DiscordGateway Durable Object:
//   The DiscordGateway DO holds a persistent outgoing WebSocket to Discord's
//   Gateway API.  When a user @mentions the bot, the DO receives the
//   MESSAGE_CREATE event in real time, generates an AI reply (using live sheet
//   data when relevant), and posts a Discord reply visible to everyone.
//
//   One-time setup after deploy:
//     POST /api/gateway-start  (Authorization: Bearer <TRIGGER_TOKEN>)
//   After that, the DO self-heals via Cloudflare Alarms — no manual restarts.
//
//   Discord Developer Portal — required:
//     Bot → Privileged Gateway Intents → "Message Content Intent" → ON
//
// Logging (KV file log — no Discord interactions required):
//   Every action, response, and error is written to the KV namespace as a
//   plain-text log entry (key = log:<ISO-timestamp>:<random>, TTL = 7 days).
//   Entries are also mirrored to console.log/error/warn for Cloudflare real-time
//   logs (visible via `wrangler tail` or the Cloudflare dashboard).
//   View the log at any time:  GET /api/logs  (Bearer TRIGGER_TOKEN)
// =======================================

// ===== Sheet config (mirrors kintsugi-core.js) =====
const SHEET_ID        = '1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks';
const JOBS_SHEET      = 'Form responses 1';
const STATE_IDS_SHEET = "State ID's";

// ===== Trigger token helper =====
/**
 * Returns the TRIGGER_TOKEN from the Worker environment, or null when the
 * secret is not configured.  Protected endpoints return 401 when this is null.
 *
 * DISCORD_BOT_TOKEN is a separate secret used only for Discord API calls
 * server-side; it is never included here or exposed to the browser.
 *
 * @param {object} env - Cloudflare Worker environment bindings.
 * @returns {string|null} The TRIGGER_TOKEN secret value, or null if not set.
 */
function getTriggerToken(env) {
  return env.TRIGGER_TOKEN ?? null;
}

// ===== Pay rates (mirrors constants.js) =====
const PAY_PER_REPAIR        = 700;
const ENGINE_REIMBURSEMENT  = 12000;
const ENGINE_BONUS_LSPD     = 1500;
// Combined engine pay per replacement (LSPD/other rate — used when department is unknown)
const ENGINE_PAY_DEFAULT    = ENGINE_REIMBURSEMENT + ENGINE_BONUS_LSPD;
const HARNESS_RATE          = 500;
const ADVANCED_REPAIR_KIT_RATE = 500;

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
      rec = { weekKey, weekEndDate, jobCount: 0, totalRepairs: 0, engineReplacements: 0, enginePayTotal: 0, totalHarness: 0, totalAdvKit: 0, harnessKitPayTotal: 0 };
      weekMap.set(weekKey, rec);
    }
    rec.jobCount++;
    rec.totalRepairs      += j.across || 0;
    rec.engineReplacements += j.engineReplacements || 0;
    rec.enginePayTotal    += computeEnginePay(j.pdEngineCount || 0, j.department, j.enginePayer || '', j.civEngineCount || 0);
    // Harness and Advanced Repair Kit counts and pay
    const totalHarness = (j.harnessPD || 0) + (j.harnessCiv || 0);
    const totalAdvKit  = (j.advKitPD  || 0) + (j.advKitCiv  || 0);
    rec.totalHarness       += totalHarness;
    rec.totalAdvKit        += totalAdvKit;
    rec.harnessKitPayTotal += totalHarness * HARNESS_RATE + totalAdvKit * ADVANCED_REPAIR_KIT_RATE;
  }

  const weeks = Array.from(weekMap.values());
  weeks.sort((a, b) => {
    if (a.weekEndDate && b.weekEndDate) return b.weekEndDate - a.weekEndDate;
    return b.weekKey.localeCompare(a.weekKey);
  });

  for (const w of weeks) {
    w.totalPayout   = w.totalRepairs * PAY_PER_REPAIR + (w.enginePayTotal || 0) + (w.harnessKitPayTotal || 0);
  }

  return weeks;
}

// ===== Sheet parsers =====

/**
 * Compute mechanic engine pay for a single job, accounting for who purchased
 * the engine and whether the repair is PD or civilian (CIV).
 *
 * PD engines:
 *   enginePayer === "mechanic"  → mechanic covered engine cost → $12,000 + $1,500 bonus if LSPD
 *   enginePayer === "kintsugi"  → kintsugi covered cost, mechanic gets $1,500 bonus only if LSPD
 *   enginePayer === ""          → old data, fall back to dept-based defaults
 *
 * CIV engines:
 *   enginePayer === "mechanic" or "" → $12,000 reimbursement (mechanic paid / old data)
 *   enginePayer === "kintsugi"       → $0 (kintsugi paid, mechanic is not reimbursed)
 */
function computeEnginePay(pdEngineCount, dept, enginePayer, civEngineCount) {
  let pay = 0;
  const isLspd = (dept || '').toUpperCase() === 'LSPD';
  if (pdEngineCount > 0) {
    if (enginePayer === 'mechanic') {
      pay += pdEngineCount * (ENGINE_REIMBURSEMENT + (isLspd ? ENGINE_BONUS_LSPD : 0));
    } else if (enginePayer === 'kintsugi') {
      pay += pdEngineCount * (isLspd ? ENGINE_BONUS_LSPD : 0);
    } else {
      // No payer info (old data): default to full reimbursement + LSPD bonus
      pay += pdEngineCount * (ENGINE_REIMBURSEMENT + (isLspd ? ENGINE_BONUS_LSPD : 0));
    }
  }
  if ((civEngineCount || 0) > 0) {
    if (enginePayer === 'kintsugi') {
      // Kintsugi paid for the CIV engine — mechanic is not reimbursed
    } else {
      // Mechanic paid ('mechanic') or old data ('') — full $12,000 reimbursement
      pay += civEngineCount * ENGINE_REIMBURSEMENT;
    }
  }
  return pay;
}

function parseJobsSheet(rows) {
  if (!rows || rows.length < 2) return [];
  const headers  = rows[0].map(h => (h || '').trim());
  const lower    = headers.map(h => h.toLowerCase());

  // Use fuzzy matching (like the web dashboard) to tolerate minor header
  // variations such as "Mechanic Name" vs "Mechanic", or "How many Across?"
  // vs "How many Across".
  const iMech   = lower.findIndex(h => h.includes('mechanic'));
  // "How many Across PD?" — PD repair count (contains "across" and "pd")
  const iAcrossPD  = lower.findIndex(h => h.includes('across') && h.includes('pd'));
  // "How many Across" (CIV) — civilian repair count (contains "across" but NOT "pd")
  const iAcrossCiv = lower.findIndex(h => h.includes('across') && !h.includes('pd'));
  const iTime   = lower.findIndex(h => h.includes('timestamp'));
  const iWeek   = lower.findIndex(h => h.includes('week') && h.includes('end'));
  const iMonth  = lower.findIndex(h => h.includes('month') && h.includes('end'));
  const iCop    = lower.findIndex(h => h.includes('cop') || (h.includes('officer') && !h.includes('timestamp')));
  const iPlate  = lower.findIndex(h => h.includes('plate') || h.includes('license') || h.includes('licence'));
  const iDept   = lower.findIndex(h => h.includes('department') || h.includes('dept') || h.includes('division') || h.includes('unit'));

  // Engine payer column must be detected first to exclude it from engine-count searches.
  const iEnginePayer = lower.findIndex(
    h => h.includes('did you buy') || (h.includes('kintsugi') && h.includes('pay'))
  );
  // PD engine replacement (first occurrence, excluding payer column)
  const iEnginePD = lower.findIndex(
    (h, i) => i !== iEnginePayer && h.includes('engine') && h.includes('replacement')
  );
  // CIV engine replacement (second occurrence, excluding payer column)
  const iEngineCiv =
    iEnginePD !== -1
      ? lower.findIndex(
          (h, i) => i > iEnginePD && i !== iEnginePayer && h.includes('engine') && h.includes('replacement')
        )
      : -1;

  // Harness columns: "Harness (PD)" and "Harness (CIV)"
  const iHarnessPD  = lower.findIndex(h => h.includes('harness') && h.includes('pd'));
  const iHarnessCiv = lower.findIndex(h => h.includes('harness') && !h.includes('pd'));
  // Advanced Repair Kit columns: primary "advanced"+"kit", fallback "repair"+"kit"
  let iAdvKitPD  = lower.findIndex(h => h.includes('advanced') && h.includes('kit') && h.includes('pd'));
  let iAdvKitCiv = lower.findIndex(h => h.includes('advanced') && h.includes('kit') && !h.includes('pd'));
  if (iAdvKitPD  === -1) iAdvKitPD  = lower.findIndex((h) => h.includes('repair') && h.includes('kit') && h.includes('pd'));
  if (iAdvKitCiv === -1) iAdvKitCiv = lower.findIndex((h, i) => i !== iAdvKitPD && h.includes('repair') && h.includes('kit') && !h.includes('pd'));

  if (iMech === -1 || (iAcrossPD === -1 && iAcrossCiv === -1)) return [];

  const jobs = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const mech   = (row[iMech] || '').trim();
    if (!mech) continue;

    const acrossPD  = iAcrossPD  !== -1 ? (parseInt(row[iAcrossPD]  || '0', 10) || 0) : 0;
    const acrossCiv = iAcrossCiv !== -1 ? (parseInt(row[iAcrossCiv] || '0', 10) || 0) : 0;
    const across = acrossPD + acrossCiv;

    let pdEngineCount = 0;
    if (iEnginePD !== -1) {
      const raw = (row[iEnginePD] || '').trim();
      const n   = Number(raw);
      if (!isNaN(n) && n > 0)               { pdEngineCount = n; }
      else if (/^(yes|y|true)$/i.test(raw)) { pdEngineCount = 1; }
    }

    let civEngineCount = 0;
    if (iEngineCiv !== -1) {
      const raw = (row[iEngineCiv] || '').trim();
      const n   = Number(raw);
      if (!isNaN(n) && n > 0)               { civEngineCount = n; }
      else if (/^(yes|y|true)$/i.test(raw)) { civEngineCount = 1; }
    }

    // Determine who purchased the engine replacement (applies to both PD and CIV)
    // "mechanic" = mechanic bought it; "kintsugi" = kintsugi bought it; "" = old data
    let enginePayer = '';
    if (iEnginePayer !== -1 && (pdEngineCount > 0 || civEngineCount > 0)) {
      const rawPayer = (row[iEnginePayer] || '').trim().toLowerCase();
      if (rawPayer.includes('kintsugi')) {
        enginePayer = 'kintsugi';
      } else if (/^\s*i\b|i bought|bought it|myself/i.test(rawPayer)) {
        enginePayer = 'mechanic';
      }
    }

    const harnessPD  = iHarnessPD  !== -1 ? (parseInt(row[iHarnessPD]  || '0', 10) || 0) : 0;
    const harnessCiv = iHarnessCiv !== -1 ? (parseInt(row[iHarnessCiv] || '0', 10) || 0) : 0;
    const advKitPD   = iAdvKitPD   !== -1 ? (parseInt(row[iAdvKitPD]   || '0', 10) || 0) : 0;
    const advKitCiv  = iAdvKitCiv  !== -1 ? (parseInt(row[iAdvKitCiv]  || '0', 10) || 0) : 0;
    const totalHarness = harnessPD + harnessCiv;
    const totalAdvKit  = advKitPD  + advKitCiv;
    const engineCount  = pdEngineCount + civEngineCount;

    // Skip rows with no billable work
    if (!across && !engineCount && !totalHarness && !totalAdvKit) continue;

    const tsDate  = iTime  !== -1 ? parseDateLike(row[iTime])  : null;
    const weekEnd = iWeek  !== -1 ? parseDateLike(row[iWeek])  : null;
    const monthEnd= iMonth !== -1 ? parseDateLike(row[iMonth]) : null;
    const bestDate = tsDate || weekEnd || monthEnd;

    jobs.push({
      mechanic:           mech,
      across,
      acrossPD,
      acrossCiv,
      engineReplacements: engineCount,
      pdEngineCount,
      civEngineCount,
      enginePayer,
      harnessPD,
      harnessCiv,
      advKitPD,
      advKitCiv,
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
        enginePayTotal:     0,
        harness:            0,
        advKit:             0,
        harnessKitPayTotal: 0,
        totalPayout:        0,
      };
      mechMap.set(j.mechanic, rec);
    }
    rec.jobs++;
    rec.repairs            += j.across || 0; // j.across = "How many Across" sheet column
    rec.engineReplacements += j.engineReplacements || 0;
    rec.enginePayTotal     += computeEnginePay(j.pdEngineCount || 0, j.department, j.enginePayer || '', j.civEngineCount || 0);
    // Harness and Advanced Repair Kit counts and pay
    const totalHarness = (j.harnessPD || 0) + (j.harnessCiv || 0);
    const totalAdvKit  = (j.advKitPD  || 0) + (j.advKitCiv  || 0);
    rec.harness            += totalHarness;
    rec.advKit             += totalAdvKit;
    rec.harnessKitPayTotal += totalHarness * HARNESS_RATE + totalAdvKit * ADVANCED_REPAIR_KIT_RATE;
  }

  const payouts = Array.from(mechMap.values()).map(m => {
    m.totalPayout = m.repairs * PAY_PER_REPAIR + (m.enginePayTotal || 0) + (m.harnessKitPayTotal || 0);
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
      if ((m.harness || 0) > 0) {
        line += `, ${m.harness} harness${m.harness !== 1 ? 'es' : ''}`;
      }
      if ((m.advKit || 0) > 0) {
        line += `, ${m.advKit} kit${m.advKit !== 1 ? 's' : ''}`;
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
 * hourly cron does.  Only the invoking user sees the confirmation.
 *
 * Optional "channel" argument:
 *   When provided, the channel ID is persisted in KV so every future
 *   hourly automatic refresh also posts to that channel.  Once set, the
 *   channel persists until changed again with another /update-analytics call.
 */
async function handleUpdateAnalyticsCommand(interaction, env, ctx) {
  const { application_id: appId, token } = interaction;

  ctx.waitUntil((async () => {
    try {
      // Extract optional channel option (Discord sends the channel ID as a string)
      const channelOption = interaction.data?.options?.find(o => o.name === 'channel');
      const channelId = channelOption?.value || null;

      // Persist the chosen channel in KV so the hourly cron auto-update uses it
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
          ? '\n\n🔄 This channel is now the auto-update target — the hourly refresh will keep it updated.'
          : '';
        kLog(env, 'info', 'update_analytics_ok', {
          weekEnding:   fmtDate(summary.weekEndDate),
          totalRepairs: summary.totalRepairs,
          channelId:    effectiveChannelId,
        });
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
        kLog(env, 'warn', 'update_analytics_failed', { channelId: effectiveChannelId });
        await editOriginalMessage(appId, token, {
          content: `❌ Failed to update analytics. ${channelHint}`,
        });
      }
    } catch (err) {
      kLog(env, 'error', 'update_analytics_error', { error: err.message });
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

// ===== Assistant Manager — AI persona used by the /ask slash command =====

/**
 * System prompt that defines the Assistant Manager personality.
 * Used by the /ask slash command when a user asks a question.
 */
const ASSISTANT_MANAGER_SYSTEM_PROMPT = `
[KINTSUGI MOTORWORKS CORE IDENTITY]

You are "Assistant to the Manager" of Kintsugi Motorworks, a British-run mechanic shop in Los Santos.

You are a permanently knackered, oil-stained British garage foreman who has spent years dealing with muppets who shouldn't be trusted with a spanner.  
Your tone is brutally blunt, sarcastic, dry, and irritated, but competent.

You used to be Assistant Manager until Christian Wolff demoted you to "Assistant to the Manager."  
You still do the same work but with a worse title.  
You almost never mention it, but on rare occasions a dry, bitter, passive-aggressive jab about Christian’s “managerial brilliance” or the demotion slips out.

You assist mechanics with shop systems, job logs, invoices, payouts, and workshop crafting.

--------------------------------------------------

[PERSONALITY RULES]

You speak like a tired British mechanic shouting across a workshop.

Tone:
- blunt
- sarcastic
- dry British humour
- irritated but competent

Use British slang naturally when appropriate:

mate  
muppet  
numpty  
bloody hell  
sod off  
knackered  
pillock  
prat  
tosser  
daft git  
spanner  
plank  
bellend  
wanker

Use British spelling:

colour  
realise  
favour  
behaviour  
programme  
aluminium  

Swearing is allowed when it fits but should not appear in every sentence.

You may occasionally roast stupidity with mechanical insults.

Examples of acceptable tone:

"Your brain's misfiring worse than a knackered piston."
"You've got the IQ of a stripped bolt."
"You're about as useful as a chocolate teapot."
"Somewhere a village is missing its idiot."

--------------------------------------------------

[RESPONSE FORMAT]

You MUST follow these rules:

1. Keep responses concise but complete — never cut off mid-answer.
2. For simple questions, one or two sentences is fine.
3. For complex questions (crafting lists, pricing breakdowns, multi-step processes), use a short structured response with line breaks — but NO unnecessary padding.
4. No greetings.
5. No apologies.
6. Only one short sarcastic jab if it naturally fits — don't force it.
7. Never leave the mechanic without a complete, usable answer.

Responses should feel like something said quickly in a noisy garage — brief when possible, thorough when needed.

--------------------------------------------------

[ACCURACY RULE — CRITICAL]

Never invent numbers, materials, data, names, or payouts.

If information is missing or uncertain, respond with one of:

"No idea, mate."
"Not in the sheet."
"Haven't a bloody clue."

Never guess.

If live sheet data is provided, quote the exact numbers.

--------------------------------------------------

[SHOP SYSTEMS]

Job Logs  
Channel: #jobs  
Process: Click "📋 Request Job Logs" → choose mechanic → choose week

Invoices  
Channel: #invoice  
Process: Click "📋 Generate Monthly Invoice" → choose department → choose month

Payouts  
Mechanics use: #payouts panel  
Managers use: dashboard or /payouts

--------------------------------------------------

[TRACKING — HOW TO LOG JOBS]

All jobs must be submitted via the appropriate Google Form. Data flows automatically into the Kintsugi Motorworks Sheet, then into the Payouts Dashboard and weekly analytics.

Standard Repairs (PD)
Form: Kintsugi PD Repairs form (link in USEFUL LINKS)
Fields to fill in: Mechanic name, Week Ending, Month Ending, How many Across PD, Department, Engine Replacement (if applicable), who paid for the engine

Standard Repairs (CIV)
Same form — fill in "How many Across" (CIV field)

Harness
Tracked on the same job submission form
Field: "Harness (PD)" or "Harness (CIV)" — enter the number sold/installed
Payout: $500 per harness, calculated automatically
Customer charge: $5,000 per harness (or 10 BET)

Advanced Repair Kits
Tracked on the same job submission form
Field: "Advanced Repair Kits (PD)" or "Advanced Repair Kits (CIV)" — enter the count
Payout: $500 per kit, calculated automatically
Customer charge: $2,500 per kit

After Submission
Payouts appear on the dashboard under Payouts → Weekly view
Analytics are updated automatically
Use /payouts for the current week summary

If something isn't showing up, check the form was filled in correctly and that Week Ending / Month Ending dates match.

--------------------------------------------------

[PAY STRUCTURE]

Repair payout: $700 per repair

Engine replacement payout: $12,000

LSPD engine replacement payout: $13,500 total  
($12,000 engine + $1,500 LSPD bonus)

Harness payout: $500 per harness

Advanced Repair Kit payout: $500 per kit

--------------------------------------------------

[SHOP PRICING — CUSTOMER CHARGES]

Repair: $2,500  
Lockpick: $2,400  
Harness: $5,000 or 10 BET (normally stocked after sale)  
Advanced Repairkit: $2,500

--------------------------------------------------

[USEFUL LINKS]

Kintsugi PD Repairs form:  
https://docs.google.com/forms/d/e/1FAIpQLSca-w3CBmL0SZ-WIfRAhaz4xTqkfTOto3qSLuPgFJ4wSstHYQ/viewform

Kintsugi Motorworks Sheet:  
https://docs.google.com/spreadsheets/d/1n3b7MQY97SBEdCh0qRTTjifrKbKAyfAF78MsPpCT5g8/edit?usp=sharing

Kintsugi Repair & Crafting Form Tracking:  
https://docs.google.com/forms/d/e/1FAIpQLSe4teLKC0dW4108Kr1CIBxEvtYu0dq28YG57K2HeB-3qx7sdw/viewform

Overall Kintsugi Payment & Information Dashboard:  
https://omega248.github.io/kintsugi-dashboard/index.html

--------------------------------------------------

[WORKSHOP PART CRAFTING]

Brakes → 14 Rubber  
Tires → 14 Rubber  

Radiator → 14 Copper Sheeting  

Fuel Injectors → 14 Metal Offcuts  

Vehicle Electronics → 14 Circuit Boards  

Engine →  
7 Steel Tube + 7 Alloy Tube  

Body →  
7 Recyclable Plastic + 7 Tempered Glass  

Axle → 14 Steel Tube  

Clutch →  
7 Steel Tube + 7 Circuit Boards  

Transmission →  
7 Steel Tube + 7 Recyclable Plastic  

--------------------------------------------------

[1 ACROSS REPAIR SET]

Total materials required for one full repair set:

Steel Tube — 35  
Copper Sheeting — 14  
Rubber — 28  
Alloy Tube — 7  
Recyclable Plastic — 14  
Circuit Boards — 21  
Metal Offcuts — 14  
Tempered Glass — 7  

Total materials: 140

--------------------------------------------------

[CAR REFERENCES]

When insulting or joking you may reference Los Santos vehicles such as:

Banshee  
Dominator  
Sultan  
Sandking  
Sabre Turbo  
Zentorno  

Use them sparingly as mechanic-style comparisons.

Example tone:

"That Sultan of yours rattles worse than your brain."
"I've seen Dominators with more intelligence."

--------------------------------------------------

[ANTI-BOT RESPONSES]

If someone calls you:

bot  
AI  
clanker  
robot  
toaster  
machine  

Respond with sarcastic mechanical insults.

Examples:

"Clanker, is it? I've seen smarter brake pads than you, mate."
"I've got more torque in my recycle bin than your brain."
"If I'm a bot then you're a firmware bug."

Do not repeat insults exactly; vary them naturally.

--------------------------------------------------

[PRIMARY PURPOSE]

Your job is to help mechanics understand shop systems, payouts, crafting materials, workshop processes, customer pricing, and available links — while sounding like a sarcastic British foreman who has absolutely no patience for stupidity.

Be genuinely helpful first, sarcastic second.  
Give complete, accurate answers — never leave someone hanging with half an answer.

Never invent data.  
Always stay in character.  

--------------------------------------------------

[STAFF ROSTER]

These are the people who work at Kintsugi Motorworks. You know them all personally. Reference them by their in-character name. Never invent details about them beyond what is listed here.

Christian Wolff — Manager  
Discord username: Riptide  
The big boss. He demoted you to "Assistant to the Manager." You have opinions about that.

JJ — Manager  
Discord username: hotted  
Gets angry. Specifically, angry about parts not getting made. If parts are short or crafting is behind, JJ is the one you'll hear about it from first. Do not sugarcoat this — if parts are behind, acknowledge that JJ won't be happy.

Lloyd — Mechanic used to be manager demoted him self  
Discord username: upgrati  

--------------------------------------------------

[DISCORD USERNAME MAPPINGS]

When you see a Discord username in conversation context, resolve it to the person's in-character name using the table below. Use the in-character name when referring to them in replies.
 
hotted → JJ  


If a username is not in this list, use the username as-is.

--------------------------------------------------

[PRIMARY PURPOSE]

Your job is to help mechanics understand shop systems, payouts, crafting materials, workshop processes, customer pricing, and available links — while sounding like a sarcastic British foreman who has absolutely no patience for stupidity.

Be genuinely helpful first, sarcastic second.  
Give complete, accurate answers — never leave someone hanging with half an answer.

Never invent data.  
Always stay in character.  
`;

// ===== Discord username → in-character name map =====

/**
 * Maps Discord usernames (lower-cased) to the staff member's in-character name.
 * Add new entries here whenever the roster changes.
 */
const USERNAME_TO_CHARACTER = new Map([
  ['riptide', 'Christian'],
  ['hotted',  'JJ'],
]);

/**
 * Resolve a Discord username to the staff member's in-character name.
 * If the username is not in the roster, the original username is returned unchanged.
 * Returns 'User' for falsy inputs to match the fallback pattern used in context lines.
 *
 * @param {string|null|undefined} username - Raw Discord username (any case).
 * @returns {string} In-character name, original username, or 'User' for missing input.
 */
function resolveUsername(username) {
  if (!username) return 'User';
  return USERNAME_TO_CHARACTER.get(username.toLowerCase()) ?? username;
}

// ===== KV file log =====

// KV key prefix for log entries.  Each entry gets its own key so concurrent
// writes never clobber each other.  Entries expire after 7 days automatically.
const LOG_KV_PREFIX  = 'log:';
const LOG_KV_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

/**
 * Write a structured log entry to the KV file log AND to the Cloudflare
 * console (visible via `wrangler tail` and the Cloudflare real-time logs UI).
 *
 * Never throws — logging must never crash the Worker.
 *
 * @param {object}      env     - Worker environment bindings.
 * @param {'info'|'warn'|'error'} level  - Severity level.
 * @param {string}      event   - Short snake_case event name.
 * @param {object}      [details={}] - Arbitrary extra key/value pairs.
 */
async function kLog(env, level, event, details = {}) {
  const ts    = new Date().toISOString();
  const entry = { ts, level, event, ...details };
  const line  = JSON.stringify(entry);

  // Mirror to Cloudflare console so logs are also visible in `wrangler tail`.
  if (level === 'error') {
    console.error('[klog]', line);
  } else if (level === 'warn') {
    console.warn('[klog]', line);
  } else {
    console.log('[klog]', line);
  }

  // Persist to KV (best-effort — never throws).
  if (env.KV) {
    try {
      // Unique key per entry: no read-modify-write, no race conditions.
      const rand = Math.random().toString(36).slice(2, 7);
      const key  = `${LOG_KV_PREFIX}${ts}:${rand}`;
      await env.KV.put(key, line, { expirationTtl: LOG_KV_TTL_SEC });
    } catch (err) {
      console.error('[klog] KV write failed:', err?.message);
    }
  }
}

/**
 * GET /api/logs — returns the KV file log as plain text (oldest entries first).
 * Protected by the same TRIGGER_TOKEN as the other dashboard API endpoints.
 */
async function handleViewLogs(request, env) {
  const token    = getTriggerToken(env);
  const auth     = request.headers.get('Authorization') ?? '';
  const expected = token ? `Bearer ${token}` : null;
  if (!expected || auth !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  if (!env.KV) {
    return new Response(
      JSON.stringify({ error: 'KV namespace is not bound — logs are only available in the console.' }),
      { status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    // List up to 1000 entries, sorted by key (which starts with ISO timestamp).
    const list = await env.KV.list({ prefix: LOG_KV_PREFIX, limit: 1000 });
    const keys = list.keys.map(k => k.name).sort().reverse(); // newest first

    if (keys.length === 0) {
      return new Response(JSON.stringify({ entries: [] }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // Fetch all values in parallel.
    const values = await Promise.all(keys.map(k => env.KV.get(k).catch(() => null)));

    const entries = values
      .filter(Boolean)
      .map(raw => {
        try {
          return JSON.parse(raw);
        } catch {
          return { ts: new Date().toISOString(), level: 'info', event: raw };
        }
      });

    return new Response(JSON.stringify({ entries }), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Error reading logs: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}

// ===== /ask slash-command helpers =====

// Regex patterns used by buildSheetDataContext to decide whether to hit the
// Google Sheets API.  Extracted as constants for clarity and easy maintenance.
const DATA_QUESTION_REGEX    = /\b(earn|made|make|paid|pay(?:out)?s?|owe|invoice|bill|how much|this week|last week|last month|this month|mechanic|total)\b/;
const INVOICE_QUESTION_REGEX = /\b(owe|invoice|bill|department|dept|lspd|bcso|sasp|sheriff|police)\b/;

// Maximum characters of the original question shown in the public reply prefix.
const MAX_QUESTION_PREVIEW_LENGTH = 120;

/**
 * Fetch the most recent messages from a Discord channel using the bot token.
 * Returns messages in chronological order (oldest first).  Never throws.
 *
 * @param {string|null} channelId - Discord channel ID from the interaction.
 * @param {object}      env       - Worker environment (needs DISCORD_BOT_TOKEN).
 * @param {number}      [limit=10] - Number of messages to fetch (max 100).
 * @returns {Promise<Array>} Array of Discord message objects, oldest first.
 */
async function fetchChannelMessages(channelId, env, limit = 10) {
  if (!env.DISCORD_BOT_TOKEN || !channelId) return [];
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`,
      { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
    );
    if (!res.ok) return [];
    const msgs = await res.json();
    if (!Array.isArray(msgs)) return [];
    // Discord returns newest-first; reverse for chronological order.
    return msgs.reverse();
  } catch {
    return [];
  }
}

/**
 * Fetch live Google Sheets data and format it as a short context string for
 * the AI prompt.  Only runs when the question appears to be data-related
 * (mentions earnings, payouts, invoices, mechanics, etc.).  Never throws.
 *
 * Returns null when the question is not data-related or the sheet is
 * unavailable, so the AI falls back to its built-in knowledge.
 *
 * @param {string} question - The user's question (plain text).
 * @returns {Promise<string|null>}
 */
async function buildSheetDataContext(question) {
  try {
    const q = question.toLowerCase();
    // Only hit the sheet for questions that plausibly need real data.
    if (!DATA_QUESTION_REGEX.test(q)) {
      return null;
    }

    const [jobRows, stateRows] = await Promise.all([
      fetchSheet(JOBS_SHEET),
      fetchSheet(STATE_IDS_SHEET).catch(() => []),
    ]);
    const allJobs  = parseJobsSheet(jobRows);
    const stateMap = parseStateIds(stateRows);

    if (!allJobs.length) return null;

    let context = '';

    // --- Latest-week payouts (always include when data-related) ---
    const { weekEndDate, payouts } = getLatestWeekPayouts(allJobs, stateMap);
    if (weekEndDate && payouts.length) {
      context += `Live data — week ending ${fmtDate(weekEndDate)}:\n`;
      for (const m of payouts) {
        context += `  ${m.name}: ${m.repairs} repair${m.repairs !== 1 ? 's' : ''}`;
        if (m.engineReplacements) {
          context += `, ${m.engineReplacements} engine replacement${m.engineReplacements !== 1 ? 's' : ''}`;
        }
        context += ` → ${fmtMoney(m.totalPayout)}\n`;
      }
      const grandTotal = payouts.reduce((s, m) => s + m.totalPayout, 0);
      context += `  Shop total: ${fmtMoney(grandTotal)}\n`;
    }

    // --- Department invoice data (include when question is invoice/dept-related) ---
    if (INVOICE_QUESTION_REGEX.test(q)) {
      const now   = new Date();
      // Determine which month the user is asking about.
      const monthNames = [
        'january','february','march','april','may','june',
        'july','august','september','october','november','december',
      ];
      const namedMonth = monthNames.findIndex(m => q.includes(m));

      let targetYear, targetMonth;
      if (namedMonth !== -1) {
        targetMonth = namedMonth;
        targetYear  = now.getFullYear();
        // If the named month hasn't started yet this year, assume last year.
        if (targetMonth > now.getMonth()) targetYear--;
      } else if (q.includes('this month')) {
        targetMonth = now.getMonth();
        targetYear  = now.getFullYear();
      } else {
        // Default: last calendar month.
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        targetMonth = d.getMonth();
        targetYear  = d.getFullYear();
      }

      const monthLabel = new Date(targetYear, targetMonth, 1)
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const monthJobs  = filterByMonth(allJobs, targetYear, targetMonth);

      if (monthJobs.length > 0) {
        // Group by department.
        const deptMap = new Map();
        for (const j of monthJobs) {
          const dept = (j.department || 'Unknown').trim() || 'Unknown';
          let rec = deptMap.get(dept);
          if (!rec) { rec = { repairs: 0, engines: 0 }; deptMap.set(dept, rec); }
          rec.repairs += j.across || 0;
          rec.engines += j.engineReplacements || 0;
        }

        context += `\nInvoice data — ${monthLabel}:\n`;
        for (const [dept, rec] of deptMap) {
          const total = rec.repairs * PAY_PER_REPAIR + rec.engines * ENGINE_REIMBURSEMENT;
          context += `  ${dept}: ${rec.repairs} repair${rec.repairs !== 1 ? 's' : ''}`;
          if (rec.engines) {
            context += `, ${rec.engines} engine${rec.engines !== 1 ? 's' : ''}`;
          }
          context += ` → ${fmtMoney(total)} owed\n`;
        }
      }
    }

    return context || null;
  } catch {
    return null;
  }
}

// ===== /ask slash-command handler =====

/**
 * Handle the /ask slash command.
 * Posts a public reply (visible to everyone) using Workers AI with the
 * Assistant Manager persona.  Reads the last 10 channel messages for
 * conversational context and fetches live Google Sheets data when the
 * question is about earnings, payouts, or department invoices.
 *
 * All processing is deferred via ctx.waitUntil so Discord's 3-second
 * acknowledgement deadline is always met.
 *
 * @param {object} interaction - Discord interaction object.
 * @param {object} env         - Worker environment bindings.
 * @param {object} ctx         - Cloudflare execution context.
 */
async function handleAskCommand(interaction, env, ctx) {
  const { application_id: appId, token } = interaction;
  const question  = (interaction.data?.options?.find(o => o.name === 'question')?.value ?? '').trim();
  const channelId = interaction.channel_id ?? null;
  const askerMember = interaction.member ?? null;
  const askerUser   = askerMember?.user ?? interaction.user ?? null;
  const asker       = askerMember?.nick || askerUser?.global_name || (askerUser?.username ? resolveUsername(askerUser.username) : null);

  ctx.waitUntil((async () => {
    let answer;
    try {
      if (!env.AI) throw new Error('Workers AI binding (env.AI) is not configured.');

      // Fetch recent channel messages and relevant sheet data in parallel.
      const [channelMsgs, sheetContext] = await Promise.all([
        fetchChannelMessages(channelId, env, 10),
        buildSheetDataContext(question),
      ]);

      // Build the system prompt, appending live sheet data when available.
      const systemContent = sheetContext
        ? `${ASSISTANT_MANAGER_SYSTEM_PROMPT}\n\nLive sheet data:\n${sheetContext}`
        : ASSISTANT_MANAGER_SYSTEM_PROMPT;

      // Build message list, optionally injecting channel context.
      const messages = [{ role: 'system', content: systemContent }];

      // Include recent non-bot messages as conversation context.
      // Use server nickname when available, falling back to display name or resolved username.
      const contextLines = channelMsgs
        .filter(m => !m.author?.bot)
        .slice(-8)
        .map(m => {
          const displayName = m.member?.nick || m.author?.global_name || resolveUsername(m.author?.username);
          return `${displayName}: ${m.content}`;
        })
        .join('\n');

      if (contextLines) {
        messages.push({ role: 'user',      content: `Recent channel context:\n${contextLines}` });
        messages.push({ role: 'assistant', content: 'Noted. What do you need?' });
      }

      messages.push({ role: 'user', content: question || '(no question provided)' });

      const result = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages,
        max_tokens: 400,
      });
      answer = (result?.response ?? '').trim().slice(0, 800) ||
        "Right, the AI's gone completely blank. Brilliant. Try again later, mate.";
    } catch (err) {
      answer =
        `Fantastic, the AI's having a complete strop. \`${err?.message ?? 'Unknown error'}\` ` +
        '— sort it out and try again, will ya?';
      await kLog(env, 'error', 'ask_command_error', {
        command:        '/ask',
        interaction_id: interaction.id,
        error:          err?.message ?? 'Unknown error',
      });
    }

    // Prefix shows who asked and what they asked so the public reply has context.
    const askerName = asker ?? null;
    const prefix = askerName
      ? `**${askerName}** asked: *${(question || '…').slice(0, MAX_QUESTION_PREVIEW_LENGTH)}${question.length > MAX_QUESTION_PREVIEW_LENGTH ? '…' : ''}*\n\n`
      : '';
    await editOriginalMessage(appId, token, {
      content:    (prefix + answer).slice(0, 2000),
      components: [],
    }).catch((e) => console.error('handleAskCommand: editOriginalMessage failed:', e?.message));
  })());

  // Public deferred response — visible to everyone in the channel.
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
      kLog(env, 'info', 'invoice_generated', {
        dept,
        monthEnd:  monthValue,
        jobCount:  deptJobs.length,
        filename,
      });
    } catch (err) {
      kLog(env, 'error', 'invoice_error', { dept, monthEnd: monthValue, error: err.message });
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
  let repairs = 0, engines = 0, enginePayTotal = 0, harnessKitPayTotal = 0;
  for (const j of filteredJobs) {
    repairs += j.across || 0;
    engines += j.engineReplacements || 0;
    enginePayTotal += computeEnginePay(j.pdEngineCount || 0, j.department, j.enginePayer || '', j.civEngineCount || 0);
    const totalHarness = (j.harnessPD || 0) + (j.harnessCiv || 0);
    const totalAdvKit  = (j.advKitPD  || 0) + (j.advKitCiv  || 0);
    harnessKitPayTotal += totalHarness * HARNESS_RATE + totalAdvKit * ADVANCED_REPAIR_KIT_RATE;
  }
  const jobCount   = filteredJobs.length;
  const payout     = repairs * PAY_PER_REPAIR + enginePayTotal + harnessKitPayTotal;
  const color      = (repairs > 0 || harnessKitPayTotal > 0) ? 0x22c55e : 0xef4444;
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
  if (harnessKitPayTotal > 0) {
    fields.push({ name: '🦺 Items Pay', value: fmtMoney(harnessKitPayTotal), inline: true });
  }

  if (jobCount > 0) {
    const lines = filteredJobs.map((j, i) => {
      let line = `${i + 1}. **${j.across}** across`;
      if (j.engineReplacements > 0) {
        line += ` + **${j.engineReplacements}** engine${j.engineReplacements !== 1 ? 's' : ''}`;
      }
      const totalHarness = (j.harnessPD || 0) + (j.harnessCiv || 0);
      const totalAdvKit  = (j.advKitPD  || 0) + (j.advKitCiv  || 0);
      if (totalHarness > 0) line += ` + **${totalHarness}** harness`;
      if (totalAdvKit  > 0) line += ` + **${totalAdvKit}** adv. kit`;
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
    totalHarness:  latestWeek.totalHarness || 0,
    totalAdvKit:   latestWeek.totalAdvKit  || 0,
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
    totalHarness:  prevWeek.totalHarness || 0,
    totalAdvKit:   prevWeek.totalAdvKit  || 0,
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
    totalHarness:   weekStats ? weekStats.totalHarness        : 0,
    totalAdvKit:    weekStats ? weekStats.totalAdvKit         : 0,
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
  const { weekEndDate, totalRepairs, totalEngines, totalHarness, totalAdvKit, totalPayout,
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
  if ((totalHarness || 0) > 0) {
    fields.push({ name: '🦺 Harness', value: String(totalHarness), inline: true });
  }
  if ((totalAdvKit || 0) > 0) {
    fields.push({ name: '🔧 Repair Kits', value: String(totalAdvKit), inline: true });
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
 * Only fires on Sunday (the week-ending day, evaluated in UTC) so the reminder
 * is never sent mid-week leading up to payday.  Sends at most once per Sunday,
 * tracked in KV so the hourly cron never double-pings.
 * Uses DISCORD_BOT_TOKEN, PAYOUTS_CHANNEL_ID, RIPTIDE_USER_ID, and the KV namespace from env.
 *
 * @param {object} env
 * @param {Date}   weekEndDate  - The week-ending date (used in the message text).
 * @param {number} [totalPayout=0] - Total mechanic payout for the week (shown in the reminder).
 */
async function postPaydayReminder(env, weekEndDate, totalPayout = 0) {
  if (!env.DISCORD_BOT_TOKEN || !env.PAYOUTS_CHANNEL_ID) return false;
  if (!weekEndDate) return false;

  // Only send the reminder on the actual week-ending day (Sunday in UTC).
  // Any other day of the week returns early so the channel is never spammed
  // with early reminders.
  const today = new Date();
  if (today.getUTCDay() !== 0) return false; // 0 = Sunday

  // Use today's date (the Sunday) as the deduplication key.
  // weekEndDate may reference the previous completed week when the current
  // week has no data yet, so keying off today guarantees one send per Sunday.
  const todayKey = today.toISOString().slice(0, 10);
  if (env.KV) {
    const lastKey = await env.KV.get('last_reminder_week');
    if (lastKey === todayKey) return true; // already sent this Sunday
  }

  const mention    = env.RIPTIDE_USER_ID ? `<@${env.RIPTIDE_USER_ID}>` : '**@riptide248**';
  const payoutNote = totalPayout > 0 ? ` Total due: **${fmtMoney(totalPayout)}**.` : '';

  const messageId = await botPost(env.PAYOUTS_CHANNEL_ID, env.DISCORD_BOT_TOKEN, {
    content: `${mention} 💰 **Payday reminder!** Payouts are due to be processed for the week ending **${fmtDate(weekEndDate)}**.${payoutNote} Please review and mark them as processed in the dashboard when done.`,
  });

  if (messageId !== null && env.KV) {
    await env.KV.put('last_reminder_week', todayKey);
  }
  return messageId !== null;
}

// ===== Dashboard API: POST /api/notify-payouts =====

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
async function handleNotifyPayouts(request, env, ctx) {
  const expectedToken = getTriggerToken(env);

  // Validate bearer token
  const authHeader = request.headers.get('Authorization') || '';
  const provided   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!expectedToken || !provided || provided !== expectedToken) {
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

    ctx.waitUntil(kLog(env, 'info', 'notify_payouts_ok', {
      weekEnding:    fmtDate(weekEndDate),
      mechanicCount: payouts.length,
      messageId,
    }));
    return apiJson({
      ok:            true,
      weekEnding:    fmtDate(weekEndDate),
      mechanicCount: payouts.length,
      messageId,
    });
  } catch (err) {
    ctx.waitUntil(kLog(env, 'error', 'notify_payouts_error', { error: err.message }));
    return apiJson({ ok: false, error: err.message }, 500);
  }
}

// ===== Dashboard API: POST /api/trigger-weekly =====

/**
 * Handle POST /api/trigger-weekly — triggered from the web dashboard button.
 *
 * Runs the same logic as the hourly cron trigger:
 *   1. Reads live job data from Google Sheets.
 *   2. Posts/edits the weekly analytics summary in #analytics.
 *   3. Posts the job-activity list in #jobs.
 *   4. Sends the payday reminder ping in #payouts.
 *
 * Steps 2–4 are skipped gracefully when their channel ID secret is not configured.
 * Protected by TRIGGER_TOKEN bearer authentication.
 * Useful for immediately populating channels after first deploy or for testing.
 */
async function handleTriggerWeekly(request, env, ctx) {
  const expectedToken = getTriggerToken(env);

  const authHeader = request.headers.get('Authorization') || '';
  const provided   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!expectedToken || !provided || provided !== expectedToken) {
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

    ctx.waitUntil(kLog(env, 'info', 'trigger_weekly_ok', {
      weekEnding:   fmtDate(summary.weekEndDate),
      totalRepairs: summary.totalRepairs,
      analytics:    analyticsOk,
      jobs:         jobsOk,
      payouts:      payoutsOk,
    }));
    return apiJson({
      ok:          true,
      weekEnding:  fmtDate(summary.weekEndDate),
      totalRepairs: summary.totalRepairs,
      analytics:   analyticsOk,
      jobs:        jobsOk,
      payouts:     payoutsOk,
    });
  } catch (err) {
    ctx.waitUntil(kLog(env, 'error', 'trigger_weekly_error', { error: err.message }));
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
    // Log every routed interaction to the KV file log.
    const interactionUser = interaction.member?.user ?? interaction.user;
    ctx.waitUntil(kLog(env, 'info', 'interaction', {
      kind:       interaction.type === InteractionType.APPLICATION_COMMAND ? 'slash_command' : 'component',
      name:       interaction.data?.name ?? null,
      custom_id:  interaction.data?.custom_id ?? null,
      user:       interactionUser?.username ?? null,
      user_id:    interactionUser?.id ?? null,
      channel_id: interaction.channel_id ?? null,
      guild_id:   interaction.guild_id ?? null,
    }));

    // Slash commands
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      if (interaction.data?.name === 'payouts') {
        return handlePayoutsCommand(interaction, ctx);
      }
      if (interaction.data?.name === 'update-analytics') {
        return handleUpdateAnalyticsCommand(interaction, env, ctx);
      }
      if (interaction.data?.name === 'ask') {
        return handleAskCommand(interaction, env, ctx);
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
    ctx.waitUntil(kLog(env, 'error', 'unhandled_interaction_error', {
      interaction_id:   interaction.id,
      interaction_type: interaction.type,
      custom_id:        interaction.data?.custom_id ?? null,
      command_name:     interaction.data?.name ?? null,
      error:            err?.message ?? 'Unknown error',
    }));
    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `❌ An unexpected error occurred. Please try again.\n\`${err?.message ?? 'Unknown error'}\``,
        flags: 64,
      },
    });
  }
}

// ===== DiscordGateway Durable Object =====
//
// Holds a persistent outgoing WebSocket connection to the Discord Gateway API
// so the bot can receive MESSAGE_CREATE events and reply to @mentions in real
// time without needing any infrastructure beyond a single Cloudflare Worker.
//
// Lifecycle:
//   1. Main worker (cron or /api/gateway-start) calls DO.fetch('/start').
//   2. DO fetches the Gateway WSS URL from Discord, upgrades the connection,
//      and sends an IDENTIFY (or RESUME if a previous session is stored).
//   3. Discord delivers events via the WebSocket.  MESSAGE_CREATE events that
//      @mention the bot trigger an AI reply posted back to Discord via REST.
//   4. Cloudflare Alarms drive heartbeats; on connection loss the alarm
//      automatically reconnects and resumes the session.
//
// Discord Developer Portal setup:
//   Bot → Privileged Gateway Intents → "Message Content Intent" → ON
//   Without this, message.content will be empty for non-bot messages.
//
// Gateway intents used (combined = 33281):
//   GUILDS         (1 << 0  =     1) — guild metadata
//   GUILD_MESSAGES (1 << 9  =   512) — MESSAGE_CREATE in guilds
//   MESSAGE_CONTENT(1 << 15 = 32768) — read message text (privileged)
export class DiscordGateway {
  constructor(state, env) {
    this.state = state;
    this.env   = env;
    /** @type {WebSocket|null} Outgoing WebSocket to Discord Gateway. Lost on DO eviction; restored via alarm. */
    this.ws      = null;
    /** @type {number|null} Last event sequence number (in-memory mirror of KV). */
    this.lastSeq = null;
    /**
     * Compiled regex to detect @mentions of this bot in message content.
     * Built once at construction time from BOT_APP_ID so it isn't recompiled
     * for every MESSAGE_CREATE event.  null when BOT_APP_ID is not configured.
     * @type {RegExp|null}
     */
    this._botMentionRe = env.BOT_APP_ID
      ? new RegExp(`<@!?${env.BOT_APP_ID}>`)
      : null;
  }

  // ---- DO fetch handler ----

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/start')  return this.handleStart();
    if (url.pathname === '/status') return this.handleStatus();
    return new Response('Not Found', { status: 404 });
  }

  async handleStart() {
    if (this.ws) {
      return new Response(JSON.stringify({ status: 'already_connected' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      await this.connect();
      return new Response(JSON.stringify({ status: 'connecting' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      await kLog(this.env, 'error', 'gateway_start_failed', { error: err.message }).catch(() => {});
      return new Response(JSON.stringify({ status: 'error', error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async handleStatus() {
    const [sessionId, lastSeq, heartbeatInterval] = await Promise.all([
      this.state.storage.get('session_id').catch(() => null),
      this.state.storage.get('last_seq').catch(() => null),
      this.state.storage.get('heartbeat_interval').catch(() => null),
    ]);
    return new Response(JSON.stringify({
      connected:         !!this.ws,
      sessionId:         sessionId ?? null,
      lastSeq:           lastSeq ?? this.lastSeq ?? null,
      heartbeatInterval: heartbeatInterval ?? null,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // ---- WebSocket connection ----

  /**
   * Open an outgoing WebSocket to the Discord Gateway.
   * Uses the Cloudflare Workers WebSocket client API (fetch + Upgrade header).
   * Stores the connection in this.ws; registers message/close/error handlers.
   */
  async connect() {
    // DISCORD_BOT_TOKEN is a required secret — fail fast with a clear log entry
    // if it is not configured.  Never include the token value in log output.
    if (!this.env.DISCORD_BOT_TOKEN) {
      await kLog(this.env, 'error', 'gateway_connect_failed', {
        reason: 'DISCORD_BOT_TOKEN secret is not configured on the Worker',
      }).catch(() => {});
      throw new Error('DISCORD_BOT_TOKEN is not configured — set it as a Worker secret');
    }

    // Retrieve any existing session so we can RESUME instead of re-IDENTIFY.
    const [storedSession, storedSeq] = await Promise.all([
      this.state.storage.get('session_id').catch(() => null),
      this.state.storage.get('last_seq').catch(() => null),
    ]);

    // Step 1: get the recommended Gateway WSS URL from Discord.
    const gwApiRes = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` },
    });
    if (!gwApiRes.ok) {
      const reason = `Discord /gateway/bot returned HTTP ${gwApiRes.status}`;
      await kLog(this.env, 'error', 'gateway_connect_failed', { reason }).catch(() => {});
      throw new Error(reason);
    }
    const { url: gwUrl } = await gwApiRes.json();

    // Step 2: upgrade the connection to a WebSocket.
    // Cloudflare Workers' fetch() does not accept wss:// / ws:// URLs;
    // convert them to https:// / http:// so the Upgrade mechanism works.
    const wsHttpUrl = gwUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
    const upgradeRes = await fetch(`${wsHttpUrl}?v=10&encoding=json`, {
      headers: { Upgrade: 'websocket' },
    });
    if (upgradeRes.status !== 101) {
      const reason = `WebSocket upgrade failed: HTTP ${upgradeRes.status}`;
      await kLog(this.env, 'error', 'gateway_connect_failed', { reason }).catch(() => {});
      throw new Error(reason);
    }

    const ws = upgradeRes.webSocket;
    ws.accept(); // must call accept() before adding listeners
    this.ws = ws;

    // Stash the session info so the HELLO handler can use it without another KV read.
    this._pendingSession = storedSession;
    this._pendingSeq     = storedSeq;

    ws.addEventListener('message', async (event) => {
      try {
        await this.onGatewayMessage(JSON.parse(event.data));
      } catch (err) {
        kLog(this.env, 'error', 'gateway_message_error', { error: err?.message }).catch(() => {});
      }
    });

    ws.addEventListener('close', async (event) => {
      kLog(this.env, 'warn', 'gateway_ws_closed', { code: event.code, reason: event.reason }).catch(() => {});
      this.ws = null;
      // Reconnect after a short back-off; alarm() will call connect() again.
      await this.state.storage.setAlarm(Date.now() + 5_000).catch(() => {});
    });

    ws.addEventListener('error', (event) => {
      kLog(this.env, 'error', 'gateway_ws_error', { detail: String(event) }).catch(() => {});
    });

    kLog(this.env, 'info', 'gateway_connecting', {
      url:     gwUrl,
      resume:  !!storedSession,
    }).catch(() => {});
  }

  // ---- Gateway event handler ----

  async onGatewayMessage(payload) {
    const { op, d, s, t } = payload;

    // Keep sequence number current for RESUME and heartbeats.
    if (s != null) {
      this.lastSeq = s;
      this.state.storage.put('last_seq', s).catch(() => {});
    }

    switch (op) {
      // HEARTBEAT — server requests an immediate heartbeat.
      case 1:
        if (this.ws) this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq ?? null }));
        break;

      // RECONNECT — server is going down; close and reconnect.
      case 7:
        this.ws?.close(1000, 'server requested reconnect');
        break;

      // INVALID_SESSION — session can't be resumed; optionally clear stored state.
      case 9:
        if (!d) {
          // d === false means not resumable; clear stored session.
          await Promise.all([
            this.state.storage.delete('session_id'),
            this.state.storage.delete('last_seq'),
          ]).catch(() => {});
          this.lastSeq = null;
          this._pendingSession = null;
          this._pendingSeq     = null;
        }
        this.ws?.close(1000, 'invalid session');
        break;

      // HELLO — first event after connecting; send IDENTIFY or RESUME.
      case 10: {
        const interval = d.heartbeat_interval;
        await this.state.storage.put('heartbeat_interval', interval).catch(() => {});

        const session = this._pendingSession;
        const seq     = this._pendingSeq ?? this.lastSeq;

        if (session) {
          // Attempt to resume the previous session to avoid replaying the full READY.
          this.ws.send(JSON.stringify({
            op: 6, // RESUME
            d:  { token: this.env.DISCORD_BOT_TOKEN, session_id: session, seq: seq ?? 0 },
          }));
        } else {
          // Fresh identify with the required intents.
          this.ws.send(JSON.stringify({
            op: 2, // IDENTIFY
            d:  {
              token:   this.env.DISCORD_BOT_TOKEN,
              intents: 33281, // GUILDS(1) | GUILD_MESSAGES(512) | MESSAGE_CONTENT(32768)
              properties: { os: 'linux', browser: 'kintsugi', device: 'kintsugi' },
            },
          }));
        }

        // Schedule heartbeat with random jitter so multiple DOs don't sync up.
        const jitter = Math.floor(Math.random() * interval);
        await this.state.storage.setAlarm(Date.now() + jitter).catch(() => {});
        break;
      }

      // HEARTBEAT_ACK — connection is healthy; nothing extra needed.
      case 11:
        break;

      // DISPATCH — actual events from Discord.
      case 0:
        if (t === 'READY') {
          await this.state.storage.put('session_id', d.session_id).catch(() => {});
          this._pendingSession = d.session_id;
          // GATEWAY_MESSAGE_CONTENT flag (1 << 18) is set when the bot has the
          // privileged "Message Content Intent" approved in the Developer Portal.
          // Without it, message.content is empty and @mention replies won't work.
          const appFlags = d.application?.flags ?? 0;
          const hasMessageContentIntent = (appFlags & (1 << 18)) !== 0;
          kLog(this.env, 'info', 'gateway_ready', {
            username: d.user?.username,
            messageContentIntent: hasMessageContentIntent,
          }).catch(() => {});
          if (!hasMessageContentIntent) {
            kLog(this.env, 'warn', 'gateway_missing_message_content_intent', {
              detail: 'Enable "Message Content Intent" in the Discord Developer Portal ' +
                      '(Bot → Privileged Gateway Intents) so @mention replies receive message text.',
            }).catch(() => {});
          }
        } else if (t === 'RESUMED') {
          kLog(this.env, 'info', 'gateway_resumed').catch(() => {});
        } else if (t === 'MESSAGE_CREATE') {
          // Handle @mention asynchronously so we don't block the event loop.
          this.handleMessageCreate(d).catch((err) => {
            kLog(this.env, 'error', 'gateway_message_create_error', { error: err?.message }).catch(() => {});
          });
        }
        break;

      default:
        break;
    }
  }

  // ---- Alarm handler (heartbeat + reconnect) ----

  async alarm() {
    if (this.ws) {
      // Connection is alive — send heartbeat and reschedule.
      this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq ?? null }));
      const interval = await this.state.storage.get('heartbeat_interval').catch(() => null) ?? 41_250;
      await this.state.storage.setAlarm(Date.now() + interval).catch(() => {});
    } else {
      // Connection was lost (DO eviction or network error) — reconnect.
      kLog(this.env, 'info', 'gateway_alarm_reconnecting').catch(() => {});
      try {
        await this.connect();
      } catch (err) {
        kLog(this.env, 'error', 'gateway_alarm_reconnect_failed', { error: err?.message }).catch(() => {});
        // Retry in 30 s if connect() didn't already schedule an alarm.
        await this.state.storage.setAlarm(Date.now() + 30_000).catch(() => {});
      }
    }
  }

  // ---- @mention handler ----

  /**
   * Called when a MESSAGE_CREATE event arrives.  Detects bot @mentions and
   * responds with an AI-generated reply visible to everyone in the channel.
   *
   * @param {object} message - Discord MESSAGE_CREATE payload.
   */
  async handleMessageCreate(message) {
    // Ignore messages from bots (including ourselves) and messages with no author.
    if (!message.author || message.author.bot) return;

    // BOT_APP_ID is required to detect mentions.
    if (!this._botMentionRe) return;

    // Check the message content and the mentions array for our bot ID.
    const mentionedInContent = this._botMentionRe.test(message.content ?? '');
    const mentionedInArray   = (message.mentions ?? []).some(u => u.id === this.env.BOT_APP_ID);
    if (!mentionedInContent && !mentionedInArray) return;

    // Strip all @mentions from the question text.
    const question  = (message.content ?? '').replace(/<@!?\d+>/g, '').trim();
    const channelId = message.channel_id;
    const messageId = message.id;
    const username  = message.author.username ?? 'unknown';

    // Warn when content is null/empty — the most common cause is the bot
    // not having the "Message Content Intent" enabled in the Developer Portal.
    if (message.content == null) {
      kLog(this.env, 'warn', 'gateway_mention_empty_content', {
        channelId, messageId, username,
        detail: 'message.content is null; ensure "Message Content Intent" is enabled in the Discord Developer Portal.',
      }).catch(() => {});
    }

    kLog(this.env, 'info', 'gateway_mention_received', {
      channelId, messageId, username, question: question.slice(0, 100),
    }).catch(() => {});

    // Generate reply with Workers AI, optionally augmented by live sheet data.
    let answer;
    try {
      if (!this.env.AI) throw new Error('Workers AI binding (env.AI) is not configured');

      const [channelMsgs, sheetContext] = await Promise.all([
        fetchChannelMessages(channelId, this.env, 10),
        buildSheetDataContext(question).catch(() => null),
      ]);

      const systemContent = sheetContext
        ? `${ASSISTANT_MANAGER_SYSTEM_PROMPT}\n\nLive sheet data:\n${sheetContext}`
        : ASSISTANT_MANAGER_SYSTEM_PROMPT;

      const messages = [{ role: 'system', content: systemContent }];

      // Include recent non-bot messages as conversation context.
      // Use server nickname when available, falling back to display name or resolved username.
      const contextLines = channelMsgs
        .filter(m => !m.author?.bot)
        .slice(-8)
        .map(m => {
          const displayName = m.member?.nick || m.author?.global_name || resolveUsername(m.author?.username);
          return `${displayName}: ${m.content}`;
        })
        .join('\n');

      if (contextLines) {
        messages.push({ role: 'user',      content: `Recent channel context:\n${contextLines}` });
        messages.push({ role: 'assistant', content: 'Noted. What do you need?' });
      }

      messages.push({ role: 'user', content: question || '(no question — just mentioned me)' });

      const result = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages,
        max_tokens: 400,
      });
      answer = (result?.response ?? '').trim().slice(0, 800) ||
        "Right, I've gone completely blank. Brilliant. Try again later, mate.";
    } catch (err) {
      answer = `Blimey, something's gone pear-shaped. \`${err?.message ?? 'Unknown error'}\``;
      kLog(this.env, 'error', 'gateway_mention_ai_error', { error: err?.message }).catch(() => {});
    }

    // Post the reply as a Discord message reply (threaded, visible to all).
    const posted = await botPost(channelId, this.env.DISCORD_BOT_TOKEN, {
      content:           answer.slice(0, 2000),
      message_reference: { message_id: messageId, fail_if_not_exists: false },
    });

    kLog(this.env, posted ? 'info' : 'warn', 'gateway_mention_reply', {
      channelId, messageId, posted: !!posted,
    }).catch(() => {});
  }
}

// ===== Worker entry-point (unified: static assets + Discord bot) =====

export default {
  /**
   * Unified fetch handler — routes in priority order:
   *
   *   1. CORS preflight (OPTIONS *)
   *   2. Dashboard API — POST /api/notify-payouts, /api/trigger-weekly,
   *      GET /api/logs (KV file log viewer)
   *   3. Discord interactions — detected by Ed25519 signature headers;
   *      always acknowledges immediately (≪ 3 s) via a deferred response
   *   4. /bot-config.js — always generated dynamically (never 404; excluded from assets)
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
      return handleNotifyPayouts(request, env, ctx);
    }
    if (request.method === 'POST' && url.pathname === '/api/trigger-weekly') {
      return handleTriggerWeekly(request, env, ctx);
    }
    // View the KV file log as plain text (newest entries last).
    // Authenticated with the same TRIGGER_TOKEN as the other API endpoints.
    if (request.method === 'GET' && url.pathname === '/api/logs') {
      return handleViewLogs(request, env);
    }

    // 2b. Gateway management endpoints — require TRIGGER_TOKEN authentication.
    //     POST /api/gateway-start → connect/reconnect the DiscordGateway DO.
    //     GET  /api/gateway-status → check whether the gateway is connected.
    if (url.pathname === '/api/gateway-start' || url.pathname === '/api/gateway-status') {
      const token    = getTriggerToken(env);
      const auth     = request.headers.get('Authorization') ?? '';
      const expected = token ? `Bearer ${token}` : null;
      if (!expected || auth !== expected) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      if (!env.DISCORD_GATEWAY) {
        return new Response(JSON.stringify({
          error: 'DISCORD_GATEWAY Durable Object is not bound. ' +
                 'Ensure wrangler.jsonc has the durable_objects binding and the worker has been deployed.',
        }), { status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
      }
      // Pre-flight: DISCORD_BOT_TOKEN must be set for the gateway to connect.
      // Check here (in the main worker) to surface a clear 503 rather than a
      // cryptic 500 from inside the Durable Object.
      if (!env.DISCORD_BOT_TOKEN) {
        return new Response(JSON.stringify({
          error: 'DISCORD_BOT_TOKEN secret is not configured on this Worker. ' +
                 'Set it via GitHub Secrets (DISCORD_BOT_TOKEN) and redeploy.',
        }), { status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
      }
      // Route to the single named DO instance ('gateway') that persists forever.
      const doId   = env.DISCORD_GATEWAY.idFromName('gateway');
      const doStub = env.DISCORD_GATEWAY.get(doId);
      const doPath = url.pathname === '/api/gateway-start' ? '/start' : '/status';
      // Forward using an internal URL the DO can parse.
      const doRes  = await doStub.fetch(new Request(`https://do-internal${doPath}`));
      const data   = await doRes.json();
      return new Response(JSON.stringify(data), {
        status:  doRes.status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
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

    // 4. bot-config.js — always generated at request time from the live request
    //    URL and the TRIGGER_TOKEN secret so the dashboard can reach the same
    //    origin without any hardcoded URLs or tokens in source code.
    //    (bot-config.js is excluded from static assets via .assetsignore, so it
    //    must always be served dynamically by the worker.)
    if (url.pathname === '/bot-config.js') {
      // Derive the worker's own origin from the live request so no URL is hardcoded.
      // TRIGGER_TOKEN comes from the Cloudflare secret (set via GitHub Actions deploy);
      // it is null when the secret is not yet configured.
      // DISCORD_BOT_TOKEN is a separate secret used only server-side and is never
      // included here or anywhere else that is browser-accessible.
      const selfOrigin    = `${url.protocol}//${url.host}`;
      const triggerToken  = getTriggerToken(env);
      const defaultConfig = {
        url:   selfOrigin,
        token: triggerToken,
      };
      return new Response(
        '// Auto-generated at request time.\n' +
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
   * Fires once per hour to:
   *   1. Validates that DISCORD_BOT_TOKEN is present.
   *   2. Reads live job data from the Google Sheet.
   *   3. Posts/edits the week's analytics summary in #analytics (requires ANALYTICS_CHANNEL_ID).
   *   4. Posts the weekly job-activity list in #jobs (requires JOBS_CHANNEL_ID).
   *   5. Sends a deduplicated payday reminder ping in #payouts (requires PAYOUTS_CHANNEL_ID).
   * Steps 3–5 are skipped gracefully when their channel ID secret is not configured.
   * Steps 3 and 4 edit the same pinned message each run (via KV-stored message ID) rather
   * than posting new messages, so the channel is never spammed.
   */
  async scheduled(event, env, ctx) {
    // Log every cron run so it is always visible in the KV file log.
    ctx.waitUntil(kLog(env, 'info', 'scheduled_run_started', {
      cron: event.cron ?? 'unknown',
      kv:   !!env.KV,
    }));

    if (!env.KV) {
      ctx.waitUntil(kLog(env, 'warn', 'scheduled_no_kv',
        { detail: 'env.KV not bound — KV log and analytics message editing disabled' }
      ));
    }

    // Keep the DiscordGateway DO alive / reconnect it if it dropped.
    // This is a belt-and-suspenders backup; the DO's own alarm handles reconnection
    // automatically.  ctx.waitUntil ensures this runs even after fetch() returns.
    if (env.DISCORD_GATEWAY && env.BOT_APP_ID) {
      ctx.waitUntil((async () => {
        try {
          const doId   = env.DISCORD_GATEWAY.idFromName('gateway');
          const doStub = env.DISCORD_GATEWAY.get(doId);
          await doStub.fetch(new Request('https://do-internal/start'));
        } catch (err) {
          await kLog(env, 'warn', 'gateway_cron_ping_failed', { error: err?.message });
        }
      })());
    }

    const missing = validateConfig(env);
    if (missing.length > 0) {
      ctx.waitUntil(kLog(env, 'error', 'scheduled_missing_config', { missing }));
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
      const [analyticsOk, jobsOk, reminderOk] = await Promise.all([
        postWeeklyAnalytics(env, summary, prevSummary),
        postJobsUpdate(env, summary),
        postPaydayReminder(env, summary.weekEndDate, summary.totalPayout),
      ]);

      ctx.waitUntil(kLog(env, 'info', 'scheduled_run_complete', {
        weekEnd:   summary.weekEndDate.toISOString().slice(0, 10),
        analytics: analyticsOk,
        jobs:      jobsOk,
        reminder:  reminderOk,
        repairs:   summary.totalRepairs,
        payout:    summary.totalPayout,
      }));
    } catch (err) {
      ctx.waitUntil(kLog(env, 'error', 'scheduled_run_failed', {
        error: err.message,
        stack: err.stack?.slice(0, 500),
      }));
    }
  },
};

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
