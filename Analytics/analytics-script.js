// ===== Config =====
const JOBS_SHEET = "Form responses 1";
const PAY_PER_REPAIR = 700;

// Auto-refresh interval (from constants.js, fallback to 5 min)
const AUTO_REFRESH_MS =
  (typeof DISCORD_CONFIG !== 'undefined'
    ? DISCORD_CONFIG.AUTO_REFRESH_INTERVAL_MS
    : null) || 5 * 60 * 1000;

let analyticsRefreshTimer = null;

// ===== Chart instances =====
let repairsChartInst = null;
let payoutChartInst  = null;
let mechanicChartInst = null;

// ===== Chart.js CDN =====
const CHARTJS_CDN = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";

async function ensureChartJs() {
  if (window.Chart) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHARTJS_CDN;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Chart.js"));
    document.head.appendChild(s);
  });
}

// ===== Helpers =====

function parseDateLike(raw) {
  return kParseDateLike(raw);
}

function getFilterDates(range) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (range) {
    case "last4w":
      return new Date(today.getTime() - 28 * 86400000);
    case "last3m": {
      const d = new Date(today);
      d.setMonth(d.getMonth() - 3);
      return d;
    }
    case "last6m": {
      const d = new Date(today);
      d.setMonth(d.getMonth() - 6);
      return d;
    }
    case "last12m": {
      const d = new Date(today);
      d.setFullYear(d.getFullYear() - 1);
      return d;
    }
    case "thisYear":
      return new Date(today.getFullYear(), 0, 1);
    default:
      return null;
  }
}

function periodKey(date, groupBy) {
  if (groupBy === "month") {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  }
  // ISO week
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function periodLabel(key, groupBy) {
  if (groupBy === "month") {
    const [year, mon] = key.split("-");
    const d = new Date(Number(year), Number(mon) - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  // week key is YYYY-MM-DD (Monday)
  const d = new Date(key + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ===== Chart helpers =====

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(10, 14, 28, 0.95)",
        borderColor: "rgba(79, 70, 229, 0.5)",
        borderWidth: 1,
        titleColor: "#e5e7eb",
        bodyColor: "#9ca3af",
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(31, 41, 55, 0.6)" },
        ticks: { color: "#6b7280", font: { size: 10 } },
      },
      y: {
        grid: { color: "rgba(31, 41, 55, 0.6)" },
        ticks: { color: "#6b7280", font: { size: 10 } },
        beginAtZero: true,
      },
    },
  };
}

function renderLineChart(canvasId, labels, data, label, color, existing) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (existing) existing.destroy();
  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label,
        data,
        borderColor: color,
        backgroundColor: color.replace("1)", "0.12)"),
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.35,
      }],
    },
    options: chartDefaults(),
  });
}

function renderBarChart(canvasId, labels, data, label, colors, existing) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (existing) existing.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: colors || "rgba(79, 70, 229, 0.7)",
        borderColor: colors ? colors.map(c => c.replace("0.7)", "1)")) : "rgba(79, 70, 229, 1)",
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      ...chartDefaults(),
      indexAxis: "y",
      scales: {
        ...chartDefaults().scales,
        x: { ...chartDefaults().scales.x, beginAtZero: true },
      },
    },
  });
}

// ===== Chart placeholder (no Chart.js loaded) =====

function showChartPlaceholder(canvasId, message) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const container = canvas.parentElement;
  canvas.style.display = "none";
  const ph = document.createElement("div");
  ph.className = "chart-placeholder";
  ph.innerHTML = `
    <div class="chart-placeholder-bars">
      ${[65, 85, 50, 75, 90, 60, 80].map(h => `<div class="chart-placeholder-bar" style="height:${h}%"></div>`).join("")}
    </div>
    <span>${message}</span>
  `;
  container.appendChild(ph);
}

// ===== Leaderboard =====

