// ===== Config (using KINTSUGI_SHEET_ID from kintsugi-core.js) =====
const MECH_JOBS_SHEET = "Form responses 1";
const MECH_STATE_ID_SHEET = "State ID's";
const MECH_PAY_PER_REPAIR = 700;
const MECH_ENGINE_REIMBURSEMENT = 12000;
const MECH_ENGINE_BONUS_LSPD = 1500;

// ===== State =====
let mechJobs = [];      // raw parsed jobs
let mechStats = [];     // aggregated per-mechanic stats
let stateIdByMechanic = new Map();  // mechanic -> state ID
let selectedMechanicName = null;  // currently selected mechanic

// DOM refs
let statusEl;
let mechanicsBody;
let mechanicFilterEl;
let timeFilterEl;
let sortByEl;
let searchBoxEl;

let sumTotalMechanicsEl;
let sumTotalMechanicsSubEl;
let sumTotalRepairsEl;
let sumTotalRepairsSubEl;
let sumTotalPayoutEl;
let sumTotalPayoutSubEl;
let sumActivityRangeEl;
let sumActivityRangeSubEl;

let detailTitleEl;
let detailSubtitleEl;
let mechanicDetailEl;
let mechanicsTableSubEl;

let weeklySummarySubtitleEl;
let weeklySummaryContentEl;

// ===== CSV fetch (using kintsugi-core.js) =====
async function mechFetchCSV(sheetName) {
  return await kFetchCSV(sheetName, { header: false });
}

// ===== State ID helpers =====
function mechBuildStateIdMap(stateRows) {
  stateIdByMechanic.clear();
  if (!stateRows || stateRows.length < 2) return;

  const headers = stateRows[0].map((h) => h.trim());
  const lower = headers.map((h) => h.toLowerCase());

  const iMech = lower.findIndex(
    (h) => h.includes("mechanic") || h.includes("name")
  );
  const iState = lower.findIndex(
    (h) => h.includes("state") && h.includes("id")
  );
  if (iMech === -1 || iState === -1) return;

  for (let r = 1; r < stateRows.length; r++) {
    const row = stateRows[r];
    if (!row) continue;
    const mech = (row[iMech] || "").trim();
    const sid = (row[iState] || "").trim();
    if (!mech || !sid) continue;
    stateIdByMechanic.set(mech, sid);
  }
}

// ===== Calculation helpers =====
function mechCalculateEngineValue(engineCount) {
  // LSPD/Other: £12k reimbursement + £1.5k bonus
  // BCSO: £12k reimbursement only (but we don't track dept here, using LSPD rate)
  return engineCount * (MECH_ENGINE_REIMBURSEMENT + MECH_ENGINE_BONUS_LSPD);
}

// ===== Date helpers =====
// ===== Date/Money helpers (using kintsugi-core.js) =====
function mechIsValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

function mechParseDateLike(raw) {
  return kParseDateLike(raw);
}

