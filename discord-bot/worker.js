// =======================================
// Kintsugi Discord Bot — Cloudflare Worker
//
// Handles Discord component interactions (button presses + select menus) for
// two permanent panels:
//   • Job Logs panel    — request any mechanic's repair history by week
//   • Payouts panel     — generate monthly department invoices (BCSO / LSPD)
//                         with CSV file attachments
//
// Also handles /payouts and /update-analytics slash commands, and the weekly cron
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

// ===== Invoice reliability & observability settings =====
// These can be overridden at runtime by the INVOICE_* env vars (see README).
const INVOICE_FETCH_TIMEOUT_MS = 12_000;   // Per-attempt fetch timeout (12 s)
const INVOICE_MAX_RETRIES       = 2;        // Retries after the first attempt (3 total)
const INVOICE_RETRY_BACKOFF_MS  = 800;      // Initial back-off; doubles each retry
const INVOICE_INFLIGHT_TTL_S    = 90;       // KV lock TTL: max expected generation time
const WORKER_VERSION            = '2.0.0';  // Bumped with the reliability update

// Department name must be 2–10 ASCII letters (e.g. "BCSO", "LSPD").
// Used in two places: step-1 filtering and step-3 input validation.
const DEPT_NAME_PATTERN = /^[A-Za-z]{2,10}$/;

// Discord's max attachment size is 25 MB; we warn in logs when approaching it
// so admins can act before uploads silently fail.
const MAX_CSV_BYTES = 24 * 1024 * 1024; // 24 MB — leave 1 MB headroom

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

// ===== Invoice observability & reliability utilities =====

/** Generate a short random correlation ID for tracing a single invoice interaction. */
function generateCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

/** Generate a short uppercase error ID from the current timestamp. */
function generateErrorId() {
  return Date.now().toString(36).toUpperCase().slice(-6);
}

/**
 * Emit a structured JSON log line.
 * Cloudflare Workers stream console output to the Workers Logs dashboard.
 */
function invoiceLog(level, data) {
  const entry = {
    ts:      new Date().toISOString(),
    svc:     'kintsugi-invoice',
    version: WORKER_VERSION,
    level,
    ...data,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

/** Promisified setTimeout — usable inside waitUntil background tasks. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a Google Sheet CSV with an explicit timeout and automatic retry for
 * transient failures (429, 5xx, network errors).
 *
 * Replaces the bare `fetchSheet()` call in invoice handlers so users are
 * never left with a stuck "loading" state due to a slow or flaky upstream.
 *
 * @param {string} sheetName - Google Sheets tab name to fetch.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=INVOICE_FETCH_TIMEOUT_MS]  - Per-attempt wall-clock timeout.
 * @param {number} [opts.maxRetries=INVOICE_MAX_RETRIES]       - Max retries after first attempt.
 * @param {string} [opts.correlationId='']                     - For structured log context.
 */
async function fetchSheetWithRetry(sheetName, {
  timeoutMs    = INVOICE_FETCH_TIMEOUT_MS,
  maxRetries   = INVOICE_MAX_RETRIES,
  correlationId = '',
} = {}) {
  let lastErr;
  const url = sheetCsvUrl(sheetName);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const durMs = Date.now() - t0;

      if (res.status === 429) {
        const retryAfterS = parseInt(res.headers.get('Retry-After') || '2', 10);
        invoiceLog('warn', { correlationId, step: 'fetchSheet', sheet: sheetName, attempt, status: 429, retryAfterS, durMs });
        if (attempt < maxRetries) { await sleep(retryAfterS * 1000); continue; }
        throw new Error(`Sheet "${sheetName}" rate-limited (HTTP 429)`);
      }

      if (!res.ok) {
        const snippet = await res.text().catch(() => '');
        const msg = `Failed to fetch sheet "${sheetName}": HTTP ${res.status}`;
        invoiceLog('warn', { correlationId, step: 'fetchSheet', sheet: sheetName, attempt, status: res.status, snippet: snippet.slice(0, 200), durMs });
        if (res.status >= 500 && attempt < maxRetries) {
          lastErr = new Error(msg);
          await sleep(INVOICE_RETRY_BACKOFF_MS * (2 ** attempt));
          continue;
        }
        throw new Error(msg);
      }

      const text = await res.text();
      if (!text.trim() || text.trim().startsWith('<')) {
        throw new Error(
          `Sheet "${sheetName}" returned no usable data. ` +
          'Check that the spreadsheet is shared publicly.'
        );
      }

      invoiceLog('info', { correlationId, step: 'fetchSheet', sheet: sheetName, attempt, durMs, rows: text.split('\n').length });
      return parseCSV(text);
    } catch (err) {
      clearTimeout(timer);
      const durMs = Date.now() - t0;
      const isAbort = err.name === 'AbortError';
      invoiceLog('warn', {
        correlationId, step: 'fetchSheet', sheet: sheetName, attempt, durMs,
        error: isAbort ? `Timeout after ${timeoutMs}ms` : err.message,
      });
      lastErr = isAbort
        ? new Error(`Fetching sheet "${sheetName}" timed out after ${timeoutMs / 1000}s — the spreadsheet may be unreachable`)
        : err;
      if (attempt < maxRetries) await sleep(INVOICE_RETRY_BACKOFF_MS * (2 ** attempt));
    }
  }
  throw lastErr;
}