function renderLeaderboard(mechTotals) {
  const el = document.getElementById("leaderboard");
  if (!el) return;

  const sorted = Object.entries(mechTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (!sorted.length) {
    el.innerHTML = '<div class="analytics-empty">No mechanic data available.</div>';
    return;
  }

  const maxReps = sorted[0][1];
  const rankClasses = ["leaderboard-rank--gold", "leaderboard-rank--silver", "leaderboard-rank--bronze"];

  el.innerHTML = sorted.map(([name, reps], i) => {
    const pct = maxReps > 0 ? Math.round((reps / maxReps) * 100) : 0;
    const rankCls = i < 3 ? rankClasses[i] : "";
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1);
    return `
      <div class="leaderboard-row" style="position:relative;overflow:hidden;">
        <div class="leaderboard-rank ${rankCls}">${medal}</div>
        <div class="leaderboard-name" title="${name}">${name}</div>
        <div class="leaderboard-stats">${reps.toLocaleString()} repairs · ${kFmtMoney(reps * PAY_PER_REPAIR)}</div>
        <div class="leaderboard-bar-wrap">
          <div class="leaderboard-bar" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

// ===== This Week Live Panel =====

function setRefreshStatus(state) {
  const dot = document.getElementById("refreshDot");
  const label = document.getElementById("refreshLabel");
  if (!dot || !label) return;

  dot.className = "refresh-dot";
  if (state === "Live") {
    dot.classList.add("refresh-dot--live");
    label.textContent = "Live · auto-refresh every 5 min";
  } else if (state === "Refreshing") {
    dot.classList.add("refresh-dot--refreshing");
    label.textContent = "Refreshing…";
  } else if (state === "Error") {
    dot.classList.add("refresh-dot--error");
    label.textContent = "Error loading data";
  } else {
    label.textContent = "Loading…";
  }
}

/**
 * Populate the "This Week Live" panel with the latest computed values.
 * @param {{ repairsThisWeek, payoutThisWeek, topMechName, topMechRepairs, perMechWeek }} data
 */
function updateThisWeekPanel(data) {
  const { repairsThisWeek, payoutThisWeek, topMechName, topMechRepairs, perMechWeek } = data;

  const repairsEl = document.getElementById("liveWeekRepairs");
  const payoutEl = document.getElementById("liveWeekPayout");
  const topMechEl = document.getElementById("liveTopMech");
  const topMechSubEl = document.getElementById("liveTopMechSub");
  const mechanicsEl = document.getElementById("liveWeekMechanics");
  const detailEl = document.getElementById("liveWeekMechanicsDetail");

  if (repairsEl) repairsEl.textContent = repairsThisWeek.toLocaleString();
  if (payoutEl) payoutEl.textContent = kFmtMoney(payoutThisWeek);

  if (topMechEl) topMechEl.textContent = topMechName || "—";
  if (topMechSubEl) {
    topMechSubEl.textContent = topMechName
      ? topMechRepairs + " repairs · " + kFmtMoney(topMechRepairs * PAY_PER_REPAIR)
      : "";
  }

  const mechCount = Object.keys(perMechWeek).length;
  if (mechanicsEl) mechanicsEl.textContent = mechCount.toLocaleString();

  if (detailEl) {
    if (!mechCount) {
      detailEl.textContent = "No repairs logged this week.";
      detailEl.className = "this-week-mechanics this-week-mechanics--empty";
      return;
    }
    detailEl.className = "this-week-mechanics";

    const sorted = Object.entries(perMechWeek).sort((a, b) => b[1] - a[1]);
    const items = sorted.map(([name, reps]) => {
      const pay = reps * PAY_PER_REPAIR;
      const safeN = kEscapeHtml(name);
      return `<div class="tw-mech-row">
        <span class="tw-mech-name">${safeN}</span>
        <span class="tw-mech-stats">${reps} repair${reps !== 1 ? "s" : ""} · ${kFmtMoney(pay)}</span>
      </div>`;
    });
    detailEl.innerHTML = items.join("");
  }
}

/**
 * Compute current-week repair stats from all rows (no filter applied).
 * Uses a Monday-start week matching the dashboard calculation:
 * (getDay() + 6) % 7 maps Sun=0…Sat=6 → Mon=0…Sun=6, so subtracting this
 * from today gives the most recent Monday as week start.
 */
function computeThisWeekStats(rows, mechKey, acrossKey, weekKey, tsKey) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (today.getDay() + 6) % 7; // Mon=0 … Sun=6
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - day);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  let repairsThisWeek = 0;
  const perMechWeek = {};

  rows.forEach(r => {
    const mech = (r[mechKey] || "").trim();
    const across = acrossKey ? Number(r[acrossKey] || 0) || 0 : 0;

    let jobDate = null;
    if (tsKey && r[tsKey]) jobDate = parseDateLike(r[tsKey]);
    if (!jobDate && weekKey && r[weekKey]) jobDate = parseDateLike(r[weekKey]);

    if (jobDate && !isNaN(jobDate)) {
      const dOnly = new Date(jobDate.getFullYear(), jobDate.getMonth(), jobDate.getDate());
      if (dOnly >= weekStart && dOnly <= weekEnd) {
        repairsThisWeek += across;
        if (mech) perMechWeek[mech] = (perMechWeek[mech] || 0) + across;
      }
    }
  });

  const payoutThisWeek = repairsThisWeek * PAY_PER_REPAIR;
  let topMechName = null;
  let topMechRepairs = 0;
  Object.entries(perMechWeek).forEach(([name, reps]) => {
    if (reps > topMechRepairs) { topMechRepairs = reps; topMechName = name; }
  });

  return { repairsThisWeek, payoutThisWeek, topMechName, topMechRepairs, perMechWeek };
}

// ===== Main loader =====

async function loadAnalytics() {
  const status = document.getElementById("status");
  if (status) status.textContent = "Loading analytics…";

  try {
    const { data: rows } = await kFetchCSV(JOBS_SHEET, { header: true });

    if (!rows.length) {
      if (status) status.textContent = "";
      kShowEmpty("analytics-charts-grid", "No jobs data available yet.");
      return;
    }

    // Infer column keys
    const sample = rows[0];
    const mechKey = Object.keys(sample).find(k => k.toLowerCase().includes("mechanic")) || "Mechanic";
    const acrossKey = Object.keys(sample).find(k => k.toLowerCase().includes("across"))
      || Object.keys(sample).find(k => k.toLowerCase().includes("repairs"));
    const weekKey = Object.keys(sample).find(k => k.toLowerCase().includes("week ending")) || null;
    const tsKey = Object.keys(sample).find(k => k.toLowerCase().includes("timestamp")) || null;

    // Read controls
    const timeRange = document.getElementById("timeRange")?.value || "all";
    const selectedMech = document.getElementById("mechanicFilter")?.value || "all";
    const groupBy = document.getElementById("groupBy")?.value || "week";

    const cutoff = getFilterDates(timeRange);

    // Aggregation maps
    const periodRepairs = {};
    const periodPayout  = {};
    const mechTotals    = {};
    let totalRepairs    = 0;
    let weeksWithRepairs = 0;
    const mechanics     = new Set();

    rows.forEach(r => {
      const mech = (r[mechKey] || "").trim();
      if (mech) mechanics.add(mech);

      const across = acrossKey ? Number(r[acrossKey] || 0) || 0 : 0;

      // Determine date
      let jobDate = null;
      if (tsKey && r[tsKey]) jobDate = parseDateLike(r[tsKey]);
      if (!jobDate && weekKey && r[weekKey]) jobDate = parseDateLike(r[weekKey]);

      if (cutoff && jobDate && jobDate < cutoff) return;
      if (selectedMech !== "all" && mech !== selectedMech) return;

      totalRepairs += across;
      if (mech) mechTotals[mech] = (mechTotals[mech] || 0) + across;

      if (jobDate && !isNaN(jobDate)) {
        const key = periodKey(jobDate, groupBy);
        periodRepairs[key] = (periodRepairs[key] || 0) + across;
        periodPayout[key]  = (periodPayout[key]  || 0) + across * PAY_PER_REPAIR;
      }
    });

    const sortedKeys = Object.keys(periodRepairs).sort();
    weeksWithRepairs = sortedKeys.length;

    // KPI cards
    const totalPayout = totalRepairs * PAY_PER_REPAIR;
    const avgPerPeriod = weeksWithRepairs > 0
      ? (totalRepairs / weeksWithRepairs).toFixed(1)
      : "–";

    kSetText("kpiTotalRepairs", totalRepairs.toLocaleString());
    kSetText("kpiTotalPayout", kFmtMoney(totalPayout));
    kSetText("kpiActiveMechanics", mechanics.size.toLocaleString());
    kSetText("kpiAvgPerWeek", avgPerPeriod);
    kSetText("kpiTotalRepairsSub", timeRange === "all" ? "All-time" : "In selected period");
    kSetText("kpiTotalPayoutSub", "@ $700 / repair");
    kSetText("kpiActiveMechanicsSub", "Distinct mechanics");
    kSetText("kpiAvgPerWeekSub", groupBy === "month" ? "Per month" : "Per week");

    // Populate mechanic filter
    const mechFilter = document.getElementById("mechanicFilter");
    if (mechFilter && mechFilter.options.length === 1) {
      Array.from(mechanics).sort().forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        mechFilter.appendChild(opt);
      });
    }

    // Charts
    try {
      await ensureChartJs();

      const labels = sortedKeys.map(k => periodLabel(k, groupBy));
      const repData = sortedKeys.map(k => periodRepairs[k]);
      const payData = sortedKeys.map(k => periodPayout[k]);

      repairsChartInst = renderLineChart(
        "repairsChart", labels, repData, "Repairs",
        "rgba(79, 70, 229, 1)", repairsChartInst
      );
      payoutChartInst = renderLineChart(
        "payoutChart", labels, payData, "Payout ($)",
        "rgba(212, 175, 55, 1)", payoutChartInst
      );

      const sortedMechs = Object.entries(mechTotals).sort((a, b) => b[1] - a[1]).slice(0, 12);
      const mechLabels  = sortedMechs.map(([n]) => n);
      const mechData    = sortedMechs.map(([, v]) => v);
      const mechColors  = mechData.map((_, i) => `hsla(${230 + i * 15}, 65%, 58%, 0.7)`);

      mechanicChartInst = renderBarChart(
        "mechanicChart", mechLabels, mechData, "Repairs", mechColors, mechanicChartInst
      );
    } catch (chartErr) {
      console.warn("Chart.js unavailable, showing placeholders:", chartErr);
      showChartPlaceholder("repairsChart", "Repairs trend unavailable offline");
      showChartPlaceholder("payoutChart", "Payout trend unavailable offline");
      showChartPlaceholder("mechanicChart", "Mechanic breakdown unavailable offline");
    }

    // Leaderboard
    renderLeaderboard(mechTotals);

    // ---- This Week Live Panel (always uses unfiltered / current-week data) ----
    const thisWeek = computeThisWeekStats(rows, mechKey, acrossKey, weekKey, tsKey);
    updateThisWeekPanel(thisWeek);
    setRefreshStatus("Live");

    // Discord: post or edit the live view message if data changed
    if (typeof kDiscordCheckAndPostUpdate === 'function') {
      const weekISO = new Date().toISOString().slice(0, 10);
      kDiscordCheckAndPostUpdate({
        weekISO,
        totalRepairs: thisWeek.repairsThisWeek,
        payoutThisWeek: thisWeek.payoutThisWeek,
        topMechanic: thisWeek.topMechName,
        topMechRepairs: thisWeek.topMechRepairs,
        perMechWeek: thisWeek.perMechWeek
      }).catch(console.warn);
    }

    if (status) status.textContent = "";
  } catch (err) {
    console.error("Error loading analytics", err);
    if (status) status.textContent = "";
    setRefreshStatus("Error");

    const msg = err.message.includes("404") || err.message.includes("not found")
      ? "Unable to load jobs data. Please check sheet configuration."
      : err.message.includes("403") || err.message.includes("denied")
      ? "Access denied. Please check sheet sharing settings."
      : "Unable to load analytics data. Please try refreshing the page.";

    kShowToast(msg, "error", 5000);

    // Show placeholder visuals in chart areas
    showChartPlaceholder("repairsChart", "No data available");
    showChartPlaceholder("payoutChart", "No data available");
    showChartPlaceholder("mechanicChart", "No data available");

    const leaderboardEl = document.getElementById("leaderboard");
    if (leaderboardEl) {
      leaderboardEl.innerHTML = '<div class="analytics-empty">No data available.</div>';
    }
  }
}

// ===== Auto-Refresh =====

async function refreshAnalytics() {
  setRefreshStatus("Refreshing");
  if (typeof kCsvCache !== 'undefined') kCsvCache.clear();
  try {
    await loadAnalytics();
  } catch (_e) {
    // loadAnalytics already handles errors internally
  }
}

function startAnalyticsAutoRefresh() {
  if (analyticsRefreshTimer) clearInterval(analyticsRefreshTimer);
  analyticsRefreshTimer = setInterval(refreshAnalytics, AUTO_REFRESH_MS);
}

// ===== Keyboard shortcuts =====

function initKeyboardShortcuts() {
  kRegisterShortcuts({
    "ctrl+r": () => {
      refreshAnalytics().then(() => kShowToast("Data refreshed", "success", 2000));
    },
    "ctrl+1": () => { window.location.href = "../index.html"; },
    "ctrl+2": () => { window.location.href = "../Payouts/payouts-index.html"; },
    "ctrl+3": () => { window.location.href = "../Mechanics/mechanics-index.html"; },
    "ctrl+4": () => { window.location.href = "../Bank_Record/bank-index.html"; },
    "ctrl+5": () => { window.location.href = "analytics-index.html"; },
  });
}

// ===== Init =====

document.addEventListener("DOMContentLoaded", async () => {
  kSyncNavLinksWithCurrentSearch();
  initKeyboardShortcuts();
  setRefreshStatus("Loading");

  await loadAnalytics();

  // Start auto-refresh
  startAnalyticsAutoRefresh();

  // Re-load on filter change
  ["timeRange", "mechanicFilter", "groupBy"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", loadAnalytics);
  });
});
