// ===== Config (using KINTSUGI_SHEET_ID from kintsugi-core.js) =====
const ORDERS_SHEET = "Orders";
const DEPUTIES_SHEET = "Deputies";

// ===== State =====
let weeklyAgg = [];   // mechanic-week aggregates
let monthlyAgg = [];  // month aggregates
let jobs = [];        // raw jobs
let mechanicLatestWeekISO = null; // latest week for current mechanic summary

let mechanics = new Set();
let departments = new Set(); // for Department filter
let monthKeys = new Set(); // for Month Ending filter
let weekKeys = new Set();  // for Week Ending filter
let monthKeyToDate = new Map(); // mKey -> monthEnd Date

let currentView = "weekly";
let weekSortDesc = true;   // newest week first
let monthSortDesc = true;  // newest month first

// mechanic -> state ID
const stateIdByMechanic = new Map();

// DOM refs
let statusEl;
let weeklySummaryEl;
let exportBtn;
let sortWeekBtn;
let sortMonthBtn;
let weeklyBody;
let monthlyBody;
let jobsBody;
let jobsSearchInput;
let ownerFilterInput;
let plateFilterInput;
let advancedFiltersPanel;
let advancedToggleBtn;

// URL params on first load
let initialParams = null;

// ===== CSV fetch (using kintsugi-core.js) =====
async function fetchCSV(sheet) {
  return await kFetchCSV(sheet, { header: false });
}

// ===== Date helpers (using kintsugi-core.js) =====
function parseDateLike(raw) {
  return kParseDateLike(raw);
}

function fmtDate(d) {
  return kFmtDate(d);
}

