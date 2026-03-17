// ===== Config (values sourced from constants.js) =====
const PAYOUTS_SHEET           = KINTSUGI_CONFIG.SHEETS.JOBS;
const STATE_ID_SHEET          = KINTSUGI_CONFIG.SHEETS.STATE_IDS;

const PAY_PER_REPAIR          = PAYMENT_RATES.PAY_PER_REPAIR;
const REPAIR_RATE             = PAYMENT_RATES.REPAIR_RATE;
const ENGINE_REPLACEMENT_RATE = PAYMENT_RATES.ENGINE_REPLACEMENT_RATE;
const ENGINE_REPLACEMENT_RATE_BCSO = PAYMENT_RATES.ENGINE_REPLACEMENT_RATE_BCSO;
const ENGINE_REIMBURSEMENT    = PAYMENT_RATES.ENGINE_REIMBURSEMENT;
const ENGINE_BONUS_LSPD       = PAYMENT_RATES.ENGINE_BONUS_LSPD;
const HARNESS_RATE            = PAYMENT_RATES.HARNESS_RATE;
const ADVANCED_REPAIR_KIT_RATE = PAYMENT_RATES.ADVANCED_REPAIR_KIT_RATE;
const HARNESS_BILLING_RATE    = PAYMENT_RATES.HARNESS_BILLING_RATE;
const ADVANCED_REPAIR_KIT_BILLING_RATE = PAYMENT_RATES.ADVANCED_REPAIR_KIT_BILLING_RATE;

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


function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Weekly payout comment helper
function commentForWeek(weekEndDate) {
  return `Payout for week ending ${kFmtDate(weekEndDate)}`;
}

