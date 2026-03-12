#!/usr/bin/env node
// =======================================
// Kintsugi Discord Bot — Update Analytics
//
// Fetches the current week's live data from Google Sheets and posts or edits
// the analytics summary message in the configured Discord channel.
//
// Run via the "Update Analytics" GitHub Actions workflow (which fires every
// 5 minutes automatically after the first run).  Can also be run locally:
//
//   DISCORD_BOT_TOKEN=Bot.xxxxx DISCORD_CHANNEL_ID=1234567890 node update-analytics.js
//
// To find and edit an existing analytics message the script searches the last
// 50 messages in the channel for one posted by this bot with the analytics
// title.  If none is found a new message is posted.
//
// Requirements:
//   - Node.js 18+ (built-in fetch)
//   - DISCORD_BOT_TOKEN   — Bot token from the Discord Developer Portal
//   - DISCORD_CHANNEL_ID  — ID of the #analytics channel
// =======================================

const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error(
    'Error: DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID environment variables are required.\n\n' +
    'Run via the "Update Analytics" GitHub Actions workflow, or locally:\n' +
    '  DISCORD_BOT_TOKEN=Bot.xxxxx DISCORD_CHANNEL_ID=1234567890 node update-analytics.js'
  );
  process.exit(1);
}

// ===== Sheet config (mirrors kintsugi-core.js) =====
const SHEET_ID   = '1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks';
const JOBS_SHEET = 'Form responses 1';

// ===== Pay rates (mirrors constants.js) =====
const PAY_PER_REPAIR       = 700;
const ENGINE_REIMBURSEMENT = 12000;
const ENGINE_BONUS_LSPD    = 1500;
const ENGINE_PAY_DEFAULT   = ENGINE_REIMBURSEMENT + ENGINE_BONUS_LSPD;

// Max mechanics to list in the embed field (Discord field value ≤ 1 024 chars)
const DISCORD_MAX_MECHANICS   = 10;
const DISCORD_FIELD_MAX_CHARS = 1024;

// Title used to find an existing analytics message when searching channel history
const ANALYTICS_EMBED_TITLE = '📊 Kintsugi Motorworks — Weekly Analytics';

// ===== Google Sheets CSV fetch + parse =====

function sheetCsvUrl(sheetName) {
  return (
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
  );
}

async function fetchSheet(sheetName) {
  const res = await fetch(sheetCsvUrl(sheetName));
  if (!res.ok) throw new Error(`Failed to fetch sheet "${sheetName}": HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim() || text.trim().startsWith('<')) {
    throw new Error(
      `Sheet "${sheetName}" returned no usable data. ` +
      'Check that the spreadsheet is shared publicly (Anyone with the link → Viewer).'
    );
  }
  return parseCSV(text);
}

function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  const pushCell = () => { row.push(cur); cur = ''; };
  const pushRow  = () => { if (row.length || cur) { pushCell(); rows.push(row); row = []; } };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; } }
      else { cur += c; }
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
  // DD/MM/YYYY (UK format used by the sheet)
  const ddmm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (ddmm) {
    const dd = parseInt(ddmm[1], 10), mm = parseInt(ddmm[2], 10);
    const yyyy = ddmm[3].length === 2 ? '20' + ddmm[3] : ddmm[3];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(`${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`);
      if (!isNaN(d.getTime())) return d;
    }
  }
  // ISO date
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtMoney(n) {
  return '$' + Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US');
}

// ===== Sheet parser =====

function parseJobsSheet(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => (h || '').trim());
  const lower   = headers.map(h => h.toLowerCase());
  const iMech   = lower.findIndex(h => h.includes('mechanic'));
  const iAcross = lower.findIndex(h => h.includes('across') || h.includes('repairs'));
  const iTime   = lower.findIndex(h => h.includes('timestamp'));
  const iWeek   = lower.findIndex(h => h.includes('week') && h.includes('end'));
  const iMonth  = lower.findIndex(h => h.includes('month') && h.includes('end'));
  const iEngine = lower.findIndex(h => h.includes('engine') && h.includes('replacement'));
  if (iMech === -1 || iAcross === -1) return [];
  const jobs = [];
  for (let i = 1; i < rows.length; i++) {
    const row  = rows[i];
    if (!row || !row.length) continue;
    const mech = (row[iMech] || '').trim();
    if (!mech) continue;
    const across = parseInt(row[iAcross] || '0', 10) || 0;
    if (!across) continue;
    let engineCount = 0;
    if (iEngine !== -1) {
      const raw = (row[iEngine] || '').trim();
      const n   = Number(raw);
      if (!isNaN(n) && n > 0) { engineCount = n; }
      else if (/^(yes|y|true)$/i.test(raw)) { engineCount = 1; }
    }
    const tsDate   = iTime  !== -1 ? parseDateLike(row[iTime])  : null;
    const weekEnd  = iWeek  !== -1 ? parseDateLike(row[iWeek])  : null;
    const monthEnd = iMonth !== -1 ? parseDateLike(row[iMonth]) : null;
    const bestDate = tsDate || weekEnd || monthEnd;
    jobs.push({ mechanic: mech, across, engineReplacements: engineCount,
                tsDate, weekEnd, monthEnd, bestDate });
  }
  return jobs;
}

// ===== Week filtering + aggregation =====

function filterByWeekEnding(jobs, weekEndDate) {
  const ref = new Date(weekEndDate);
  ref.setHours(0, 0, 0, 0);
  const mon = new Date(ref);
  mon.setDate(ref.getDate() - 6);
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
      const dt  = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = dt.getUTCDay() || 7;
      dt.setUTCDate(dt.getUTCDate() + 4 - day);
      const yr  = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
      const wk  = Math.ceil(((dt - yr) / 86400000 + 1) / 7);
      weekKey   = `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
      const dayNum = d.getDay();
      weekEndDate  = new Date(d);
      weekEndDate.setDate(d.getDate() + (dayNum === 0 ? 0 : 7 - dayNum));
    }
    let rec = weekMap.get(weekKey);
    if (!rec) {
      rec = { weekKey, weekEndDate, totalRepairs: 0, engineReplacements: 0 };
      weekMap.set(weekKey, rec);
    }
    rec.totalRepairs       += j.across || 0;
    rec.engineReplacements += j.engineReplacements || 0;
  }
  const weeks = Array.from(weekMap.values());
  weeks.sort((a, b) => {
    if (a.weekEndDate && b.weekEndDate) return b.weekEndDate - a.weekEndDate;
    return b.weekKey.localeCompare(a.weekKey);
  });
  for (const w of weeks) {
    w.totalPayout = w.totalRepairs * PAY_PER_REPAIR + w.engineReplacements * ENGINE_PAY_DEFAULT;
  }
  return weeks;
}