function mechFmtDate(d) {
  if (!mechIsValidDate(d)) return "–";
  // Using UK format (DD/MM/YY) for this page
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function mechFmtMoney(amount) {
  // Using UK format (£) for this page
  return "£" + (amount || 0).toLocaleString("en-GB");
}

function mechGetBestDate(job) {
  const candidates = [job.tsDate, job.weekEnd, job.monthEnd];
  for (const d of candidates) {
    if (mechIsValidDate(d)) return d;
  }
  return null;
}

// derive ISO week key (year-week) from a date
function mechWeekKeyFromDate(d) {
  if (!mechIsValidDate(d)) return null;
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function mechMonthKeyFromDate(d) {
  if (!mechIsValidDate(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ===== Time filtering =====
function mechFilterJobsByTime(jobs, timeKey) {
  if (timeKey === "all") return jobs;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (timeKey === "last4w") {
    const threshold = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000);
    return jobs.filter((j) => j.bestDate && j.bestDate >= threshold);
  }

  if (timeKey === "last3m") {
    const thr = new Date(today);
    thr.setMonth(thr.getMonth() - 3);
    thr.setHours(0, 0, 0, 0);
    return jobs.filter((j) => j.bestDate && j.bestDate >= thr);
  }

  if (timeKey === "last6m") {
    const thr = new Date(today);
    thr.setMonth(thr.getMonth() - 6);
    thr.setHours(0, 0, 0, 0);
    return jobs.filter((j) => j.bestDate && j.bestDate >= thr);
  }

  if (timeKey === "last12m") {
    const thr = new Date(today);
    thr.setFullYear(thr.getFullYear() - 1);
    thr.setHours(0, 0, 0, 0);
    return jobs.filter((j) => j.bestDate && j.bestDate >= thr);
  }

  if (timeKey === "thisMonth") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return jobs.filter((j) => j.bestDate && j.bestDate >= start && j.bestDate < end);
  }

  return jobs;
}

// ===== Weekly aggregation for a specific mechanic =====
function mechBuildWeeklyStats(mechanicName, sourceJobs) {
  if (!mechanicName) return [];
  
  const mechanicJobs = sourceJobs.filter(j => j.mechanic === mechanicName);
  if (mechanicJobs.length === 0) return [];
  
  const weekMap = new Map();
  
  for (const j of mechanicJobs) {
    const d = j.bestDate;
    if (!mechIsValidDate(d)) continue;
    
    // Use week ending date if available, otherwise calculate week key
    let weekKey;
    let weekEndDate;
    
    if (j.weekEnd && mechIsValidDate(j.weekEnd)) {
      // Use the week ending date from the data (preferred)
      weekKey = j.weekEnd.toISOString().slice(0, 10);
      weekEndDate = j.weekEnd;
    } else {
      // Fallback: use ISO week standard for grouping
      weekKey = mechWeekKeyFromDate(d);
      // Calculate week ending date (Sunday) for display purposes
      // Note: This is for display only and may differ from ISO week boundaries
      const dayNum = d.getDay();
      const daysUntilSunday = dayNum === 0 ? 0 : 7 - dayNum;
      weekEndDate = new Date(d);
      weekEndDate.setDate(d.getDate() + daysUntilSunday);
    }
    
    if (!weekKey) continue;
    
    let weekRec = weekMap.get(weekKey);
    if (!weekRec) {
      weekRec = {
        weekKey,
        weekEndDate,
        mechanic: mechanicName,
        totalRepairs: 0,
        engineReplacements: 0,
        jobs: []
      };
      weekMap.set(weekKey, weekRec);
    }
    
    weekRec.totalRepairs += j.across || 0;
    weekRec.engineReplacements += j.engineReplacements || 0;
    weekRec.jobs.push(j);
  }
  
  // Convert to array and sort by week (newest first)
  const weeklyStats = Array.from(weekMap.values());
  weeklyStats.sort((a, b) => {
    if (a.weekEndDate && b.weekEndDate) {
      return b.weekEndDate - a.weekEndDate;
    }
    return b.weekKey.localeCompare(a.weekKey);
  });
  
  // Calculate payouts
  for (const week of weeklyStats) {
    const basePay = week.totalRepairs * MECH_PAY_PER_REPAIR;
    const enginePay = mechCalculateEngineValue(week.engineReplacements);
    week.totalPayout = basePay + enginePay;
  }
  
  return weeklyStats;
}

// ===== Aggregation =====
function mechBuildStats(sourceJobs) {
  const map = new Map();
  let globalEarliest = null;
  let globalLatest = null;

  for (const j of sourceJobs) {
    const mech = j.mechanic;
    if (!mech) continue;

    let rec = map.get(mech);
    if (!rec) {
      rec = {
        mechanic: mech,
        totalRepairs: 0,
        weeksWorkedSet: new Set(),
        monthsActiveSet: new Set(),
        firstJob: null,
        lastJob: null,
      };
      map.set(mech, rec);
    }

    const across = j.across || 0;
    rec.totalRepairs += across;

    // choose best valid date for this job
    const d = j.bestDate;
    if (mechIsValidDate(d)) {
      const weekKey =
        j.weekEnd && mechIsValidDate(j.weekEnd)
          ? j.weekEnd.toISOString().slice(0, 10)
          : mechWeekKeyFromDate(d);
      if (weekKey) rec.weeksWorkedSet.add(weekKey);

      const monthKey =
        j.monthEnd && mechIsValidDate(j.monthEnd)
          ? mechMonthKeyFromDate(j.monthEnd)
          : mechMonthKeyFromDate(d);
      if (monthKey) rec.monthsActiveSet.add(monthKey);

      if (!rec.firstJob || d < rec.firstJob) rec.firstJob = d;
      if (!rec.lastJob || d > rec.lastJob) rec.lastJob = d;
      if (!globalEarliest || d < globalEarliest) globalEarliest = d;
      if (!globalLatest || d > globalLatest) globalLatest = d;
    }
  }

  const stats = [];
  for (const rec of map.values()) {
    const weeksCount = rec.weeksWorkedSet.size;
    const monthsCount = rec.monthsActiveSet.size;
    const avgPerWeek = weeksCount ? rec.totalRepairs / weeksCount : 0;
    const totalPayout = rec.totalRepairs * MECH_PAY_PER_REPAIR;

    stats.push({
      mechanic: rec.mechanic,
      totalRepairs: rec.totalRepairs,
      weeksWorked: weeksCount,
      monthsActive: monthsCount,
      avgPerWeek,
      totalPayout,
      firstJob: rec.firstJob,
      lastJob: rec.lastJob,
    });
  }

  return { stats, globalEarliest, globalLatest };
}

// ===== Rendering =====
function mechRenderGlobalSummary(stats, globalEarliest, globalLatest) {
  const totalMechanics = stats.length;
  const totalRepairs = stats.reduce((sum, r) => sum + (r.totalRepairs || 0), 0);
  const totalPayout = totalRepairs * MECH_PAY_PER_REPAIR;

  if (sumTotalMechanicsEl) {
    sumTotalMechanicsEl.textContent = totalMechanics
      ? totalMechanics.toLocaleString("en-GB")
      : "0";
  }
  if (sumTotalMechanicsSubEl) {
    sumTotalMechanicsSubEl.textContent = "Unique mechanics with at least one repair.";
  }

  if (sumTotalRepairsEl) {
    sumTotalRepairsEl.textContent = totalRepairs
      ? totalRepairs.toLocaleString("en-GB")
      : "0";
  }
  if (sumTotalRepairsSubEl) {
    sumTotalRepairsSubEl.textContent =
      "Across all mechanics in the selected time window.";
  }

  if (sumTotalPayoutEl) {
    sumTotalPayoutEl.textContent = mechFmtMoney(totalPayout);
  }
  if (sumTotalPayoutSubEl) {
    sumTotalPayoutSubEl.textContent = `Assuming £${MECH_PAY_PER_REPAIR.toLocaleString(
      "en-GB"
    )} per repair.`;
  }

  if (sumActivityRangeEl) {
    if (mechIsValidDate(globalEarliest) && mechIsValidDate(globalLatest)) {
      sumActivityRangeEl.textContent =
        mechFmtDate(globalEarliest) + " → " + mechFmtDate(globalLatest);
      if (sumActivityRangeSubEl) {
        sumActivityRangeSubEl.textContent = "Oldest and newest jobs in the filtered window.";
      }
    } else {
      sumActivityRangeEl.textContent = "–";
      if (sumActivityRangeSubEl) sumActivityRangeSubEl.textContent = "";
    }
  }
}

function mechRenderTable(stats) {
  if (!mechanicsBody) return;

  mechanicsBody.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const row of stats) {
    const tr = document.createElement("tr");
    tr.classList.add("is-clickable");
    tr.dataset.mechanic = row.mechanic;

    const avg = row.avgPerWeek || 0;

    tr.innerHTML = `
      <td>${row.mechanic}</td>
      <td>${row.totalRepairs.toLocaleString("en-GB")}</td>
      <td>${row.weeksWorked || 0}</td>
      <td>${row.monthsActive || 0}</td>
      <td>${avg.toFixed(1)}</td>
      <td>${mechFmtMoney(row.totalPayout)}</td>
      <td>${row.lastJob ? mechFmtDate(row.lastJob) : "–"}</td>
    `;

    frag.appendChild(tr);
  }

  mechanicsBody.appendChild(frag);
}

function mechRenderDetail(selected) {
  mechanicDetailEl.innerHTML = "";

  if (!selected) {
    const div = document.createElement("div");
    div.className = "mechanic-detail-empty";
    div.textContent =
      "No mechanic selected. Choose a mechanic to see breakdown for repairs, weeks worked and payout.";
    mechanicDetailEl.appendChild(div);
    detailTitleEl.textContent = "Mechanic details";
    detailSubtitleEl.textContent = "Select a mechanic from the table or dropdown.";
    return;
  }

  detailTitleEl.textContent = selected.mechanic;

  const summaryBits = [];
  summaryBits.push(`Total repairs: ${selected.totalRepairs.toLocaleString("en-GB")}.`);
  if (selected.weeksWorked) summaryBits.push(`Weeks worked: ${selected.weeksWorked}.`);
  if (selected.monthsActive) summaryBits.push(`Months active: ${selected.monthsActive}.`);
  if (selected.lastJob) summaryBits.push(`Last job: ${mechFmtDate(selected.lastJob)}.`);
  detailSubtitleEl.textContent = summaryBits.join(" ");

  const grid = document.createElement("div");
  grid.className = "mechanic-detail-grid";

  function addItem(label, value) {
    const el = document.createElement("div");
    el.className = "mechanic-detail-item";

    const lab = document.createElement("div");
    lab.className = "mechanic-detail-item-label";
    lab.textContent = label;

    const val = document.createElement("div");
    val.className = "mechanic-detail-item-value";
    val.textContent = value;

    el.appendChild(lab);
    el.appendChild(val);
    grid.appendChild(el);
  }

  addItem(
    "Total repairs",
    selected.totalRepairs ? selected.totalRepairs.toLocaleString("en-GB") : "0"
  );
  addItem("Weeks worked", selected.weeksWorked ? String(selected.weeksWorked) : "0");
  addItem("Months active", selected.monthsActive ? String(selected.monthsActive) : "0");
  addItem(
    "Average repairs / week",
    selected.avgPerWeek ? selected.avgPerWeek.toFixed(1) : "0.0"
  );
  addItem("Lifetime mechanic payout", mechFmtMoney(selected.totalPayout));
  addItem("Last job", selected.lastJob ? mechFmtDate(selected.lastJob) : "–");

  mechanicDetailEl.appendChild(grid);
}

// ===== Weekly summary rendering =====
function mechRenderWeeklySummary(mechanicName) {
  if (!weeklySummaryContentEl) return;
  
  weeklySummaryContentEl.innerHTML = "";
  
  if (!mechanicName) {
    const div = document.createElement("div");
    div.className = "weekly-summary-empty";
    div.textContent = "No mechanic selected. Choose a mechanic to see their weekly payout summary.";
    weeklySummaryContentEl.appendChild(div);
    
    if (weeklySummarySubtitleEl) {
      weeklySummarySubtitleEl.textContent = "Select a mechanic to view weekly breakdown.";
    }
    return;
  }
  
  // Get current time filter
  const timeFilter = timeFilterEl ? timeFilterEl.value : "all";
  const scopedJobs = mechFilterJobsByTime(mechJobs, timeFilter);
  
  const weeklyStats = mechBuildWeeklyStats(mechanicName, scopedJobs);
  
  if (weeklyStats.length === 0) {
    const div = document.createElement("div");
    div.className = "weekly-summary-empty";
    div.textContent = "No repairs found for this mechanic in the selected time period.";
    weeklySummaryContentEl.appendChild(div);
    
    if (weeklySummarySubtitleEl) {
      weeklySummarySubtitleEl.textContent = "No data available.";
    }
    return;
  }
  
  // Update subtitle
  if (weeklySummarySubtitleEl) {
    const stateId = stateIdByMechanic.get(mechanicName) || "N/A";
    weeklySummarySubtitleEl.textContent = `${mechanicName} (State ID: ${stateId})`;
  }
  
  // Create weekly cards
  const fragment = document.createDocumentFragment();
  
  for (const week of weeklyStats) {
    const card = document.createElement("div");
    card.className = "weekly-summary-card";
    
    const header = document.createElement("div");
    header.className = "weekly-summary-header";
    
    const weekLabel = document.createElement("div");
    weekLabel.className = "weekly-summary-week";
    weekLabel.textContent = week.weekEndDate ? 
      `Week ending ${mechFmtDate(week.weekEndDate)}` : 
      week.weekKey;
    
    const copyBtn = document.createElement("button");
    copyBtn.className = "weekly-summary-copy-btn";
    copyBtn.textContent = "Copy";
    copyBtn.dataset.weekKey = week.weekKey;
    copyBtn.addEventListener("click", () => mechCopyWeekSummary(mechanicName, week));
    
    header.appendChild(weekLabel);
    header.appendChild(copyBtn);
    card.appendChild(header);
    
    // Add summary rows
    const stateId = stateIdByMechanic.get(mechanicName) || "N/A";
    
    mechAddSummaryRow(card, "Mechanic", mechanicName);
    mechAddSummaryRow(card, "State ID", stateId);
    mechAddSummaryRow(card, "Repairs", week.totalRepairs.toString());
    if (week.engineReplacements > 0) {
      mechAddSummaryRow(card, "Engine Replacements", week.engineReplacements.toString());
      const engineValue = mechCalculateEngineValue(week.engineReplacements);
      mechAddSummaryRow(card, "Engine Value", mechFmtMoney(engineValue));
    }
    mechAddSummaryRow(card, "Total Payout", mechFmtMoney(week.totalPayout));
    
    fragment.appendChild(card);
  }
  
  // Add "Copy All" button if there are multiple weeks
  if (weeklyStats.length > 1) {
    const copyAllBtn = document.createElement("button");
    copyAllBtn.className = "weekly-summary-copy-all";
    copyAllBtn.textContent = `Copy All ${weeklyStats.length} Weeks`;
    copyAllBtn.addEventListener("click", () => mechCopyAllWeeks(mechanicName, weeklyStats));
    fragment.appendChild(copyAllBtn);
  }
  
  weeklySummaryContentEl.appendChild(fragment);
}

function mechAddSummaryRow(container, label, value) {
  const row = document.createElement("div");
  row.className = "weekly-summary-row";
  
  const labelEl = document.createElement("div");
  labelEl.className = "weekly-summary-label";
  labelEl.textContent = label + ":";
  
  const valueEl = document.createElement("div");
  valueEl.className = "weekly-summary-value";
  valueEl.textContent = value;
  
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  container.appendChild(row);
}

// ===== Copy functions =====
async function mechCopyWeekSummary(mechanicName, week) {
  const stateId = stateIdByMechanic.get(mechanicName) || "N/A";
  const weekEndStr = week.weekEndDate ? mechFmtDate(week.weekEndDate) : week.weekKey;
  
  let summary = `Kintsugi Motorworks - Weekly Payout\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `Mechanic: ${mechanicName}\n`;
  summary += `State ID: ${stateId}\n`;
  summary += `Week Ending: ${weekEndStr}\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `Repairs: ${week.totalRepairs}\n`;
  if (week.engineReplacements > 0) {
    summary += `Engine Replacements: ${week.engineReplacements}\n`;
    const engineValue = mechCalculateEngineValue(week.engineReplacements);
    summary += `Engine Reimbursement: ${mechFmtMoney(engineValue)}\n`;
  }
  summary += `Total Payout: ${mechFmtMoney(week.totalPayout)}\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(summary);
      mechShowNotification("✓ Copied to clipboard!");
    } else {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = summary;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      mechShowNotification("✓ Copied to clipboard!");
    }
  } catch (err) {
    console.error("Failed to copy:", err);
    mechShowNotification("✗ Failed to copy");
  }
}

async function mechCopyAllWeeks(mechanicName, weeklyStats) {
  const stateId = stateIdByMechanic.get(mechanicName) || "N/A";
  
  let summary = `Kintsugi Motorworks - Multi-Week Payout Summary\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `Mechanic: ${mechanicName}\n`;
  summary += `State ID: ${stateId}\n`;
  summary += `Period: ${weeklyStats.length} weeks\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  let totalRepairs = 0;
  let totalEngineReplacements = 0;
  let totalPayout = 0;
  
  for (const week of weeklyStats) {
    const weekEndStr = week.weekEndDate ? mechFmtDate(week.weekEndDate) : week.weekKey;
    summary += `Week ending ${weekEndStr}:\n`;
    summary += `  Repairs: ${week.totalRepairs}\n`;
    if (week.engineReplacements > 0) {
      summary += `  Engine Replacements: ${week.engineReplacements}\n`;
    }
    summary += `  Payout: ${mechFmtMoney(week.totalPayout)}\n\n`;
    
    totalRepairs += week.totalRepairs;
    totalEngineReplacements += week.engineReplacements;
    totalPayout += week.totalPayout;
  }
  
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `TOTALS:\n`;
  summary += `Total Repairs: ${totalRepairs}\n`;
  if (totalEngineReplacements > 0) {
    summary += `Total Engine Replacements: ${totalEngineReplacements}\n`;
  }
  summary += `Total Payout: ${mechFmtMoney(totalPayout)}\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(summary);
      mechShowNotification("✓ All weeks copied to clipboard!");
    } else {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = summary;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      mechShowNotification("✓ All weeks copied to clipboard!");
    }
  } catch (err) {
    console.error("Failed to copy:", err);
    mechShowNotification("✗ Failed to copy");
  }
}

