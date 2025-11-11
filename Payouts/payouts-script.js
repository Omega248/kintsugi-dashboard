// ===== Config =====
const SHEET_ID = "1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks";
const PAYOUTS_SHEET = "Form responses 1";

const PAY_PER_REPAIR = 700;
const REPAIR_RATE = 2500; // for monthly summary

// ===== State =====
let weeklyAgg = [];   // mechanic-week aggregates
let monthlyAgg = [];  // month aggregates
let jobs = [];        // raw jobs

let mechanics = new Set();
let monthKeys = new Set(); // still used for Monthly view
let weekKeys = new Set();  // used for Week Ending filter

let currentView = "weekly";
let weekSortDesc = true; // sort by week ending

// DOM refs
let statusEl;
let weeklySummaryEl;
let exportBtn;
let sortWeekBtn;
let weeklyBody;
let monthlyBody;
let jobsBody;

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
    return isNaN(d) ? null : d;
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const yyyy = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// US MM/DD/YYYY
function fmtDate(d) {
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = d.getFullYear();
  return `${mm}/${dd}/${yy}`;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [y, m] = key.split("-");
  const dt = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  const name = dt.toLocaleString("default", { month: "long" });
  return `${name} ${y}`;
}

function fmtMoney(n) {
  return (
    "$" +
    (n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })
  );
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

// ===== Load & aggregate =====
async function loadPayouts() {
  try {
    statusEl.textContent = "Loading from sheet...";

    const data = await fetchCSV(PAYOUTS_SHEET);
    if (data.length < 2) throw new Error("No rows in Form responses 1.");

    const headers = data[0].map((h) => h.trim());
    const iTime = headers.indexOf("Timestamp");
    const iMech = headers.indexOf("Mechanic");
    const iOwner = headers.indexOf("Owner of Vehicle");
    const iPlate = headers.indexOf("Vehicle Plate");
    const iAcross = headers.indexOf("How many Across");
    const iWeek = headers.indexOf("Week Ending");
    const iMonth = headers.indexOf("Month Ending");

    if (iMech === -1 || iAcross === -1 || iWeek === -1 || iMonth === -1) {
      throw new Error("Missing required columns.");
    }

    weeklyAgg = [];
    monthlyAgg = [];
    jobs = [];
    mechanics.clear();
    monthKeys.clear();
    weekKeys.clear();

    const weeklyMap = new Map();  // mech|weekISO -> agg
    const monthlyMap = new Map(); // mKey -> agg

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row || !row.length) continue;

      const mech = (row[iMech] || "").trim();
      if (!mech) continue;

      const across = Number(row[iAcross] || "0") || 0;
      if (!across) continue;

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
        };
      w.repairs += across;
      weeklyMap.set(wKey, w);

      // Monthly agg
      const mAgg =
        monthlyMap.get(mKey) || {
          monthEnd,
          mKey,
          repairs: 0,
        };
      mAgg.repairs += across;
      monthlyMap.set(mKey, mAgg);

      // Jobs table
      jobs.push({
        tsDate,
        mechanic: mech,
        owner,
        plate,
        across,
        weekEnd,
        weekISO,
        monthEnd,
        mKey,
      });
    }

    // Finalize arrays
    weeklyAgg = Array.from(weeklyMap.values());
    monthlyAgg = Array.from(monthlyMap.values()).sort(
      (a, b) => b.monthEnd - a.monthEnd
    );
    jobs.sort((a, b) => {
      if (b.weekEnd - a.weekEnd !== 0) return b.weekEnd - a.weekEnd;
      if (a.tsDate && b.tsDate) return b.tsDate - a.tsDate;
      return 0;
    });

    populateFilters();
    renderAll();

    statusEl.textContent = "Loaded from sheet";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Failed to load from sheet";
  }
}

// ===== Filters =====
function populateFilters() {
  const mechSel = document.getElementById("mechanicFilter");
  const weekSel = document.getElementById("monthFilter"); // reuse select as Week Ending

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
}

// mech + week filter
function getFilters() {
  const mechSel = document.getElementById("mechanicFilter");
  const weekSel = document.getElementById("monthFilter"); // now week ending
  return {
    mech: mechSel ? mechSel.value : "all",
    week: weekSel ? weekSel.value : "all",
  };
}