function fmtMoney(n) {
  return kFmtMoney(n);
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Weekly order comment helper
function commentForWeek(weekEndDate) {
  return `Orders for week ending ${fmtDate(weekEndDate)}`;
}

// Generate copy summary for a weekly payout entry
function generateWeeklyCopySummary(mechanic, weekEndDate, repairs, engineReplacementsByDept, totalPayout) {
  const stateId = stateIdByMechanic.get(mechanic) || "N/A";
  const weekEndStr = fmtDate(weekEndDate);
  const engineReplacements = Object.values(engineReplacementsByDept).reduce((sum, count) => sum + count, 0);
  const enginePay = calculateEnginePayment(engineReplacementsByDept);
  
  let summary = `Kaneshiro Enterprises - Weekly Orders\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `Deputy: ${mechanic}\n`;
  summary += `State ID: ${stateId}\n`;
  summary += `Week Ending: ${weekEndStr}\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `Orders: ${repairs}\n`;
  
  if (engineReplacements > 0) {
    summary += `Special Orders: ${engineReplacements}\n`;
    summary += `Additional Amount: ${fmtMoney(enginePay)}\n`;
  }
  
  summary += `Total Amount: ${fmtMoney(totalPayout)}\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  return summary;
}

// Copy weekly payout summary to clipboard
async function copyWeeklySummary(btn, mechanic, weekEndDate, repairs, engineReplacementsByDept, totalPayout) {
  const summary = generateWeeklyCopySummary(mechanic, weekEndDate, repairs, engineReplacementsByDept, totalPayout);
  
  // Use existing helper function from payout-helpers.js
  const success = await kCopyToClipboard(summary);
  
  if (success) {
    // Show success feedback
    const originalText = btn.textContent;
    btn.textContent = "Copied!";
    btn.classList.add("btn-success");
    btn.disabled = true;
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove("btn-success");
      btn.disabled = false;
    }, 1500);
    
    // Show toast notification
    if (typeof kShowToast === "function") {
      kShowToast("✓ Order summary copied to clipboard!", "success", 2000);
    }
  } else {
    // Show error feedback
    if (typeof kShowToast === "function") {
      kShowToast("✗ Failed to copy summary", "error", 3000);
    }
  }
}

// Calculate engine replacement billing value by department
function calculateEngineValue(engineReplacementsByDept) {
  let totalValue = 0;
  for (const dept in engineReplacementsByDept) {
    const count = engineReplacementsByDept[dept];
    const rate = (dept === "BCSO") ? ENGINE_REPLACEMENT_RATE_BCSO : ENGINE_REPLACEMENT_RATE;
    totalValue += count * rate;
  }
  return totalValue;
}

// Calculate mechanic pay for engine replacements by department
// BCSO: $12k reimbursement only (no bonus)
// LSPD: $12k reimbursement + $1.5k bonus
// Other: $12k reimbursement + $1.5k bonus
function calculateEnginePayment(engineReplacementsByDept) {
  let enginePay = 0;
  if (!engineReplacementsByDept) return 0;
  
  const bcsoEngines = engineReplacementsByDept["BCSO"] || 0;
  const lspdEngines = engineReplacementsByDept["LSPD"] || 0;
  
  // Calculate total for other departments
  let otherEngines = 0;
  for (const dept in engineReplacementsByDept) {
    if (dept !== "BCSO" && dept !== "LSPD") {
      otherEngines += engineReplacementsByDept[dept] || 0;
    }
  }
  
  // BCSO: reimbursement only
  enginePay += bcsoEngines * ENGINE_REIMBURSEMENT;
  // LSPD: reimbursement + bonus
  enginePay += lspdEngines * (ENGINE_REIMBURSEMENT + ENGINE_BONUS_LSPD);
  // Other: reimbursement + bonus
  enginePay += otherEngines * (ENGINE_REIMBURSEMENT + ENGINE_BONUS_LSPD);
  
  return enginePay;
}

// ===== CSV export helpers (using kintsugi-core.js) =====
function toCsv(cols, rows) {
  return kToCsv(cols, rows);
}

function downloadCsv(filename, csv) {
  kDownloadCsv(filename, csv);
}

// ===== State ID helpers =====
function buildStateIdMap(stateRows) {
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

function labelWithStateId(mech) {
  const sid = stateIdByMechanic.get(mech);
  return sid ? `${mech} - ${sid}` : mech;
}

// ===== Load & aggregate =====
async function loadPayouts() {
  try {
    if (statusEl) statusEl.textContent = "";

    // Load Deputies sheet for state IDs (optional) and orders
    const [deputiesRows, data] = await Promise.all([
      fetchCSV(DEPUTIES_SHEET).catch(() => []),
      fetchCSV(ORDERS_SHEET),
    ]);

    if (deputiesRows && deputiesRows.length > 0) {
      buildStateIdMap(deputiesRows);
    }

    if (data.length < 2) throw new Error("No rows in Orders sheet.");

    const headers = data[0].map((h) => h.trim());
    const headersLower = headers.map((h) => h.toLowerCase());

    // Find columns by flexible matching
    const iTime = headersLower.findIndex((h) => h.includes("time") || h.includes("date"));
    const iMech = headersLower.findIndex((h) => h.includes("deputy") || h.includes("mechanic") || h.includes("name"));
    const iOwner = headersLower.findIndex((h) => h.includes("owner") || h.includes("customer"));
    const iPlate = headersLower.findIndex((h) => h.includes("plate") || h.includes("id"));
    const iAcross = headersLower.findIndex((h) => h.includes("quantity") || h.includes("qty") || h.includes("across") || h.includes("amount"));
    const iWeek = headersLower.findIndex((h) => h.includes("week"));
    const iMonth = headersLower.findIndex((h) => h.includes("month"));
    const iEngine = headersLower.findIndex((h) => h.includes("engine") && h.includes("replacement"));
    const iDept = headersLower.findIndex((h) => h.includes("department") || h.includes("agency"));

    // For Orders sheet, we need at least deputy/name and quantity
    if (iMech === -1 || iAcross === -1) {
      throw new Error("Missing required columns (Deputy and Quantity).");
    }

    weeklyAgg = [];
    monthlyAgg = [];
    jobs = [];
    mechanics.clear();
    departments.clear();
    monthKeys.clear();
    weekKeys.clear();
    monthKeyToDate.clear();

    const weeklyMap = new Map();   // mech|weekISO -> agg
    const monthlyMap = new Map();  // mKey -> agg

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row || !row.length) continue;

      const mech = (row[iMech] || "").trim();
      if (!mech) continue;

      const across = Number(row[iAcross] || "0") || 0;
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

      const weekEnd = parseDateLike(row[iWeek]);
      const monthEnd = parseDateLike(row[iMonth]);
      if (!weekEnd || !monthEnd) continue;

      const tsRaw = iTime !== -1 ? (row[iTime] || "").trim() : "";
      const tsDate = tsRaw ? parseDateLike(tsRaw) || new Date(tsRaw) : null;
      const owner = iOwner !== -1 ? (row[iOwner] || "").trim() : "";
      const plate = iPlate !== -1 ? (row[iPlate] || "").trim() : "";
      const dept = iDept !== -1 ? (row[iDept] || "").trim() : "";

      mechanics.add(mech);
      if (dept) departments.add(dept);

      const mKey = monthKey(monthEnd);
      monthKeys.add(mKey);
      monthKeyToDate.set(mKey, monthEnd);

      const weekISO = weekEnd.toISOString().slice(0, 10);
      weekKeys.add(weekISO);

      // Weekly agg for mechanic+week
      const wKey = `${mech}|${weekISO}`;
      const w =
        weeklyMap.get(wKey) || {
          mechanic: mech,
          weekEnd,
          weekISO,
          mKey,
          repairs: 0,
          engineReplacements: 0,
          engineReplacementsByDept: {}, // track engine replacements by department
        };
      w.repairs += across;
      w.engineReplacements += engineCount;
      if (engineCount > 0 && dept) {
        w.engineReplacementsByDept[dept] = (w.engineReplacementsByDept[dept] || 0) + engineCount;
      }
      weeklyMap.set(wKey, w);

      // Monthly agg
      const mAgg =
        monthlyMap.get(mKey) || {
          monthEnd,
          mKey,
          repairs: 0,
          engineReplacements: 0,
          engineReplacementsByDept: {}, // track engine replacements by department
        };
      mAgg.repairs += across;
      mAgg.engineReplacements += engineCount;
      if (engineCount > 0 && dept) {
        mAgg.engineReplacementsByDept[dept] = (mAgg.engineReplacementsByDept[dept] || 0) + engineCount;
      }
      monthlyMap.set(mKey, mAgg);

      // Jobs table
      jobs.push({
        tsDate,
        mechanic: mech,
        owner,
        plate,
        across,
        engineReplacements: engineCount,
        department: dept,
        weekEnd,
        weekISO,
        monthEnd,
        mKey,
      });
    }

    weeklyAgg = Array.from(weeklyMap.values());
    monthlyAgg = Array.from(monthlyMap.values());
    jobs.sort((a, b) => {
      if (b.weekEnd - a.weekEnd !== 0) return b.weekEnd - a.weekEnd;
      if (a.tsDate && b.tsDate) return b.tsDate - a.tsDate;
      return 0;
    });

    populateFilters();
    applyFiltersFromUrl();
    renderAll();

    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = "";
  }
}

// ===== Filters =====
function populateFilters() {
  const mechSel = document.getElementById("mechanicFilter");
  const deptSel = document.getElementById("departmentFilter");
  const weekSel = document.getElementById("weekFilter");
  const monthSel = document.getElementById("monthFilter");

  if (mechSel) {
    mechSel.innerHTML = '<option value="all">All Mechanics</option>';
    Array.from(mechanics)
      .sort()
      .forEach((m) => {
        mechSel.innerHTML += `<option value="${m}">${m}</option>`;
      });
  }

  if (deptSel) {
    deptSel.innerHTML = '<option value="all">All Departments</option>';
    Array.from(departments)
      .sort()
      .forEach((d) => {
        deptSel.innerHTML += `<option value="${d}">${d}</option>`;
      });
  }

  if (weekSel) {
    weekSel.innerHTML = '<option value="all">All Weeks</option>';
    Array.from(weekKeys)
      .sort((a, b) => new Date(b) - new Date(a)) // newest first
      .forEach((iso) => {
        const d = new Date(iso);
        weekSel.innerHTML += `<option value="${iso}">${fmtDate(d)}</option>`;
      });
  }

  if (monthSel) {
    monthSel.innerHTML = '<option value="all">All Months</option>';
    Array.from(monthKeys)
      .sort(
        (a, b) => monthKeyToDate.get(b) - monthKeyToDate.get(a)
      )
      .forEach((key) => {
        const d = monthKeyToDate.get(key);
        monthSel.innerHTML += `<option value="${key}">${fmtDate(d)}</option>`;
      });
  }
}

function getFilters() {
  const mechSel = document.getElementById("mechanicFilter");
  const deptSel = document.getElementById("departmentFilter");
  const weekSel = document.getElementById("weekFilter");
  const monthSel = document.getElementById("monthFilter");
  return {
    mech: mechSel ? mechSel.value : "all",
    dept: deptSel ? deptSel.value : "all",
    week: weekSel ? weekSel.value : "all",
    month: monthSel ? monthSel.value : "all",
  };
}

// ===== Weekly view =====
function renderWeekly() {
  const { mech, dept, week } = getFilters(); // month ignored in weekly
  
  // Use document fragment for better performance
  const fragment = document.createDocumentFragment();
  
  weeklyBody.innerHTML = "";

  // Filter jobs first by department if needed
  let filteredJobs = jobs;
  if (dept !== "all") {
    filteredJobs = jobs.filter((j) => j.department === dept);
  }
  if (mech !== "all") {
    filteredJobs = filteredJobs.filter((j) => j.mechanic === mech);
  }
  if (week !== "all") {
    filteredJobs = filteredJobs.filter((j) => j.weekISO === week);
  }

  // Re-aggregate filtered jobs by mechanic+week
  const weeklyMap = new Map();
  filteredJobs.forEach((j) => {
    const wKey = `${j.mechanic}|${j.weekISO}`;
    const w = weeklyMap.get(wKey) || {
      mechanic: j.mechanic,
      weekEnd: j.weekEnd,
      weekISO: j.weekISO,
      mKey: j.mKey,
      repairs: 0,
      engineReplacements: 0,
      engineReplacementsByDept: {},
    };
    w.repairs += j.across;
    w.engineReplacements += j.engineReplacements;
    if (j.engineReplacements > 0 && j.department) {
      w.engineReplacementsByDept[j.department] = 
        (w.engineReplacementsByDept[j.department] || 0) + j.engineReplacements;
    }
    weeklyMap.set(wKey, w);
  });

  const filtered = Array.from(weeklyMap.values());

  if (!filtered.length) {
    weeklyBody.innerHTML =
      '<tr><td colspan="5" style="padding:8px; color:#6b7280;">No weekly records for this selection.</td></tr>';
    if (weeklySummaryEl) weeklySummaryEl.textContent = "";
    return;
  }

  const byWeek = new Map();
  filtered.forEach((r) => {
    let bucket = byWeek.get(r.weekISO);
    if (!bucket) {
      bucket = { weekEnd: r.weekEnd, entries: [] };
      byWeek.set(r.weekISO, bucket);
    }
    bucket.entries.push(r);
  });

  const weekBuckets = Array.from(byWeek.values()).sort((a, b) =>
    weekSortDesc ? b.weekEnd - a.weekEnd : a.weekEnd - b.weekEnd
  );

  const summarySource = [];

  weekBuckets.forEach((bucket) => {
    const { weekEnd, entries } = bucket;

    entries.sort((a, b) => a.mechanic.localeCompare(b.mechanic));

    let weekTotal = 0;
    const mechTotals = new Map();

    entries.forEach((r) => {
      const enginePay = calculateEnginePayment(r.engineReplacementsByDept);
      const pay = r.repairs * PAY_PER_REPAIR + enginePay;
      const comment = commentForWeek(r.weekEnd);

      weekTotal += pay;
      mechTotals.set(
        r.mechanic,
        (mechTotals.get(r.mechanic) || 0) + pay
      );

      const mechLabel = labelWithStateId(r.mechanic);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><button class="mech-link" data-mech="${r.mechanic}">${mechLabel}</button></td>
        <td>${fmtDate(r.weekEnd)}</td>
        <td class="col-count">${r.repairs}</td>
        <td class="col-amount amount-in">
          ${fmtMoney(pay)}
          <div class="payout-comment">${comment}</div>
        </td>
        <td class="col-actions">
          <button class="btn btn-copy-summary" 
                  title="Copy payout summary to clipboard"
                  data-mechanic="${r.mechanic}"
                  data-week-end="${r.weekEnd.toISOString()}"
                  data-repairs="${r.repairs}"
                  data-engine-depts='${JSON.stringify(r.engineReplacementsByDept)}'
                  data-total-pay="${pay}">
            📋 Copy
          </button>
        </td>
      `;
      
      fragment.appendChild(tr);
    });

    const totalRow = document.createElement("tr");
    totalRow.className = "week-total-row";

    const mechBreakdown = Array.from(mechTotals.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, pay]) => {
        const label = labelWithStateId(name);
        return `${label}: ${fmtMoney(pay)}`;
      })
      .join(" · ");

    totalRow.innerHTML = `
      <td colspan="5">Total for week ending ${fmtDate(
        weekEnd
      )}${mechBreakdown ? " — " + mechBreakdown : ""}</td>
    `;
    fragment.appendChild(totalRow);

    summarySource.push({ weekEnd, weekTotal, mechTotals });
  });

  // Append all rows at once for better performance
  weeklyBody.appendChild(fragment);
  
  updateWeeklySummary(summarySource);
}

