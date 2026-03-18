// ===== Config (values sourced from constants.js) =====
const JOBS_SHEET    = KINTSUGI_CONFIG.SHEETS.JOBS;
const CONFIG_SHEET  = KINTSUGI_CONFIG.SHEETS.CONFIG;
const PAY_PER_REPAIR       = PAYMENT_RATES.PAY_PER_REPAIR;
const ENGINE_REIMBURSEMENT = PAYMENT_RATES.ENGINE_REIMBURSEMENT;
const ENGINE_BONUS_LSPD    = PAYMENT_RATES.ENGINE_BONUS_LSPD;

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

let refreshTimer = null;

// ===== Overview from jobs sheet (GLOBAL ONLY) =====

async function loadOverview() {
  const status = document.getElementById("status");

  try {
    // Show loading state
    if (status) status.textContent = "Loading dashboard...";
    
    const rawData = await kFetchCSV(JOBS_SHEET);

    if (rawData.length < 2) {
      if (status) status.textContent = "";
      kShowEmpty('stat-boxes', 'No jobs data available yet.');
      return;
    }

    // Detect column indices from header row.
    // Use raw-array mode so duplicate column names (e.g. two "Engine Replacement?"
    // columns for PD and CIV) can be distinguished by their position.
    const headers = rawData[0].map((h) => h.trim());
    const headersLower = headers.map((h) => h.toLowerCase());

    const iMech = headersLower.findIndex((h) => h.includes("mechanic"));

    // PD repairs: contains "across" AND "pd"
    const iAcrossPD = headersLower.findIndex(
      (h) => h.includes("across") && h.includes("pd")
    );
    // CIV repairs: contains "across" but NOT "pd"; fall back to generic "repairs"
    let iAcrossCiv = headersLower.findIndex(
      (h) => h.includes("across") && !h.includes("pd")
    );
    if (iAcrossCiv === -1) {
      iAcrossCiv = headersLower.findIndex((h) => h.includes("repairs"));
    }

    const iWeek = headersLower.findIndex((h) => h.includes("week ending"));
    const iTs   = headersLower.findIndex((h) => h.includes("timestamp"));

    // Engine payer column — detect FIRST so it can be excluded from the engine
    // replacement column searches (codebase convention).
    const iEnginePayer = headersLower.findIndex(
      (h) => h.includes("did you buy") || (h.includes("kintsugi") && h.includes("pay"))
    );
    // PD engine replacement: first "engine replacement" column, excluding payer column
    const iEnginePD = headersLower.findIndex(
      (h, i) => i !== iEnginePayer && h.includes("engine") && h.includes("replacement")
    );
    // CIV engine replacement: second "engine replacement" column (after iEnginePD)
    const iEngineCiv =
      iEnginePD !== -1
        ? headersLower.findIndex(
            (h, i) =>
              i > iEnginePD &&
              i !== iEnginePayer &&
              h.includes("engine") &&
              h.includes("replacement")
          )
        : -1;
    // Department column
    const iDept = headersLower.findIndex((h) => h.includes("department"));

    const rows = rawData.slice(1);

    // global aggregates
    let totalRepairs = 0;
    let totalEnginePay = 0;
    const mechanics = new Set();
    let latestWeekDate = null;
    let lastActivity = null;

    // time-bucketed aggregates
    let repairsThisWeek = 0;
    let repairsThisMonth = 0;
    let enginePayThisWeek = 0;
    let enginePayThisMonth = 0;
    const perMechWeek = {};
    const perMechWeekEnginePay = {};

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

    rows.forEach((row) => {
      const mech = iMech !== -1 ? (row[iMech] || "").trim() : "";
      if (mech) mechanics.add(mech);

      // Sum PD + CIV repairs for total count
      const acrossPD  = iAcrossPD  !== -1 ? (Number(row[iAcrossPD]  || 0) || 0) : 0;
      const acrossCiv = iAcrossCiv !== -1 ? (Number(row[iAcrossCiv] || 0) || 0) : 0;
      const across = acrossPD + acrossCiv;
      totalRepairs += across;

      // Engine pay for this job
      let enginePay = 0;
      const pdEngineRaw  = iEnginePD  !== -1 ? (row[iEnginePD]  || "").trim() : "";
      const civEngineRaw = iEngineCiv !== -1 ? (row[iEngineCiv] || "").trim() : "";
      let pdEngineCount = 0;
      if (pdEngineRaw) {
        const n = Number(pdEngineRaw);
        if (!isNaN(n) && n > 0) pdEngineCount = n;
        else if (/^(yes|y|true)$/i.test(pdEngineRaw)) pdEngineCount = 1;
      }
      let civEngineCount = 0;
      if (civEngineRaw) {
        const n = Number(civEngineRaw);
        if (!isNaN(n) && n > 0) civEngineCount = n;
        else if (/^(yes|y|true)$/i.test(civEngineRaw)) civEngineCount = 1;
      }
      if (pdEngineCount > 0 || civEngineCount > 0) {
        const dept    = iDept        !== -1 ? (row[iDept]        || "").trim().toUpperCase() : "";
        const payerRaw = iEnginePayer !== -1 ? (row[iEnginePayer] || "").trim().toLowerCase() : "";
        let enginePayer = "";
        if (payerRaw) {
          if (payerRaw.includes("kintsugi")) enginePayer = "kintsugi";
          else if (/^\s*i\b|i bought|bought it|myself/i.test(payerRaw)) enginePayer = "mechanic";
        }
        const isLspd = dept === "LSPD";
        if (pdEngineCount > 0) {
          if (enginePayer === "mechanic") {
            enginePay += pdEngineCount * (ENGINE_REIMBURSEMENT + (isLspd ? ENGINE_BONUS_LSPD : 0));
          } else if (enginePayer === "kintsugi") {
            // Kintsugi paid — mechanic earns the LSPD bonus only (or $0 for non-LSPD)
            enginePay += pdEngineCount * (isLspd ? ENGINE_BONUS_LSPD : 0);
          } else {
            // Old data without payer info: default to full reimbursement
            enginePay += pdEngineCount * (ENGINE_REIMBURSEMENT + (isLspd ? ENGINE_BONUS_LSPD : 0));
          }
        }
        enginePay += civEngineCount * ENGINE_REIMBURSEMENT;
      }
      totalEnginePay += enginePay;

      // Week ending for global latest week tile
      let weekDate = null;
      const weekRaw = iWeek !== -1 ? row[iWeek] : null;
      if (weekRaw) {
        const d = parseDateLike(weekRaw);
        if (d && !isNaN(d)) {
          weekDate = d;
          if (!latestWeekDate || d > latestWeekDate) {
            latestWeekDate = d;
          }
        }
      }

      // Prefer timestamp for "this week/month" classification, fall back to week ending
      let jobDate = null;
      const tsRaw = iTs !== -1 ? row[iTs] : null;
      if (tsRaw) {
        const d = parseDateLike(tsRaw);
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
          enginePayThisWeek += enginePay;
          if (mech) {
            perMechWeek[mech] = (perMechWeek[mech] || 0) + across;
            perMechWeekEnginePay[mech] = (perMechWeekEnginePay[mech] || 0) + enginePay;
          }
        }

        if (dOnly >= monthStart && dOnly <= monthEnd) {
          repairsThisMonth += across;
          enginePayThisMonth += enginePay;
        }
      }
    });

    const totalPayout    = totalRepairs * PAY_PER_REPAIR + totalEnginePay;
    const payoutThisWeek  = repairsThisWeek  * PAY_PER_REPAIR + enginePayThisWeek;
    const payoutThisMonth = repairsThisMonth * PAY_PER_REPAIR + enginePayThisMonth;

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
      lastActivity ? "Last job: " + kFmtRelativeDate(lastActivity) : ""
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
