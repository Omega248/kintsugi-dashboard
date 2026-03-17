// ===== Config (values sourced from constants.js) =====
const MECH_JOBS_SHEET         = KINTSUGI_CONFIG.SHEETS.JOBS;
const MECH_STATE_ID_SHEET     = KINTSUGI_CONFIG.SHEETS.STATE_IDS;
const MECH_PAY_PER_REPAIR     = PAYMENT_RATES.PAY_PER_REPAIR;
const MECH_ENGINE_REIMBURSEMENT = PAYMENT_RATES.ENGINE_REIMBURSEMENT;
const MECH_ENGINE_BONUS_LSPD  = PAYMENT_RATES.ENGINE_BONUS_LSPD;
const MECH_HARNESS_RATE       = PAYMENT_RATES.HARNESS_RATE;
const MECH_ADVANCED_REPAIR_KIT_RATE = PAYMENT_RATES.ADVANCED_REPAIR_KIT_RATE;

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
function mechCalculateEngineValue(engineCount, isLspd) {
  // LSPD: $12k reimbursement + $1.5k bonus; all others: $12k reimbursement only
  return engineCount * (MECH_ENGINE_REIMBURSEMENT + (isLspd ? MECH_ENGINE_BONUS_LSPD : 0));
}

// ===== Date helpers =====
function mechFmtDate(d) {
  if (!kIsValidDate(d)) return "–";
  // Using UK format (DD/MM/YY) for this page
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function mechFmtMoney(amount) {
  // Using US format ($) for this page
  return "$" + (amount || 0).toLocaleString("en-US");
}

function mechGetBestDate(job) {
  const candidates = [job.tsDate, job.weekEnd, job.monthEnd];
  for (const d of candidates) {
    if (kIsValidDate(d)) return d;
  }
  return null;
}

// derive ISO week key (year-week) from a date
function mechWeekKeyFromDate(d) {
  if (!kIsValidDate(d)) return null;
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function mechMonthKeyFromDate(d) {
  if (!kIsValidDate(d)) return null;
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
    if (!kIsValidDate(d)) continue;
    
    // Use week ending date if available, otherwise calculate week key
    let weekKey;
    let weekEndDate;
    
    if (j.weekEnd && kIsValidDate(j.weekEnd)) {
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
        acrossPD: 0,
        acrossCiv: 0,
        engineReplacements: 0,
        civEngineReplacements: 0,
        enginePayTotal: 0,
        harnessPD: 0,
        harnessCiv: 0,
        advKitPD: 0,
        advKitCiv: 0,
        harnessKitPayTotal: 0,
        jobs: []
      };
      weekMap.set(weekKey, weekRec);
    }
    
    weekRec.totalRepairs += j.across || 0;
    weekRec.acrossPD = (weekRec.acrossPD || 0) + (j.acrossPD || 0);
    weekRec.acrossCiv = (weekRec.acrossCiv || 0) + (j.acrossCiv || 0);
    weekRec.engineReplacements += j.engineReplacements || 0;
    weekRec.civEngineReplacements = (weekRec.civEngineReplacements || 0) + (j.civEngineReplacements || 0);
    // Accumulate engine pay per job, applying the $1,500 bonus only for LSPD
    const isLspd = (j.department || "").toUpperCase() === "LSPD";
    weekRec.enginePayTotal += mechCalculateEngineValue(j.engineReplacements || 0, isLspd)
                            + mechCalculateEngineValue(j.civEngineReplacements || 0, false); // CIV engines never get the bonus
    weekRec.harnessPD += j.harnessPD || 0;
    weekRec.harnessCiv += j.harnessCiv || 0;
    weekRec.advKitPD += j.advKitPD || 0;
    weekRec.advKitCiv += j.advKitCiv || 0;
    weekRec.harnessKitPayTotal += j.harnessKitPay || 0;
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
  
  // Calculate payouts (include both PD and CIV engine replacements, plus harness and kits)
  for (const week of weeklyStats) {
    const basePay = week.totalRepairs * MECH_PAY_PER_REPAIR;
    week.totalPayout = basePay + (week.enginePayTotal || 0) + (week.harnessKitPayTotal || 0);
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
        totalHarnessKitPay: 0,
        weeksWorkedSet: new Set(),
        monthsActiveSet: new Set(),
        firstJob: null,
        lastJob: null,
      };
      map.set(mech, rec);
    }

    const across = j.across || 0;
    rec.totalRepairs += across;
    rec.totalHarnessKitPay += j.harnessKitPay || 0;

    // choose best valid date for this job
    const d = j.bestDate;
    if (kIsValidDate(d)) {
      const weekKey =
        j.weekEnd && kIsValidDate(j.weekEnd)
          ? j.weekEnd.toISOString().slice(0, 10)
          : mechWeekKeyFromDate(d);
      if (weekKey) rec.weeksWorkedSet.add(weekKey);

      const monthKey =
        j.monthEnd && kIsValidDate(j.monthEnd)
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
    const totalPayout = rec.totalRepairs * MECH_PAY_PER_REPAIR + (rec.totalHarnessKitPay || 0);

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
  const totalPayout = stats.reduce((sum, r) => sum + (r.totalPayout || 0), 0);

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
    sumTotalPayoutSubEl.textContent = `Assuming $${MECH_PAY_PER_REPAIR.toLocaleString(
      "en-US"
    )} per repair.`;
  }

  if (sumActivityRangeEl) {
    if (kIsValidDate(globalEarliest) && kIsValidDate(globalLatest)) {
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
    if (week.acrossCiv > 0) {
      mechAddSummaryRow(card, "Repairs (PD)", (week.acrossPD || 0).toString());
      mechAddSummaryRow(card, "Repairs (CIV)", (week.acrossCiv || 0).toString());
      mechAddSummaryRow(card, "Total Repairs", week.totalRepairs.toString());
    } else {
      mechAddSummaryRow(card, "Repairs", week.totalRepairs.toString());
    }
    const totalEngines = (week.engineReplacements || 0) + (week.civEngineReplacements || 0);
    if (totalEngines > 0) {
      if (week.civEngineReplacements > 0) {
        mechAddSummaryRow(card, "Engine Replacements (PD)", (week.engineReplacements || 0).toString());
        mechAddSummaryRow(card, "Engine Replacements (CIV)", (week.civEngineReplacements || 0).toString());
      } else {
        mechAddSummaryRow(card, "Engine Replacements", totalEngines.toString());
      }
      const engineValue = week.enginePayTotal || 0;
      mechAddSummaryRow(card, "Engine Value", mechFmtMoney(engineValue));
    }

    const totalHarness = (week.harnessPD || 0) + (week.harnessCiv || 0);
    if (totalHarness > 0) {
      if ((week.harnessCiv || 0) > 0 && (week.harnessPD || 0) > 0) {
        mechAddSummaryRow(card, "Harness (PD)", (week.harnessPD || 0).toString());
        mechAddSummaryRow(card, "Harness (CIV)", (week.harnessCiv || 0).toString());
      } else {
        mechAddSummaryRow(card, "Harness", totalHarness.toString());
      }
    }

    const totalAdvKit = (week.advKitPD || 0) + (week.advKitCiv || 0);
    if (totalAdvKit > 0) {
      if ((week.advKitCiv || 0) > 0 && (week.advKitPD || 0) > 0) {
        mechAddSummaryRow(card, "Advanced Repair Kits (PD)", (week.advKitPD || 0).toString());
        mechAddSummaryRow(card, "Advanced Repair Kits (CIV)", (week.advKitCiv || 0).toString());
      } else {
        mechAddSummaryRow(card, "Advanced Repair Kits", totalAdvKit.toString());
      }
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
  if ((week.acrossCiv || 0) > 0) {
    summary += `Repairs (PD): ${week.acrossPD || 0}\n`;
    summary += `Repairs (CIV): ${week.acrossCiv || 0}\n`;
    summary += `Total Repairs: ${week.totalRepairs}\n`;
  } else {
    summary += `Repairs: ${week.totalRepairs}\n`;
  }
  const totalEngines = (week.engineReplacements || 0) + (week.civEngineReplacements || 0);
  if (totalEngines > 0) {
    if ((week.civEngineReplacements || 0) > 0) {
      summary += `Engine Replacements (PD): ${week.engineReplacements || 0}\n`;
      summary += `Engine Replacements (CIV): ${week.civEngineReplacements || 0}\n`;
    } else {
      summary += `Engine Replacements: ${totalEngines}\n`;
    }
    const engineValue = week.enginePayTotal || 0;
    summary += `Engine Reimbursement: ${mechFmtMoney(engineValue)}\n`;
  }

  const totalHarness = (week.harnessPD || 0) + (week.harnessCiv || 0);
  if (totalHarness > 0) {
    if ((week.harnessCiv || 0) > 0 && (week.harnessPD || 0) > 0) {
      summary += `Harness (PD): ${week.harnessPD || 0}\n`;
      summary += `Harness (CIV): ${week.harnessCiv || 0}\n`;
    } else {
      summary += `Harness: ${totalHarness}\n`;
    }
  }

  const totalAdvKit = (week.advKitPD || 0) + (week.advKitCiv || 0);
  if (totalAdvKit > 0) {
    if ((week.advKitCiv || 0) > 0 && (week.advKitPD || 0) > 0) {
      summary += `Advanced Repair Kits (PD): ${week.advKitPD || 0}\n`;
      summary += `Advanced Repair Kits (CIV): ${week.advKitCiv || 0}\n`;
    } else {
      summary += `Advanced Repair Kits: ${totalAdvKit}\n`;
    }
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
    if ((week.acrossCiv || 0) > 0) {
      summary += `  Repairs (PD): ${week.acrossPD || 0}\n`;
      summary += `  Repairs (CIV): ${week.acrossCiv || 0}\n`;
      summary += `  Total Repairs: ${week.totalRepairs}\n`;
    } else {
      summary += `  Repairs: ${week.totalRepairs}\n`;
    }
    const totalEngines = (week.engineReplacements || 0) + (week.civEngineReplacements || 0);
    if (totalEngines > 0) {
      if ((week.civEngineReplacements || 0) > 0) {
        summary += `  Engine Replacements (PD): ${week.engineReplacements || 0}\n`;
        summary += `  Engine Replacements (CIV): ${week.civEngineReplacements || 0}\n`;
      } else {
        summary += `  Engine Replacements: ${totalEngines}\n`;
      }
    }

    const weekHarness = (week.harnessPD || 0) + (week.harnessCiv || 0);
    if (weekHarness > 0) {
      if ((week.harnessCiv || 0) > 0 && (week.harnessPD || 0) > 0) {
        summary += `  Harness (PD): ${week.harnessPD || 0}\n`;
        summary += `  Harness (CIV): ${week.harnessCiv || 0}\n`;
      } else {
        summary += `  Harness: ${weekHarness}\n`;
      }
    }

    const weekAdvKit = (week.advKitPD || 0) + (week.advKitCiv || 0);
    if (weekAdvKit > 0) {
      if ((week.advKitCiv || 0) > 0 && (week.advKitPD || 0) > 0) {
        summary += `  Advanced Repair Kits (PD): ${week.advKitPD || 0}\n`;
        summary += `  Advanced Repair Kits (CIV): ${week.advKitCiv || 0}\n`;
      } else {
        summary += `  Advanced Repair Kits: ${weekAdvKit}\n`;
      }
    }
    summary += `  Payout: ${mechFmtMoney(week.totalPayout)}\n\n`;
    
    totalRepairs += week.totalRepairs;
    totalEngineReplacements += totalEngines;
    totalPayout += week.totalPayout;
  }
  
  let totalHarness = 0;
  let totalAdvKit = 0;
  for (const week of weeklyStats) {
    totalHarness += (week.harnessPD || 0) + (week.harnessCiv || 0);
    totalAdvKit += (week.advKitPD || 0) + (week.advKitCiv || 0);
  }

  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `TOTALS:\n`;
  summary += `Total Repairs: ${totalRepairs}\n`;
  if (totalEngineReplacements > 0) {
    summary += `Total Engine Replacements: ${totalEngineReplacements}\n`;
  }
  if (totalHarness > 0) {
    summary += `Total Harness: ${totalHarness}\n`;
  }
  if (totalAdvKit > 0) {
    summary += `Total Advanced Repair Kits: ${totalAdvKit}\n`;
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
      kFetchCSV(MECH_STATE_ID_SHEET),
      kFetchCSV(MECH_JOBS_SHEET),
    ]);

    mechBuildStateIdMap(stateRows);

    if (!data.length || data.length < 2) {
      throw new Error("No rows in Form responses 1.");
    }

    const headers = data[0].map((h) => (h || "").trim());
    const headersLower = headers.map((h) => h.toLowerCase());

    const iTime = headers.indexOf("Timestamp");
    const iMech = headers.indexOf("Mechanic");
    const iWeek = headers.indexOf("Week Ending");
    const iMonth = headers.indexOf("Month Ending");

    // Dual-column detection matching payouts-script.js:
    // PD repairs: "How many Across PD?" (contains "across" AND "pd")
    const iAcrossPD = headersLower.findIndex(
      (h) => h.includes("across") && h.includes("pd")
    );
    // CIV repairs: "How many Across" (contains "across" but NOT "pd")
    const iAcrossCiv = headersLower.findIndex(
      (h) => h.includes("across") && !h.includes("pd")
    );

    // "Did you buy the engine replacement..." payer column — detect first so we
    // can exclude it from the engine-count column searches.
    const iEnginePayer = headersLower.findIndex(
      (h) => h.includes("did you buy") || (h.includes("kintsugi") && h.includes("pay"))
    );

    // First "Engine Replacement?" column → PD (exclude the payer question)
    const iEngine = headersLower.findIndex(
      (h, i) => i !== iEnginePayer && h.includes("engine") && h.includes("replacement")
    );

    // Second "Engine Replacement?" column → CIV (after PD column, exclude payer)
    const iEngineCiv =
      iEngine !== -1
        ? headersLower.findIndex(
            (h, i) => i > iEngine && i !== iEnginePayer && h.includes("engine") && h.includes("replacement")
          )
        : -1;

    // "PD Repair" yes/no column — used to classify CIV-only jobs
    const iPDRepair = headersLower.findIndex(
      (h) => h === "pd repair" || (h.includes("pd") && h.includes("repair") && !h.includes("across") && !h.includes("kit"))
    );

    // Find department column
    const iDept = headersLower.findIndex(
      (h) => h.includes("department")
    );

    // Harness columns: "Harness (PD)" and "Harness (CIV)"
    const iHarnessPD  = headersLower.findIndex((h) => h.includes("harness") && h.includes("pd"));
    const iHarnessCiv = headersLower.findIndex((h) => h.includes("harness") && !h.includes("pd"));

    // Advanced Repair Kit columns: "Advanced Repair Kits (PD)" and "Advanced Repair Kits (CIV)"
    const iAdvKitPD  = headersLower.findIndex((h) => h.includes("advanced") && h.includes("kit") && h.includes("pd"));
    const iAdvKitCiv = headersLower.findIndex((h) => h.includes("advanced") && h.includes("kit") && !h.includes("pd"));

    if (iTime === -1 || iMech === -1 || (iAcrossPD === -1 && iAcrossCiv === -1)) {
      throw new Error(
        'Missing expected columns. Need at least "Timestamp", "Mechanic", and either "How many Across PD?" or "How many Across" column.'
      );
    }

    const jobs = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const mech = iMech !== -1 ? String(row[iMech] || "").trim() : "";
      if (!mech) continue;

      // PD and CIV repair counts
      const acrossPD = iAcrossPD !== -1 ? (parseInt(row[iAcrossPD] || 0, 10) || 0) : 0;
      const acrossCiv = iAcrossCiv !== -1 ? (parseInt(row[iAcrossCiv] || 0, 10) || 0) : 0;
      const across = acrossPD + acrossCiv;

      // Harness and Advanced Repair Kit counts
      const harnessPD  = iHarnessPD  !== -1 ? (parseInt(row[iHarnessPD]  || 0, 10) || 0) : 0;
      const harnessCiv = iHarnessCiv !== -1 ? (parseInt(row[iHarnessCiv] || 0, 10) || 0) : 0;
      const advKitPD  = iAdvKitPD  !== -1 ? (parseInt(row[iAdvKitPD]  || 0, 10) || 0) : 0;
      const advKitCiv = iAdvKitCiv !== -1 ? (parseInt(row[iAdvKitCiv] || 0, 10) || 0) : 0;
      const totalHarness = harnessPD + harnessCiv;
      const totalAdvKit = advKitPD + advKitCiv;

      if (!across && !totalHarness && !totalAdvKit) continue;

      // PD engine replacements (first "Engine Replacement?" column)
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

      // CIV engine replacements (second "Engine Replacement?" column)
      let civEngineCount = 0;
      if (iEngineCiv !== -1) {
        const rawEngineCiv = (row[iEngineCiv] || "").trim();
        if (rawEngineCiv) {
          const num = Number(rawEngineCiv);
          if (!Number.isNaN(num) && num > 0) {
            civEngineCount = num;
          } else if (/^(yes|y|true)$/i.test(rawEngineCiv)) {
            civEngineCount = 1;
          }
        }
      }
      
      let dept = iDept !== -1 ? (row[iDept] || "").trim() : "";

      // Classify CIV-only jobs: "PD Repair" = "No" (or dept empty + CIV-only)
      if (!dept) {
        const pdRepairFlag = iPDRepair !== -1 ? (row[iPDRepair] || "").trim().toLowerCase() : "";
        if (pdRepairFlag === "no" || (acrossCiv > 0 && acrossPD === 0)) {
          dept = "CIV";
        }
      }

      const tsRaw = iTime !== -1 ? row[iTime] : "";
      const weekRaw = iWeek !== -1 ? row[iWeek] : "";
      const monthRaw = iMonth !== -1 ? row[iMonth] : "";

      const tsDate = tsRaw ? kParseDateLike(tsRaw) : null;
      const weekEnd = weekRaw ? kParseDateLike(weekRaw) : null;
      const monthEnd = monthRaw ? kParseDateLike(monthRaw) : null;
      const bestDate = mechGetBestDate({ tsDate, weekEnd, monthEnd });

      jobs.push({
        mechanic: mech,
        across,
        acrossPD,
        acrossCiv,
        engineReplacements: engineCount,
        civEngineReplacements: civEngineCount,
        harnessPD,
        harnessCiv,
        advKitPD,
        advKitCiv,
        harnessKitPay: totalHarness * MECH_HARNESS_RATE + totalAdvKit * MECH_ADVANCED_REPAIR_KIT_RATE,
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

    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    console.error(err);
    if (statusEl) {
      statusEl.textContent =
        "Failed to load mechanic stats. Check sheet sharing and column names.";
    }
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