// Summary line above weekly table (currently unused)
function updateWeeklySummary(weekBuckets) {
  if (!weeklySummaryEl) return;
  weeklySummaryEl.textContent = "";
}

// ===== Monthly view =====
function renderMonthly() {
  const { dept, month } = getFilters();
  monthlyBody.innerHTML = "";

  const headerCell = document.getElementById("monthlyTotalHeader");

  // Filter jobs first by department if needed
  let filteredJobs = jobs;
  if (dept !== "all") {
    filteredJobs = jobs.filter((j) => j.department === dept);
  }
  if (month !== "all") {
    filteredJobs = filteredJobs.filter((j) => j.mKey === month);
  }

  // Re-aggregate filtered jobs by month
  const monthlyMap = new Map();
  filteredJobs.forEach((j) => {
    const mAgg = monthlyMap.get(j.mKey) || {
      monthEnd: j.monthEnd,
      mKey: j.mKey,
      repairs: 0,
      engineReplacements: 0,
      engineReplacementsByDept: {},
    };
    mAgg.repairs += j.across;
    mAgg.engineReplacements += j.engineReplacements;
    if (j.engineReplacements > 0 && j.department) {
      mAgg.engineReplacementsByDept[j.department] = 
        (mAgg.engineReplacementsByDept[j.department] || 0) + j.engineReplacements;
    }
    monthlyMap.set(j.mKey, mAgg);
  });

  let rows = Array.from(monthlyMap.values());

  if (!rows.length) {
    monthlyBody.innerHTML =
      '<tr><td colspan="4" style="padding:8px; color:#6b7280;">No monthly records for this selection.</td></tr>';
    if (headerCell) {
      headerCell.textContent = "Total Repair Value ($2,500/repair)";
    }
    return;
  }

  rows.sort((a, b) =>
    monthSortDesc ? b.monthEnd - a.monthEnd : a.monthEnd - b.monthEnd
  );

  let grandTotalValue = 0;

  rows.forEach((r) => {
    const engineReps = r.engineReplacements || 0;
    const engineValue = calculateEngineValue(r.engineReplacementsByDept || {});
    const totalValue = r.repairs * REPAIR_RATE + engineValue;
    grandTotalValue += totalValue;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(r.monthEnd)}</td>
      <td class="col-count">${r.repairs}</td>
      <td class="col-count">${engineReps}</td>
      <td class="col-amount amount-in">${fmtMoney(totalValue)}</td>
    `;
    monthlyBody.appendChild(tr);
  });

  if (headerCell) {
    headerCell.innerHTML = `
      <div>Total Repair Value</div>
      <div class="th-total-amount">${fmtMoney(grandTotalValue)}</div>
    `;
  }
}

// ===== Jobs view =====
function renderJobs() {
  const { mech, dept, week, month } = getFilters();
  jobsBody.innerHTML = "";

  const q =
    (jobsSearchInput && jobsSearchInput.value.trim().toLowerCase()) || "";
  const ownerFilter =
    (ownerFilterInput && ownerFilterInput.value.trim().toLowerCase()) || "";
  const plateFilter =
    (plateFilterInput && plateFilterInput.value.trim().toLowerCase()) || "";

  let rows = jobs.filter((j) => {
    if (mech !== "all" && j.mechanic !== mech) return false;
    if (dept !== "all" && j.department !== dept) return false;
    if (week !== "all" && j.weekISO !== week) return false;
    if (month !== "all" && j.mKey !== month) return false;

    const mechLower = j.mechanic.toLowerCase();
    const ownerLower = j.owner.toLowerCase();
    const plateLower = j.plate.toLowerCase();

    if (
      q &&
      !(
        mechLower.includes(q) ||
        ownerLower.includes(q) ||
        plateLower.includes(q)
      )
    ) {
      return false;
    }

    if (ownerFilter && !ownerLower.includes(ownerFilter)) return false;
    if (plateFilter && !plateLower.includes(plateFilter)) return false;

    return true;
  });

  if (!rows.length) {
    jobsBody.innerHTML =
      '<tr><td colspan="9" style="padding:8px; color:#6b7280;">No jobs for this selection.</td></tr>';
    return;
  }

  // Sort jobs by Month Ending (toggle), then timestamp
  rows = rows.slice().sort((a, b) => {
    if (a.monthEnd && b.monthEnd) {
      const diff = monthSortDesc ? b.monthEnd - a.monthEnd : a.monthEnd - b.monthEnd;
      if (diff !== 0) return diff;
    }
    if (a.tsDate && b.tsDate) {
      return b.tsDate - a.tsDate;
    }
    return 0;
  });

  rows.forEach((j) => {
    const engineReps = j.engineReplacements || 0;
    const engineLabel = engineReps ? "Yes" : "No";
    // Use BCSO rate for BCSO engine replacements, standard rate for others
    const engineRate = (j.department === "BCSO" && engineReps > 0) ? 
                       ENGINE_REPLACEMENT_RATE_BCSO : ENGINE_REPLACEMENT_RATE;
    const totalValue =
      j.across * REPAIR_RATE + engineReps * engineRate;

    const mechLabel = j.mechanic; // keep Jobs view as raw mechanic name

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${j.tsDate ? fmtDate(j.tsDate) : ""}</td>
      <td><button class="mech-link link-btn" data-mech="${j.mechanic}">${mechLabel}</button></td>
      <td><button class="owner-link link-btn" data-owner="${j.owner}">${j.owner}</button></td>
      <td><button class="plate-link link-btn" data-plate="${j.plate}">${j.plate}</button></td>
      <td class="col-count">${j.across}</td>
      <td class="col-count">${engineLabel}</td>
      <td>${fmtDate(j.weekEnd)}</td>
      <td>${fmtDate(j.monthEnd)}</td>
      <td class="col-amount amount-in">${fmtMoney(totalValue)}</td>
    `;
    jobsBody.appendChild(tr);
  });
}