function buildCurrentWeekSummary(allJobs) {
  const now    = new Date();
  const dayNum = now.getDay();
  const currentSunday = new Date(now);
  currentSunday.setDate(now.getDate() + (dayNum === 0 ? 0 : 7 - dayNum));
  currentSunday.setHours(0, 0, 0, 0);
  const weekJobs  = filterByWeekEnding(allJobs, currentSunday);
  const weekStats = buildWeeklyStats(weekJobs)[0] ?? null;
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
    weekEndDate:   currentSunday,
    totalRepairs:  weekStats ? weekStats.totalRepairs        : 0,
    totalEngines:  weekStats ? weekStats.engineReplacements  : 0,
    totalPayout:   weekStats ? weekStats.totalPayout         : 0,
    mechanicCount: mechMap.size,
    topMechanic,
    topRepairs,
    mechanics,
  };
}

function buildLatestWeekSummary(allJobs) {
  const allWeeks = buildWeeklyStats(allJobs);
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

// ===== Build analytics embed =====

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
      title:     ANALYTICS_EMBED_TITLE,
      color:     0x4f46e5,
      fields,
      timestamp: new Date().toISOString(),
      footer:    { text: 'Kintsugi Motorworks · Weekly Analytics' },
    }],
  };
}

// ===== Discord API helpers =====

/**
 * Search the last `limit` messages in the channel for an existing analytics
 * message posted by this bot.  Returns the message ID if found, null otherwise.
 */
async function findExistingAnalyticsMessage(limit = 50) {
  const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bot ${BOT_TOKEN}` },
  });
  if (!res.ok) return null;
  const messages = await res.json();
  if (!Array.isArray(messages)) return null;
  for (const msg of messages) {
    if (
      msg.author?.bot &&
      Array.isArray(msg.embeds) &&
      msg.embeds.some(e => e.title === ANALYTICS_EMBED_TITLE)
    ) {
      return msg.id;
    }
  }
  return null;
}

async function editMessage(messageId, payload) {
  const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/${messageId}`;
  const res = await fetch(url, {
    method:  'PATCH',
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Discord PATCH error (${res.status}): ${JSON.stringify(data)}`);
  }
  const data = await res.json();
  return data.id;
}

async function postMessage(payload) {
  const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Discord POST error (${res.status}): ${JSON.stringify(data)}`);
  }
  return data.id;
}

// ===== Main =====

async function main() {
  console.log('Fetching live job data from Google Sheets…');
  const jobRows = await fetchSheet(JOBS_SHEET);
  const allJobs = parseJobsSheet(jobRows);

  if (!allJobs.length) {
    console.error('No job data found in the sheet.');
    process.exit(1);
  }

  // Use current week data; fall back to the most recent week with actual data
  // so the message is useful even early in the week before any jobs are logged.
  let summary = buildCurrentWeekSummary(allJobs);
  if (summary.totalRepairs === 0) {
    const latest = buildLatestWeekSummary(allJobs);
    if (latest && latest.totalRepairs > 0) summary = latest;
  }

  console.log(`Week ending : ${fmtDate(summary.weekEndDate)}`);
  console.log(`Repairs     : ${summary.totalRepairs}`);
  console.log(`Mechanics   : ${summary.mechanicCount}`);
  console.log(`Total payout: ${fmtMoney(summary.totalPayout)}`);

  const payload = buildAnalyticsPayload(summary);

  // Look for an existing analytics message to edit so the channel stays tidy
  console.log('\nSearching channel for existing analytics message…');
  const existingId = await findExistingAnalyticsMessage();

  if (existingId) {
    console.log(`Found existing message (${existingId}) — editing…`);
    await editMessage(existingId, payload);
    console.log(`✅ Analytics message updated!  Message ID: ${existingId}`);
  } else {
    console.log('No existing message found — posting new…');
    const messageId = await postMessage(payload);
    console.log(`✅ Analytics message posted!  Message ID: ${messageId}`);
    console.log('   Tip: Pin this message in Discord so it stays visible at the top of the channel.');
  }

  console.log(`   Channel: ${CHANNEL_ID}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
