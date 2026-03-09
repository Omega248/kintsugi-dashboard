// ===== Config =====
const JOBS_SHEET = "Form responses 1";
const CONFIG_SHEET = "Config";
const PAY_PER_REPAIR = 700;

// Store fetched rows globally so analytics can use them
let _dashboardRows = null;
let _dashboardRedBins = null;
let _dashboardBetLeft = null;

// ===== Overview from jobs sheet (GLOBAL ONLY) =====

async function loadOverview() {
  const status = document.getElementById("status");

  try {
    if (status) status.textContent = "Loading dashboard...";
    
    const { data: rows } = await kFetchCSV(JOBS_SHEET, { header: true });
    
    if (!rows.length) {
      if (status) status.textContent = "";
      kShowEmpty('stat-boxes', 'No jobs data available yet.');
      return;
    }

    // Cache rows for analytics use
    _dashboardRows = rows;

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
    kSetText("payoutThisWeek", "Payout: " + kFmtMoney(payoutThisWeek));

    kSetText("repairsThisMonth", repairsThisMonth.toLocaleString());
    kSetText("payoutThisMonth", "Payout: " + kFmtMoney(payoutThisMonth));

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

    if (status) status.textContent = "";

    // ----- Trigger analytics rendering (non-blocking) -----
    requestIdleCallback
      ? requestIdleCallback(() => renderAnalytics(rows))
      : setTimeout(() => renderAnalytics(rows), 100);

  } catch (err) {
    console.error("Error loading overview from jobs sheet", err);
    if (status) status.textContent = "";
    
    const errorMsg = err.message && (err.message.includes('404') || err.message.includes('not found'))
      ? 'Unable to load jobs data. Please check sheet configuration.'
      : err.message && (err.message.includes('403') || err.message.includes('denied'))
      ? 'Access denied. Please check sheet sharing settings.'
      : 'Unable to load dashboard data. Please try refreshing the page.';
    
    kShowToast(errorMsg, 'error', 5000);
  }
}

// ===== Config sheet (BET / bin manual overrides) =====

async function loadConfig() {
  try {
    const { data: rows } = await kFetchCSV(CONFIG_SHEET, { header: true, cache: true });
    if (!rows.length) return;

    const map = {};
    rows.forEach((r) => {
      const key = (r.Key || r.key || "").trim();
      if (!key) return;
      const raw = r.Value ?? r.value;
      const num = raw === "" || raw === undefined ? null : Number(raw);
      map[key] = isNaN(num) ? raw : num;
    });

    if (map.MANUAL_BET_LEFT !== undefined) {
      const betVal = Number(map.MANUAL_BET_LEFT || 0);
      kSetText("manualBetLeft", betVal.toLocaleString());
      _dashboardBetLeft = betVal;
      // Mirror in inventory panel
      const invBet = document.getElementById('inv-bet');
      if (invBet) invBet.textContent = betVal.toLocaleString();
    }
    if (map.MANUAL_RED_BINS !== undefined) {
      const binsVal = Number(map.MANUAL_RED_BINS || 0);
      kSetText("manualRedBins", binsVal.toLocaleString());
      _dashboardRedBins = binsVal;
      // Render inventory forecast now that we have both metrics and bins
      renderInventoryForecast(binsVal);
    }
  } catch (err) {
    console.error("Error loading Config sheet", err);
  }
}

// ==== Helpers (now using kintsugi-core.js) ====

function parseDateLike(raw) { return kParseDateLike(raw); }
function fmtDate(d)          { return kFmtDate(d); }
function money(n)            { return kFmtMoney(n); }

// ==== Analytics rendering ====

/**
 * Main analytics rendering entry point.
 * Called after job rows are loaded.
 */
function renderAnalytics(rows) {
  if (!rows || !rows.length) return;

  // 1. Operational metrics
  const metrics = AnalyticsService.calculateOperationalMetrics(rows);
  renderOperationalMetrics(metrics);

  // 2. Leaderboards
  const leaderboards = {
    alltime: AnalyticsService.buildLeaderboard(rows, 'alltime'),
    monthly: AnalyticsService.buildLeaderboard(rows, 'monthly'),
    weekly:  AnalyticsService.buildLeaderboard(rows, 'weekly'),
  };
  renderLeaderboard(leaderboards, 'alltime');
  attachLeaderboardTabs(rows, leaderboards);

  // 3. Charts (lazy-load Chart.js if needed)
  loadChartJs(() => {
    const byDate = AnalyticsService.buildRepairsByDate(rows, 30);
    const byWeek = AnalyticsService.buildRepairsByWeek(rows, 12);
    const dist   = AnalyticsService.buildMechanicDistribution(rows, 8);

    AnalyticsCharts.renderRepairsTrend('repairsTrendChart', byDate);
    AnalyticsCharts.renderWeeklyPayouts('weeklyPayoutChart', byWeek);
    AnalyticsCharts.renderMechanicDistribution('mechanicDistributionChart', dist);
  });

  // 4. Activity feed
  const activity = AnalyticsService.getRecentActivity(rows, 10);
  renderActivityFeed(activity);

  // 5. Financial summary
  if (metrics) {
    const fin = AnalyticsService.calculateFinancialSummary(metrics.totalRepairs);
    renderFinancialSummary(fin);
  }

  // 6. Alerts (needs inventory data – merged after config loads)
  const alerts = AnalyticsService.generateAlerts({
    metrics,
    leaderboards,
    redBinsRemaining: _dashboardRedBins,
  });
  renderAlerts(alerts);

  // 7. Data integrity
  const issues = AnalyticsService.checkDataIntegrity(rows);
  renderIntegrityPanel(issues);

  // 8. Export buttons
  attachExportButtons(rows);
}

