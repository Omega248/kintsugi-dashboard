#!/usr/bin/env node
// =======================================
// Kintsugi Discord Bot — Post Payouts Processed
//
// Fetches the most recent week's payout data from Google Sheets and posts a
// "Payouts Processed" embed to the configured Discord channel.
//
// Run via GitHub Actions ("Post Payouts Processed" workflow) — no manual token
// entry needed.  Can also be run locally:
//
//   DISCORD_BOT_TOKEN=Bot.xxxxx DISCORD_CHANNEL_ID=1234567890 node post-payouts.js
//
// Requirements:
//   - Node.js 18+ (built-in fetch)
//   - DISCORD_BOT_TOKEN      — Bot token from the Discord Developer Portal
//   - DISCORD_CHANNEL_ID     — ID of the #payouts channel
//
// Optional:
//   - PAYOUT_CONTACT_USER_ID — Discord user ID to mention at the bottom of the
//                              post so mechanics know who to contact if they
//                              have issues with their payout.
// =======================================

const BOT_TOKEN        = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID       = process.env.DISCORD_CHANNEL_ID;
const CONTACT_USER_ID  = process.env.PAYOUT_CONTACT_USER_ID || '';

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error(
    'Error: DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID environment variables are required.\n\n' +
    'Run via the "Post Payouts Processed" GitHub Actions workflow, or locally:\n' +
    '  DISCORD_BOT_TOKEN=Bot.xxxxx DISCORD_CHANNEL_ID=1234567890 node post-payouts.js'
  );
  process.exit(1);
}

// ===== Sheet config (mirrors kintsugi-core.js) =====
const SHEET_ID        = '1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks';
const JOBS_SHEET      = 'Form responses 1';
const STATE_IDS_SHEET = "State ID's";

// ===== Pay rates =====
const PAY_PER_REPAIR       = 700;
const ENGINE_REIMBURSEMENT = 12000;
const ENGINE_BONUS_LSPD    = 1500;
const ENGINE_PAY_DEFAULT   = ENGINE_REIMBURSEMENT + ENGINE_BONUS_LSPD;

// ===== CSV fetch + parse =====

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

// ===== Sheet parsers =====

function parseJobsSheet(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => (h || '').trim());
  const lower   = headers.map(h => h.toLowerCase());
  const iMech   = lower.findIndex(h => h.includes('mechanic'));
  const iAcross = lower.findIndex(h => h.includes('across') || h.includes('repairs'));
  const iTime   = lower.findIndex(h => h.includes('timestamp'));
  const iWeek   = lower.findIndex(h => h.includes('week') && h.includes('end'));
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
    const tsDate   = iTime !== -1 ? parseDateLike(row[iTime])  : null;
    const weekEnd  = iWeek !== -1 ? parseDateLike(row[iWeek])  : null;
    const bestDate = tsDate || weekEnd;
    jobs.push({ mechanic: mech, across, engineReplacements: engineCount, weekEnd, bestDate });
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

// ===== Week filtering =====

function getLatestWeekEndDate(jobs) {
  let latest = null;
  for (const j of jobs) {
    const d = j.weekEnd || j.bestDate;
    if (d && (!latest || d > latest)) latest = d;
  }
  if (!latest) return null;
  // Snap to the coming Sunday of that date
  const dayNum = latest.getDay();
  const sun    = new Date(latest);
  sun.setDate(latest.getDate() + (dayNum === 0 ? 0 : 7 - dayNum));
  sun.setHours(0, 0, 0, 0);
  return sun;
}

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

// ===== Build payouts embed =====

function buildPayload(weekEndDate, payouts) {
  const header =
    `Payouts for the week ending **${fmtDate(weekEndDate)}** have been processed.\n\n` +
    'All mechanics listed below have been paid.';

  const lines = payouts.map(m => {
    let line = `• **${m.name}**`;
    if (m.stateId) line += ` _(ID: ${m.stateId})_`;
    line += ` — ${m.jobs} job${m.jobs !== 1 ? 's' : ''} (${m.repairs} across)`;
    if (m.engineReplacements > 0) {
      line += `, ${m.engineReplacements} engine replacement${m.engineReplacements !== 1 ? 's' : ''}`;
    }
    line += ` · **${fmtMoney(m.totalPayout)}**`;
    return line;
  });

  const grandTotal = payouts.reduce((s, m) => s + m.totalPayout, 0);

  const contactContent = CONTACT_USER_ID
    ? `If you think there are any issues with your payout, please contact <@${CONTACT_USER_ID}>`
    : '';

  return {
    ...(contactContent ? { content: contactContent } : {}),
    embeds: [{
      title:       `✅ Payouts Processed — Week Ending ${fmtDate(weekEndDate)}`,
      description: header,
      color:       0x22c55e,
      fields: [
        {
          name:   '💸 Mechanic Payouts',
          value:  lines.join('\n').slice(0, 1024) || '_No mechanics found._',
          inline: false,
        },
        { name: '💰 Total Paid',    value: fmtMoney(grandTotal), inline: true },
        { name: '👷 Mechanics Paid',  value: String(payouts.length), inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer:    { text: 'Kintsugi Motorworks · Payouts' },
    }],
  };
}

// ===== Post to Discord =====

async function postToDiscord(payload) {
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
    throw new Error(`Discord API error (${res.status}): ${JSON.stringify(data)}`);
  }
  return data.id;
}

// ===== Main =====

async function main() {
  console.log('Fetching sheet data…');
  const [jobRows, stateRows] = await Promise.all([
    fetchSheet(JOBS_SHEET),
    fetchSheet(STATE_IDS_SHEET).catch(() => []),
  ]);

  const allJobs  = parseJobsSheet(jobRows);
  const stateMap = parseStateIds(stateRows);

  if (!allJobs.length) {
    console.error('No job data found in the sheet.');
    process.exit(1);
  }

  const weekEndDate = getLatestWeekEndDate(allJobs);
  if (!weekEndDate) {
    console.error('Could not determine the most recent week ending date.');
    process.exit(1);
  }

  const weekJobs = filterByWeekEnding(allJobs, weekEndDate);
  if (!weekJobs.length) {
    console.error(`No jobs found for the week ending ${fmtDate(weekEndDate)}.`);
    process.exit(1);
  }

  // Aggregate per mechanic
  const mechMap = new Map();
  for (const j of weekJobs) {
    let rec = mechMap.get(j.mechanic);
    if (!rec) {
      rec = {
        name:               j.mechanic,
        stateId:            stateMap.get(j.mechanic) || '',
        jobs:               0,
        repairs:            0,
        engineReplacements: 0,
        totalPayout:        0,
      };
      mechMap.set(j.mechanic, rec);
    }
    rec.jobs++;
    rec.repairs            += j.across || 0;
    rec.engineReplacements += j.engineReplacements || 0;
  }

  const payouts = Array.from(mechMap.values()).map(m => {
    m.totalPayout = m.repairs * PAY_PER_REPAIR + m.engineReplacements * ENGINE_PAY_DEFAULT;
    return m;
  }).sort((a, b) => b.totalPayout - a.totalPayout);

  console.log(`Week ending: ${fmtDate(weekEndDate)}`);
  console.log(`Mechanics:   ${payouts.length}`);
  payouts.forEach(m => console.log(`  ${m.name}: ${m.repairs} repairs → ${fmtMoney(m.totalPayout)}`));

  console.log('\nPosting to Discord…');
  const messageId = await postToDiscord(buildPayload(weekEndDate, payouts));
  console.log(`✅ Posted! Message ID: ${messageId}`);
  console.log(`   Channel: ${CHANNEL_ID}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
