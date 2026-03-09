// =======================================
// Kintsugi Analytics Service
// Service layer for data processing and calculations.
// Separate from UI logic for modularity.
// =======================================

const AnalyticsService = {

  // ----- Key extraction helpers -----

  _inferKeys(sample) {
    const keys = Object.keys(sample);
    return {
      mechKey:  keys.find(k => k.toLowerCase().includes('mechanic')) || 'Mechanic',
      acrossKey: keys.find(k => k.toLowerCase().includes('across')) ||
                 keys.find(k => k.toLowerCase().includes('repairs')) || null,
      weekKey:  keys.find(k => k.toLowerCase().includes('week ending')) || null,
      tsKey:    keys.find(k => k.toLowerCase().includes('timestamp')) || null,
    };
  },

  _getDate(r, keys) {
    const { tsKey, weekKey } = keys;
    let d = null;
    if (tsKey && r[tsKey]) d = kParseDateLike(r[tsKey]);
    if (!d && weekKey && r[weekKey]) d = kParseDateLike(r[weekKey]);
    return (d && !isNaN(d)) ? d : null;
  },

  _getRepairs(r, keys) {
    return keys.acrossKey ? (Number(r[keys.acrossKey] || 0) || 0) : 0;
  },

  // ----- Operational metrics -----

  /**
   * Calculate all operational metrics from job rows.
   * @param {object[]} rows - Parsed CSV rows
   * @returns {object} metrics
   */
  calculateOperationalMetrics(rows) {
    if (!rows || !rows.length) return null;

    const keys = this._inferKeys(rows[0]);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // week start (Monday)
    const weekDay = (today.getDay() + 6) % 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - weekDay);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const mechanics = new Set();
    let totalRepairs = 0;
    let repairsThisWeek = 0;
    let repairsThisMonth = 0;
    let minDate = null;
    let maxDate = null;

    rows.forEach(r => {
      const mech = (r[keys.mechKey] || '').trim();
      if (mech) mechanics.add(mech);

      const across = this._getRepairs(r, keys);
      totalRepairs += across;

      const d = this._getDate(r, keys);
      if (d) {
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;

        if (d >= weekStart)  repairsThisWeek  += across;
        if (d >= monthStart) repairsThisMonth += across;
      }
    });

    const totalMechanics = mechanics.size;
    const days = (minDate && maxDate)
      ? Math.max(1, Math.ceil((maxDate - minDate) / 86400000) + 1)
      : 1;

    const repairsPerDay = totalRepairs / days;
    const payPerRepair = PAYMENT_RATES.PAY_PER_REPAIR;

    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const remainingDays = daysInMonth - today.getDate();
    const projectedMonthlyRepairs = repairsThisMonth + (repairsPerDay * remainingDays);

    return {
      totalRepairs,
      totalMechanics,
      repairsPerDay:           parseFloat(repairsPerDay.toFixed(1)),
      avgRepairsPerMech:       totalMechanics > 0 ? parseFloat((totalRepairs / totalMechanics).toFixed(1)) : 0,
      payoutPerRepair:         payPerRepair,
      weeklyPayoutBurnRate:    repairsThisWeek * payPerRepair,
      projectedMonthlyRepairs: Math.round(projectedMonthlyRepairs),
      projectedMonthlyPayout:  Math.round(projectedMonthlyRepairs * payPerRepair),
      costPerMechanic:         totalMechanics > 0 ? Math.round((totalRepairs * payPerRepair) / totalMechanics) : 0,
      totalPayout:             totalRepairs * payPerRepair,
      days,
    };
  },

  // ----- Leaderboard -----

  /**
   * Build a ranked mechanic leaderboard.
   * @param {object[]} rows
   * @param {'alltime'|'monthly'|'weekly'} period
   * @returns {object[]} ranked list: [{rank, name, repairs, payout}]
   */
  buildLeaderboard(rows, period = 'alltime') {
    if (!rows || !rows.length) return [];

    const keys = this._inferKeys(rows[0]);
    const now = new Date();
    let cutoff = null;

    if (period === 'weekly') {
      cutoff = new Date(now);
      cutoff.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      cutoff.setHours(0, 0, 0, 0);
    } else if (period === 'monthly') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const perMech = {};
    rows.forEach(r => {
      const mech = (r[keys.mechKey] || '').trim();
      if (!mech) return;

      const across = this._getRepairs(r, keys);
      if (cutoff) {
        const d = this._getDate(r, keys);
        if (!d || d < cutoff) return;
      }

      perMech[mech] = (perMech[mech] || 0) + across;
    });

    return Object.entries(perMech)
      .map(([name, repairs]) => ({
        name,
        repairs,
        payout: repairs * PAYMENT_RATES.PAY_PER_REPAIR,
      }))
      .sort((a, b) => b.repairs - a.repairs)
      .map((item, idx) => ({ rank: idx + 1, ...item }));
  },

  // ----- Time series data for charts -----

  /**
   * Repairs grouped by date (for line chart).
   * @param {object[]} rows
   * @param {number} limit - Last N entries to return
   * @returns {[string, number][]} [[isoDate, count], ...]
   */
  buildRepairsByDate(rows, limit = 30) {
    if (!rows || !rows.length) return [];

    const keys = this._inferKeys(rows[0]);
    const byDate = {};

    rows.forEach(r => {
      const across = this._getRepairs(r, keys);
      const d = this._getDate(r, keys);
      if (!d) return;

      const key = d.toISOString().slice(0, 10);
      byDate[key] = (byDate[key] || 0) + across;
    });

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-limit);
  },

  /**
   * Repairs grouped by week-ending date (for bar chart).
   * @param {object[]} rows
   * @param {number} limit
   * @returns {[string, number][]}
   */
  buildRepairsByWeek(rows, limit = 12) {
    if (!rows || !rows.length) return [];

    const keys = this._inferKeys(rows[0]);
    const byWeek = {};

    rows.forEach(r => {
      const across = this._getRepairs(r, keys);
      // Prefer explicit week-ending date for grouping
      let d = null;
      if (keys.weekKey && r[keys.weekKey]) d = kParseDateLike(r[keys.weekKey]);
      if (!d) d = this._getDate(r, keys);
      if (!d) return;

      const key = d.toISOString().slice(0, 10);
      byWeek[key] = (byWeek[key] || 0) + across;
    });

    return Object.entries(byWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-limit);
  },

  /**
   * Mechanic repair distribution (for doughnut chart).
   * @param {object[]} rows
   * @param {number} limit - Top N mechanics
   * @returns {object[]} [{name, repairs}]
   */
  buildMechanicDistribution(rows, limit = 8) {
    return this.buildLeaderboard(rows, 'alltime').slice(0, limit);
  },

  // ----- Activity feed -----

  /**
   * Recent repair activity entries sorted newest first.
   * @param {object[]} rows
   * @param {number} limit
   * @returns {object[]} [{date, mechanic, repairs}]
   */
  getRecentActivity(rows, limit = 10) {
    if (!rows || !rows.length) return [];

    const keys = this._inferKeys(rows[0]);
    const entries = [];

    rows.forEach(r => {
      const mech = (r[keys.mechKey] || '').trim();
      const across = this._getRepairs(r, keys);
      const d = this._getDate(r, keys);
      if (!mech || !d) return;
      entries.push({ date: d, mechanic: mech, repairs: across });
    });

    return entries
      .sort((a, b) => b.date - a.date)
      .slice(0, limit);
  },

  // ----- Inventory forecast -----

  /**
   * Estimate days until red bin depletion.
   * @param {number|null} redBinsRemaining
   * @param {number} repairsPerDay
   * @returns {object|null}
   */
  calculateInventoryForecast(redBinsRemaining, repairsPerDay) {
    if (redBinsRemaining == null) return null;

    // 10 bins per 15 repairs (BINS_PER_15 / 15)
    const binsPerRepair = (PAYMENT_RATES.BINS_PER_15 || 10) / 15;
    const dailyBinUsage = repairsPerDay * binsPerRepair;

    return {
      redBinsRemaining,
      dailyBinUsage: parseFloat(dailyBinUsage.toFixed(1)),
      estimatedDaysRemaining: dailyBinUsage > 0
        ? Math.floor(redBinsRemaining / dailyBinUsage)
        : null,
    };
  },

  // ----- Alerts -----

  /**
   * Generate operational alerts from current data snapshot.
   * @param {object} data - { metrics, leaderboards, redBinsRemaining }
   * @returns {object[]} [{type:'warning'|'error'|'info', title, message}]
   */
  generateAlerts(data) {
    const alerts = [];
    const { metrics, leaderboards, redBinsRemaining } = data;

    // Low bin inventory
    if (redBinsRemaining != null && redBinsRemaining < 20) {
      const forecast = this.calculateInventoryForecast(
        redBinsRemaining,
        metrics ? metrics.repairsPerDay : 0
      );
      const daysMsg = (forecast && forecast.estimatedDaysRemaining != null)
        ? ` Estimated ${forecast.estimatedDaysRemaining} days until depletion.`
        : '';
      alerts.push({
        type: 'error',
        title: '⚠ Low Red Bin Inventory',
        message: `Only ${redBinsRemaining} red bins remaining.${daysMsg}`,
      });
    }

    // Inactive mechanics (all-time mechanics with no repairs this week)
    if (leaderboards && leaderboards.alltime && leaderboards.weekly) {
      const activeThisWeek = new Set(leaderboards.weekly.map(m => m.name));
      const inactive = leaderboards.alltime.filter(m => !activeThisWeek.has(m.name));
      if (inactive.length > 0) {
        const names = inactive.slice(0, 3).map(m => m.name).join(', ');
        const extra = inactive.length > 3 ? ` +${inactive.length - 3} more` : '';
        alerts.push({
          type: 'info',
          title: 'ℹ Inactive Mechanics This Week',
          message: `${inactive.length} mechanic(s) with no repairs this week: ${names}${extra}.`,
        });
      }
    }

    // Payout spike (any mechanic > 2× weekly average)
    if (leaderboards && leaderboards.weekly && leaderboards.weekly.length > 1) {
      const payouts = leaderboards.weekly.map(m => m.payout);
      const avg = payouts.reduce((a, b) => a + b, 0) / payouts.length;
      const spikes = leaderboards.weekly.filter(m => m.payout > avg * 2);
      if (spikes.length > 0) {
        alerts.push({
          type: 'warning',
          title: '↑ Payout Spike Detected',
          message: `${spikes.map(m => m.name).join(', ')} ha${spikes.length > 1 ? 've' : 's'} payout(s) significantly above the weekly average.`,
        });
      }
    }

    return alerts;
  },

  // ----- Financial summary -----

  /**
   * High-level financial summary.
   * @param {number} totalRepairs
   * @returns {object}
   */
  calculateFinancialSummary(totalRepairs) {
    const payPerRepair    = PAYMENT_RATES.PAY_PER_REPAIR;    // $700 mechanic cost
    const revenuePerRepair = PAYMENT_RATES.REPAIR_RATE;       // $2500 charged to customer
    const totalPayout   = totalRepairs * payPerRepair;
    const totalRevenue  = totalRepairs * revenuePerRepair;
    const netProfit     = totalRevenue - totalPayout;

    return {
      totalRevenue,
      totalPayout,
      netProfit,
      profitMargin: totalRevenue > 0
        ? Math.round((netProfit / totalRevenue) * 100)
        : 0,
    };
  },

  // ----- Data integrity -----

  /**
   * Find duplicate entries (same mechanic + same week).
   * @param {object[]} rows
   * @returns {object[]} issues [{type, mechanic, week, message}]
   */
  checkDataIntegrity(rows) {
    if (!rows || !rows.length) return [];

    const keys = this._inferKeys(rows[0]);
    const seen  = new Map();
    const issues = [];

    rows.forEach((r, idx) => {
      const mech = (r[keys.mechKey] || '').trim();
      const week = keys.weekKey ? (r[keys.weekKey] || '').trim() : null;
      if (!mech || !week) return;

      const key = `${mech}|${week}`;
      if (seen.has(key)) {
        issues.push({
          type: 'duplicate',
          rowIndex: idx,
          mechanic: mech,
          week,
          message: `Duplicate entry: ${mech} – week ${week}`,
        });
      } else {
        seen.set(key, idx);
      }
    });

    return issues;
  },

  // ----- Export helpers -----

  /**
   * Convert rows to CSV string.
   * @param {object[]} rows
   * @returns {string}
   */
  rowsToCSV(rows) {
    if (!rows || !rows.length) return '';
    const headers = Object.keys(rows[0]);
    const escape = v => {
      const s = String(v == null ? '' : v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const lines = [
      headers.map(escape).join(','),
      ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
    ];
    return lines.join('\n');
  },

  /**
   * Trigger a browser file download.
   * @param {string} content
   * @param {string} filename
   * @param {string} mimeType
   */
  downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  exportCSV(rows, filename = 'kintsugi-repairs.csv') {
    this.downloadFile(this.rowsToCSV(rows), filename, 'text/csv;charset=utf-8;');
  },

  exportJSON(rows, filename = 'kintsugi-repairs.json') {
    this.downloadFile(JSON.stringify(rows, null, 2), filename, 'application/json');
  },

  exportExcel(rows, filename = 'kintsugi-repairs.xlsx') {
    if (!window.XLSX) {
      kShowToast('Excel library not loaded. Try CSV export instead.', 'warning');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Repairs');
    XLSX.writeFile(wb, filename);
  },
};
