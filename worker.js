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

const DEPARTMENT_CONFIG = {
  CIV: {
    color: 0x808080,
    engineBonus: 0,
    emoji: '🚗',
  },
  EMS: {
    color: 0xFF1493,
    engineBonus: 0,
    emoji: '🏥',
  },
  LSPD: {
    color: 0x000000,
    engineBonus: ENGINE_BONUS_LSPD,
    emoji: '⚫',
  },
  BCSO: {
    color: 0xD2B48C,
    engineBonus: 0,
    emoji: '🟤',
  },
  ODPD: {
    color: 0x00FFFF,
    engineBonus: ENGINE_BONUS_LSPD,
    emoji: '🔷',
  },
  SASM: {
    color: 0xFF6B35,
    engineBonus: ENGINE_BONUS_LSPD,
    emoji: '🟠',
  },
};

function normalizeDepartment(dept) {
  return String(dept || '').trim().toUpperCase();
}

function getDepartmentConfig(dept) {
  return DEPARTMENT_CONFIG[normalizeDepartment(dept)] || {
    color: 0x22c55e,
    engineBonus: 0,
    emoji: '🏢',
  };
}

function getDepartmentEngineBonus(dept) {
  return getDepartmentConfig(dept).engineBonus || 0;
}

function getJobDepartment(job) {
  return normalizeDepartment(job?.department) || 'CIV';
}

function computeDepartmentEngineCharge(dept) {
  return ENGINE_REIMBURSEMENT + getDepartmentEngineBonus(dept);
}

