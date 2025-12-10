// ===== Config (using KINTSUGI_SHEET_ID from kintsugi-core.js) =====
const MECH_JOBS_SHEET = "Form responses 1";
const MECH_PAY_PER_REPAIR = 700;

// ===== State =====
let mechJobs = [];      // raw parsed jobs
let mechStats = [];     // aggregated per-mechanic stats

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

// ===== CSV fetch (using kintsugi-core.js) =====
async function mechFetchCSV(sheetName) {
  return await kFetchCSV(sheetName, { header: false });
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
}

// ===== Data load =====
async function mechLoad() {
  try {
    if (statusEl) statusEl.textContent = "Loading mechanics…";

    const data = await mechFetchCSV(MECH_JOBS_SHEET);
    if (!data.length || data.length < 2) {
      throw new Error("No rows in Form responses 1.");
    }

    const headers = data[0].map((h) => (h || "").trim());

    const iTime = headers.indexOf("Timestamp");
    const iMech = headers.indexOf("Mechanic");
    const iAcross = headers.indexOf("How many Across");
    const iWeek = headers.indexOf("Week Ending");
    const iMonth = headers.indexOf("Month Ending");

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
    searchBoxEl.addEventListener("input", mechApplyFiltersAndRender);
  }

  mechLoad();
});