// ===== Mechanic summary helpers =====
function updateMechanicSummary() {
  const summaryBox = document.getElementById("mechanicSummary");
  const nameEl = document.getElementById("mechSummaryName");
  const totalRepairsEl = document.getElementById("mechSummaryTotalRepairs");
  const weeksWorkedEl = document.getElementById("mechSummaryWeeksWorked");
  const avgPerWeekEl = document.getElementById("mechSummaryAvgPerWeek");
  const totalPayoutEl = document.getElementById("mechSummaryTotalPayout");
  const lastJobEl = document.getElementById("mechSummaryLastJob");

  if (!summaryBox || !jobs || !jobs.length) return;

  const { mech } = getFilters();
  if (!mech || mech === "all") {
    summaryBox.classList.add("hidden");
    return;
  }

  const mechJobs = jobs.filter((j) => j.mechanic === mech);
  if (!mechJobs.length) {
    summaryBox.classList.add("hidden");
    return;
  }

  let totalRepairs = 0;
  let totalEngineReps = 0;
  const weekSet = new Set();
  let lastJob = null;
  mechanicLatestWeekISO = null;

  let totalEngineRepsBCSO = 0; // Track BCSO engine replacements separately
  let totalEngineRepsLSPD = 0; // Track LSPD engine replacements separately

  mechJobs.forEach((j) => {
    const rep = Number(j.across || 0) || 0;
    const engines = Number(j.engineReplacements || 0) || 0;
    totalRepairs += rep;
    totalEngineReps += engines;
    
    // Track engine replacements by department
    if (engines > 0) {
      if (j.department === "BCSO") {
        totalEngineRepsBCSO += engines;
      } else if (j.department === "LSPD") {
        totalEngineRepsLSPD += engines;
      }
    }

    if (j.weekISO) {
      weekSet.add(j.weekISO);
      if (!mechanicLatestWeekISO || j.weekISO > mechanicLatestWeekISO) {
        mechanicLatestWeekISO = j.weekISO;
      }
    }

    if (j.tsDate instanceof Date && !isNaN(j.tsDate)) {
      if (!lastJob || j.tsDate > lastJob) {
        lastJob = j.tsDate;
      }
    }
  });

  const weeksWorked = weekSet.size;
  const avgPerWeek = weeksWorked ? totalRepairs / weeksWorked : 0;
  // Calculate engine pay:
  // - BCSO: $12k reimbursement only
  // - LSPD: $12k reimbursement + $1.5k bonus
  // - Other: $12k reimbursement + $1.5k bonus
  const otherEngineReps = totalEngineReps - totalEngineRepsBCSO - totalEngineRepsLSPD;
  const totalPayout =
    totalRepairs * PAY_PER_REPAIR +
    totalEngineRepsBCSO * ENGINE_REIMBURSEMENT +
    totalEngineRepsLSPD * (ENGINE_REIMBURSEMENT + ENGINE_BONUS_LSPD) +
    otherEngineReps * (ENGINE_REIMBURSEMENT + ENGINE_BONUS_LSPD);

  if (nameEl) nameEl.textContent = mech;
  if (totalRepairsEl) totalRepairsEl.textContent = totalRepairs.toLocaleString();
  if (weeksWorkedEl) weeksWorkedEl.textContent = String(weeksWorked);
  if (avgPerWeekEl) avgPerWeekEl.textContent = avgPerWeek.toFixed(1);
  if (totalPayoutEl) totalPayoutEl.textContent = fmtMoney(totalPayout);
  if (lastJobEl) lastJobEl.textContent = lastJob ? fmtDate(lastJob) : "—";

  summaryBox.classList.remove("hidden");
}