function computeInvoiceJobTotal(job) {
  return (
    (job.across || 0) * PAY_PER_REPAIR +
    (job.engineReplacements || 0) * computeDepartmentEngineCharge(getJobDepartment(job))
  );
}

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
    const jobTotal = computeInvoiceJobTotal(j);
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
  const grandTotal = jobs.reduce((sum, j) => sum + computeInvoiceJobTotal(j), 0);
  const color = getDepartmentConfig(dept).color;
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
 * Edit the original deferred message and attach a file.
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
  const departmentBonus = getDepartmentEngineBonus(dept);

  if (pdEngineCount > 0) {
    if (enginePayer === 'mechanic') {
      pay += pdEngineCount * (ENGINE_REIMBURSEMENT + departmentBonus);
    } else if (enginePayer === 'kintsugi') {
      pay += pdEngineCount * departmentBonus;
    } else {
      // No payer info (old data): default to full reimbursement + department bonus
      pay += pdEngineCount * (ENGINE_REIMBURSEMENT + departmentBonus);
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
  // variations such as "Mechanic Name" vs "Mechanic", "PD" vs "Government",
  // or "How many Across?" vs "How many Across".
  const isGovernmentHeader = h => h.includes('pd') || h.includes('government') || h.includes('gov');
  const isCivilianHeader   = h => h.includes('civ') || h.includes('civilian');

  const iMech   = lower.findIndex(h => h.includes('mechanic'));
  // Government / PD repair count. Supports both old "(PD)" and current "(Government)" form headers.
  const iAcrossPD  = lower.findIndex(h => h.includes('across') && isGovernmentHeader(h) && !isCivilianHeader(h));
  // Civilian repair count. Supports explicit CIV/Civilian headers; falls back to the non-government across column.
  const iAcrossCiv = lower.findIndex(h => h.includes('across') && isCivilianHeader(h)) !== -1
    ? lower.findIndex(h => h.includes('across') && isCivilianHeader(h))
    : lower.findIndex(h => h.includes('across') && !isGovernmentHeader(h));
  const iTime   = lower.findIndex(h => h.includes('timestamp'));
  const iWeek   = lower.findIndex(h => h.includes('week') && h.includes('end'));
  const iMonth  = lower.findIndex(h => h.includes('month') && h.includes('end'));
  const iCop    = lower.findIndex(
    h =>
      h.includes('cop') ||
      h.includes('officer') ||
      h.includes('owner of vehicle') ||
      h.includes('vehicle owner')
  );
  const iPlate  = lower.findIndex(h => h.includes('plate') || h.includes('license') || h.includes('licence'));
  const iDept   = lower.findIndex(h => h.includes('department') || h.includes('dept') || h.includes('division') || h.includes('unit'));
  // Explicit Government Repair routing question. In the current Google Form,
  // "No" sends the user to the Civilian Repair section. Treat that row as CIV.
  const iGovernmentRepair = lower.findIndex(
    h =>
      (h.includes('government') && h.includes('repair') && !h.includes('advanced') && !h.includes('kit')) ||
      (h === 'pd repair') ||
      (h.includes('pd') && h.includes('repair') && !h.includes('advanced') && !h.includes('kit'))
  );

  // Engine payer column must be detected first to exclude it from engine-count searches.
  let iEnginePayer = lower.findIndex(
  h =>
    h.includes('did you buy') ||
    h.includes('who paid') ||
    h.includes('engine payer') ||
    h === 'question' ||
    (h.includes('engine') && h.includes('paid')) ||
    (h.includes('kintsugi') && h.includes('pay'))
  );
  // Government / PD engine replacement. Supports both old "(PD)" and current "(Government)" headers.
  let iEnginePD = lower.findIndex(
    (h, i) => i !== iEnginePayer && h.includes('engine') && h.includes('replacement') && isGovernmentHeader(h) && !isCivilianHeader(h)
  );
  // Fallback for old/odd sheets: use first non-CIV engine replacement column.
  if (iEnginePD === -1) {
    iEnginePD = lower.findIndex(
      (h, i) => i !== iEnginePayer && h.includes('engine') && h.includes('replacement') && !isCivilianHeader(h)
    );
  }
  // CIV engine replacement.
  const iEngineCiv = lower.findIndex(
    (h, i) => i !== iEnginePayer && h.includes('engine') && h.includes('replacement') && isCivilianHeader(h)
  );

  // Harness columns: supports "Harness (PD)", "Harness (Government)", and "Harness (CIV)".
  const iHarnessPD  = lower.findIndex(h => h.includes('harness') && isGovernmentHeader(h) && !isCivilianHeader(h));
  const iHarnessCiv = lower.findIndex(h => h.includes('harness') && isCivilianHeader(h));
  // Advanced Repair Kit columns: supports "Advanced Repair Kits (PD)", "(Government)", and "(CIV)".
  let iAdvKitPD  = lower.findIndex(h => h.includes('advanced') && h.includes('kit') && isGovernmentHeader(h) && !isCivilianHeader(h));
  let iAdvKitCiv = lower.findIndex(h => h.includes('advanced') && h.includes('kit') && isCivilianHeader(h));
  if (iAdvKitPD  === -1) iAdvKitPD  = lower.findIndex((h) => h.includes('repair') && h.includes('kit') && isGovernmentHeader(h) && !isCivilianHeader(h));
  if (iAdvKitCiv === -1) iAdvKitCiv = lower.findIndex((h) => h.includes('repair') && h.includes('kit') && isCivilianHeader(h));

  // Fallback: if header detection failed, scan data rows to find the engine payer column
  // by cell values (handles generic headers like "Column 8").
  if (iEnginePayer === -1) {
    const knownCols = new Set(
      [iMech, iTime, iAcrossPD, iAcrossCiv, iEnginePD, iEngineCiv,
        iCop, iPlate, iDept, iGovernmentRepair, iHarnessPD, iHarnessCiv, iAdvKitPD, iAdvKitCiv, iWeek, iMonth]
         .filter(i => i !== -1)
    );
    for (let col = 0; col < headers.length && iEnginePayer === -1; col++) {
      if (knownCols.has(col)) continue;
      for (let r = 1; r < Math.min(rows.length, 11); r++) {
        const cell = (rows[r][col] || '').trim().toLowerCase();
        if (cell && (cell.includes('kintsugi') || /i bought|bought it|myself/i.test(cell))) {
          iEnginePayer = col;
          break;
        }
      }
    }
  }

  if (iMech === -1 || (iAcrossPD === -1 && iAcrossCiv === -1)) return [];

  const jobs = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const mech   = (row[iMech] || '').trim();
    if (!mech) continue;

    let acrossPD  = iAcrossPD  !== -1 ? (parseInt(row[iAcrossPD]  || '0', 10) || 0) : 0;
    let acrossCiv = iAcrossCiv !== -1 ? (parseInt(row[iAcrossCiv] || '0', 10) || 0) : 0;

    const governmentRepairRaw = iGovernmentRepair !== -1
      ? String(row[iGovernmentRepair] || '').trim().toLowerCase()
      : '';
    const isExplicitCivilianRepair = /^(no|n|false|0)$/i.test(governmentRepairRaw);

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

    let harnessPD  = iHarnessPD  !== -1 ? (parseInt(row[iHarnessPD]  || '0', 10) || 0) : 0;
    let harnessCiv = iHarnessCiv !== -1 ? (parseInt(row[iHarnessCiv] || '0', 10) || 0) : 0;
    let advKitPD   = iAdvKitPD   !== -1 ? (parseInt(row[iAdvKitPD]   || '0', 10) || 0) : 0;
    let advKitCiv  = iAdvKitCiv  !== -1 ? (parseInt(row[iAdvKitCiv]  || '0', 10) || 0) : 0;

    if (isExplicitCivilianRepair) {
      // The form's first question routes "No" to the CIV section. If any
      // government-side fields were still filled, move them to CIV so the row
      // is counted as civilian everywhere: payouts, invoices, analytics, and CSVs.
      acrossCiv += acrossPD;
      civEngineCount += pdEngineCount;
      harnessCiv += harnessPD;
      advKitCiv += advKitPD;

      acrossPD = 0;
      pdEngineCount = 0;
      harnessPD = 0;
      advKitPD = 0;
    }

    // Department routing rule from the Google Form:
    // Government Repair = No  -> CIV
    // Government Repair = Yes -> selected department
    // If no department is present, fall back to CIV so civilian rows are not lost.
    let resolvedDepartment = normalizeDepartment(iDept !== -1 ? (row[iDept] || '').trim() : '');
    if (isExplicitCivilianRepair) {
      resolvedDepartment = 'CIV';
    } else if (!resolvedDepartment) {
      resolvedDepartment = 'CIV';
    }

    const across = acrossPD + acrossCiv;
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
      department:         resolvedDepartment,
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

// ... (rest of worker.js remains the same - truncated for space)
// [Keep all the remaining handlers: handleUpdateAnalyticsCommand, handleAskCommand, 
//  handleStartButton, handleMechSelect, handleWeekSelect, handleInvoicePanelButton,
//  handleInvoiceDeptSelect, handleInvoiceMonthSelect, buildMechanicPayoutEmbed,
//  handlePayoutsWeekButton, handlePayoutsWeekMechSelect, buildLatestWeekSummary,
//  buildPrevWeekSummary, buildCurrentWeekSummary, findExistingBotMessage, botPost,
//  botEdit, validateConfig, buildAnalyticsPayload, postWeeklyAnalytics, buildJobsPayload,
//  postJobsUpdate, postPaydayReminder, handleNotifyPayouts, handleTriggerWeekly,
//  handleDiscordInteraction, DiscordGateway class, and export default with fetch/scheduled handlers]

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && url.pathname === '/api/notify-payouts') {
      return handleNotifyPayouts(request, env, ctx);
    }
    if (request.method === 'POST' && url.pathname === '/api/trigger-weekly') {
      return handleTriggerWeekly(request, env, ctx);
    }
    if (request.method === 'GET' && url.pathname === '/api/logs') {
      return handleViewLogs(request, env);
    }

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
          error: 'DISCORD_GATEWAY Durable Object is not bound.',
        }), { status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
      }
      if (!env.DISCORD_BOT_TOKEN) {
        return new Response(JSON.stringify({
          error: 'DISCORD_BOT_TOKEN secret is not configured on this Worker.',
        }), { status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
      }
      const doId   = env.DISCORD_GATEWAY.idFromName('gateway');
      const doStub = env.DISCORD_GATEWAY.get(doId);
      const doPath = url.pathname === '/api/gateway-start' ? '/start' : '/status';
      const doRes  = await doStub.fetch(new Request(`https://do-internal${doPath}`));
      const data   = await doRes.json();
      return new Response(JSON.stringify(data), {
        status:  doRes.status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (
      request.method === 'POST' &&
      request.headers.get('X-Signature-Ed25519') &&
      request.headers.get('X-Signature-Timestamp')
    ) {
      return handleDiscordInteraction(request, env, ctx);
    }

    if (url.pathname === '/bot-config.js') {
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

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      return addCspToHtmlResponse(assetResponse);
    }

    return new Response('Kintsugi Bot is running.', { status: 200 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(kLog(env, 'info', 'scheduled_run_started', {
      cron: event.cron ?? 'unknown',
      kv:   !!env.KV,
    }));

    if (!env.KV) {
      ctx.waitUntil(kLog(env, 'warn', 'scheduled_no_kv',
        { detail: 'env.KV not bound — KV log and analytics message editing disabled' }
      ));
    }

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