// ===== Weekly view =====
function renderWeekly() {
  const { mech, week } = getFilters();
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

  // Group by weekISO
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

    // sort mechanics A–Z in each week
    entries.sort((a, b) => a.mechanic.localeCompare(b.mechanic));

    let weekTotal = 0;
    const mechTotals = new Map();

    entries.forEach((r) => {
      const pay = r.repairs * PAY_PER_REPAIR;
      weekTotal += pay;
      mechTotals.set(
        r.mechanic,
        (mechTotals.get(r.mechanic) || 0) + pay
      );

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.mechanic}</td>
        <td>${fmtDate(r.weekEnd)}</td>
        <td class="col-count">${r.repairs}</td>
        <td class="col-amount amount-in">${fmtMoney(pay)}</td>
      `;
      weeklyBody.appendChild(tr);
    });

    // Total for that week (single cell across all columns)
    const totalRow = document.createElement("tr");
    totalRow.className = "week-total-row";

    const mechBreakdown = Array.from(mechTotals.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, pay]) => `${name}: ${fmtMoney(pay)}`)
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

// Summary line above weekly table
function updateWeeklySummary(weekBuckets) {
  if (!weeklySummaryEl) return;
  if (!weekBuckets.length) {
    weeklySummaryEl.textContent = "";
    return;
  }

  let grand = 0;
  const parts = weekBuckets
    .slice()
    .sort((a, b) => b.weekEnd - a.weekEnd)
    .map((w) => {
      grand += w.weekTotal;
      const mechParts = Array.from(w.mechTotals.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, pay]) => `${name}: ${fmtMoney(pay)}`)
        .join(", ");
      return `${fmtDate(w.weekEnd)}: ${fmtMoney(
        w.weekTotal
      )} [${mechParts}]`;
    });

  weeklySummaryEl.textContent =
    "Weekly mechanic payout (visible) " +
    fmtMoney(grand) +
    " — " +
    parts.join(" · ");
}

// ===== Monthly view =====
function renderMonthly() {
  monthlyBody.innerHTML = "";

  if (!monthlyAgg.length) {
    monthlyBody.innerHTML =
      '<tr><td colspan="3" style="padding:8px; color:#6b7280;">No monthly records.</td></tr>';
    return;
  }

  monthlyAgg.forEach((r) => {
    const totalValue = r.repairs * REPAIR_RATE;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(r.monthEnd)}</td>
      <td class="col-count">${r.repairs}</td>
      <td class="col-amount amount-in">${fmtMoney(totalValue)}</td>
    `;
    monthlyBody.appendChild(tr);
  });
}

// ===== Jobs view =====
function renderJobs() {
  const { mech, week } = getFilters();
  jobsBody.innerHTML = "";

  const rows = jobs.filter((j) => {
    if (mech !== "all" && j.mechanic !== mech) return false;
    if (week !== "all" && j.weekISO !== week) return false;
    return true;
  });

  if (!rows.length) {
    jobsBody.innerHTML =
      '<tr><td colspan="7" style="padding:8px; color:#6b7280;">No jobs for this selection.</td></tr>';
    return;
  }

  rows.forEach((j) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${j.tsDate ? fmtDate(j.tsDate) : ""}</td>
      <td>${j.mechanic}</td>
      <td>${j.owner}</td>
      <td>${j.plate}</td>
      <td class="col-count">${j.across}</td>
      <td>${fmtDate(j.weekEnd)}</td>
      <td>${fmtDate(j.monthEnd)}</td>
    `;
    jobsBody.appendChild(tr);
  });
}

// ===== Export current view =====
function exportCurrentViewCsv() {
  const { mech, week } = getFilters();

  if (currentView === "weekly") {
    const filtered = weeklyAgg.filter((r) => {
      if (mech !== "all" && r.mechanic !== mech) return false;
      if (week !== "all" && r.weekISO !== week) return false;
      return true;
    });
    if (!filtered.length) return;

    const rows = filtered.map((r) => ({
      Mechanic: r.mechanic,
      "Week Ending": fmtDate(r.weekEnd),
      "# Repairs": r.repairs,
      [`Pay ($${PAY_PER_REPAIR}/repair)`]:
        r.repairs * PAY_PER_REPAIR,
    }));

    const cols = [
      "Mechanic",
      "Week Ending",
      "# Repairs",
      `Pay ($${PAY_PER_REPAIR}/repair)`,
    ];
    downloadCsv("payouts_weekly_filtered.csv", toCsv(cols, rows));
  } else if (currentView === "monthly") {
    if (!monthlyAgg.length) return;

    const rows = monthlyAgg.map((r) => ({
      "Month Ending": fmtDate(r.monthEnd),
      "Total Repairs": r.repairs,
      [`Total Repair Value ($${REPAIR_RATE}/repair)`]:
        r.repairs * REPAIR_RATE,
    }));

    const cols = [
      "Month Ending",
      "Total Repairs",
      `Total Repair Value ($${REPAIR_RATE}/repair)`,
    ];
    downloadCsv("payouts_monthly_all.csv", toCsv(cols, rows));
  } else {
    const filtered = jobs.filter((j) => {
      if (mech !== "all" && j.mechanic !== mech) return false;
      if (week !== "all" && j.weekISO !== week) return false;
      return true;
    });
    if (!filtered.length) return;

    const rows = filtered.map((j) => ({
      Timestamp: j.tsDate ? fmtDate(j.tsDate) : "",
      Mechanic: j.mechanic,
      Owner: j.owner,
      Plate: j.plate,
      Across: j.across,
      "Week Ending": fmtDate(j.weekEnd),
      "Month Ending": fmtDate(j.monthEnd),
    }));

    const cols = [
      "Timestamp",
      "Mechanic",
      "Owner",
      "Plate",
      "Across",
      "Week Ending",
      "Month Ending",
    ];
    downloadCsv("payouts_jobs_filtered.csv", toCsv(cols, rows));
  }
}

// ===== View + render orchestration =====
function renderAll() {
  renderWeekly();
  renderMonthly();
  renderJobs();
  updateView();
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
  weeklyBody = document.getElementById("weeklyBody");
  monthlyBody = document.getElementById("monthlyBody");
  jobsBody = document.getElementById("jobsBody");

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
    renderWeekly();
  });

  // Segmented view tabs
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".seg-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentView = btn.dataset.view || "weekly";
      updateView();
    });
  });

  // Filters
  const mechSel = document.getElementById("mechanicFilter");
  const weekSel = document.getElementById("monthFilter");
  mechSel && mechSel.addEventListener("change", renderAll);
  weekSel && weekSel.addEventListener("change", renderAll);

  // Initial load
  loadPayouts();
});
