// ==========================================
// Kaneshiro Enterprises Platform
// Main Application Controller
// ==========================================

class KaneshiroApp {
  constructor() {
    this.config = CONFIG;
    this.sheetsClient = new SheetsClient(this.config);
    this.normalizer = new DataNormalizer(this.config);
    this.themeManager = new ThemeManager(this.config);
    
    this.state = {
      subsidiary: this.config.defaults.subsidiary,
      view: 'dashboard',
      data: null,
      loading: false,
      dateRange: 'all',
      filters: {}
    };

    this.init();
  }

  /**
   * Initialize application
   */
  async init() {
    // Apply default theme
    this.themeManager.applyTheme(this.state.subsidiary);
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Load data
    await this.loadData();
    
    // Render initial view
    this.render();
  }

  /**
   * Load all data from sheets
   */
  async loadData() {
    this.state.loading = true;
    this.showLoading();

    try {
      const rawSheets = await this.sheetsClient.fetchAllSheets();
      this.state.data = this.normalizer.normalizeAll(rawSheets);
      this.hideLoading();
    } catch (error) {
      console.error('Failed to load data:', error);
      this.showError('Failed to load data. Please check your connection and sheet permissions.');
      this.state.loading = false;
    }
  }

  /**
   * Setup global event listeners
   */
  setupEventListeners() {
    // Subsidiary switcher
    document.addEventListener('click', (e) => {
      const subsBtn = e.target.closest('[data-subsidiary]');
      if (subsBtn) {
        const subsidiary = subsBtn.dataset.subsidiary;
        this.switchSubsidiary(subsidiary);
      }

      // View switcher
      const viewBtn = e.target.closest('[data-view]');
      if (viewBtn) {
        const view = viewBtn.dataset.view;
        this.switchView(view);
      }

      // Refresh button
      if (e.target.closest('[data-action="refresh"]')) {
        this.loadData();
      }
    });

    // Date range selector
    const dateRangeSelect = document.getElementById('dateRange');
    if (dateRangeSelect) {
      dateRangeSelect.addEventListener('change', (e) => {
        this.state.dateRange = e.target.value;
        this.render();
      });
    }
  }

  /**
   * Switch subsidiary context
   */
  switchSubsidiary(subsidiary) {
    if (this.state.subsidiary === subsidiary) return;
    
    this.state.subsidiary = subsidiary;
    this.themeManager.applyTheme(subsidiary);
    this.render();
  }

  /**
   * Switch view
   */
  switchView(view) {
    if (this.state.view === view) return;
    
    this.state.view = view;
    this.render();
  }

  /**
   * Get filtered data for current context
   */
  getFilteredData() {
    if (!this.state.data) return { orders: [], payouts: [], deputies: [] };

    let { orders, payouts, deputies } = this.state.data;

    // Filter by subsidiary
    if (this.state.subsidiary !== 'kaneshiro') {
      orders = orders.filter(o => o.subsidiary === this.state.subsidiary);
      payouts = payouts.filter(p => p.subsidiary === this.state.subsidiary);
      deputies = deputies.filter(d => d.subsidiary === this.state.subsidiary);
    }

    // Filter by date range
    orders = Helpers.filterByDateRange(orders, 'date', this.state.dateRange);
    payouts = Helpers.filterByDateRange(payouts, 'date', this.state.dateRange);

    return { orders, payouts, deputies };
  }

  /**
   * Calculate KPIs
   */
  calculateKPIs(data) {
    const { orders, payouts, deputies } = data;

    return {
      totalRevenue: orders.reduce((sum, o) => sum + o.total, 0),
      totalOrders: orders.length,
      totalPayouts: payouts.reduce((sum, p) => sum + p.amount, 0),
      activeStaff: deputies.filter(d => d.active).length,
      avgOrderValue: orders.length > 0 ? orders.reduce((sum, o) => sum + o.total, 0) / orders.length : 0
    };
  }

