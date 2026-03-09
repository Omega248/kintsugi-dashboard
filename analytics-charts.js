// =======================================
// Kintsugi Analytics Charts
// Chart.js-based chart rendering.
// Requires Chart.js loaded via CDN before this file.
// =======================================

const AnalyticsCharts = {
  _charts: {},

  // ----- Helpers -----

  _destroy(id) {
    if (this._charts[id]) {
      this._charts[id].destroy();
      delete this._charts[id];
    }
  },

  _baseScales() {
    return {
      x: {
        ticks: { color: '#9ca3af', font: { size: 10 }, maxRotation: 45 },
        grid:  { color: 'rgba(255,255,255,0.06)' },
      },
      y: {
        ticks: { color: '#9ca3af', font: { size: 10 } },
        grid:  { color: 'rgba(255,255,255,0.06)' },
        beginAtZero: true,
      },
    };
  },

  _baseOptions(extra = {}) {
    return Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeInOutQuart' },
      plugins: {
        legend: {
          labels: { color: '#e5e7eb', font: { size: 11 }, padding: 16 },
        },
        tooltip: {
          backgroundColor: 'rgba(6, 11, 25, 0.95)',
          borderColor: 'rgba(79, 70, 229, 0.5)',
          borderWidth: 1,
          titleColor: '#e5e7eb',
          bodyColor: '#9ca3af',
          padding: 10,
        },
      },
    }, extra);
  },

  // ----- Public render methods -----

  /**
   * Line chart – repairs per day.
   * @param {string} canvasId
   * @param {[string, number][]} data  [[isoDate, count], ...]
   */
  renderRepairsTrend(canvasId, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    this._destroy(canvasId);

    if (!data || !data.length) {
      this._renderEmpty(ctx, 'No repair data available');
      return;
    }

    const labels = data.map(([d]) => {
      const dt = new Date(d + 'T00:00:00');
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const values = data.map(([, v]) => v);

    this._charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Repairs',
          data: values,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.12)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: '#4f46e5',
          pointBorderColor: '#020817',
          pointBorderWidth: 2,
        }],
      },
      options: {
        ...this._baseOptions(),
        scales: this._baseScales(),
        plugins: {
          ...this._baseOptions().plugins,
          legend: { display: false },
        },
      },
    });
  },

  /**
   * Bar chart – weekly payouts.
   * @param {string} canvasId
   * @param {[string, number][]} data  [[isoDate, repairCount], ...]
   */
  renderWeeklyPayouts(canvasId, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    this._destroy(canvasId);

    if (!data || !data.length) {
      this._renderEmpty(ctx, 'No payout data available');
      return;
    }

    const labels = data.map(([d]) => {
      const dt = new Date(d + 'T00:00:00');
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const values = data.map(([, v]) => v * PAYMENT_RATES.PAY_PER_REPAIR);

    this._charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Payout',
          data: values,
          backgroundColor: 'rgba(212, 175, 55, 0.65)',
          borderColor: '#d4af37',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        ...this._baseOptions(),
        scales: {
          ...this._baseScales(),
          y: {
            ...this._baseScales().y,
            ticks: {
              ...this._baseScales().y.ticks,
              callback: v => '$' + v.toLocaleString(),
            },
          },
        },
        plugins: {
          ...this._baseOptions().plugins,
          legend: { display: false },
          tooltip: {
            ...this._baseOptions().plugins.tooltip,
            callbacks: {
              label: ctx => ' $' + ctx.parsed.y.toLocaleString(),
            },
          },
        },
      },
    });
  },

  /**
   * Doughnut chart – mechanic repair distribution.
   * @param {string} canvasId
   * @param {object[]} data  [{name, repairs}]
   */
  renderMechanicDistribution(canvasId, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    this._destroy(canvasId);

    if (!data || !data.length) {
      this._renderEmpty(ctx, 'No mechanic data available');
      return;
    }

    const COLORS = [
      'rgba(79, 70, 229, 0.85)',
      'rgba(212, 175, 55, 0.85)',
      'rgba(34, 197, 94, 0.85)',
      'rgba(239, 68, 68, 0.85)',
      'rgba(168, 85, 247, 0.85)',
      'rgba(14, 165, 233, 0.85)',
      'rgba(249, 115, 22, 0.85)',
      'rgba(20, 184, 166, 0.85)',
    ];

    this._charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(m => m.name),
        datasets: [{
          data: data.map(m => m.repairs),
          backgroundColor: COLORS.slice(0, data.length),
          borderColor: 'rgba(2, 8, 23, 0.9)',
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: 'easeInOutQuart' },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#e5e7eb',
              font: { size: 10 },
              padding: 12,
              boxWidth: 12,
            },
          },
          tooltip: {
            ...this._baseOptions().plugins.tooltip,
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed} repairs`,
            },
          },
        },
      },
    });
  },

  /**
   * Horizontal bar chart – repairs per mechanic histogram.
   * @param {string} canvasId
   * @param {object[]} data  [{name, repairs}]
   */
  renderRepairsPerMechanic(canvasId, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    this._destroy(canvasId);

    if (!data || !data.length) {
      this._renderEmpty(ctx, 'No mechanic data available');
      return;
    }

    const sorted = [...data].sort((a, b) => b.repairs - a.repairs).slice(0, 10);

    this._charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(m => m.name),
        datasets: [{
          label: 'Total Repairs',
          data: sorted.map(m => m.repairs),
          backgroundColor: sorted.map((_, i) =>
            i === 0 ? 'rgba(212, 175, 55, 0.85)' : 'rgba(79, 70, 229, 0.65)'
          ),
          borderColor: sorted.map((_, i) =>
            i === 0 ? '#d4af37' : '#4f46e5'
          ),
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        indexAxis: 'y',
        ...this._baseOptions(),
        scales: {
          x: {
            ticks: { color: '#9ca3af', font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.06)' },
            beginAtZero: true,
          },
          y: {
            ticks: { color: '#e5e7eb', font: { size: 10 } },
            grid:  { display: false },
          },
        },
        plugins: {
          ...this._baseOptions().plugins,
          legend: { display: false },
        },
      },
    });
  },

  // ----- Internal helpers -----

  _renderEmpty(ctx, message) {
    const chart2d = ctx.getContext('2d');
    if (!chart2d) return;
    chart2d.clearRect(0, 0, ctx.width, ctx.height);
    chart2d.fillStyle = '#4b5563';
    chart2d.font = '12px system-ui, sans-serif';
    chart2d.textAlign = 'center';
    chart2d.textBaseline = 'middle';
    chart2d.fillText(message, ctx.width / 2, ctx.height / 2);
  },

  /**
   * Destroy all active charts (call on re-render).
   */
  destroyAll() {
    Object.keys(this._charts).forEach(id => this._destroy(id));
  },
};