function onMechanicClickFromTable(evt) {
  const target = evt.target;
  if (!target) return;

  const mechBtn = target.closest && target.closest(".mech-link");
  const ownerBtn = target.closest && target.closest(".owner-link");
  const plateBtn = target.closest && target.closest(".plate-link");

  const advancedFiltersPanel = document.getElementById("advancedFilters");
  const ownerFilterInput = document.getElementById("ownerFilter");
  const plateFilterInput = document.getElementById("plateFilter");
  const jobsSearchInput = document.getElementById("jobsSearch");

  function openFiltersPanel() {
    if (
      advancedFiltersPanel &&
      advancedFiltersPanel.classList &&
      advancedFiltersPanel.classList.contains("hidden")
    ) {
      advancedFiltersPanel.classList.remove("hidden");
    }
  }

  // Mechanic click → set dropdown + open filters + re-render all views
  if (mechBtn) {
    const mech = mechBtn.dataset.mech || mechBtn.textContent.trim();
    if (!mech) return;

    const mechSel = document.getElementById("mechanicFilter");
    if (mechSel) {
      const has = Array.from(mechSel.options).some((o) => o.value === mech);
      if (has) mechSel.value = mech;
    }

    openFiltersPanel();
    renderAll();
    return;
  }

  // Owner click → set owner filter + open filters + re-render Jobs
  if (ownerBtn) {
    const owner = ownerBtn.dataset.owner || ownerBtn.textContent.trim();
    if (!owner) return;

    if (ownerFilterInput) ownerFilterInput.value = owner;
    if (jobsSearchInput) jobsSearchInput.value = "";

    openFiltersPanel();
    renderJobs();
    return;
  }

  // Plate click → set plate filter + open filters + re-render Jobs
  if (plateBtn) {
    const plate = plateBtn.dataset.plate || plateBtn.textContent.trim();
    if (!plate) return;

    if (plateFilterInput) plateFilterInput.value = plate;
    if (jobsSearchInput) jobsSearchInput.value = "";

    openFiltersPanel();
    renderJobs();
    return;
  }
}

// ===== Export current view =====
function exportCurrentViewCsv() {
  const { mech, dept, week, month } = getFilters();

  if (currentView === "weekly") {
    // Filter jobs by department, mechanic, and week
    let filteredJobs = jobs;
    if (dept !== "all") {
      filteredJobs = filteredJobs.filter((j) => j.department === dept);
    }
    if (mech !== "all") {
      filteredJobs = filteredJobs.filter((j) => j.mechanic === mech);
    }
    if (week !== "all") {
      filteredJobs = filteredJobs.filter((j) => j.weekISO === week);
    }

    // Re-aggregate
    const weeklyMap = new Map();
    filteredJobs.forEach((j) => {
      const wKey = `${j.mechanic}|${j.weekISO}`;
      const w = weeklyMap.get(wKey) || {
        mechanic: j.mechanic,
        weekEnd: j.weekEnd,
        weekISO: j.weekISO,
        repairs: 0,
        engineReplacements: 0,
        engineReplacementsByDept: {},
      };
      w.repairs += j.across;
      w.engineReplacements += j.engineReplacements;
      if (j.engineReplacements > 0 && j.department) {
        w.engineReplacementsByDept[j.department] = 
          (w.engineReplacementsByDept[j.department] || 0) + j.engineReplacements;
      }
      weeklyMap.set(wKey, w);
    });

    const filtered = Array.from(weeklyMap.values());
    if (!filtered.length) return;

    const rows = filtered.map((r) => {
      const enginePay = calculateEnginePayment(r.engineReplacementsByDept);
      const pay = r.repairs * PAY_PER_REPAIR + enginePay;
      const mechLabel = labelWithStateId(r.mechanic);
      const comment = commentForWeek(r.weekEnd);
      return {
        Mechanic: mechLabel,
        "Week Ending": fmtDate(r.weekEnd),
        "# Repairs": r.repairs,
        [`Pay ($${PAY_PER_REPAIR}/repair + engines)`]: pay,
        Comment: comment,
      };
    });

    const cols = [
      "Mechanic",
      "Week Ending",
      "# Repairs",
      `Pay ($${PAY_PER_REPAIR}/repair + engines)`,
      "Comment",
    ];
    downloadCsv("payouts_weekly_filtered.csv", toCsv(cols, rows));
  } else if (currentView === "monthly") {
    // Filter jobs by department and month
    let filteredJobs = jobs;
    if (dept !== "all") {
      filteredJobs = filteredJobs.filter((j) => j.department === dept);
    }
    if (month !== "all") {
      filteredJobs = filteredJobs.filter((j) => j.mKey === month);
    }

    // Re-aggregate
    const monthlyMap = new Map();
    filteredJobs.forEach((j) => {
      const mAgg = monthlyMap.get(j.mKey) || {
        monthEnd: j.monthEnd,
        mKey: j.mKey,
        repairs: 0,
        engineReplacements: 0,
        engineReplacementsByDept: {},
      };
      mAgg.repairs += j.across;
      mAgg.engineReplacements += j.engineReplacements;
      if (j.engineReplacements > 0 && j.department) {
        mAgg.engineReplacementsByDept[j.department] = 
          (mAgg.engineReplacementsByDept[j.department] || 0) + j.engineReplacements;
      }
      monthlyMap.set(j.mKey, mAgg);
    });

    const rows = Array.from(monthlyMap.values());
    if (!rows.length) return;

    const mapped = rows.map((r) => {
      const engineReps = r.engineReplacements || 0;
      const engineValue = calculateEngineValue(r.engineReplacementsByDept || {});
      const totalValue = r.repairs * REPAIR_RATE + engineValue;
      return {
        "Month Ending": fmtDate(r.monthEnd),
        "Total Repairs (Across)": r.repairs,
        "Engine Replacements": engineReps,
        "Total Repair Value": totalValue,
      };
    });

    const cols = [
      "Month Ending",
      "Total Repairs (Across)",
      "Engine Replacements",
      "Total Repair Value",
    ];
    downloadCsv("payouts_monthly_filtered.csv", toCsv(cols, mapped));
  } else {
    const q =
      (jobsSearchInput && jobsSearchInput.value.trim().toLowerCase()) || "";
    const ownerFilter =
      (ownerFilterInput && ownerFilterInput.value.trim().toLowerCase()) || "";
    const plateFilter =
      (plateFilterInput && plateFilterInput.value.trim().toLowerCase()) || "";

    let rows = jobs.filter((j) => {
      if (mech !== "all" && j.mechanic !== mech) return false;
      if (week !== "all" && j.weekISO !== week) return false;
      if (month !== "all" && j.mKey !== month) return false;

      const mechLower = j.mechanic.toLowerCase();
      const ownerLower = j.owner.toLowerCase();
      const plateLower = j.plate.toLowerCase();

      if (
        q &&
        !(
          mechLower.includes(q) ||
          ownerLower.includes(q) ||
          plateLower.includes(q)
        )
      ) {
        return false;
      }

      if (ownerFilter && !ownerLower.includes(ownerFilter)) return false;
      if (plateFilter && !plateLower.includes(plateFilter)) return false;

      return true;
    });
    if (!rows.length) return;

    rows = rows.slice().sort((a, b) => {
      if (a.monthEnd && b.monthEnd) {
        const diff = monthSortDesc ? b.monthEnd - a.monthEnd : a.monthEnd - b.monthEnd;
        if (diff !== 0) return diff;
      }
      if (a.tsDate && b.tsDate) {
        return b.tsDate - a.tsDate;
      }
      return 0;
    });

    const mapped = rows.map((j) => {
      const engineReps = j.engineReplacements || 0;
      const engineLabel = engineReps ? "Yes" : "No";
      // Use BCSO rate for BCSO, standard rate for others
      const engineRate = (j.department === "BCSO" && engineReps > 0) ? 
                         ENGINE_REPLACEMENT_RATE_BCSO : ENGINE_REPLACEMENT_RATE;
      const totalValue = j.across * REPAIR_RATE + engineReps * engineRate;
      return {
        Timestamp: j.tsDate ? fmtDate(j.tsDate) : "",
        Mechanic: j.mechanic,
        Owner: j.owner,
        Plate: j.plate,
        Across: j.across,
        "Engine Replacements": engineLabel,
        "Week Ending": fmtDate(j.weekEnd),
        "Month Ending": fmtDate(j.monthEnd),
        "Total Value": totalValue,
      };
    });

    const cols = [
      "Timestamp",
      "Mechanic",
      "Owner",
      "Plate",
      "Across",
      "Engine Replacements",
      "Week Ending",
      "Month Ending",
      "Total Value",
    ];
    downloadCsv("payouts_jobs_filtered.csv", toCsv(cols, mapped));
  }
}

