// ===== Config =====
const JOBS_SHEET = "Form responses 1";
const CONFIG_SHEET = "Config";
const PAY_PER_REPAIR = 700;

// Auto-refresh interval (from constants.js, fallback to 5 min)
const AUTO_REFRESH_MS =
  (typeof DISCORD_CONFIG !== 'undefined'
    ? DISCORD_CONFIG.AUTO_REFRESH_INTERVAL_MS
    : null) || 5 * 60 * 1000;

let refreshTimer = null;
let lastLoadedWeekData = null; // Cached week data for Discord change detection

// ===== Overview from jobs sheet (GLOBAL ONLY) =====

async function loadOverview() {
  const status = document.getElementById("status");

  try {
    // Show loading state
    if (status) status.textContent = "Loading dashboard...";
    
    const { data: rows } = await kFetchCSV(JOBS_SHEET, { header: true });
    
    if (!rows.length) {
      if (status) status.textContent = "";
      kShowEmpty('stat-boxes', 'No jobs data available yet.');
      return;
    }

    // infer keys
    const sample = rows[0];
    const mechKey =
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("mechanic")
      ) || "Mechanic";

    const acrossKey =
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("across")
      ) ||
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("repairs")
      );

    const weekKey =
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("week ending")
      ) || null;

    const tsKey =
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("timestamp")
      ) || null;

    // global aggregates
    let totalRepairs = 0;
    const mechanics = new Set();
    let latestWeekDate = null;
    let lastActivity = null;

    // time-bucketed aggregates
    let repairsThisWeek = 0;
    let repairsThisMonth = 0;
    const perMechWeek = {};

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Monday-start week
    const day = (today.getDay() + 6) % 7; // Mon=0..Sun=6
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - day);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    rows.forEach((r) => {
      const mech = (r[mechKey] || "").trim();
      if (mech) mechanics.add(mech);

      const across = acrossKey ? Number(r[acrossKey] || 0) || 0 : 0;
      totalRepairs += across;

      // Week ending for global latest week tile
      let weekDate = null;
      if (weekKey && r[weekKey]) {
        const d = parseDateLike(r[weekKey]);
        if (d && !isNaN(d)) {
          weekDate = d;
          if (!latestWeekDate || d > latestWeekDate) {
            latestWeekDate = d;
          }
        }
      }

      // Prefer timestamp for "this week/month" classification, fall back to week ending
      let jobDate = null;
      if (tsKey && r[tsKey]) {
        const d = parseDateLike(r[tsKey]);
        if (d && !isNaN(d)) jobDate = d;
      }
      if (!jobDate) jobDate = weekDate;

      if (jobDate && !isNaN(jobDate)) {
        const dOnly = new Date(
          jobDate.getFullYear(),
          jobDate.getMonth(),
          jobDate.getDate()
        );

        if (!lastActivity || dOnly > lastActivity) {
          lastActivity = dOnly;
        }

        if (dOnly >= weekStart && dOnly <= weekEnd) {
          repairsThisWeek += across;
          if (mech) {
            perMechWeek[mech] = (perMechWeek[mech] || 0) + across;
          }
        }

        if (dOnly >= monthStart && dOnly <= monthEnd) {
          repairsThisMonth += across;
        }
      }
    });

    const totalPayout = totalRepairs * PAY_PER_REPAIR;
    const payoutThisWeek = repairsThisWeek * PAY_PER_REPAIR;
    const payoutThisMonth = repairsThisMonth * PAY_PER_REPAIR;

    // Top mechanic this week
    let topMechName = null;
    let topMechRepairs = 0;
    Object.entries(perMechWeek).forEach(([name, reps]) => {
      if (reps > topMechRepairs) {
        topMechRepairs = reps;
        topMechName = name;
      }
    });

    kSetText("totalRepairs", totalRepairs.toLocaleString());
    kSetText("totalPayout", kFmtMoney(totalPayout));
    kSetText("activeMechanics", mechanics.size.toLocaleString());
    kSetText("latestWeek", latestWeekDate ? kFmtDate(latestWeekDate) : "—");

    // Week/month KPIs
    kSetText("repairsThisWeek", repairsThisWeek.toLocaleString());
    kSetText(
      "payoutThisWeek",
      "Payout: " + kFmtMoney(payoutThisWeek)
    );

    kSetText("repairsThisMonth", repairsThisMonth.toLocaleString());
    kSetText(
      "payoutThisMonth",
      "Payout: " + kFmtMoney(payoutThisMonth)
    );

    // Top mechanic this week
    if (topMechName) {
      kSetText("topMechWeekName", topMechName);
      kSetText(
        "topMechWeekStats",
        topMechRepairs.toLocaleString() +
          " repairs · " +
          kFmtMoney(topMechRepairs * PAY_PER_REPAIR)
      );
    } else {
      kSetText("topMechWeekName", "—");
      kSetText("topMechWeekStats", "No repairs logged this week");
    }

    // Subtitles
    kSetText("tileSub-totalRepairs", "");
    kSetText("tileSub-totalPayout", "");
    kSetText("tileSub-activeMechanics", "");
    kSetText("tileSub-manualBetLeft", "");
    kSetText("tileSub-manualRedBins", "");
    kSetText(
      "tileSub-latestWeek",
      lastActivity ? "Last job: " + kFmtDate(lastActivity) : ""
    );

    // ---- This Week Live Panel ----
    const weekISO = latestWeekDate ? latestWeekDate.toISOString().slice(0, 10) : "";
    updateThisWeekPanel({
      repairsThisWeek,
      payoutThisWeek,
      topMechName,
      topMechRepairs,
      perMechWeek
    });

    // Build week data for Discord change detection
    lastLoadedWeekData = {
      weekISO,
      totalRepairs: repairsThisWeek,
      payoutThisWeek,
      topMechanic: topMechName,
      topMechRepairs,
      mechanicsBreakdown: perMechWeek
    };

    // Discord: check if data changed and auto-post
    if (typeof kDiscordCheckAndPostUpdate === 'function') {
      kDiscordCheckAndPostUpdate(lastLoadedWeekData).catch(console.warn);
    }

    // Discord: payday reminder if today is the configured payday
    if (typeof kDiscordCheckAndSendPaydayReminder === 'function' && weekISO) {
      kDiscordCheckAndSendPaydayReminder(weekISO).catch(console.warn);
    }

    setRefreshStatus("Live");

    if (status) {
      status.textContent = "";
    }
  } catch (err) {
    console.error("Error loading overview from jobs sheet", err);
    if (status) {
      status.textContent = "";
    }
    setRefreshStatus("Error");
    
    // Show user-friendly error message
    const errorMsg = err.message.includes('404') || err.message.includes('not found')
      ? 'Unable to load jobs data. Please check sheet configuration.'
      : err.message.includes('403') || err.message.includes('denied')
      ? 'Access denied. Please check sheet sharing settings.'
      : 'Unable to load dashboard data. Please try refreshing the page.';
    
    kShowToast(errorMsg, 'error', 5000);
  }
}