function mechShowNotification(message) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = message.startsWith("✓") ? "#10b981" : "#ef4444";
    setTimeout(() => {
      statusEl.textContent = "";
      statusEl.style.color = "";
    }, 2000);
  }
}

// ===== Mechanic dropdown / filters =====
function mechPopulateMechanicDropdown() {
  if (!mechanicFilterEl) return;

  const prev = mechanicFilterEl.value || "all";
  mechanicFilterEl.innerHTML = '<option value="all">All mechanics</option>';

  const names = Array.from(
    new Set(mechJobs.map((j) => j.mechanic).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    mechanicFilterEl.appendChild(opt);
  }

  if (prev && prev !== "all" && names.includes(prev)) {
    mechanicFilterEl.value = prev;
  } else {
    mechanicFilterEl.value = "all";
  }
}

function mechApplyFiltersAndRender() {
  const mechFilter = mechanicFilterEl ? mechanicFilterEl.value : "all";
  const timeFilter = timeFilterEl ? timeFilterEl.value : "all";

  const sortKeyRaw = sortByEl ? sortByEl.value : "totalRepairs";
  const sortKeyMap = {
    totalRepairs: "totalRepairs",
    weeksWorked: "weeksWorked",
    monthsActive: "monthsActive",
    avgPerWeek: "avgPerWeek",
    lifetimePayout: "totalPayout",
    name: "mechanic",
  };
  const sortKey = sortKeyMap[sortKeyRaw] || "totalRepairs";

  const searchTerm = searchBoxEl ? searchBoxEl.value.trim().toLowerCase() : "";

  const scopedJobs = mechFilterJobsByTime(mechJobs, timeFilter);
  const { stats, globalEarliest, globalLatest } = mechBuildStats(scopedJobs);

  // filter
  let filtered = stats;
  if (mechFilter && mechFilter !== "all") {
    filtered = filtered.filter((s) => s.mechanic === mechFilter);
  }
  if (searchTerm) {
    filtered = filtered.filter((s) =>
      s.mechanic.toLowerCase().includes(searchTerm)
    );
  }

  // sort
  filtered.sort((a, b) => {
    if (sortKey === "mechanic") return a.mechanic.localeCompare(b.mechanic);
    return (b[sortKey] || 0) - (a[sortKey] || 0);
  });

  mechStats = filtered;
  mechRenderTable(filtered);
  mechRenderGlobalSummary(stats, globalEarliest, globalLatest);

  const timeLabelMap = {
    all: "All time.",
    last4w: "Last 4 weeks.",
    last3m: "Last 3 months.",
    last6m: "Last 6 months.",
    last12m: "Last 12 months.",
    thisMonth: "This month.",
  };
  const timeLabel = timeLabelMap[timeFilter] || "All time.";
  const mechLabel =
    mechFilter && mechFilter !== "all" ? `Mechanic: ${mechFilter}.` : "All mechanics.";
  if (mechanicsTableSubEl) {
    mechanicsTableSubEl.textContent = `${mechLabel} ${timeLabel}`;
  }

  const selected =
    mechFilter && mechFilter !== "all"
      ? filtered.find((s) => s.mechanic === mechFilter) || null
      : null;
  mechRenderDetail(selected);
  
  // Update selected mechanic and render weekly summary
  selectedMechanicName = mechFilter && mechFilter !== "all" ? mechFilter : null;
  mechRenderWeeklySummary(selectedMechanicName);
}

// ===== Data load =====
async function mechLoad() {
  try {
    if (statusEl) statusEl.textContent = "Loading mechanics…";

    // Load State IDs and jobs in parallel
    const [stateRows, data] = await Promise.all([
      mechFetchCSV(MECH_STATE_ID_SHEET),
      mechFetchCSV(MECH_JOBS_SHEET),
    ]);

    mechBuildStateIdMap(stateRows);

    if (!data.length || data.length < 2) {
      throw new Error("No rows in Form responses 1.");
    }

    const headers = data[0].map((h) => (h || "").trim());
    const headersLower = headers.map((h) => h.toLowerCase());

    const iTime = headers.indexOf("Timestamp");
    const iMech = headers.indexOf("Mechanic");
    const iAcross = headers.indexOf("How many Across");
    const iWeek = headers.indexOf("Week Ending");
    const iMonth = headers.indexOf("Month Ending");
    
    // Find engine replacement column
    const iEngine = headersLower.findIndex(
      (h) => h.includes("engine") && h.includes("replacement")
    );
    
    // Find department column
    const iDept = headersLower.findIndex(
      (h) => h.includes("department")
    );

    if (iTime === -1 || iMech === -1 || iAcross === -1) {
      throw new Error(
        'Missing expected columns. Need at least "Timestamp", "Mechanic", "How many Across".'
      );
    }

    const jobs = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const mech = iMech !== -1 ? String(row[iMech] || "").trim() : "";
      if (!mech) continue;

      const acrossRaw = iAcross !== -1 ? row[iAcross] : "";
      const across = acrossRaw ? parseInt(acrossRaw, 10) || 0 : 0;
      if (!across) continue;

      // Engine replacements: allow numeric count or yes/no
      let engineCount = 0;
      if (iEngine !== -1) {
        const rawEngine = (row[iEngine] || "").trim();
        if (rawEngine) {
          const num = Number(rawEngine);
          if (!Number.isNaN(num) && num > 0) {
            engineCount = num;
          } else if (/^(yes|y|true)$/i.test(rawEngine)) {
            engineCount = 1;
          }
        }
      }
      
      const dept = iDept !== -1 ? (row[iDept] || "").trim() : "";

      const tsRaw = iTime !== -1 ? row[iTime] : "";
      const weekRaw = iWeek !== -1 ? row[iWeek] : "";
      const monthRaw = iMonth !== -1 ? row[iMonth] : "";

      const tsDate = tsRaw ? mechParseDateLike(tsRaw) : null;
      const weekEnd = weekRaw ? mechParseDateLike(weekRaw) : null;
      const monthEnd = monthRaw ? mechParseDateLike(monthRaw) : null;
      const bestDate = mechGetBestDate({ tsDate, weekEnd, monthEnd });

      jobs.push({
        mechanic: mech,
        across,
        engineReplacements: engineCount,
        department: dept,
        tsDate,
        weekEnd,
        monthEnd,
        bestDate,
      });
    }

    mechJobs = jobs;
    mechPopulateMechanicDropdown();
    mechApplyFiltersAndRender();
    mechInitMyLog();

    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    console.error(err);
    if (statusEl) {
      statusEl.textContent =
        "Failed to load mechanic stats. Check sheet sharing and column names.";
    }
  }
}