  /**
   * Render application
   */
  render() {
    if (!this.state.data) return;

    // Update navigation state
    this.updateNavigation();

    // Render based on current view
    switch (this.state.view) {
      case 'dashboard':
        this.renderDashboard();
        break;
      case 'orders':
        this.renderOrders();
        break;
      case 'deputies':
        this.renderDeputies();
        break;
      case 'payout':
        this.renderPayout();
        break;
      default:
        this.renderDashboard();
    }
  }

  /**
   * Update navigation UI
   */
  updateNavigation() {
    // Update subsidiary selector
    document.querySelectorAll('[data-subsidiary]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subsidiary === this.state.subsidiary);
    });

    // Update view tabs
    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === this.state.view);
    });

    // Update subsidiary name in header
    const subsNameEl = document.getElementById('subsidiaryName');
    if (subsNameEl) {
      const theme = this.themeManager.getTheme(this.state.subsidiary);
      subsNameEl.textContent = theme.name;
    }
  }

  /**
   * Render dashboard view
   */
  renderDashboard() {
    const data = this.getFilteredData();
    const kpis = this.calculateKPIs(data);

    // Show dashboard, hide others
    document.getElementById('dashboardView').style.display = 'block';
    document.getElementById('ordersView').style.display = 'none';
    document.getElementById('deputiesView').style.display = 'none';
    document.getElementById('payoutView').style.display = 'none';

    // Render KPIs
    this.renderKPIs(kpis);

    // Render subsidiary breakdown if in Kaneshiro view
    if (this.state.subsidiary === 'kaneshiro') {
      this.renderSubsidiaryBreakdown();
    }

    // Render recent orders table
    this.renderRecentOrders(data.orders.slice(0, 10));
  }

  /**
   * Render KPIs
   */
  renderKPIs(kpis) {
    document.getElementById('kpiRevenue').textContent = Helpers.formatCurrency(kpis.totalRevenue);
    document.getElementById('kpiOrders').textContent = Helpers.formatNumber(kpis.totalOrders);
    document.getElementById('kpiPayouts').textContent = Helpers.formatCurrency(kpis.totalPayouts);
    document.getElementById('kpiStaff').textContent = Helpers.formatNumber(kpis.activeStaff);
  }

  /**
   * Render subsidiary breakdown (Kaneshiro view only)
   */
  renderSubsidiaryBreakdown() {
    const kintsugiData = {
      orders: this.state.data.orders.filter(o => o.subsidiary === 'kintsugi'),
      payouts: this.state.data.payouts.filter(p => p.subsidiary === 'kintsugi'),
      deputies: this.state.data.deputies.filter(d => d.subsidiary === 'kintsugi')
    };

    const takosuyaData = {
      orders: this.state.data.orders.filter(o => o.subsidiary === 'takosuya'),
      payouts: this.state.data.payouts.filter(p => p.subsidiary === 'takosuya'),
      deputies: this.state.data.deputies.filter(d => d.subsidiary === 'takosuya')
    };

    const kintsugiKPIs = this.calculateKPIs(kintsugiData);
    const takosuyaKPIs = this.calculateKPIs(takosuyaData);

    document.getElementById('breakdownContainer').innerHTML = `
      <div class="subsidiary-card" data-subsidiary="kintsugi" style="cursor: pointer;">
        <h3>Kintsugi</h3>
        <div class="breakdown-metrics">
          <div><span>Revenue:</span> ${Helpers.formatCurrency(kintsugiKPIs.totalRevenue)}</div>
          <div><span>Orders:</span> ${Helpers.formatNumber(kintsugiKPIs.totalOrders)}</div>
          <div><span>Payouts:</span> ${Helpers.formatCurrency(kintsugiKPIs.totalPayouts)}</div>
        </div>
      </div>
      <div class="subsidiary-card" data-subsidiary="takosuya" style="cursor: pointer;">
        <h3>Takosuya</h3>
        <div class="breakdown-metrics">
          <div><span>Revenue:</span> ${Helpers.formatCurrency(takosuyaKPIs.totalRevenue)}</div>
          <div><span>Orders:</span> ${Helpers.formatNumber(takosuyaKPIs.totalOrders)}</div>
          <div><span>Payouts:</span> ${Helpers.formatCurrency(takosuyaKPIs.totalPayouts)}</div>
        </div>
      </div>
    `;
  }

  /**
   * Render recent orders table
   */
  renderRecentOrders(orders) {
    const tbody = document.getElementById('recentOrdersBody');
    if (!tbody) return;

    tbody.innerHTML = orders.map(order => `
      <tr>
        <td>${Helpers.formatDate(order.date)}</td>
        <td>${order.customer}</td>
        <td>${order.items}</td>
        <td>${Helpers.formatCurrency(order.total)}</td>
        <td><span class="badge badge-${order.status}">${order.status}</span></td>
        ${this.state.subsidiary === 'kaneshiro' ? `<td><span class="badge badge-${order.subsidiary}">${order.subsidiary}</span></td>` : ''}
      </tr>
    `).join('');
  }

  /**
   * Render orders view
   */
  renderOrders() {
    const data = this.getFilteredData();

    // Show orders view, hide others
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('ordersView').style.display = 'block';
    document.getElementById('deputiesView').style.display = 'none';
    document.getElementById('payoutView').style.display = 'none';

    this.renderOrdersTable(data.orders);
  }

  /**
   * Render orders table
   */
  renderOrdersTable(orders) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    tbody.innerHTML = orders.map(order => `
      <tr>
        <td>${order.id}</td>
        <td>${Helpers.formatDate(order.date)}</td>
        <td>${order.customer}</td>
        <td>${order.staff || '—'}</td>
        <td>${Helpers.formatCurrency(order.total)}</td>
        <td><span class="badge badge-${order.status}">${order.status}</span></td>
      </tr>
    `).join('');
  }

  /**
   * Render deputies view
   */
  renderDeputies() {
    const data = this.getFilteredData();

    // Show deputies view, hide others
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('ordersView').style.display = 'none';
    document.getElementById('deputiesView').style.display = 'block';
    document.getElementById('payoutView').style.display = 'none';

    this.renderDeputiesTable(data.deputies);
  }

  /**
   * Render deputies table
   */
  renderDeputiesTable(deputies) {
    const tbody = document.getElementById('deputiesTableBody');
    if (!tbody) return;

    tbody.innerHTML = deputies.map(deputy => `
      <tr>
        <td>${deputy.name}</td>
        <td>${deputy.stateId || '—'}</td>
        <td>${Helpers.formatNumber(deputy.metrics.orders)}</td>
        <td>${Helpers.formatCurrency(deputy.metrics.revenue)}</td>
        <td>${Helpers.formatCurrency(deputy.metrics.payouts)}</td>
        <td><span class="badge badge-${deputy.active ? 'active' : 'inactive'}">${deputy.active ? 'Active' : 'Inactive'}</span></td>
      </tr>
    `).join('');
  }

  /**
   * Render payout view
   */
  renderPayout() {
    const data = this.getFilteredData();

    // Show payout view, hide others
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('ordersView').style.display = 'none';
    document.getElementById('deputiesView').style.display = 'none';
    document.getElementById('payoutView').style.display = 'block';

    this.renderPayoutTable(data.payouts);
  }

  /**
   * Render payout table
   */
  renderPayoutTable(payouts) {
    const tbody = document.getElementById('payoutTableBody');
    if (!tbody) return;

    tbody.innerHTML = payouts.map(payout => `
      <tr>
        <td>${payout.person}</td>
        <td>${payout.stateId || '—'}</td>
        <td>${Helpers.formatDate(payout.date)}</td>
        <td>${Helpers.formatCurrency(payout.amount)}</td>
        <td><span class="badge badge-${payout.type}">${payout.type}</span></td>
      </tr>
    `).join('');
  }

  /**
   * Show loading indicator
   */
  showLoading() {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'flex';
  }

  /**
   * Hide loading indicator
   */
  hideLoading() {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    this.state.loading = false;
  }

  /**
   * Show error message
   */
  showError(message) {
    Helpers.showToast(message, 'error', 5000);
  }
}

// Initialize app when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    window.app = new KaneshiroApp();
  });
}
