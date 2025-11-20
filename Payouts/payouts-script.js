// ===== Config =====
const SHEET_ID = "1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks";
const PAYOUTS_SHEET = "Form responses 1";
const STATE_ID_SHEET = "State ID's";

const PAY_PER_REPAIR = 700;
const REPAIR_RATE = 2500;              // per across, customer billing
const ENGINE_REPLACEMENT_RATE = 12000; // per engine replacement, customer billing
const ENGINE_REPLACEMENT_MECH_PAY = 500; // per engine replacement, mechanic payout

// ===== State =====
let weeklyAgg = [];   // mechanic-week aggregates
let monthlyAgg = [];  // month aggregates
let jobs = [];        // raw jobs
let mechanicLatestWeekISO = null; // latest week for current mechanic summary

let mechanics = new Set();
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

// ===== CSV fetch & parse =====
function sheetCsvUrl(sheet) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheet
  )}`;
}

async function fetchCSV(sheet) {
  const res = await fetch(sheetCsvUrl(sheet));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error("Got HTML instead of CSV; check sharing.");
  }
  return parseCSV(text);
}

// Minimal CSV parser (no Papa dependency)
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cur);
    cur = "";
  };

  const pushRow = () => {
    if (row.length || cur) {
      pushCell();
      rows.push(row);
      row = [];
    }
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") pushCell();
      else if (c === "\r") continue;
      else if (c === "\n") pushRow();
      else cur += c;
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

  // dd/mm/yyyy or dd-mm-yyyy
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d.getTime()) ? null : d;
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const yyyy = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// US MM/DD/YYYY
function fmtDate(d) {
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtMoney(n) {
  return (
    "$" +
    (n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })
  );
}

// Weekly payout comment helper
function commentForWeek(weekEndDate) {
  return `Payout for week ending ${fmtDate(weekEndDate)}`;
}

// ===== CSV export helpers =====
function toCsv(cols, rows) {
  const esc = (val) => {
    if (val == null) return "";
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const lines = rows.map((r) => cols.map((c) => esc(r[c])).join(","));
  return [head, ...lines].join("\n");
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
      fetchCSV(STATE_ID_SHEET),
      fetchCSV(PAYOUTS_SHEET),
    ]);

    buildStateIdMap(stateRows);

    if (data.length < 2) throw new Error("No rows in Form responses 1.");

    const headers = data[0].map((h) => h.trim());
    const headersLower = headers.map((h) => h.toLowerCase());

    const iTime = headers.indexOf("Timestamp");
    const iMech = headers.indexOf("Mechanic");
    const iOwner = headers.indexOf("Owner of Vehicle");
    const iPlate = headers.indexOf("Vehicle Plate");
    const iAcross = headers.indexOf("How many Across");
    const iWeek = headers.indexOf("Week Ending");
    const iMonth = headers.indexOf("Month Ending");
    // any header that contains both "engine" and "replacement"
    const iEngine = headersLower.findIndex(
      (h) => h.includes("engine") && h.includes("replacement")
    );

    if (iMech === -1 || iAcross === -1 || iWeek === -1 || iMonth === -1) {
      throw new Error("Missing required columns.");
    }

    weeklyAgg = [];
    monthlyAgg = [];
    jobs = [];
    mechanics.clear();
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

      mechanics.add(mech);

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
        };
      w.repairs += across;
      w.engineReplacements += engineCount;
      weeklyMap.set(wKey, w);

      // Monthly agg
      const mAgg =
        monthlyMap.get(mKey) || {
          monthEnd,
          mKey,
          repairs: 0,
          engineReplacements: 0,
        };
      mAgg.repairs += across;
      mAgg.engineReplacements += engineCount;
      monthlyMap.set(mKey, mAgg);

      // Jobs table
      jobs.push({
        tsDate,
        mechanic: mech,
        owner,
        plate,
        across,
        engineReplacements: engineCount,
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
  const weekSel = document.getElementById("weekFilter");
  const monthSel = document.getElementById("monthFilter");
  return {
    mech: mechSel ? mechSel.value : "all",
    week: weekSel ? weekSel.value : "all",
    month: monthSel ? monthSel.value : "all",
  };
}

// ===== Weekly view =====
function renderWeekly() {
  const { mech, week } = getFilters(); // month ignored in weekly
  weeklyBody.innerHTML = "";

  const filtered = weeklyAgg.filter((r) => {
    if (mech !== "all" && r.mechanic !== mech) return false;
    if (week !== "all" && r.weekISO !== week) return false;
    return true;
  });

  if (!filtered.length) {
    weeklyBody.innerHTML =
      '<tr><td colspan="4" style="padding:8px; color:#6b7280;">No weekly records for this selection.</td></tr>';
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
      const enginePay =
        (r.engineReplacements || 0) * ENGINE_REPLACEMENT_MECH_PAY;
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
      `;
      weeklyBody.appendChild(tr);
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
      <td colspan="4">Total for week ending ${fmtDate(
        weekEnd
      )}${mechBreakdown ? " — " + mechBreakdown : ""}</td>
    `;
    weeklyBody.appendChild(totalRow);

    summarySource.push({ weekEnd, weekTotal, mechTotals });
  });

  updateWeeklySummary(summarySource);
}

// Summary line above weekly table (currently unused)
function updateWeeklySummary(weekBuckets) {
  if (!weeklySummaryEl) return;
  weeklySummaryEl.textContent = "";
}

// ===== Monthly view =====
function renderMonthly() {
  const { month } = getFilters();
  monthlyBody.innerHTML = "";

  const headerCell = document.getElementById("monthlyTotalHeader");

  if (!monthlyAgg.length) {
    monthlyBody.innerHTML =
      '<tr><td colspan="4" style="padding:8px; color:#6b7280;">No monthly records.</td></tr>';
    if (headerCell) {
      headerCell.textContent = "Total Repair Value ($2,500/repair)";
    }
    return;
  }

  let rows = monthlyAgg.slice();
  if (month !== "all") {
    rows = rows.filter((r) => r.mKey === month);
  }

  rows.sort((a, b) =>
    monthSortDesc ? b.monthEnd - a.monthEnd : a.monthEnd - b.monthEnd
  );

  if (!rows.length) {
    monthlyBody.innerHTML =
      '<tr><td colspan="4" style="padding:8px; color:#6b7280;">No monthly records for this selection.</td></tr>';
    if (headerCell) {
      headerCell.textContent = "Total Repair Value ($2,500/repair)";
    }
    return;
  }

  let grandTotalValue = 0;

  rows.forEach((r) => {
    const engineReps = r.engineReplacements || 0;
    const totalValue =
      r.repairs * REPAIR_RATE + engineReps * ENGINE_REPLACEMENT_RATE;
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
  const { mech, week, month } = getFilters();
  jobsBody.innerHTML = "";

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
    const totalValue =
      j.across * REPAIR_RATE + engineReps * ENGINE_REPLACEMENT_RATE;

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

  mechJobs.forEach((j) => {
    const rep = Number(j.across || 0) || 0;
    const engines = Number(j.engineReplacements || 0) || 0;
    totalRepairs += rep;
    totalEngineReps += engines;

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
  const totalPayout =
    totalRepairs * PAY_PER_REPAIR +
    totalEngineReps * ENGINE_REPLACEMENT_MECH_PAY;

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
  const { mech, week, month } = getFilters();

  if (currentView === "weekly") {
    const filtered = weeklyAgg.filter((r) => {
      if (mech !== "all" && r.mechanic !== mech) return false;
      if (week !== "all" && r.weekISO !== week) return false;
      return true;
    });
    if (!filtered.length) return;

    const rows = filtered.map((r) => {
      const enginePay =
        (r.engineReplacements || 0) * ENGINE_REPLACEMENT_MECH_PAY;
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
    if (!monthlyAgg.length) return;

    let rows = monthlyAgg.slice();
    if (month !== "all") {
      rows = rows.filter((r) => r.mKey === month);
    }
    if (!rows.length) return;

    const mapped = rows.map((r) => {
      const engineReps = r.engineReplacements || 0;
      const totalValue =
        r.repairs * REPAIR_RATE + engineReps * ENGINE_REPLACEMENT_RATE;
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
      const totalValue =
        j.across * REPAIR_RATE + engineReps * ENGINE_REPLACEMENT_RATE;
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

// ===== Nav sync (keep tabs using current querystring) =====
function syncNavLinksWithCurrentSearch() {
  const qs = window.location.search || "";
  const links = document.querySelectorAll(".nav-tabs a");
  links.forEach((a) => {
    if (!a) return;
    const current = a.getAttribute("href") || "";
    // Store the "base" href once (no query)
    let base = a.getAttribute("data-base-href");
    if (!base) {
      base = current.split("?")[0];
      a.setAttribute("data-base-href", base);
    }
    a.setAttribute("href", base + qs);
  });
}

function updateUrlFromState() {
  try {
    const params = new URLSearchParams(window.location.search);
    const { mech, week, month } = getFilters();
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
  const weekSel = document.getElementById("weekFilter");
  const monthSel = document.getElementById("monthFilter");

  const mech = initialParams.get("mech");
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
  const weekSel = document.getElementById("weekFilter");
  const monthSel = document.getElementById("monthFilter");
  mechSel && mechSel.addEventListener("change", renderAll);
  weekSel && weekSel.addEventListener("change", renderAll);
  monthSel && monthSel.addEventListener("change", renderAll);

  // Quick presets
  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      if (preset) applyQuickPreset(preset);
    });
  });

  // Jobs search
  if (jobsSearchInput) {
    jobsSearchInput.addEventListener("input", () => {
      if (currentView === "jobs") {
        renderAll();
      } else {
        // still update URL for cross-page search usage
        updateUrlFromState();
      }
    });
  }

  // Advanced filters
  if (advancedToggleBtn && advancedFiltersPanel) {
    advancedToggleBtn.addEventListener("click", () => {
      advancedFiltersPanel.classList.toggle("hidden");
    });
  }

  if (ownerFilterInput) {
    ownerFilterInput.addEventListener("input", () => {
      if (currentView === "jobs") renderAll();
    });
  }

  if (plateFilterInput) {
    plateFilterInput.addEventListener("input", () => {
      if (currentView === "jobs") renderAll();
    });
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