// ===== Config sheet (BET / bin manual overrides) =====

async function loadConfig() {
  try {
    const { data: rows } = await kFetchCSV(CONFIG_SHEET, { header: true, cache: true });
    if (!rows.length) {
      return;
    }

    const map = {};
    rows.forEach((r) => {
      const key = (r.Key || r.key || "").trim();
      if (!key) return;
      const raw = r.Value ?? r.value;
      const num = raw === "" || raw === undefined ? null : Number(raw);
      map[key] = isNaN(num) ? raw : num;
    });

    if (map.MANUAL_BET_LEFT !== undefined) {
      kSetText(
        "manualBetLeft",
        Number(map.MANUAL_BET_LEFT || 0).toLocaleString()
      );
    }
    if (map.MANUAL_RED_BINS !== undefined) {
      kSetText(
        "manualRedBins",
        Number(map.MANUAL_RED_BINS || 0).toLocaleString()
      );
    }
  } catch (err) {
    console.error("Error loading Config sheet", err);
    // Config is optional, so we don't show error to user
  }
}

// ==== Helpers (now using kintsugi-core.js) ====
// All date/money formatting helpers are in kintsugi-core.js

function parseDateLike(raw) {
  return kParseDateLike(raw);
}

function fmtDate(d) {
  return kFmtDate(d);
}

function money(n) {
  return kFmtMoney(n);
}

// ==== This Week Live Panel ====

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

  // Mechanic breakdown list
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

// ==== Auto-Refresh ====

async function refreshDashboard() {
  setRefreshStatus("Refreshing");
  // Clear cache so we always get fresh data
  if (typeof kCsvCache !== 'undefined') kCsvCache.clear();
  try {
    await Promise.all([loadOverview(), loadConfig()]);
  } catch (_e) {
    // loadOverview already handles errors internally
  }
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshDashboard, AUTO_REFRESH_MS);
}

// ==== Keyboard Shortcuts ====

function initKeyboardShortcuts() {
  kRegisterShortcuts({
    'ctrl+r': (e) => {
      // Reload data
      refreshDashboard().then(() => kShowToast('Data refreshed', 'success', 2000));
    },
    'ctrl+1': () => {
      // Navigate to Dashboard
      window.location.href = 'index.html';
    },
    'ctrl+2': () => {
      // Navigate to Payouts
      window.location.href = 'Payouts/payouts-index.html';
    },
    'ctrl+3': () => {
      // Navigate to Mechanics
      window.location.href = 'Mechanics/mechanics-index.html';
    },
    'ctrl+4': () => {
      // Navigate to Bank
      window.location.href = 'Bank_Record/bank-index.html';
    }
  });
}

// ==== Init ====

document.addEventListener("DOMContentLoaded", async () => {
  kSyncNavLinksWithCurrentSearch();
  initKeyboardShortcuts();
  setRefreshStatus("Loading");

  // Load overview and config in parallel for better performance
  try {
    await Promise.all([
      loadOverview(),
      loadConfig()
    ]);
  } catch (err) {
    console.error('Error during dashboard initialization:', err);
  }

  // Start auto-refresh
  startAutoRefresh();
});