// ===== My Repair Log (self-service) =====

/**
 * Initialise the "My Repair Log" panel once job data has been loaded.
 * Populates the mechanic dropdown and wires up change events.
 */
function mechInitMyLog() {
  const mechSel = document.getElementById('myLogMechanic');
  const weekSel = document.getElementById('myLogWeek');
  const postBtn = document.getElementById('myLogPostBtn');
  if (!mechSel) return;

  // Populate mechanic dropdown from loaded data (sorted A→Z)
  const mechanicNames = [...new Set(mechJobs.map(j => j.mechanic))].sort();
  mechSel.innerHTML = '<option value="">— Select mechanic —</option>';
  mechanicNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    mechSel.appendChild(opt);
  });

  mechSel.addEventListener('change', () => {
    mechUpdateMyLogWeeks(mechSel.value);
    mechRenderMyLog();
  });

  if (weekSel) {
    weekSel.addEventListener('change', mechRenderMyLog);
  }

  if (postBtn) {
    postBtn.addEventListener('click', mechPostMyLogToDiscord);
  }
}

/**
 * Populate the week dropdown for the given mechanic, then auto-render.
 */
function mechUpdateMyLogWeeks(mechanicName) {
  const weekSel = document.getElementById('myLogWeek');
  if (!weekSel) return;

  weekSel.innerHTML = '<option value="">— Select week —</option>';
  weekSel.disabled = !mechanicName;
  if (!mechanicName) return;

  // Collect unique weeks for this mechanic
  const weekMap = new Map(); // weekKey → { weekKey, label, weekEndDate }
  mechJobs
    .filter(j => j.mechanic === mechanicName)
    .forEach(j => {
      let weekKey, label, weekEndDate;
      if (j.weekEnd && mechIsValidDate(j.weekEnd)) {
        weekKey = j.weekEnd.toISOString().slice(0, 10);
        weekEndDate = j.weekEnd;
        label = 'Week ending ' + mechFmtDate(j.weekEnd);
      } else if (j.bestDate) {
        weekKey = mechWeekKeyFromDate(j.bestDate);
        weekEndDate = null;
        label = weekKey || 'Unknown week';
      }
      if (weekKey && !weekMap.has(weekKey)) {
        weekMap.set(weekKey, { weekKey, label, weekEndDate });
      }
    });

  // Sort newest first
  const weeks = Array.from(weekMap.values()).sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  weeks.forEach(({ weekKey, label }) => {
    const opt = document.createElement('option');
    opt.value = weekKey;
    opt.textContent = label;
    weekSel.appendChild(opt);
  });

  // Auto-select the most recent week
  if (weeks.length > 0) {
    weekSel.value = weeks[0].weekKey;
    mechRenderMyLog();
  }
}