/**
 * Acquire an exclusive KV lock for an invoice generation job.
 * Returns true if the lock was obtained (proceed), false if already in progress.
 * Silently allows the job when KV is unavailable.
 */
async function acquireInvoiceLock(kv, key) {
  if (!kv) return true;
  try {
    if (await kv.get(key)) return false;
    await kv.put(key, '1', { expirationTtl: INVOICE_INFLIGHT_TTL_S });
    return true;
  } catch {
    return true; // KV errors must not block invoice generation
  }
}

/** Release the KV invoice lock (called after the job completes or errors). */
async function releaseInvoiceLock(kv, key) {
  if (!kv) return;
  await kv.delete(key).catch(() => {});
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
 * Escape a single cell value for RFC-4180 CSV output.
 * Fields that contain commas, double-quotes, or newlines are wrapped in
 * double-quotes and internal double-quotes are doubled.
 */
function toCsvCell(v) {
  const s = String(v == null ? '' : v);
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(cells) {
  return cells.map(toCsvCell).join(',');
}

/**
 * Build a CSV invoice string for one department and one calendar month.
 * The file includes a header, per-job rows, and a TOTALS footer row.
 */
function buildInvoiceCsv(dept, monthLabel, jobs) {
  const lines = [
    toCsvRow([`Kintsugi Motorworks — ${dept} Invoice — Month Ending: ${monthLabel}`]),
    '',
    toCsvRow(['Date', 'Mechanic', 'Officer', 'License Plate', 'Repairs', 'Engine Replacements', 'Job Total ($)']),
  ];

  for (const j of jobs) {
    const jobTotal = (j.across || 0) * PAY_PER_REPAIR + (j.engineReplacements || 0) * ENGINE_REIMBURSEMENT;
    lines.push(toCsvRow([
      fmtDate(j.bestDate),
      j.mechanic,
      j.cop || '',
      j.plate || '',
      j.across || 0,
      j.engineReplacements || 0,
      jobTotal,
    ]));
  }

  if (jobs.length > 0) {
    const totalRepairs = jobs.reduce((s, j) => s + (j.across || 0), 0);
    const totalEngines = jobs.reduce((s, j) => s + (j.engineReplacements || 0), 0);
    const grandTotal   = totalRepairs * PAY_PER_REPAIR + totalEngines * ENGINE_REIMBURSEMENT;
    lines.push('');
    lines.push(toCsvRow(['TOTALS', '', '', '', totalRepairs, totalEngines, grandTotal]));
  }

  return lines.join('\r\n');
}

/**
 * Build a Discord embed summarising the monthly invoice for one department.
 */
function buildDeptInvoiceEmbed(dept, monthLabel, jobs) {
  const totalRepairs = jobs.reduce((s, j) => s + (j.across || 0), 0);
  const totalEngines = jobs.reduce((s, j) => s + (j.engineReplacements || 0), 0);
  const repairCost   = totalRepairs * PAY_PER_REPAIR;
  const engineCost   = totalEngines * ENGINE_REIMBURSEMENT;
  const grandTotal   = repairCost + engineCost;

  const deptUpper = dept.toUpperCase();
  const color = deptUpper === 'BCSO' ? 0xd4a017 : deptUpper === 'LSPD' ? 0x1e90ff : 0x22c55e;

  const fields = [
    { name: '📅 Month Ending',        value: monthLabel,            inline: true  },
    { name: '🧾 Total Jobs',          value: String(jobs.length),   inline: true  },
    { name: '🔧 Total Repairs',       value: String(totalRepairs),  inline: true  },
    { name: '🔩 Engine Replacements', value: String(totalEngines),  inline: true  },
    { name: '💰 Repair Cost',         value: fmtMoney(repairCost),  inline: true  },
    { name: '⚙️ Engine Cost',         value: fmtMoney(engineCost),  inline: true  },
    { name: '💵 Total Owed',          value: fmtMoney(grandTotal),  inline: false },
  ];

  const description = jobs.length === 0
    ? `_No jobs recorded for **${dept}** in ${monthLabel}._`
    : `Full job breakdown is attached as a CSV file.`;

  return {
    title:       `📋 ${dept} — Monthly Invoice`,
    description,
    color,
    fields,
    footer:      { text: 'Kintsugi Motorworks · Invoice' },
    timestamp:   new Date().toISOString(),
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
 * "Generate Monthly Invoice" button pressed on the permanent billing panel.
 *
 * Step 1 of 3: Mirrors handleStartButton from the job-logs flow.
 * Responds immediately with an ephemeral deferral, then fetches the sheet to
 * collect distinct departments, and edits the private message with the
 * department select menu.  Departments come from the sheet so the list is
 * always up to date — no hardcoded values.
 */
async function handleInvoicePanelButton(interaction, env, ctx) {
  const { application_id: appId, token } = interaction;
  const correlationId = generateCorrelationId();
  const userId = interaction.member?.user?.id || interaction.user?.id || 'anon';

  invoiceLog('info', {
    correlationId,
    event:         'invoice_button_pressed',
    userId,
    guildId:       interaction.guild_id,
    channelId:     interaction.channel_id,
    interactionId: interaction.id,
  });

  ctx.waitUntil((async () => {
    try {
      // Fetch the sheet to get departments dynamically — mirrors handleStartButton
      // fetching the mechanic list so the options are always live.
      const jobRows = await fetchSheetWithRetry(JOBS_SHEET, { correlationId });
      const allJobs = parseJobsSheet(jobRows);

      // Collect unique, non-empty department values; filter to simple word-like values
      const depts = [...new Set(
        allJobs.map(j => j.department).filter(d => d && DEPT_NAME_PATTERN.test(d))
      )].sort((a, b) => a.localeCompare(b));

      // Fall back to the two known departments when the sheet lacks a dept column
      const deptList = depts.length > 0 ? depts : ['BCSO', 'LSPD'];
      const options = deptList.map(d => ({
        label:  d,
        value:  d,
        emoji:  { name: d === 'BCSO' ? '🟡' : d === 'LSPD' ? '🔵' : '🏢' },
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
      invoiceLog('info', { correlationId, event: 'invoice_dept_select_shown', userId, depts: deptList });
    } catch (err) {
      invoiceLog('error', { correlationId, event: 'invoice_button_error', userId, error: err.message, stack: err.stack });
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load department selector.\n\`${err.message}\``,
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
 * Department selected from the billing panel dropdown.
 *
 * Step 2 of 3: Fetches the sheet to discover available month-ending dates for
 * the chosen department, then edits the ephemeral message with a month-ending
 * select menu.  Values are ISO date strings (YYYY-MM-DD) from the sheet's
 * "Month Ending" column.  The department is encoded in the custom_id so the
 * next handler can read it.
 */
async function handleInvoiceDeptSelect(interaction, env, ctx) {
  const { application_id: appId, token } = interaction;
  const dept = interaction.data.values[0]; // 'BCSO' or 'LSPD'
  const correlationId = generateCorrelationId();
  const userId = interaction.member?.user?.id || interaction.user?.id || 'anon';

  invoiceLog('info', {
    correlationId,
    event:         'invoice_dept_selected',
    userId,
    guildId:       interaction.guild_id,
    channelId:     interaction.channel_id,
    interactionId: interaction.id,
    dept,
  });

  // Input validation — reject unexpected department values to surface data problems early
  if (!dept || !DEPT_NAME_PATTERN.test(dept)) {
    invoiceLog('warn', { correlationId, event: 'invoice_dept_invalid', userId, dept });
    await editOriginalMessage(appId, token, {
      content:    `❌ Invalid department value received. Please try again.`,
      components: [],
    }).catch(() => {});
    return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
  }

  ctx.waitUntil((async () => {
    try {
      // Show a progress message before the (potentially slow) sheet fetch
      await editOriginalMessage(appId, token, {
        content:    `⏳ Loading **${dept}** billing data… this may take a few seconds.`,
        components: [],
      }).catch(() => {});

      const t0 = Date.now();
      const jobRows = await fetchSheetWithRetry(JOBS_SHEET, { correlationId });
      const allJobs = parseJobsSheet(jobRows);
      invoiceLog('info', { correlationId, event: 'invoice_sheet_fetched', dept, durMs: Date.now() - t0, jobCount: allJobs.length });

      // Collect distinct month-ending dates from the sheet's "Month Ending"
      // column for the chosen department.  Key by ISO date so duplicates merge.
      const monthEndMap = new Map(); // "YYYY-MM-DD" -> Date
      for (const j of allJobs) {
        if (j.monthEnd && new RegExp(dept, 'i').test(j.department)) {
          const iso = j.monthEnd.toISOString().slice(0, 10);
          if (!monthEndMap.has(iso)) monthEndMap.set(iso, j.monthEnd);
        }
      }

      if (monthEndMap.size === 0) {
        invoiceLog('warn', { correlationId, event: 'invoice_no_months_found', dept });
        await editOriginalMessage(appId, token, {
          content:    `❌ No job data found for **${dept}** in the sheet.`,
          components: [],
        });
        return;
      }

      // Sort newest-first, cap at Discord's 25-option limit
      const entries = [...monthEndMap.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 25);

      const options = entries.map(([iso, date]) => {
        const label = date.toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
        });
        return { label, value: iso };
      });

      // Encode dept in custom_id so the month handler knows which dept was chosen
      await editOriginalMessage(appId, token, {
        content:    `📋 **${dept} — Step 2 of 3 — Select a month ending:**`,
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
      invoiceLog('info', { correlationId, event: 'invoice_month_select_shown', dept, monthCount: entries.length });
    } catch (err) {
      invoiceLog('error', { correlationId, event: 'invoice_dept_select_error', dept, error: err.message, stack: err.stack });
      await editOriginalMessage(appId, token, {
        content:    `❌ Failed to load job data.\n\`${err.message}\``,
        components: [],
      }).catch(() => {});
    }
  })());

  return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
}

/**
 * Month ending selected from the billing panel dropdown.
 *
 * Final step: Mirrors handleWeekSelect from the job-logs flow.
 * Fetches all jobs for the chosen department whose "Month Ending" matches the
 * selected date, then:
 *   1. editOriginalMessage  — updates the ephemeral message with the invoice embed
 *                             (simple JSON PATCH, same as handleWeekSelect)
 *   2. postFollowupWithFile — sends a separate ephemeral follow-up with the CSV
 *                             (keeps the primary response simple and reliable)
 *
 * Splitting the response (embed + CSV) this way mirrors exactly how handleWeekSelect
 * works and avoids the complex multipart PATCH that was causing "This interaction failed".
 *
 * The department is read from the select menu's custom_id
 * (format: `billing_month_select:<dept>`).
 * The selected value is an ISO date string (YYYY-MM-DD) taken from the sheet's
 * "Month Ending" column.
 */
async function handleInvoiceMonthSelect(interaction, env, ctx) {
  const { application_id: appId, token } = interaction;
  const monthValue = interaction.data.values[0]; // e.g. "2026-03-31"
  // Parse department encoded in the custom_id (e.g. "billing_month_select:BCSO")
  const dept = (interaction.data.custom_id || '').split(':')[1] || 'BCSO';
  const correlationId = generateCorrelationId();
  const userId = interaction.member?.user?.id || interaction.user?.id || 'anon';
  const debugMode = env?.INVOICE_DEBUG === 'true';

  invoiceLog('info', {
    correlationId,
    event:         'invoice_month_selected',
    userId,
    guildId:       interaction.guild_id,
    channelId:     interaction.channel_id,
    interactionId: interaction.id,
    dept,
    monthValue,
    debugMode,
  });

  // Input validation
  if (!dept || !DEPT_NAME_PATTERN.test(dept)) {
    invoiceLog('warn', { correlationId, event: 'invoice_month_dept_invalid', userId, dept });
    await editOriginalMessage(appId, token, {
      content: `❌ Invalid department. Please restart the invoice flow.`, components: [],
    }).catch(() => {});
    return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
  }
  if (!monthValue || !/^\d{4}-\d{2}-\d{2}$/.test(monthValue)) {
    invoiceLog('warn', { correlationId, event: 'invoice_month_value_invalid', userId, monthValue });
    await editOriginalMessage(appId, token, {
      content: `❌ Invalid month value. Please restart the invoice flow.`, components: [],
    }).catch(() => {});
    return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
  }

  // KV-based in-flight guard — prevents concurrent invoice generation for the same user
  const lockKey = `invoice:${userId}:${dept}:${monthValue}`;

  ctx.waitUntil((async () => {
    const locked = await acquireInvoiceLock(env?.KV, lockKey);
    if (!locked) {
      invoiceLog('warn', { correlationId, event: 'invoice_already_in_progress', userId, dept, monthValue });
      await editOriginalMessage(appId, token, {
        content:    `⏳ An invoice for **${dept}** (${monthValue}) is already being generated. Please wait a moment and try again.`,
        components: [],
      }).catch(() => {});
      return;
    }

    const timings = {};
    const t0Total = Date.now();

    try {
      const selectedDate = new Date(monthValue + 'T00:00:00Z');
      const monthLabel   = selectedDate.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      });

      // Progress message — keeps the user informed while the sheet is fetched.
      // Uses editOriginalMessage (simple JSON PATCH) just like handleWeekSelect.
      const tProgress = Date.now();
      await editOriginalMessage(appId, token, {
        content:    `⏳ **Generating invoice for ${dept} — Month Ending: ${monthLabel}…**\nFetching job data from the sheet. This may take a moment.`,
        components: [],
      }).catch(() => {});
      timings.progressMs = Date.now() - tProgress;

      // Fetch sheet data with timeout + retry — mirrors handleWeekSelect's fetchSheet call
      const tFetch = Date.now();
      const jobRows = await fetchSheetWithRetry(JOBS_SHEET, { correlationId });
      const allJobs = parseJobsSheet(jobRows);
      timings.fetchMs = Date.now() - tFetch;
      invoiceLog('info', { correlationId, event: 'invoice_sheet_fetched', dept, monthValue, durMs: timings.fetchMs, jobCount: allJobs.length });

      // Filter by dept AND by matching monthEnd date from the "Month Ending" column
      const tTransform = Date.now();
      const deptJobs = allJobs.filter(j => {
        if (!new RegExp(dept, 'i').test(j.department)) return false;
        if (!j.monthEnd) return false;
        return j.monthEnd.toISOString().slice(0, 10) === monthValue;
      });
      timings.transformMs = Date.now() - tTransform;

      invoiceLog('info', {
        correlationId,
        event:     'invoice_jobs_filtered',
        dept,
        monthValue,
        totalJobs: allJobs.length,
        deptJobs:  deptJobs.length,
        durMs:     timings.transformMs,
      });

      // Build CSV content
      const tCsv = Date.now();
      const csvContent = buildInvoiceCsv(dept, monthLabel, deptJobs);
      const csvFilename = `kintsugi-invoice-${dept.toLowerCase()}-${monthValue}.csv`;
      const csvBytes   = new TextEncoder().encode(csvContent).length;
      timings.csvMs    = Date.now() - tCsv;

      if (csvBytes > MAX_CSV_BYTES) {
        invoiceLog('warn', { correlationId, event: 'invoice_csv_oversized', csvBytes, dept, monthValue });
      }

      // Step 1: Update the original deferred message with the invoice embed summary.
      // Uses editOriginalMessage (plain JSON PATCH) — identical to how handleWeekSelect
      // updates the original message with the job-log embed.  No file attachment here.
      const tEmbed = Date.now();
      await editOriginalMessage(appId, token, {
        content:    `📋 **${dept} Invoice — Month Ending: ${monthLabel}**\n${deptJobs.length} job${deptJobs.length !== 1 ? 's' : ''} · CSV attached below ↓`,
        embeds:     [buildDeptInvoiceEmbed(dept, monthLabel, deptJobs)],
        components: [],
      });
      timings.embedMs = Date.now() - tEmbed;

      // Step 2: Send the CSV as a separate ephemeral follow-up.
      // Splitting the file into a follow-up keeps the primary response simple
      // (plain JSON PATCH) and the file delivery reliable.
      const tFile = Date.now();
      await postFollowupWithFile(
        appId, token,
        `📎 **${dept} Invoice CSV** — Month Ending: ${monthLabel}`,
        [],
        csvFilename,
        csvContent
      );
      timings.fileMs  = Date.now() - tFile;
      timings.totalMs = Date.now() - t0Total;

      invoiceLog('info', {
        correlationId,
        event:     'invoice_generated',
        userId,
        dept,
        monthValue,
        deptJobs:  deptJobs.length,
        csvBytes,
        timings,
      });

      if (debugMode) {
        invoiceLog('debug', {
          correlationId,
          event:       'invoice_debug_info',
          timings,
          memoryUsage: typeof process !== 'undefined' ? process.memoryUsage() : null,
          csvBytes,
        });
      }
    } catch (err) {
      timings.totalMs = Date.now() - t0Total;
      const errorId = generateErrorId();
      invoiceLog('error', {
        correlationId,
        event:     'invoice_generation_failed',
        userId,
        dept,
        monthValue,
        errorId,
        error:     err.message,
        stack:     err.stack,
        timings,
      });
      await editOriginalMessage(appId, token, {
        content:    `❌ Invoice generation failed (Error ID: \`${errorId}\`).\n\`${err.message}\`\n\n_If this keeps happening, share the Error ID with an admin._`,
        components: [],
      }).catch(editErr => {
        invoiceLog('error', { correlationId, event: 'invoice_error_reply_failed', errorId, error: editErr.message });
      });
    } finally {
      await releaseInvoiceLock(env?.KV, lockKey);
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
    // Manually triggers the same posts as the 5-minute cron (analytics, jobs,
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
        // Also handle legacy custom_ids from panels posted before the billing_ prefix rename (PR #81).
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
  },

  /**
   * Scheduled handler — runs on the Cron Trigger defined in wrangler.toml.
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
  },
};

// ===== Global error handlers (Node.js / local test runtime only) =====
// In Cloudflare Workers `process` is undefined — the guards below prevent
// runtime errors.  In local Node.js runs (e.g. test-invoice-flow.mjs or
// running the bot with `node worker.js`) these handlers surface hidden
// promise rejections and synchronous exceptions that would otherwise be
// swallowed or crash the process silently.
if (typeof process !== 'undefined') {
  process.on('unhandledRejection', (reason) => {
    invoiceLog('error', {
      event:  'unhandledRejection',
      reason: String(reason),
      stack:  reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on('uncaughtException', (err) => {
    invoiceLog('error', {
      event: 'uncaughtException',
      error: err.message,
      stack: err.stack,
    });
    // Log and continue — a Worker process may be handling concurrent requests,
    // so forced termination would drop them.  CI pipelines detect non-zero exit
    // through test failures rather than uncaughtException.
  });
}