// ---- Operational metrics ----

function renderOperationalMetrics(metrics) {
  if (!metrics) return;

  setText('op-avgRepairsPerMech', metrics.avgRepairsPerMech.toLocaleString());
  setText('op-repairsPerDay', metrics.repairsPerDay.toLocaleString());
  setText('op-repairsPerDay-sub', `Over ${metrics.days} day span`);
  setText('op-payoutPerRepair', kFmtMoney(metrics.payoutPerRepair));
  setText('op-weeklyBurnRate', kFmtMoney(metrics.weeklyPayoutBurnRate));
  setText('op-projectedMonthlyPayout', kFmtMoney(metrics.projectedMonthlyPayout));
  setText('op-costPerMechanic', kFmtMoney(metrics.costPerMechanic));
}

// ---- Leaderboard ----

function renderLeaderboard(leaderboards, period) {
  const tbody = document.getElementById('leaderboard-tbody');
  if (!tbody) return;

  const data = leaderboards[period] || [];

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-secondary);text-align:center;padding:16px">No data for this period</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(m => {
    const rankClass = m.rank <= 3 ? ` lb-rank-${m.rank}` : '';
    return `<tr>
      <td class="lb-rank${rankClass}">${m.rank}</td>
      <td class="lb-name">${escHtml(m.name)}</td>
      <td>${m.repairs.toLocaleString()}</td>
      <td class="lb-payout">${kFmtMoney(m.payout)}</td>
    </tr>`;
  }).join('');
}

function attachLeaderboardTabs(rows, leaderboards) {
  const tabs = document.querySelectorAll('.lb-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const period = tab.dataset.period;
      renderLeaderboard(leaderboards, period);
    });
  });
}

// ---- Activity feed ----

function renderActivityFeed(entries) {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;

  if (!entries.length) {
    feed.innerHTML = '<div style="color:var(--text-secondary);font-size:var(--font-size-sm)">No recent activity</div>';
    return;
  }

  feed.innerHTML = entries.map((e, i) => `
    <div class="activity-entry" style="animation-delay:${i * 0.04}s">
      <div class="activity-dot"></div>
      <div class="activity-date">${kFmtDate(e.date)}</div>
      <div class="activity-mechanic">${escHtml(e.mechanic)}</div>
      <div class="activity-repairs">${e.repairs} repair${e.repairs !== 1 ? 's' : ''}</div>
    </div>
  `).join('');
}

// ---- Inventory forecast ----

function renderInventoryForecast(redBinsRemaining) {
  const metrics = _dashboardRows
    ? AnalyticsService.calculateOperationalMetrics(_dashboardRows)
    : null;

  const forecast = AnalyticsService.calculateInventoryForecast(
    redBinsRemaining,
    metrics ? metrics.repairsPerDay : 0
  );

  if (!forecast) return;

  setText('inv-bins', forecast.redBinsRemaining.toLocaleString());
  setText('inv-daily-usage', forecast.dailyBinUsage.toLocaleString());

  const daysEl = document.getElementById('inv-days-remaining');
  const progressFill = document.getElementById('inv-progress-fill');

  if (daysEl) {
    if (forecast.estimatedDaysRemaining != null) {
      daysEl.textContent = forecast.estimatedDaysRemaining + ' days';
      const severity = forecast.estimatedDaysRemaining < 3 ? 'danger'
        : forecast.estimatedDaysRemaining < 7 ? 'warning' : 'ok';
      daysEl.className = 'inventory-stat-value ' + severity;
    } else {
      daysEl.textContent = '—';
    }
  }

  // Fill progress bar (0–30 days scale)
  if (progressFill && forecast.estimatedDaysRemaining != null) {
    const pct = Math.min(100, (forecast.estimatedDaysRemaining / 30) * 100);
    const severity = forecast.estimatedDaysRemaining < 3 ? 'danger'
      : forecast.estimatedDaysRemaining < 7 ? 'warning' : 'ok';
    progressFill.style.width = pct + '%';
    progressFill.className = 'inventory-progress-fill ' + severity;
  }

  // Also update the stat card subtitles
  if (metrics) {
    setText('tileSub-redBins-usage', `Daily usage: ~${forecast.dailyBinUsage}`);
    if (forecast.estimatedDaysRemaining != null) {
      setText('tileSub-redBins-days', `~${forecast.estimatedDaysRemaining} days remaining`);
    }
  }

  // Re-run alerts with updated bins
  if (_dashboardRows) {
    const allLeaderboards = {
      alltime: AnalyticsService.buildLeaderboard(_dashboardRows, 'alltime'),
      weekly:  AnalyticsService.buildLeaderboard(_dashboardRows, 'weekly'),
    };
    const alerts = AnalyticsService.generateAlerts({
      metrics,
      leaderboards: allLeaderboards,
      redBinsRemaining,
    });
    renderAlerts(alerts);
  }
}