/**
 * Return all jobs for a given mechanic + week key.
 */
function mechGetMyLogJobs(mechanicName, weekKey) {
  if (!mechanicName || !weekKey) return [];
  return mechJobs.filter(j => {
    if (j.mechanic !== mechanicName) return false;
    if (j.weekEnd && mechIsValidDate(j.weekEnd)) {
      return j.weekEnd.toISOString().slice(0, 10) === weekKey;
    }
    return mechWeekKeyFromDate(j.bestDate) === weekKey;
  });
}

/**
 * Render the repair log table for the currently selected mechanic + week.
 */
function mechRenderMyLog() {
  const mechSel = document.getElementById('myLogMechanic');
  const weekSel = document.getElementById('myLogWeek');
  const resultEl = document.getElementById('myLogResult');
  const postBtn = document.getElementById('myLogPostBtn');
  if (!mechSel || !weekSel || !resultEl) return;

  const mechanicName = mechSel.value;
  const weekKey = weekSel.value;

  if (!mechanicName || !weekKey) {
    resultEl.classList.add('hidden');
    if (postBtn) postBtn.disabled = true;
    return;
  }

  const jobs = mechGetMyLogJobs(mechanicName, weekKey);
  const weekLabel = weekSel.options[weekSel.selectedIndex]?.text || weekKey;

  // Aggregates — each row = 1 repair
  const totalRepairs = jobs.length;
  const totalAcross = jobs.reduce((s, j) => s + (j.across || 0), 0);
  const totalEngines = jobs.reduce((s, j) => s + (j.engineReplacements || 0), 0);
  const basePay = totalRepairs * MECH_PAY_PER_REPAIR;
  const enginePay = mechCalculateEngineValue(totalEngines);
  const totalPayout = basePay + enginePay;

  const tbodyRows = jobs.length
    ? jobs.map((j, i) => {
        const date = j.tsDate && mechIsValidDate(j.tsDate)
          ? mechFmtDate(j.tsDate)
          : j.bestDate ? mechFmtDate(j.bestDate) : '—';
        const engCell = j.engineReplacements > 0
          ? j.engineReplacements + (j.department ? ` (${kEscapeHtml(j.department)})` : '')
          : '—';
        const jobPay = MECH_PAY_PER_REPAIR + mechCalculateEngineValue(j.engineReplacements || 0);
        return `<tr>
          <td>${i + 1}</td>
          <td>${date}</td>
          <td>${j.across || 0}</td>
          <td>${engCell}</td>
          <td>${mechFmtMoney(jobPay)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No jobs found for this week.</td></tr>';

  const engineSummary = totalEngines > 0
    ? ` · ${totalEngines} engine rep${totalEngines !== 1 ? 's' : ''}`
    : '';

  resultEl.innerHTML = `
    <div class="my-log-header">
      <span class="my-log-mech-name">${kEscapeHtml(mechanicName)}</span>
      <span class="my-log-week-label">${kEscapeHtml(weekLabel)}</span>
    </div>
    <div class="table-wrap">
      <table class="table my-log-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Date</th>
            <th>Across</th>
            <th>Engine Reps</th>
            <th>Est. Pay</th>
          </tr>
        </thead>
        <tbody>${tbodyRows}</tbody>
      </table>
    </div>
    <div class="my-log-summary">
      ${totalRepairs} repair${totalRepairs !== 1 ? 's' : ''} &nbsp;·&nbsp;
      ${totalAcross} Across${engineSummary} &nbsp;·&nbsp;
      ${mechFmtMoney(totalPayout)} payout
    </div>
  `;

  resultEl.classList.remove('hidden');
  if (postBtn) postBtn.disabled = false;
}

/**
 * Post the currently displayed log to Discord via the mechanic logs webhook.
 */
async function mechPostMyLogToDiscord() {
  if (typeof kDiscordPostMechanicLog !== 'function') {
    kShowToast('Discord service not loaded', 'error', 3000);
    return;
  }

  const mechSel = document.getElementById('myLogMechanic');
  const weekSel = document.getElementById('myLogWeek');
  const postBtn = document.getElementById('myLogPostBtn');
  if (!mechSel || !weekSel) return;

  const mechanicName = mechSel.value;
  const weekKey = weekSel.value;
  if (!mechanicName || !weekKey) return;

  const weekLabel = weekSel.options[weekSel.selectedIndex]?.text || weekKey;
  const jobs = mechGetMyLogJobs(mechanicName, weekKey);

  const totalRepairs = jobs.length;
  const totalAcross = jobs.reduce((s, j) => s + (j.across || 0), 0);
  const totalEngines = jobs.reduce((s, j) => s + (j.engineReplacements || 0), 0);
  const basePay = totalRepairs * MECH_PAY_PER_REPAIR;
  const enginePay = mechCalculateEngineValue(totalEngines);
  const totalPayout = basePay + enginePay;

  const jobLines = jobs.map((j, i) => {
    const date = j.tsDate && mechIsValidDate(j.tsDate)
      ? mechFmtDate(j.tsDate)
      : j.bestDate ? mechFmtDate(j.bestDate) : '—';
    let line = `${i + 1}. ${date} — ${j.across} across`;
    if (j.engineReplacements > 0) {
      line += ` · ${j.engineReplacements} Engine Rep${j.engineReplacements !== 1 ? 's' : ''}`;
      if (j.department) line += ` (${j.department})`;
    }
    return line;
  });

  const originalText = postBtn ? postBtn.textContent : '';
  if (postBtn) { postBtn.disabled = true; postBtn.textContent = 'Posting…'; }

  const ok = await kDiscordPostMechanicLog({
    mechanicName,
    weekLabel,
    totalRepairs,
    totalAcross,
    totalEngines,
    totalPayout,
    jobLines
  });

  if (postBtn) { postBtn.disabled = false; postBtn.textContent = originalText; }

  if (ok) {
    kShowToast('✅ Log posted to Discord!', 'success', 3000);
  } else {
    kShowToast(
      'Failed to post. Configure the Mechanic Logs webhook URL in Settings (⚙️).',
      'error',
      5000
    );
  }
}

// ===== Interaction =====
function mechOnTableClick(e) {
  const tr = e.target.closest("tr");
  if (!tr || !tr.dataset.mechanic) return;
  const name = tr.dataset.mechanic;
  if (mechanicFilterEl) {
    mechanicFilterEl.value = name;
  }
  mechApplyFiltersAndRender();
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  statusEl = document.getElementById("status");
  mechanicsBody = document.getElementById("mechanicsBody");
  mechanicFilterEl = document.getElementById("mechanicFilter");
  timeFilterEl = document.getElementById("timeFilter");
  sortByEl = document.getElementById("sortBy");
  searchBoxEl = document.getElementById("searchBox");

  sumTotalMechanicsEl = document.getElementById("sumTotalMechanics");
  sumTotalMechanicsSubEl = document.getElementById("sumTotalMechanicsSub");
  sumTotalRepairsEl = document.getElementById("sumTotalRepairs");
  sumTotalRepairsSubEl = document.getElementById("sumTotalRepairsSub");
  sumTotalPayoutEl = document.getElementById("sumTotalPayout");
  sumTotalPayoutSubEl = document.getElementById("sumTotalPayoutSub");
  sumActivityRangeEl = document.getElementById("sumActivityRange");
  sumActivityRangeSubEl = document.getElementById("sumActivityRangeSub");

  detailTitleEl = document.getElementById("detailTitle");
  detailSubtitleEl = document.getElementById("detailSubtitle");
  mechanicDetailEl = document.getElementById("mechanicDetail");
  mechanicsTableSubEl = document.getElementById("mechanicsTableSub");

  weeklySummarySubtitleEl = document.getElementById("weeklySummarySubtitle");
  weeklySummaryContentEl = document.getElementById("weeklySummaryContent");

  if (mechanicsBody) {
    mechanicsBody.addEventListener("click", mechOnTableClick);
  }
  if (mechanicFilterEl) {
    mechanicFilterEl.addEventListener("change", mechApplyFiltersAndRender);
  }
  if (timeFilterEl) {
    timeFilterEl.addEventListener("change", mechApplyFiltersAndRender);
  }
  if (sortByEl) {
    sortByEl.addEventListener("change", mechApplyFiltersAndRender);
  }
  if (searchBoxEl) {
    // Debounce search for better performance
    const debouncedSearch = kDebounce(mechApplyFiltersAndRender, 300);
    searchBoxEl.addEventListener("input", debouncedSearch);
  }

  mechLoad();
});