// ===== Generate Bill for Department + Month =====
function generateBill() {
  const { dept, month } = getFilters();

  if (dept === "all") {
    alert("Please select a specific department to generate a bill.");
    return;
  }

  if (month === "all") {
    alert("Please select a specific month to generate a bill.");
    return;
  }

  // Filter jobs for the selected department and month
  const filteredJobs = jobs.filter((j) => {
    return j.department === dept && j.mKey === month;
  });

  if (!filteredJobs.length) {
    alert(`No jobs found for department "${dept}" in the selected month.`);
    return;
  }

  // Create bill rows with proper rates
  const billRows = filteredJobs.map((j) => {
    const engineReps = j.engineReplacements || 0;
    // Use BCSO rate for BCSO, standard rate for others
    const engineRate = (j.department === "BCSO" && engineReps > 0) ? 
                       ENGINE_REPLACEMENT_RATE_BCSO : ENGINE_REPLACEMENT_RATE;
    const repairValue = j.across * REPAIR_RATE;
    const engineValue = engineReps * engineRate;
    const totalValue = repairValue + engineValue;

    return {
      "Date": j.tsDate ? fmtDate(j.tsDate) : "",
      "Mechanic": j.mechanic,
      "Owner": j.owner,
      "Plate": j.plate,
      "Department": j.department,
      "Repairs (Across)": j.across,
      "Repair Value": repairValue,
      "Engine Replacements": engineReps,
      "Engine Replacement Value": engineValue,
      "Total": totalValue,
    };
  });

  // Sort by date
  billRows.sort((a, b) => {
    const dateA = a.Date || "";
    const dateB = b.Date || "";
    return dateA.localeCompare(dateB);
  });

  // Calculate totals
  const totalRepairs = billRows.reduce((sum, r) => sum + r["Repairs (Across)"], 0);
  const totalRepairValue = billRows.reduce((sum, r) => sum + r["Repair Value"], 0);
  const totalEngines = billRows.reduce((sum, r) => sum + r["Engine Replacements"], 0);
  const totalEngineValue = billRows.reduce((sum, r) => sum + r["Engine Replacement Value"], 0);
  const grandTotal = billRows.reduce((sum, r) => sum + r["Total"], 0);

  // Add summary row
  billRows.push({
    "Date": "",
    "Mechanic": "",
    "Owner": "",
    "Plate": "",
    "Department": "TOTAL",
    "Repairs (Across)": totalRepairs,
    "Repair Value": totalRepairValue,
    "Engine Replacements": totalEngines,
    "Engine Replacement Value": totalEngineValue,
    "Total": grandTotal,
  });

  const cols = [
    "Date",
    "Mechanic",
    "Owner",
    "Plate",
    "Department",
    "Repairs (Across)",
    "Repair Value",
    "Engine Replacements",
    "Engine Replacement Value",
    "Total",
  ];

  const monthDate = monthKeyToDate.get(month);
  const monthStr = monthDate ? fmtDate(monthDate).replace(/\//g, "-") : month;
  const filename = `bill_${dept}_${monthStr}.csv`;
  
  downloadCsv(filename, toCsv(cols, billRows));
}

// ===== Nav sync (using kintsugi-core.js) =====
function syncNavLinksWithCurrentSearch() {
  kSyncNavLinksWithCurrentSearch();
}

function updateUrlFromState() {
  try {
    const params = new URLSearchParams(window.location.search);
    const { mech, dept, week, month } = getFilters();
    const q =
      (jobsSearchInput && jobsSearchInput.value.trim()) || "";

    const setOrDelete = (key, value, def) => {
      if (
        value === undefined ||
        value === null ||
        value === "" ||
        value === def
      ) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    };

    setOrDelete("view", currentView, "weekly");
    setOrDelete("mech", mech, "all");
    setOrDelete("dept", dept, "all");
    setOrDelete("week", week, "all");
    setOrDelete("month", month, "all");
    setOrDelete("weekSort", weekSortDesc ? "desc" : "asc", "desc");
    setOrDelete("monthSort", monthSortDesc ? "desc" : "asc", "desc");
    setOrDelete("q", q, "");

    const qs = params.toString();
    const newUrl =
      window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;

    window.history.replaceState(null, "", newUrl);

    // keep nav tabs in sync with the latest query
    syncNavLinksWithCurrentSearch();
  } catch (e) {
    console.warn("updateUrlFromState failed:", e);
  }
}

function applyFiltersFromUrl() {
  if (!initialParams) return;

  const mechSel = document.getElementById("mechanicFilter");
  const deptSel = document.getElementById("departmentFilter");
  const weekSel = document.getElementById("weekFilter");
  const monthSel = document.getElementById("monthFilter");

  const mech = initialParams.get("mech");
  const dept = initialParams.get("dept");
  const week = initialParams.get("week");
  const month = initialParams.get("month");
  const weekSort = initialParams.get("weekSort");
  const monthSort = initialParams.get("monthSort");
  const viewParam = initialParams.get("view");
  const q = initialParams.get("q");

  const safeSet = (sel, value) => {
    if (!sel || !value) return;
    const has = Array.from(sel.options).some((o) => o.value === value);
    if (has) sel.value = value;
  };

  safeSet(mechSel, mech);
  safeSet(deptSel, dept);
  safeSet(weekSel, week);
  safeSet(monthSel, month);

  if (weekSort === "asc") {
    weekSortDesc = false;
    if (sortWeekBtn)
      sortWeekBtn.textContent = "Sort by Week Ending (Oldest)";
  }
  if (monthSort === "asc") {
    monthSortDesc = false;
    if (sortMonthBtn)
      sortMonthBtn.textContent = "Sort by Month Ending (Oldest)";
  }

  if (viewParam === "weekly" || viewParam === "monthly" || viewParam === "jobs") {
    currentView = viewParam;
    document
      .querySelectorAll(".seg-btn")
      .forEach((btn) =>
        btn.classList.toggle("active", btn.dataset.view === currentView)
      );
  }

  if (q && jobsSearchInput) {
    jobsSearchInput.value = q;
  }
}

// ===== Quick presets =====
function applyQuickPreset(preset) {
  const weekSel = document.getElementById("weekFilter");
  const monthSel = document.getElementById("monthFilter");
  if (!weekSel || !monthSel) return;

  const sortedWeeks = Array.from(weekKeys).sort(
    (a, b) => new Date(b) - new Date(a)
  );
  const sortedMonths = Array.from(monthKeys).sort(
    (a, b) => monthKeyToDate.get(b) - monthKeyToDate.get(a)
  );

  if (preset === "this-week" && sortedWeeks.length >= 1) {
    weekSel.value = sortedWeeks[0];
  } else if (preset === "last-week" && sortedWeeks.length >= 2) {
    weekSel.value = sortedWeeks[1];
  } else if (preset === "this-month" && sortedMonths.length >= 1) {
    monthSel.value = sortedMonths[0];
  } else if (preset === "last-month" && sortedMonths.length >= 2) {
    monthSel.value = sortedMonths[1];
  }

  renderAll();
}

// ===== View + render orchestration =====
function renderAll() {
  if (currentView === "weekly") {
    renderWeekly();
  } else if (currentView === "monthly") {
    renderMonthly();
  } else {
    renderJobs();
  }
  updateView();
  updateMechanicSummary();
  updateUrlFromState();
}

function updateView() {
  const weeklyWrap = document.getElementById("weeklyWrap");
  const monthlyWrap = document.getElementById("monthlyWrap");
  const jobsWrap = document.getElementById("jobsWrap");

  if (!weeklyWrap || !monthlyWrap || !jobsWrap) return;

  weeklyWrap.classList.add("hidden");
  monthlyWrap.classList.add("hidden");
  jobsWrap.classList.add("hidden");

  if (currentView === "weekly") weeklyWrap.classList.remove("hidden");
  else if (currentView === "monthly")
    monthlyWrap.classList.remove("hidden");
  else jobsWrap.classList.remove("hidden");
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  initialParams = new URLSearchParams(window.location.search);

  // make sure nav tabs use whatever query we started with
  syncNavLinksWithCurrentSearch();

  weeklyBody = document.getElementById("weeklyBody");
  monthlyBody = document.getElementById("monthlyBody");
  jobsBody = document.getElementById("jobsBody");

  if (weeklyBody) {
    weeklyBody.addEventListener("click", onMechanicClickFromTable);
    // Event delegation for copy summary buttons
    weeklyBody.addEventListener("click", (e) => {
      const copyBtn = e.target.closest(".btn-copy-summary");
      if (copyBtn) {
        e.stopPropagation();
        const mechanic = copyBtn.dataset.mechanic;
        const weekEnd = new Date(copyBtn.dataset.weekEnd);
        const repairs = parseInt(copyBtn.dataset.repairs, 10);
        const engineReplacementsByDept = JSON.parse(copyBtn.dataset.engineDepts || "{}");
        const totalPay = parseFloat(copyBtn.dataset.totalPay);
        
        copyWeeklySummary(copyBtn, mechanic, weekEnd, repairs, engineReplacementsByDept, totalPay);
      }
    });
  }
  if (jobsBody) {
    jobsBody.addEventListener("click", onMechanicClickFromTable);
  }

  jobsSearchInput = document.getElementById("jobsSearch");
  ownerFilterInput = document.getElementById("ownerFilter");
  plateFilterInput = document.getElementById("plateFilter");
  advancedFiltersPanel = document.getElementById("advancedFilters");
  advancedToggleBtn = document.getElementById("toggleAdvancedFilters");

  const controls = document.querySelector(".controls");

  statusEl =
    document.getElementById("status") ||
    (() => {
      const s = document.createElement("div");
      s.id = "status";
      s.className = "status";
      controls && controls.appendChild(s);
      return s;
    })();

  weeklySummaryEl =
    document.getElementById("weeklySummary") ||
    (() => {
      const d = document.createElement("div");
      d.id = "weeklySummary";
      d.className = "status";
      controls && controls.appendChild(d);
      return d;
    })();

  exportBtn =
    document.getElementById("exportPayoutsBtn") ||
    (() => {
      const b = document.createElement("button");
      b.id = "exportPayoutsBtn";
      b.className = "btn";
      b.textContent = "Export CSV (current view)";
      controls && controls.appendChild(b);
      return b;
    })();
  exportBtn.addEventListener("click", exportCurrentViewCsv);

  const generateBillBtn =
    document.getElementById("generateBillBtn") ||
    (() => {
      const b = document.createElement("button");
      b.id = "generateBillBtn";
      b.className = "btn";
      b.textContent = "Generate Bill (Dept + Month)";
      controls && controls.appendChild(b);
      return b;
    })();
  generateBillBtn.addEventListener("click", generateBill);

  // Copy Payout Summary button
  const copyPayoutSummaryBtn = document.getElementById("copyPayoutSummaryBtn");
  if (copyPayoutSummaryBtn) {
    copyPayoutSummaryBtn.addEventListener("click", async () => {
      const { mech, week } = getFilters();
      
      if (mech === "all") {
        kShowToast("Please select a specific mechanic first", "warning", 3000);
        return;
      }
      
      // Find mechanic data
      const mechanicData = weeklyAgg.filter(w => w.mechanic === mech);
      
      if (mechanicData.length === 0) {
        kShowToast("No data found for selected mechanic", "error", 3000);
        return;
      }
      
      // Calculate totals
      const totalRepairs = mechanicData.reduce((sum, w) => sum + w.repairs, 0);
      const totalEngines = mechanicData.reduce((sum, w) => sum + w.engineReplacements, 0);
      
      // Calculate total engine pay
      let totalEnginePay = 0;
      mechanicData.forEach(w => {
        totalEnginePay += calculateEnginePayment(w.engineReplacementsByDept);
      });
      
      const totalPayout = totalRepairs * PAY_PER_REPAIR + totalEnginePay;
      const stateId = stateIdByMechanic.get(mech) || "";
      
      // Get date range
      const dates = mechanicData.map(w => w.weekEnd).sort((a, b) => a - b);
      const startDate = dates[0];
      const endDate = dates[dates.length - 1];
      
      // Get week number if single week selected
      let weekNumber = null;
      if (week !== "all" && mechanicData.length === 1) {
        weekNumber = kGetWeekNumber(mechanicData[0].weekEnd);
      }
      
      // Generate summary
      const summary = kGeneratePayoutSummary({
        name: mech,
        stateId: stateId,
        totalRepairs: totalRepairs,
        engineReplacements: totalEngines,
        totalPayout: totalPayout
      }, {
        startDate: startDate,
        endDate: endDate,
        weekNumber: weekNumber,
        notes: `${mechanicData.length} week(s) of work`
      });
      
      // Copy to clipboard
      const success = await kCopyToClipboard(summary);
      
      if (success) {
        kShowToast("Payout summary copied to clipboard!", "success", 3000);
      } else {
        kShowToast("Failed to copy. Please try again.", "error", 3000);
      }
    });
  }

  sortWeekBtn =
    document.getElementById("sortWeekBtn") ||
    (() => {
      const b = document.createElement("button");
      b.id = "sortWeekBtn";
      b.className = "btn";
      b.textContent = "Sort by Week Ending (Newest)";
      controls && controls.appendChild(b);
      return b;
    })();
  sortWeekBtn.addEventListener("click", () => {
    weekSortDesc = !weekSortDesc;
    sortWeekBtn.textContent = weekSortDesc
      ? "Sort by Week Ending (Newest)"
      : "Sort by Week Ending (Oldest)";
    if (currentView === "weekly") renderAll();
  });

  sortMonthBtn =
    document.getElementById("sortMonthBtn") ||
    (() => {
      const b = document.createElement("button");
      b.id = "sortMonthBtn";
      b.className = "btn";
      b.textContent = "Sort by Month Ending (Newest)";
      controls && controls.appendChild(b);
      return b;
    })();
  sortMonthBtn.addEventListener("click", () => {
    monthSortDesc = !monthSortDesc;
    sortMonthBtn.textContent = monthSortDesc
      ? "Sort by Month Ending (Newest)"
      : "Sort by Month Ending (Oldest)";
    if (currentView === "monthly" || currentView === "jobs") renderAll();
  });

  // Segmented view tabs
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".seg-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentView = btn.dataset.view || "weekly";
      renderAll();
    });
  });

  // Filters
  const mechSel = document.getElementById("mechanicFilter");
  const deptSel = document.getElementById("departmentFilter");
  const weekSel = document.getElementById("weekFilter");
  const monthSel = document.getElementById("monthFilter");
  mechSel && mechSel.addEventListener("change", renderAll);
  deptSel && deptSel.addEventListener("change", renderAll);
  weekSel && weekSel.addEventListener("change", renderAll);
  monthSel && monthSel.addEventListener("change", renderAll);

  // Quick presets
  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      if (preset) applyQuickPreset(preset);
    });
  });

  // Jobs search with debouncing
  if (jobsSearchInput) {
    const debouncedSearch = kDebounce(() => {
      if (currentView === "jobs") {
        renderAll();
      } else {
        // still update URL for cross-page search usage
        updateUrlFromState();
      }
    }, 300);
    
    jobsSearchInput.addEventListener("input", debouncedSearch);
  }

  // Advanced filters
  if (advancedToggleBtn && advancedFiltersPanel) {
    advancedToggleBtn.addEventListener("click", () => {
      advancedFiltersPanel.classList.toggle("hidden");
    });
  }

  // Debounced advanced filter inputs
  if (ownerFilterInput) {
    const debouncedOwner = kDebounce(() => {
      if (currentView === "jobs") renderAll();
    }, 300);
    ownerFilterInput.addEventListener("input", debouncedOwner);
  }

  if (plateFilterInput) {
    const debouncedPlate = kDebounce(() => {
      if (currentView === "jobs") renderAll();
    }, 300);
    plateFilterInput.addEventListener("input", debouncedPlate);
  }

  const clearBtn = document.getElementById("mechSummaryClearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const mechSel = document.getElementById("mechanicFilter");
      if (mechSel) mechSel.value = "all";
      renderAll();
    });
  }

  const bankBtn = document.getElementById("mechSummaryBankBtn");
  if (bankBtn) {
    bankBtn.addEventListener("click", () => {
      const { mech } = getFilters();
      if (!mech || mech === "all") return;
      const params = new URLSearchParams();
      params.set("from", "payouts");
      params.set("mech", mech);
      if (mechanicLatestWeekISO) {
        params.set("week", mechanicLatestWeekISO);
      }
      const url = "../Bank_Record/bank-index.html?" + params.toString();
      window.location.href = url;
    });
  }

  // Initial load
  loadPayouts();
});