// Generate copy summary for a weekly payout entry.
// acrossPD      – PD repair count for the week
// acrossCiv     – CIV repair count for the week
// pdEngineReps  – PD engine replacement count
// civEngineReps – CIV engine replacement count
// enginePay     – pre-computed mechanic engine pay total
// harnessPD     – PD harness count
// harnessCiv    – CIV harness count
// advKitPD      – PD advanced repair kit count
// advKitCiv     – CIV advanced repair kit count
// totalPayout   – final payout (repairs * PAY_PER_REPAIR + enginePay + harnessKitPay)
function generateWeeklyCopySummary(mechanic, weekEndDate, acrossPD, acrossCiv, pdEngineReps, civEngineReps, enginePay, harnessPD, harnessCiv, advKitPD, advKitCiv, totalPayout) {
  const stateId = stateIdByMechanic.get(mechanic) || "N/A";
  const weekEndStr = kFmtDate(weekEndDate);
  const totalRepairs = acrossPD + acrossCiv;

  let summary = `Kintsugi Motorworks - Weekly Payout\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `Mechanic: ${mechanic}\n`;
  summary += `State ID: ${stateId}\n`;
  summary += `Week Ending: ${weekEndStr}\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  if (acrossCiv > 0) {
    summary += `Repairs (PD): ${acrossPD}\n`;
    summary += `Repairs (CIV): ${acrossCiv}\n`;
    summary += `Total Repairs: ${totalRepairs}\n`;
  } else {
    summary += `Repairs: ${totalRepairs}\n`;
  }

  const totalEngines = pdEngineReps + civEngineReps;
  if (totalEngines > 0) {
    summary += `Engine Replacements: ${totalEngines}`;
    if (civEngineReps > 0) summary += ` (${pdEngineReps} PD, ${civEngineReps} CIV)`;
    summary += `\n`;
    summary += `Engine Pay: ${kFmtMoney(enginePay)}\n`;
  }

  const totalHarness = (harnessPD || 0) + (harnessCiv || 0);
  if (totalHarness > 0) {
    if ((harnessCiv || 0) > 0 && (harnessPD || 0) > 0) {
      summary += `Harness (PD): ${harnessPD || 0}\n`;
      summary += `Harness (CIV): ${harnessCiv || 0}\n`;
    } else {
      summary += `Harness: ${totalHarness}\n`;
    }
  }

  const totalAdvKit = (advKitPD || 0) + (advKitCiv || 0);
  if (totalAdvKit > 0) {
    if ((advKitCiv || 0) > 0 && (advKitPD || 0) > 0) {
      summary += `Advanced Repair Kits (PD): ${advKitPD || 0}\n`;
      summary += `Advanced Repair Kits (CIV): ${advKitCiv || 0}\n`;
    } else {
      summary += `Advanced Repair Kits: ${totalAdvKit}\n`;
    }
  }

  summary += `Total Payout: ${kFmtMoney(totalPayout)}\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  return summary;
}

// Copy weekly payout summary to clipboard
async function copyWeeklySummary(btn, mechanic, weekEndDate, acrossPD, acrossCiv, pdEngineReps, civEngineReps, enginePay, harnessPD, harnessCiv, advKitPD, advKitCiv, totalPayout) {
  const summary = generateWeeklyCopySummary(mechanic, weekEndDate, acrossPD, acrossCiv, pdEngineReps, civEngineReps, enginePay, harnessPD, harnessCiv, advKitPD, advKitCiv, totalPayout);
  
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
      kShowToast("✓ Payout summary copied to clipboard!", "success", 2000);
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
// Legacy function kept for backwards-compatible paths.
// BCSO: $12k reimbursement only (no bonus)
// LSPD: $12k reimbursement + $1.5k bonus
// Other: $12k reimbursement only (no bonus)
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
  // Other: reimbursement only (no bonus)
  enginePay += otherEngines * ENGINE_REIMBURSEMENT;
  
  return enginePay;
}

// Compute mechanic engine pay for a single job row, accounting for who purchased
// the engine and whether the repair is PD or civilian (CIV).
//
// The $1,500 bonus is only awarded when the department is LSPD.
//
// PD engines:
//   enginePayer === "mechanic"  → mechanic covered engine cost → $12,000 + $1,500 bonus if LSPD
//   enginePayer === "kintsugi"  → kintsugi covered cost, mechanic gets $1,500 bonus only if LSPD
//   enginePayer === ""          → old data, fall back to dept-based defaults
//                                  LSPD: $13,500  |  all others: $12,000
//
// CIV engines: $12,000 reimbursement only (no bonus)
function computeJobEnginePay(pdEngineCount, dept, enginePayer, civEngineCount) {
  let pay = 0;
  const isLspd = dept === "LSPD";

  if (pdEngineCount > 0) {
    if (enginePayer === "mechanic") {
      pay += pdEngineCount * (ENGINE_REIMBURSEMENT + (isLspd ? ENGINE_BONUS_LSPD : 0));
    } else if (enginePayer === "kintsugi") {
      pay += pdEngineCount * (isLspd ? ENGINE_BONUS_LSPD : 0);
    } else {
      // Old data without payer info: bonus only for LSPD
      pay += pdEngineCount * (isLspd ? (ENGINE_REIMBURSEMENT + ENGINE_BONUS_LSPD) : ENGINE_REIMBURSEMENT);
    }
  }

  pay += (civEngineCount || 0) * ENGINE_REIMBURSEMENT;

  return pay;
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

    // Load State IDs and payouts in parallel
    const [stateRows, data] = await Promise.all([
      kFetchCSV(STATE_ID_SHEET),
      kFetchCSV(PAYOUTS_SHEET),
    ]);

    buildStateIdMap(stateRows);

    if (data.length < 2) throw new Error("No rows in Form responses 1.");

    const headers = data[0].map((h) => h.trim());
    const headersLower = headers.map((h) => h.toLowerCase());

    const iTime = headers.indexOf("Timestamp");
    const iMech = headers.indexOf("Mechanic");
    const iOwner = headers.indexOf("Owner of Vehicle");
    const iPlate = headers.indexOf("Vehicle Plate");
    const iWeek = headers.indexOf("Week Ending");
    const iMonth = headers.indexOf("Month Ending");

    // "How many Across PD?" — PD repair count (contains "pd")
    const iAcrossPD = headersLower.findIndex(
      (h) => h.includes("across") && h.includes("pd")
    );
    // "How many Across" (CIV) — civilian repair count (contains "across" but NOT "pd")
    const iAcrossCiv = headersLower.findIndex(
      (h) => h.includes("across") && !h.includes("pd")
    );

    // "Did you buy the engine replacement, or did kintsugi pay for it?"
    // Must be detected BEFORE engine replacement columns so we can exclude it from those searches.
    const iEnginePayer = headersLower.findIndex(
      (h) => h.includes("did you buy") || (h.includes("kintsugi") && h.includes("pay"))
    );

    // First "Engine Replacement?" column → PD engine replacement
    // Exclude the payer question column which also contains "engine" and "replacement".
    const iEnginePD = headersLower.findIndex(
      (h, i) => i !== iEnginePayer && h.includes("engine") && h.includes("replacement")
    );
    // Second "Engine Replacement?" column → CIV engine replacement (after iEnginePD)
    const iEngineCiv =
      iEnginePD !== -1
        ? headersLower.findIndex(
            (h, i) => i > iEnginePD && i !== iEnginePayer && h.includes("engine") && h.includes("replacement")
          )
        : -1;

    // "PD Repair" — yes/no column indicating whether the job is a PD repair
    const iPDRepair = headersLower.findIndex(
      (h) => h === "pd repair" || (h.includes("pd") && h.includes("repair") && !h.includes("across") && !h.includes("kit"))
    );

    // find department column
    const iDept = headersLower.findIndex((h) => h.includes("department"));

    // Harness columns: "Harness (PD)" and "Harness (CIV)"
    const iHarnessPD  = headersLower.findIndex((h) => h.includes("harness") && h.includes("pd"));
    const iHarnessCiv = headersLower.findIndex((h) => h.includes("harness") && !h.includes("pd"));

    // Advanced Repair Kit columns: "Advanced Repair Kits (PD)" and "Advanced Repair Kits (CIV)"
    const iAdvKitPD  = headersLower.findIndex((h) => h.includes("advanced") && h.includes("kit") && h.includes("pd"));
    const iAdvKitCiv = headersLower.findIndex((h) => h.includes("advanced") && h.includes("kit") && !h.includes("pd"));

    if (iMech === -1 || (iAcrossPD === -1 && iAcrossCiv === -1) || iWeek === -1 || iMonth === -1) {
      throw new Error("Missing required columns.");
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

      // PD repair count ("How many Across PD?")
      const acrossPD = iAcrossPD !== -1 ? (Number(row[iAcrossPD] || "0") || 0) : 0;
      // CIV repair count ("How many Across")
      const acrossCiv = iAcrossCiv !== -1 ? (Number(row[iAcrossCiv] || "0") || 0) : 0;
      const across = acrossPD + acrossCiv;

      // Harness counts
      const harnessPD  = iHarnessPD  !== -1 ? (Number(row[iHarnessPD]  || "0") || 0) : 0;
      const harnessCiv = iHarnessCiv !== -1 ? (Number(row[iHarnessCiv] || "0") || 0) : 0;
      const totalHarness = harnessPD + harnessCiv;

      // Advanced Repair Kit counts
      const advKitPD  = iAdvKitPD  !== -1 ? (Number(row[iAdvKitPD]  || "0") || 0) : 0;
      const advKitCiv = iAdvKitCiv !== -1 ? (Number(row[iAdvKitCiv] || "0") || 0) : 0;
      const totalAdvKit = advKitPD + advKitCiv;

      if (!across && !totalHarness && !totalAdvKit) continue;

      // PD engine replacements (first "Engine Replacement?" column)
      let pdEngineCount = 0;
      if (iEnginePD !== -1) {
        const rawEngine = (row[iEnginePD] || "").trim();
        if (rawEngine) {
          const num = Number(rawEngine);
          if (!Number.isNaN(num) && num > 0) {
            pdEngineCount = num;
          } else if (/^(yes|y|true)$/i.test(rawEngine)) {
            pdEngineCount = 1;
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

      // Determine who purchased the PD engine replacement
      // "mechanic" = mechanic bought it (owed 13 500)
      // "kintsugi" = kintsugi bought it (mechanic gets 1 500 bonus)
      // ""         = old data — fall back to dept-based defaults
      let enginePayer = "";
      if (iEnginePayer !== -1 && pdEngineCount > 0) {
        const rawPayer = (row[iEnginePayer] || "").trim().toLowerCase();
        if (rawPayer) {
          if (rawPayer.includes("kintsugi")) {
            enginePayer = "kintsugi";
          } else if (/^\s*i\b|i bought|bought it|myself/i.test(rawPayer)) {
            enginePayer = "mechanic";
          }
        }
      }

      const weekEnd = kParseDateLike(row[iWeek]);
      const monthEnd = kParseDateLike(row[iMonth]);
      if (!weekEnd || !monthEnd) continue;

      const tsRaw = iTime !== -1 ? (row[iTime] || "").trim() : "";
      const tsDate = tsRaw ? kParseDateLike(tsRaw) || new Date(tsRaw) : null;
      const owner = iOwner !== -1 ? (row[iOwner] || "").trim() : "";
      const plate = iPlate !== -1 ? (row[iPlate] || "").trim() : "";
      let dept = iDept !== -1 ? (row[iDept] || "").trim() : "";

      // Classify CIV-only jobs: "PD Repair" = "No" (or dept empty + only CIV repairs)
      if (!dept) {
        const pdRepairFlag = iPDRepair !== -1 ? (row[iPDRepair] || "").trim().toLowerCase() : "";
        if (pdRepairFlag === "no" || (acrossCiv > 0 && acrossPD === 0)) {
          dept = "CIV";
        }
      }

      mechanics.add(mech);
      if (dept) departments.add(dept);

      const mKey = monthKey(monthEnd);
      monthKeys.add(mKey);
      monthKeyToDate.set(mKey, monthEnd);

      const weekISO = weekEnd.toISOString().slice(0, 10);
      weekKeys.add(weekISO);

      // Pre-compute mechanic engine pay for this job
      const enginePayForMechanic = computeJobEnginePay(pdEngineCount, dept, enginePayer, civEngineCount);

      // Harness and Advanced Repair Kit pay
      const harnessKitPay = totalHarness * HARNESS_RATE + totalAdvKit * ADVANCED_REPAIR_KIT_RATE;

      // Weekly agg for mechanic+week
      const wKey = `${mech}|${weekISO}`;
      const w =
        weeklyMap.get(wKey) || {
          mechanic: mech,
          weekEnd,
          weekISO,
          mKey,
          jobCount: 0,
          repairs: 0,
          acrossPD: 0,
          acrossCiv: 0,
          engineReplacements: 0,
          civEngineReplacements: 0,
          engineReplacementsByDept: {},
          enginePayAccumulated: 0,
          harnessPD: 0,
          harnessCiv: 0,
          advKitPD: 0,
          advKitCiv: 0,
          harnessKitPayAccumulated: 0,
        };
      w.jobCount++;
      w.repairs += across;
      w.acrossPD += acrossPD;
      w.acrossCiv += acrossCiv;
      w.engineReplacements += pdEngineCount;
      w.civEngineReplacements += civEngineCount;
      w.enginePayAccumulated += enginePayForMechanic;
      w.harnessPD += harnessPD;
      w.harnessCiv += harnessCiv;
      w.advKitPD += advKitPD;
      w.advKitCiv += advKitCiv;
      w.harnessKitPayAccumulated += harnessKitPay;
      if (pdEngineCount > 0 && dept) {
        w.engineReplacementsByDept[dept] = (w.engineReplacementsByDept[dept] || 0) + pdEngineCount;
      }
      weeklyMap.set(wKey, w);

      // Monthly agg
      const mAgg =
        monthlyMap.get(mKey) || {
          monthEnd,
          mKey,
          repairs: 0,
          acrossPD: 0,
          acrossCiv: 0,
          engineReplacements: 0,
          civEngineReplacements: 0,
          engineReplacementsByDept: {},
          enginePayAccumulated: 0,
          harnessPD: 0,
          harnessCiv: 0,
          advKitPD: 0,
          advKitCiv: 0,
          harnessKitPayAccumulated: 0,
        };
      mAgg.repairs += across;
      mAgg.acrossPD += acrossPD;
      mAgg.acrossCiv += acrossCiv;
      mAgg.engineReplacements += pdEngineCount;
      mAgg.civEngineReplacements += civEngineCount;
      mAgg.enginePayAccumulated += enginePayForMechanic;
      mAgg.harnessPD += harnessPD;
      mAgg.harnessCiv += harnessCiv;
      mAgg.advKitPD += advKitPD;
      mAgg.advKitCiv += advKitCiv;
      mAgg.harnessKitPayAccumulated += harnessKitPay;
      if (pdEngineCount > 0 && dept) {
        mAgg.engineReplacementsByDept[dept] = (mAgg.engineReplacementsByDept[dept] || 0) + pdEngineCount;
      }
      monthlyMap.set(mKey, mAgg);

      // Jobs table
      jobs.push({
        tsDate,
        mechanic: mech,
        owner,
        plate,
        acrossPD,
        acrossCiv,
        across,
        engineReplacements: pdEngineCount,
        civEngineReplacements: civEngineCount,
        enginePayer,
        enginePayForMechanic,
        harnessPD,
        harnessCiv,
        advKitPD,
        advKitCiv,
        harnessKitPay,
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
    populateInvoiceMonthSelect();

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
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        mechSel.appendChild(opt);
      });
  }

  if (deptSel) {
    deptSel.innerHTML = '<option value="all">All Departments</option>';
    Array.from(departments)
      .sort()
      .forEach((d) => {
        const opt = document.createElement("option");
        opt.value = d;
        opt.textContent = d;
        deptSel.appendChild(opt);
      });
  }

  if (weekSel) {
    weekSel.innerHTML = '<option value="all">All Weeks</option>';
    Array.from(weekKeys)
      .sort((a, b) => new Date(b) - new Date(a)) // newest first
      .forEach((iso) => {
        const d = new Date(iso);
        const opt = document.createElement("option");
        opt.value = iso;
        opt.textContent = kFmtDate(d);
        weekSel.appendChild(opt);
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
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = kFmtDate(d);
        monthSel.appendChild(opt);
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
      jobCount: 0,
      repairs: 0,
      acrossPD: 0,
      acrossCiv: 0,
      engineReplacements: 0,
      civEngineReplacements: 0,
      engineReplacementsByDept: {},
      enginePayAccumulated: 0,
      harnessPD: 0,
      harnessCiv: 0,
      advKitPD: 0,
      advKitCiv: 0,
      harnessKitPayAccumulated: 0,
    };
    w.jobCount++;
    w.repairs += j.across;
    w.acrossPD += j.acrossPD || 0;
    w.acrossCiv += j.acrossCiv || 0;
    w.engineReplacements += j.engineReplacements;
    w.civEngineReplacements += j.civEngineReplacements || 0;
    w.enginePayAccumulated += j.enginePayForMechanic || 0;
    w.harnessPD += j.harnessPD || 0;
    w.harnessCiv += j.harnessCiv || 0;
    w.advKitPD += j.advKitPD || 0;
    w.advKitCiv += j.advKitCiv || 0;
    w.harnessKitPayAccumulated += j.harnessKitPay || 0;
    if (j.engineReplacements > 0 && j.department) {
      w.engineReplacementsByDept[j.department] = 
        (w.engineReplacementsByDept[j.department] || 0) + j.engineReplacements;
    }
    weeklyMap.set(wKey, w);
  });

  const filtered = Array.from(weeklyMap.values());

  if (!filtered.length) {
    weeklyBody.innerHTML =
      '<tr><td colspan="9" style="padding:8px; color:#6b7280;">No weekly records for this selection.</td></tr>';
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
  let groupCounter = 0;

  weekBuckets.forEach((bucket) => {
    const { weekEnd, entries } = bucket;

    entries.sort((a, b) => a.mechanic.localeCompare(b.mechanic));

    // First pass: calculate week total for the compact header
    let weekTotal = 0;
    entries.forEach((r) => {
      weekTotal += r.repairs * PAY_PER_REPAIR + r.enginePayAccumulated + r.harnessKitPayAccumulated;
    });

    const groupId = `wg-${++groupCounter}`;

    // Compact collapsible group header (no per-mechanic breakdown)
    const headerRow = document.createElement("tr");
    headerRow.className = "week-group-header";
    headerRow.dataset.groupId = groupId;

    const headerTd = document.createElement("td");
    headerTd.colSpan = 9;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "week-group-toggle";
    toggleBtn.textContent = "▼";
    toggleBtn.setAttribute("aria-expanded", "true");
    headerTd.appendChild(toggleBtn);

    const labelSpan = document.createElement("span");
    labelSpan.className = "week-group-label";
    labelSpan.textContent = `Week ending ${kFmtDate(weekEnd)}`;
    headerTd.appendChild(labelSpan);

    const metaSpan = document.createElement("span");
    metaSpan.className = "week-group-meta";
    metaSpan.textContent = `${entries.length} mechanic${entries.length !== 1 ? "s" : ""} · ${kFmtMoney(weekTotal)}`;
    headerTd.appendChild(metaSpan);

    headerRow.appendChild(headerTd);
    fragment.appendChild(headerRow);

    // Second pass: create individual mechanic rows under this group
    entries.forEach((r) => {
      const pay = r.repairs * PAY_PER_REPAIR + r.enginePayAccumulated + r.harnessKitPayAccumulated;
      const comment = commentForWeek(r.weekEnd);
      const pdEngineReps = r.engineReplacements || 0;
      const civEngineReps = r.civEngineReplacements || 0;
      const totalEngineReps = pdEngineReps + civEngineReps;

      const mechLabel = labelWithStateId(r.mechanic);

      const tr = document.createElement("tr");
      tr.className = "week-group-row";
      tr.dataset.groupId = groupId;
      tr.innerHTML = `
        <td><button class="mech-link" data-mech="${r.mechanic}">${mechLabel}</button></td>
        <td>${kFmtDate(r.weekEnd)}</td>
        <td class="col-count">${r.jobCount || 0}</td>
        <td class="col-amount amount-in">
          ${kFmtMoney(pay)}
          <div class="payout-comment">${comment}</div>
        </td>
        <td class="col-count">${r.repairs}</td>
        <td class="col-count">${totalEngineReps > 0 ? totalEngineReps : 0}</td>
        <td class="col-count">${(r.harnessPD || 0) + (r.harnessCiv || 0)}</td>
        <td class="col-count">${(r.advKitPD || 0) + (r.advKitCiv || 0)}</td>
        <td class="col-actions">
          <button class="btn btn-copy-summary" 
                  title="Copy payout summary to clipboard"
                  data-mechanic="${r.mechanic}"
                  data-week-end="${r.weekEnd.toISOString()}"
                  data-pd-repairs="${r.acrossPD || 0}"
                  data-civ-repairs="${r.acrossCiv || 0}"
                  data-pd-engine-reps="${pdEngineReps}"
                  data-civ-engine-reps="${civEngineReps}"
                  data-engine-pay="${r.enginePayAccumulated}"
                  data-harness-pd="${r.harnessPD || 0}"
                  data-harness-civ="${r.harnessCiv || 0}"
                  data-adv-kit-pd="${r.advKitPD || 0}"
                  data-adv-kit-civ="${r.advKitCiv || 0}"
                  data-total-pay="${pay}">
            📋 Copy
          </button>
        </td>
      `;

      fragment.appendChild(tr);
    });

    summarySource.push({ weekEnd, weekTotal });
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
      acrossPD: 0,
      acrossCiv: 0,
      engineReplacements: 0,
      civEngineReplacements: 0,
      engineReplacementsByDept: {},
      enginePayAccumulated: 0,
      harnessPD: 0,
      harnessCiv: 0,
      advKitPD: 0,
      advKitCiv: 0,
      harnessKitBillingAccumulated: 0,
    };
    mAgg.repairs += j.across;
    mAgg.acrossPD += j.acrossPD || 0;
    mAgg.acrossCiv += j.acrossCiv || 0;
    mAgg.engineReplacements += j.engineReplacements;
    mAgg.civEngineReplacements += j.civEngineReplacements || 0;
    mAgg.enginePayAccumulated += j.enginePayForMechanic || 0;
    mAgg.harnessPD += j.harnessPD || 0;
    mAgg.harnessCiv += j.harnessCiv || 0;
    mAgg.advKitPD += j.advKitPD || 0;
    mAgg.advKitCiv += j.advKitCiv || 0;
    mAgg.harnessKitBillingAccumulated +=
      ((j.harnessPD || 0) + (j.harnessCiv || 0)) * HARNESS_BILLING_RATE +
      ((j.advKitPD || 0) + (j.advKitCiv || 0)) * ADVANCED_REPAIR_KIT_BILLING_RATE;
    if (j.engineReplacements > 0 && j.department) {
      mAgg.engineReplacementsByDept[j.department] = 
        (mAgg.engineReplacementsByDept[j.department] || 0) + j.engineReplacements;
    }
    monthlyMap.set(j.mKey, mAgg);
  });

  let rows = Array.from(monthlyMap.values());

  if (!rows.length) {
    monthlyBody.innerHTML =
      '<tr><td colspan="6" style="padding:8px; color:#6b7280;">No monthly records for this selection.</td></tr>';
    if (headerCell) {
      headerCell.textContent = "Total Repair Value ($2,500/repair)";
    }
    return;
  }

  rows.sort((a, b) =>
    monthSortDesc ? b.monthEnd - a.monthEnd : a.monthEnd - b.monthEnd
  );

  // Group months by year for collapsible sections
  const byYear = new Map();
  rows.forEach((r) => {
    const year = r.monthEnd.getFullYear();
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(r);
  });

  const yearBuckets = Array.from(byYear.entries()).sort(([a], [b]) =>
    monthSortDesc ? b - a : a - b
  );

  let grandTotalValue = 0;
  let groupCounter = 0;
  const fragment = document.createDocumentFragment();

  yearBuckets.forEach(([year, yearRows]) => {
    let yearTotal = 0;
    let yearRepairs = 0;
    yearRows.forEach((r) => {
      const engineValue = calculateEngineValue(r.engineReplacementsByDept || {});
      const totalValue = r.repairs * REPAIR_RATE + engineValue + (r.harnessKitBillingAccumulated || 0);
      yearTotal += totalValue;
      yearRepairs += r.repairs;
    });
    grandTotalValue += yearTotal;

    const groupId = `yg-${++groupCounter}`;

    // Collapsible year group header
    const headerRow = document.createElement("tr");
    headerRow.className = "week-group-header";
    headerRow.dataset.groupId = groupId;

    const headerTd = document.createElement("td");
    headerTd.colSpan = 6;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "week-group-toggle";
    toggleBtn.textContent = "▼";
    toggleBtn.setAttribute("aria-expanded", "true");
    headerTd.appendChild(toggleBtn);

    const labelSpan = document.createElement("span");
    labelSpan.className = "week-group-label";
    labelSpan.textContent = String(year);
    headerTd.appendChild(labelSpan);

    const metaSpan = document.createElement("span");
    metaSpan.className = "week-group-meta";
    metaSpan.textContent = `${yearRows.length} month${yearRows.length !== 1 ? "s" : ""} · ${yearRepairs} repairs · ${kFmtMoney(yearTotal)}`;
    headerTd.appendChild(metaSpan);

    headerRow.appendChild(headerTd);
    fragment.appendChild(headerRow);

    // Individual month rows under this year group
    yearRows.forEach((r) => {
      const pdEngineReps = r.engineReplacements || 0;
      const civEngineReps = r.civEngineReplacements || 0;
      const totalEngineReps = pdEngineReps + civEngineReps;
      const engineValue = calculateEngineValue(r.engineReplacementsByDept || {});
      const totalValue = r.repairs * REPAIR_RATE + engineValue + (r.harnessKitBillingAccumulated || 0);
      const totalHarnessCount = (r.harnessPD || 0) + (r.harnessCiv || 0);
      const totalAdvKitCount = (r.advKitPD || 0) + (r.advKitCiv || 0);

      const acrossPD = r.acrossPD || 0;
      const acrossCiv = r.acrossCiv || 0;
      const repairsLabel = acrossCiv > 0
        ? `${r.repairs} <span class="label-soft" title="${acrossPD} PD / ${acrossCiv} CIV" style="font-size:0.75em">(${acrossPD}PD/${acrossCiv}CIV)</span>`
        : String(r.repairs);

      const tr = document.createElement("tr");
      tr.className = "week-group-row";
      tr.dataset.groupId = groupId;
      tr.innerHTML = `
        <td>${kFmtDate(r.monthEnd)}</td>
        <td class="col-count">${repairsLabel}</td>
        <td class="col-count">${totalEngineReps}</td>
        <td class="col-count">${totalHarnessCount}</td>
        <td class="col-count">${totalAdvKitCount}</td>
        <td class="col-amount amount-in">${kFmtMoney(totalValue)}</td>
      `;
      fragment.appendChild(tr);
    });
  });

  monthlyBody.appendChild(fragment);

  if (headerCell) {
    headerCell.innerHTML = `
      <div>Total Repair Value</div>
      <div class="th-total-amount">${kFmtMoney(grandTotalValue)}</div>
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
      '<tr><td colspan="12" style="padding:8px; color:#6b7280;">No jobs for this selection.</td></tr>';
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

  // Group sorted rows by month for collapsible sections
  const byMonth = new Map();
  rows.forEach((j) => {
    const mKey = j.mKey || "unknown";
    if (!byMonth.has(mKey)) byMonth.set(mKey, { monthEnd: j.monthEnd, jobs: [] });
    byMonth.get(mKey).jobs.push(j);
  });

  // Preserve insertion order (already sorted by monthEnd above)
  const monthBuckets = Array.from(byMonth.values());
  let groupCounter = 0;
  const fragment = document.createDocumentFragment();

  monthBuckets.forEach(({ monthEnd, jobs: monthJobs }) => {
    let monthTotal = 0;
    monthJobs.forEach((j) => {
      const pdEngineReps = j.engineReplacements || 0;
      const engineRate = (j.department === "BCSO" && pdEngineReps > 0) ?
        ENGINE_REPLACEMENT_RATE_BCSO : ENGINE_REPLACEMENT_RATE;
      monthTotal += j.across * REPAIR_RATE + pdEngineReps * engineRate
        + ((j.harnessPD || 0) + (j.harnessCiv || 0)) * HARNESS_BILLING_RATE
        + ((j.advKitPD || 0) + (j.advKitCiv || 0)) * ADVANCED_REPAIR_KIT_BILLING_RATE;
    });

    const groupId = `jg-${++groupCounter}`;

    // Collapsible month group header
    const headerRow = document.createElement("tr");
    headerRow.className = "week-group-header";
    headerRow.dataset.groupId = groupId;

    const headerTd = document.createElement("td");
    headerTd.colSpan = 12;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "week-group-toggle";
    toggleBtn.textContent = "▼";
    toggleBtn.setAttribute("aria-expanded", "true");
    headerTd.appendChild(toggleBtn);

    const labelSpan = document.createElement("span");
    labelSpan.className = "week-group-label";
    labelSpan.textContent = `Month ending ${kFmtDate(monthEnd)}`;
    headerTd.appendChild(labelSpan);

    const metaSpan = document.createElement("span");
    metaSpan.className = "week-group-meta";
    metaSpan.textContent = `${monthJobs.length} job${monthJobs.length !== 1 ? "s" : ""} · ${kFmtMoney(monthTotal)}`;
    headerTd.appendChild(metaSpan);

    headerRow.appendChild(headerTd);
    fragment.appendChild(headerRow);

    // Individual job rows under this month group
    monthJobs.forEach((j) => {
      const pdEngineReps = j.engineReplacements || 0;
      const civEngineReps = j.civEngineReplacements || 0;
      const pdEngineLabel = pdEngineReps ? "Yes" : "No";
      // Use BCSO rate for BCSO engine replacements, standard rate for others
      const engineRate = (j.department === "BCSO" && pdEngineReps > 0) ?
        ENGINE_REPLACEMENT_RATE_BCSO : ENGINE_REPLACEMENT_RATE;
      const totalHarnessCount = (j.harnessPD || 0) + (j.harnessCiv || 0);
      const totalAdvKitCount = (j.advKitPD || 0) + (j.advKitCiv || 0);
      const totalValue =
        j.across * REPAIR_RATE + pdEngineReps * engineRate
        + totalHarnessCount * HARNESS_BILLING_RATE
        + totalAdvKitCount * ADVANCED_REPAIR_KIT_BILLING_RATE;

      const mechLabel = j.mechanic; // keep Jobs view as raw mechanic name

      const tr = document.createElement("tr");
      tr.className = "week-group-row";
      tr.dataset.groupId = groupId;
      tr.innerHTML = `
        <td>${j.tsDate ? kFmtDate(j.tsDate) : ""}</td>
        <td><button class="mech-link link-btn" data-mech="${j.mechanic}">${mechLabel}</button></td>
        <td><button class="owner-link link-btn" data-owner="${j.owner}">${j.owner}</button></td>
        <td><button class="plate-link link-btn" data-plate="${j.plate}">${j.plate}</button></td>
        <td class="col-count">${j.acrossPD || 0}</td>
        <td class="col-count">${j.acrossCiv || 0}</td>
        <td class="col-count">${pdEngineLabel}${civEngineReps > 0 ? ` / ${civEngineReps} CIV` : ""}</td>
        <td class="col-count">${totalHarnessCount}</td>
        <td class="col-count">${totalAdvKitCount}</td>
        <td>${kFmtDate(j.weekEnd)}</td>
        <td>${kFmtDate(j.monthEnd)}</td>
        <td class="col-amount amount-in">${kFmtMoney(totalValue)}</td>
      `;
      fragment.appendChild(tr);
    });
  });

  jobsBody.appendChild(fragment);
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
  let totalEnginePay = 0;
  let totalHarnessKitPay = 0;
  const weekSet = new Set();
  let lastJob = null;
  mechanicLatestWeekISO = null;

  mechJobs.forEach((j) => {
    const rep = Number(j.across || 0) || 0;
    totalRepairs += rep;
    totalEnginePay += j.enginePayForMechanic || 0;
    totalHarnessKitPay += j.harnessKitPay || 0;

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
  const totalPayout = totalRepairs * PAY_PER_REPAIR + totalEnginePay + totalHarnessKitPay;

  if (nameEl) nameEl.textContent = mech;
  if (totalRepairsEl) totalRepairsEl.textContent = totalRepairs.toLocaleString();
  if (weeksWorkedEl) weeksWorkedEl.textContent = String(weeksWorked);
  if (avgPerWeekEl) avgPerWeekEl.textContent = avgPerWeek.toFixed(1);
  if (totalPayoutEl) totalPayoutEl.textContent = kFmtMoney(totalPayout);
  if (lastJobEl) lastJobEl.textContent = lastJob ? kFmtDate(lastJob) : "—";

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
        acrossPD: 0,
        acrossCiv: 0,
        engineReplacements: 0,
        civEngineReplacements: 0,
        engineReplacementsByDept: {},
        enginePayAccumulated: 0,
        harnessPD: 0,
        harnessCiv: 0,
        advKitPD: 0,
        advKitCiv: 0,
        harnessKitPayAccumulated: 0,
      };
      w.repairs += j.across;
      w.acrossPD += j.acrossPD || 0;
      w.acrossCiv += j.acrossCiv || 0;
      w.engineReplacements += j.engineReplacements;
      w.civEngineReplacements += j.civEngineReplacements || 0;
      w.enginePayAccumulated += j.enginePayForMechanic || 0;
      w.harnessPD += j.harnessPD || 0;
      w.harnessCiv += j.harnessCiv || 0;
      w.advKitPD += j.advKitPD || 0;
      w.advKitCiv += j.advKitCiv || 0;
      w.harnessKitPayAccumulated += j.harnessKitPay || 0;
      if (j.engineReplacements > 0 && j.department) {
        w.engineReplacementsByDept[j.department] = 
          (w.engineReplacementsByDept[j.department] || 0) + j.engineReplacements;
      }
      weeklyMap.set(wKey, w);
    });

    const filtered = Array.from(weeklyMap.values());
    if (!filtered.length) return;

    const rows = filtered.map((r) => {
      const pay = r.repairs * PAY_PER_REPAIR + r.enginePayAccumulated + r.harnessKitPayAccumulated;
      const mechLabel = labelWithStateId(r.mechanic);
      const comment = commentForWeek(r.weekEnd);
      return {
        Mechanic: mechLabel,
        "Week Ending": kFmtDate(r.weekEnd),
        "PD Repairs": r.acrossPD,
        "CIV Repairs": r.acrossCiv,
        "# Total Repairs": r.repairs,
        "Harness": (r.harnessPD || 0) + (r.harnessCiv || 0),
        "Repair Kits": (r.advKitPD || 0) + (r.advKitCiv || 0),
        [`Pay ($${PAY_PER_REPAIR}/repair + engines + items)`]: pay,
        Comment: comment,
      };
    });

    const cols = [
      "Mechanic",
      "Week Ending",
      "PD Repairs",
      "CIV Repairs",
      "# Total Repairs",
      "Harness",
      "Repair Kits",
      `Pay ($${PAY_PER_REPAIR}/repair + engines + items)`,
      "Comment",
    ];
    kDownloadCsv("payouts_weekly_filtered.csv", kToCsv(cols, rows));
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
        acrossPD: 0,
        acrossCiv: 0,
        engineReplacements: 0,
        civEngineReplacements: 0,
        engineReplacementsByDept: {},
        harnessPD: 0,
        harnessCiv: 0,
        advKitPD: 0,
        advKitCiv: 0,
        harnessKitBillingAccumulated: 0,
      };
      mAgg.repairs += j.across;
      mAgg.acrossPD += j.acrossPD || 0;
      mAgg.acrossCiv += j.acrossCiv || 0;
      mAgg.engineReplacements += j.engineReplacements;
      mAgg.civEngineReplacements += j.civEngineReplacements || 0;
      mAgg.harnessPD += j.harnessPD || 0;
      mAgg.harnessCiv += j.harnessCiv || 0;
      mAgg.advKitPD += j.advKitPD || 0;
      mAgg.advKitCiv += j.advKitCiv || 0;
      mAgg.harnessKitBillingAccumulated +=
        ((j.harnessPD || 0) + (j.harnessCiv || 0)) * HARNESS_BILLING_RATE +
        ((j.advKitPD || 0) + (j.advKitCiv || 0)) * ADVANCED_REPAIR_KIT_BILLING_RATE;
      if (j.engineReplacements > 0 && j.department) {
        mAgg.engineReplacementsByDept[j.department] = 
          (mAgg.engineReplacementsByDept[j.department] || 0) + j.engineReplacements;
      }
      monthlyMap.set(j.mKey, mAgg);
    });

    const rows = Array.from(monthlyMap.values());
    if (!rows.length) return;

    const mapped = rows.map((r) => {
      const pdEngineReps = r.engineReplacements || 0;
      const civEngineReps = r.civEngineReplacements || 0;
      const engineValue = calculateEngineValue(r.engineReplacementsByDept || {});
      const totalValue = r.repairs * REPAIR_RATE + engineValue + (r.harnessKitBillingAccumulated || 0);
      return {
        "Month Ending": kFmtDate(r.monthEnd),
        "PD Repairs": r.acrossPD,
        "CIV Repairs": r.acrossCiv,
        "Total Repairs (Across)": r.repairs,
        "PD Engine Replacements": pdEngineReps,
        "CIV Engine Replacements": civEngineReps,
        "Harness": (r.harnessPD || 0) + (r.harnessCiv || 0),
        "Repair Kits": (r.advKitPD || 0) + (r.advKitCiv || 0),
        "Total Repair Value": totalValue,
      };
    });

    const cols = [
      "Month Ending",
      "PD Repairs",
      "CIV Repairs",
      "Total Repairs (Across)",
      "PD Engine Replacements",
      "CIV Engine Replacements",
      "Harness",
      "Repair Kits",
      "Total Repair Value",
    ];
    kDownloadCsv("payouts_monthly_filtered.csv", kToCsv(cols, mapped));
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
      const pdEngineReps = j.engineReplacements || 0;
      const civEngineReps = j.civEngineReplacements || 0;
      const pdEngineLabel = pdEngineReps ? "Yes" : "No";
      const civEngineLabel = civEngineReps ? "Yes" : "No";
      // Use BCSO rate for BCSO, standard rate for others
      const engineRate = (j.department === "BCSO" && pdEngineReps > 0) ? 
                         ENGINE_REPLACEMENT_RATE_BCSO : ENGINE_REPLACEMENT_RATE;
      const totalHarnessCount = (j.harnessPD || 0) + (j.harnessCiv || 0);
      const totalAdvKitCount = (j.advKitPD || 0) + (j.advKitCiv || 0);
      const totalValue = j.across * REPAIR_RATE + pdEngineReps * engineRate
        + totalHarnessCount * HARNESS_BILLING_RATE
        + totalAdvKitCount * ADVANCED_REPAIR_KIT_BILLING_RATE;
      return {
        Timestamp: j.tsDate ? kFmtDate(j.tsDate) : "",
        Mechanic: j.mechanic,
        Owner: j.owner,
        Plate: j.plate,
        "PD Repairs": j.acrossPD || 0,
        "CIV Repairs": j.acrossCiv || 0,
        "Total Repairs": j.across,
        "PD Engine Replacement": pdEngineLabel,
        "CIV Engine Replacement": civEngineLabel,
        "Harness": totalHarnessCount,
        "Repair Kits": totalAdvKitCount,
        "Week Ending": kFmtDate(j.weekEnd),
        "Month Ending": kFmtDate(j.monthEnd),
        "Total Value": totalValue,
      };
    });

    const cols = [
      "Timestamp",
      "Mechanic",
      "Owner",
      "Plate",
      "PD Repairs",
      "CIV Repairs",
      "Total Repairs",
      "PD Engine Replacement",
      "CIV Engine Replacement",
      "Harness",
      "Repair Kits",
      "Week Ending",
      "Month Ending",
      "Total Value",
    ];
    kDownloadCsv("payouts_jobs_filtered.csv", kToCsv(cols, mapped));
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

  // Create bill rows with proper rates (PD billing only — CIV repairs not charged to department)
  const billRows = filteredJobs.map((j) => {
    const engineReps = j.engineReplacements || 0;
    // Use BCSO rate for BCSO, standard rate for others
    const engineRate = (j.department === "BCSO" && engineReps > 0) ? 
                       ENGINE_REPLACEMENT_RATE_BCSO : ENGINE_REPLACEMENT_RATE;
    const repairValue = (j.acrossPD || 0) * REPAIR_RATE;
    const engineValue = engineReps * engineRate;
    const totalValue = repairValue + engineValue;

    return {
      "Date": j.tsDate ? kFmtDate(j.tsDate) : "",
      "Mechanic": j.mechanic,
      "Owner": j.owner,
      "Plate": j.plate,
      "Department": j.department,
      "PD Repairs (Across)": j.acrossPD || 0,
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
  const totalRepairs = billRows.reduce((sum, r) => sum + r["PD Repairs (Across)"], 0);
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
    "PD Repairs (Across)": totalRepairs,
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
    "PD Repairs (Across)",
    "Repair Value",
    "Engine Replacements",
    "Engine Replacement Value",
    "Total",
  ];

  const monthDate = monthKeyToDate.get(month);
  const monthStr = monthDate ? kFmtDate(monthDate).replace(/\//g, "-") : month;
  const filename = `bill_${dept}_${monthStr}.csv`;
  
  kDownloadCsv(filename, kToCsv(cols, billRows));
}


// ===== Generate Department Invoice (BCSO / LSPD) =====
// Produces a detailed CSV invoice for the selected department and month.
// Mechanic process-payments remain unchanged and mechanic-only.
function populateInvoiceMonthSelect() {
  const sel = document.getElementById("invoiceMonthSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">Select Month…</option>';
  Array.from(monthKeys)
    .sort((a, b) => monthKeyToDate.get(b) - monthKeyToDate.get(a))
    .forEach((key) => {
      const d = monthKeyToDate.get(key);
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = kFmtDate(d);
      sel.appendChild(opt);
    });
}

function generateDeptInvoice(dept) {
  const sel = document.getElementById("invoiceMonthSelect");
  const mKey = sel ? sel.value : "";

  if (!mKey) {
    kShowToast("Please select a month for the invoice.", "warning", 3000);
    return;
  }

  const filteredJobs = jobs.filter((j) => j.department === dept && j.mKey === mKey);

  if (!filteredJobs.length) {
    kShowToast(`No jobs found for ${dept} in the selected month.`, "error", 3000);
    return;
  }

  // Sort chronologically
  const sortedJobs = filteredJobs.slice().sort((a, b) => {
    if (a.tsDate && b.tsDate) return a.tsDate - b.tsDate;
    return 0;
  });

  const engineRate = dept === "BCSO" ? ENGINE_REPLACEMENT_RATE_BCSO : ENGINE_REPLACEMENT_RATE;

  const billRows = sortedJobs.map((j) => {
    const engineReps = j.engineReplacements || 0;
    const repairValue = (j.acrossPD || 0) * REPAIR_RATE;
    const engineValue = engineReps * engineRate;
    const total = repairValue + engineValue;
    return {
      "Date": j.tsDate ? kFmtDate(j.tsDate) : "",
      "Mechanic": j.mechanic,
      "Officer / Owner": j.owner,
      "License Plate": j.plate,
      "PD Repairs": j.acrossPD || 0,
      "Engine Replacements": engineReps,
      "Repair Value ($)": repairValue,
      "Engine Replacement Value ($)": engineValue,
      "Total ($)": total,
    };
  });

  // Calculate totals
  const totalRepairs = billRows.reduce((s, r) => s + r["PD Repairs"], 0);
  const totalEngines = billRows.reduce((s, r) => s + r["Engine Replacements"], 0);
  const totalRepairValue = billRows.reduce((s, r) => s + r["Repair Value ($)"], 0);
  const totalEngineValue = billRows.reduce((s, r) => s + r["Engine Replacement Value ($)"], 0);
  const grandTotal = billRows.reduce((s, r) => s + r["Total ($)"], 0);

  // Add a blank separator then summary row
  billRows.push({
    "Date": "",
    "Mechanic": "",
    "Officer / Owner": "",
    "License Plate": "TOTAL",
    "PD Repairs": totalRepairs,
    "Engine Replacements": totalEngines,
    "Repair Value ($)": totalRepairValue,
    "Engine Replacement Value ($)": totalEngineValue,
    "Total ($)": grandTotal,
  });

  const cols = [
    "Date",
    "Mechanic",
    "Officer / Owner",
    "License Plate",
    "PD Repairs",
    "Engine Replacements",
    "Repair Value ($)",
    "Engine Replacement Value ($)",
    "Total ($)",
  ];

  const monthDate = monthKeyToDate.get(mKey);
  const monthStr = monthDate ? kFmtDate(monthDate).replace(/\//g, "-") : mKey;
  const filename = `invoice_${dept}_${monthStr}.csv`;

  kDownloadCsv(filename, kToCsv(cols, billRows));
  kShowToast(`${dept} invoice for ${monthStr} downloaded!`, "success", 3000);
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
    kSyncNavLinksWithCurrentSearch();
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
  kSyncNavLinksWithCurrentSearch();

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
        const acrossPD = parseInt(copyBtn.dataset.pdRepairs, 10) || 0;
        const acrossCiv = parseInt(copyBtn.dataset.civRepairs, 10) || 0;
        const pdEngineReps = parseInt(copyBtn.dataset.pdEngineReps, 10) || 0;
        const civEngineReps = parseInt(copyBtn.dataset.civEngineReps, 10) || 0;
        const enginePay = parseFloat(copyBtn.dataset.enginePay) || 0;
        const harnessPD = parseInt(copyBtn.dataset.harnessPd, 10) || 0;
        const harnessCiv = parseInt(copyBtn.dataset.harnessCiv, 10) || 0;
        const advKitPD = parseInt(copyBtn.dataset.advKitPd, 10) || 0;
        const advKitCiv = parseInt(copyBtn.dataset.advKitCiv, 10) || 0;
        const totalPay = parseFloat(copyBtn.dataset.totalPay);
        
        copyWeeklySummary(copyBtn, mechanic, weekEnd, acrossPD, acrossCiv, pdEngineReps, civEngineReps, enginePay, harnessPD, harnessCiv, advKitPD, advKitCiv, totalPay);
      }
    });
    // Event delegation for collapsible week group headers
    weeklyBody.addEventListener("click", (e) => {
      const headerRow = e.target.closest(".week-group-header");
      if (!headerRow) return;
      const groupId = headerRow.dataset.groupId;
      const isCollapsed = headerRow.classList.toggle("collapsed");
      const toggleBtn = headerRow.querySelector(".week-group-toggle");
      if (toggleBtn) {
        toggleBtn.textContent = isCollapsed ? "▶" : "▼";
        toggleBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      }
      weeklyBody.querySelectorAll(`.week-group-row[data-group-id="${groupId}"]`)
        .forEach((row) => row.classList.toggle("hidden", isCollapsed));
    });
  }
  if (monthlyBody) {
    // Event delegation for collapsible year group headers in monthly view
    monthlyBody.addEventListener("click", (e) => {
      const headerRow = e.target.closest(".week-group-header");
      if (!headerRow) return;
      const groupId = headerRow.dataset.groupId;
      const isCollapsed = headerRow.classList.toggle("collapsed");
      const toggleBtn = headerRow.querySelector(".week-group-toggle");
      if (toggleBtn) {
        toggleBtn.textContent = isCollapsed ? "▶" : "▼";
        toggleBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      }
      monthlyBody.querySelectorAll(`.week-group-row[data-group-id="${groupId}"]`)
        .forEach((row) => row.classList.toggle("hidden", isCollapsed));
    });
  }
  if (jobsBody) {
    jobsBody.addEventListener("click", onMechanicClickFromTable);
    // Event delegation for collapsible month group headers in jobs view
    jobsBody.addEventListener("click", (e) => {
      const headerRow = e.target.closest(".week-group-header");
      if (!headerRow) return;
      const groupId = headerRow.dataset.groupId;
      const isCollapsed = headerRow.classList.toggle("collapsed");
      const toggleBtn = headerRow.querySelector(".week-group-toggle");
      if (toggleBtn) {
        toggleBtn.textContent = isCollapsed ? "▶" : "▼";
        toggleBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      }
      jobsBody.querySelectorAll(`.week-group-row[data-group-id="${groupId}"]`)
        .forEach((row) => row.classList.toggle("hidden", isCollapsed));
    });
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
      const totalHarness = mechanicData.reduce((sum, w) => sum + (w.harnessPD || 0) + (w.harnessCiv || 0), 0);
      const totalAdvKit  = mechanicData.reduce((sum, w) => sum + (w.advKitPD || 0) + (w.advKitCiv || 0), 0);

      // Calculate total engine pay using pre-computed accumulated values
      let totalEnginePay = 0;
      mechanicData.forEach(w => {
        totalEnginePay += w.enginePayAccumulated || 0;
      });

      // Calculate harness/kit mechanic pay
      const totalHarnessKitPay = totalHarness * HARNESS_RATE + totalAdvKit * ADVANCED_REPAIR_KIT_RATE;

      const totalPayout = totalRepairs * PAY_PER_REPAIR + totalEnginePay + totalHarnessKitPay;
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
        totalHarness: totalHarness,
        totalAdvKit: totalAdvKit,
        harnessKitPay: totalHarnessKitPay,
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

  // Department invoice buttons
  const generateBcsoInvoiceBtn = document.getElementById("generateBcsoInvoiceBtn");
  if (generateBcsoInvoiceBtn) {
    generateBcsoInvoiceBtn.addEventListener("click", () => generateDeptInvoice("BCSO"));
  }

  const generateLspdInvoiceBtn = document.getElementById("generateLspdInvoiceBtn");
  if (generateLspdInvoiceBtn) {
    generateLspdInvoiceBtn.addEventListener("click", () => generateDeptInvoice("LSPD"));
  }

  // Initial load
  loadPayouts();
});