// ---- Financial summary ----

function renderFinancialSummary(fin) {
  if (!fin) return;
  setText('fin-totalRevenue', kFmtMoney(fin.totalRevenue));
  setText('fin-totalPayout',  kFmtMoney(fin.totalPayout));
  setText('fin-netProfit',    kFmtMoney(fin.netProfit));
  setText('fin-profitMargin', fin.profitMargin + '% profit margin');
}

// ---- Alerts ----

function renderAlerts(alerts) {
  const section = document.getElementById('alerts-section');
  const list    = document.getElementById('alerts-list');
  if (!section || !list) return;

  if (!alerts || !alerts.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  list.innerHTML = alerts.map((a, i) => `
    <div class="alert-item alert-${a.type}" style="animation-delay:${i * 0.08}s">
      <div>
        <div class="alert-title">${escHtml(a.title)}</div>
        <div class="alert-message">${escHtml(a.message)}</div>
      </div>
    </div>
  `).join('');
}

// ---- Data integrity ----

function renderIntegrityPanel(issues) {
  const panel   = document.getElementById('integrity-panel');
  const content = document.getElementById('integrity-content');
  if (!panel || !content) return;

  if (!issues || !issues.length) {
    panel.style.display = '';
    content.innerHTML = '<span class="integrity-ok">✓ No data integrity issues detected.</span>';
    return;
  }

  panel.style.display = '';
  const issueItems = issues.slice(0, 10).map(i => `<li>${escHtml(i.message)}</li>`).join('');
  const extra = issues.length > 10 ? `<li>…and ${issues.length - 10} more</li>` : '';
  content.innerHTML = `
    <div class="integrity-issue">⚠ ${issues.length} data integrity issue(s) detected:</div>
    <ul class="integrity-issue-list">${issueItems}${extra}</ul>
  `;
}

// ---- Export buttons ----

function attachExportButtons(rows) {
  const csvBtn   = document.getElementById('export-csv-btn');
  const jsonBtn  = document.getElementById('export-json-btn');
  const xlsxBtn  = document.getElementById('export-excel-btn');

  if (csvBtn) csvBtn.onclick = () => {
    AnalyticsService.exportCSV(rows);
    kShowToast('CSV exported', 'success', 2000);
  };

  if (jsonBtn) jsonBtn.onclick = () => {
    AnalyticsService.exportJSON(rows);
    kShowToast('JSON exported', 'success', 2000);
  };

  if (xlsxBtn) xlsxBtn.onclick = () => {
    if (window.XLSX) {
      AnalyticsService.exportExcel(rows);
      kShowToast('Excel exported', 'success', 2000);
    } else {
      // Lazy-load SheetJS
      const script = document.createElement('script');
      script.src = window._xlsxCdnUrl || 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload = () => {
        AnalyticsService.exportExcel(rows);
        kShowToast('Excel exported', 'success', 2000);
      };
      script.onerror = () => kShowToast('Failed to load Excel library. Try CSV instead.', 'error');
      document.head.appendChild(script);
    }
  };
}

// ---- Chart.js lazy loader ----

function loadChartJs(callback) {
  if (window.Chart) {
    callback();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
  script.onload = callback;
  script.onerror = () => console.warn('Chart.js failed to load. Charts will not be displayed.');
  document.head.appendChild(script);
}

// ---- DOM helper ----

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==== Keyboard Shortcuts ====

function initKeyboardShortcuts() {
  kRegisterShortcuts({
    'ctrl+r': () => {
      loadOverview().then(() => kShowToast('Data refreshed', 'success', 2000));
    },
    'ctrl+1': () => { window.location.href = 'index.html'; },
    'ctrl+2': () => { window.location.href = 'Payouts/payouts-index.html'; },
    'ctrl+3': () => { window.location.href = 'Mechanics/mechanics-index.html'; },
    'ctrl+4': () => { window.location.href = 'Bank_Record/bank-index.html'; },
  });
}

// ==== Init ====

document.addEventListener("DOMContentLoaded", async () => {
  kSyncNavLinksWithCurrentSearch();
  initKeyboardShortcuts();

  try {
    await Promise.all([
      loadOverview(),
      loadConfig(),
    ]);
  } catch (err) {
    console.error('Error during dashboard initialization:', err);
  }
});
