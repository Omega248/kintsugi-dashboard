// ===== Config =====
const JOBS_SHEET = "Form responses 1";
const PAY_PER_REPAIR = 700;

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

      totalRepairs += 1; // Each form entry is one repair regardless of "across" value
      if (mech) mechTotals[mech] = (mechTotals[mech] || 0) + 1;

      if (jobDate && !isNaN(jobDate)) {
        const key = periodKey(jobDate, groupBy);
        periodRepairs[key] = (periodRepairs[key] || 0) + 1;
        periodPayout[key]  = (periodPayout[key]  || 0) + PAY_PER_REPAIR;
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

    if (status) status.textContent = "";
  } catch (err) {
    console.error("Error loading analytics", err);
    if (status) status.textContent = "";

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

// ===== Keyboard shortcuts =====

function initKeyboardShortcuts() {
  kRegisterShortcuts({
    "ctrl+r": () => {
      loadAnalytics().then(() => kShowToast("Data refreshed", "success", 2000));
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

  await loadAnalytics();

  // Re-load on filter change
  ["timeRange", "mechanicFilter", "groupBy"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", loadAnalytics);
  });
});
