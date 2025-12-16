/**
 * Takosuya Dashboard Script
 * Operations-focused features with fast-paced energy
 */

// State management
const state = {
  orders: [],
  payouts: [],
  staff: [],
  loading: false,
  currentPage: 1,
  pageSize: 25,
  searchTerm: '',
  statusFilter: 'all'
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Apply Takosuya theme
  themeEngine.applyTheme('takosuya');
  
  // Set up navigation
  navigation.setContext('takosuya');
  navigation.inject();
  
  // Set up event listeners
  setupEventListeners();
  
  // Load initial data
  await loadData();
  
  // Update UI
  updateUI();
});

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Time controls
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const period = btn.dataset.period;
      timeControls.setPeriod(period);
      updateUI();
    });
  });
  
  // Copy payouts button
  document.getElementById('copyPayoutsBtn')?.addEventListener('click', copyPayouts);
  
  // Copy summary button
  document.getElementById('copySummaryBtn')?.addEventListener('click', copySummary);
  
  // Print summary button
  document.getElementById('printSummaryBtn')?.addEventListener('click', printSummary);
  
  // Refresh button
  document.getElementById('refreshBtn')?.addEventListener('click', async () => {
    await loadData(true);
    updateUI();
  });
  
  // Search input
  const searchInput = document.getElementById('orderSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchTerm = e.target.value.toLowerCase();
      state.currentPage = 1;
      updateOrdersTable();
    });
  }
  
  // Status filter
  const statusFilter = document.getElementById('statusFilter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      state.statusFilter = e.target.value;
      state.currentPage = 1;
      updateOrdersTable();
    });
  }
}

/**
 * Load data from Google Sheets
 */
async function loadData(forceRefresh = false) {
  if (state.loading) return;
  
  state.loading = true;
  
  try {
    console.log('Loading Takosuya data...');
    
    const data = forceRefresh 
      ? await dataIngestion.refresh()
      : await dataIngestion.fetchAll();
    
    // Filter to only Takosuya data
    state.orders = (data.orders || []).filter(o => o.isTakosuya());
    state.payouts = (data.payouts || []).filter(p => p.isTakosuya());
    state.staff = (data.staff || []).filter(s => s.isTakosuya());
    
    console.log(`Loaded ${state.orders.length} orders, ${state.payouts.length} payouts, ${state.staff.length} team members`);
  } catch (error) {
    console.error('Error loading data:', error);
    showNotification('Failed to load data. Please try again.', 'error');
  } finally {
    state.loading = false;
  }
}

/**
 * Update entire UI
 */
function updateUI() {
  updateDateRange();
  updateOperationsKPIs();
  updateQuickStats();
  updateTeamGrid();
  updateCategoryGrid();
  updatePayoutGrid();
  updateOrdersTable();
  updateDailySummary();
}

/**
 * Update date range display
 */
function updateDateRange() {
  const displayEl = document.getElementById('dateRangeDisplay');
  if (displayEl) {
    displayEl.textContent = timeControls.formatRange();
  }
}

/**
 * Update operations KPIs
 */
function updateOperationsKPIs() {
  const container = document.getElementById('operationsKPIs');
  if (!container) return;
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const previousOrders = timeControls.filterByPreviousRange(state.orders);
  
  const totalOrders = currentOrders.length;
  const previousOrderCount = previousOrders.length;
  const totalRevenue = Aggregations.totalRevenue(currentOrders);
  const previousRevenue = Aggregations.totalRevenue(previousOrders);
  const activeTeam = state.staff.filter(s => s.active).length;
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  const totalPayouts = Aggregations.totalPayouts(currentPayouts);
  
  const kpis = [
    new KPICard({
      title: 'Total Orders',
      value: totalOrders,
      format: 'number',
      trend: Aggregations.calculateTrend(totalOrders, previousOrderCount)
    }),
    new KPICard({
      title: 'Total Revenue',
      value: totalRevenue,
      format: 'currency',
      trend: Aggregations.calculateTrend(totalRevenue, previousRevenue)
    }),
    new KPICard({
      title: 'Team Payouts',
      value: totalPayouts,
      format: 'currency'
    }),
    new KPICard({
      title: 'Active Team',
      value: activeTeam,
      format: 'number',
      subtitle: 'Members on duty'
    })
  ];
  
  container.innerHTML = kpis.map(kpi => kpi.render()).join('');
}

/**
 * Update quick stats
 */
function updateQuickStats() {
  const currentOrders = timeControls.filterByRange(state.orders);
  const totalRevenue = Aggregations.totalRevenue(currentOrders);
  const totalOrders = currentOrders.length;
  const activeTeam = state.staff.filter(s => s.active).length;
  
  // Calculate avg order value
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  document.getElementById('avgOrderValue').textContent = `$${avgOrderValue.toFixed(2)}`;
  
  // Calculate orders per hour (rough estimate based on period)
  const range = timeControls.getRange();
  const hours = (range.end - range.start) / (1000 * 60 * 60);
  const ordersPerHour = hours > 0 ? Math.round(totalOrders / hours) : 0;
  document.getElementById('ordersPerHour').textContent = ordersPerHour;
  
  // Active team
  document.getElementById('activeTeam').textContent = activeTeam;
  
  // Target progress (assume target is 100 orders per day)
  const target = 100;
  const progress = Math.min(100, Math.round((totalOrders / target) * 100));
  document.getElementById('targetProgress').textContent = `${progress}%`;
}

/**
 * Update team performance grid
 */
function updateTeamGrid() {
  const container = document.getElementById('teamGrid');
  if (!container) return;
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  
  const teamStats = state.staff.map(member => {
    const orders = currentOrders.filter(o => o.staff === member.name);
    const payouts = currentPayouts.filter(p => p.person === member.name);
    
    return {
      name: member.name,
      role: member.role || 'Team Member',
      orders: orders.length,
      revenue: Aggregations.totalRevenue(orders),
      payouts: Aggregations.totalPayouts(payouts),
      active: member.active
    };
  }).filter(m => m.active);
  
  // Sort by orders descending
  teamStats.sort((a, b) => b.orders - a.orders);
  
  if (teamStats.length === 0) {
    container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 48px; color: var(--color-textMuted);">No team data available</div>';
    return;
  }
  
  container.innerHTML = teamStats.map(m => `
    <div class="team-card">
      <div class="team-member-header">
        <div>
          <div class="team-member-name">${m.name}</div>
          <div class="team-member-role">${m.role}</div>
        </div>
      </div>
      <div class="team-metrics">
        <div class="team-metric">
          <span class="team-metric-label">Orders Served</span>
          <span class="team-metric-value">${m.orders}</span>
        </div>
        <div class="team-metric">
          <span class="team-metric-label">Revenue</span>
          <span class="team-metric-value">$${m.revenue.toLocaleString('en-US')}</span>
        </div>
        <div class="team-metric">
          <span class="team-metric-label">Earnings</span>
          <span class="team-metric-value">$${m.payouts.toLocaleString('en-US')}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Update category breakdown
 */
function updateCategoryGrid() {
  const container = document.getElementById('categoryGrid');
  if (!container) return;
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const byCategory = Aggregations.byCategory(currentOrders);
  
  const categories = [
    { key: 'food_order', name: '🍜 Food Orders', icon: '🍜' },
    { key: 'beverage', name: '🍹 Beverages', icon: '🍹' },
    { key: 'special', name: '⭐ Specials', icon: '⭐' },
    { key: 'other', name: '📦 Other', icon: '📦' }
  ];
  
  container.innerHTML = categories.map(cat => {
    const orders = byCategory[cat.key] || [];
    const count = orders.length;
    const revenue = Aggregations.totalRevenue(orders);
    
    return `
      <div class="category-card">
        <div style="font-size: 48px; margin-bottom: 12px;">${cat.icon}</div>
        <div class="category-name">${cat.name.replace(/[^\w\s]/g, '')}</div>
        <div class="category-count">${count}</div>
        <div class="category-revenue">
          ${revenue > 0 ? `$${revenue.toLocaleString('en-US')}` : 'No orders'}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Update payout grid
 */
function updatePayoutGrid() {
  const container = document.getElementById('payoutGrid');
  if (!container) return;
  
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  const byPerson = Aggregations.payoutsByPerson(currentPayouts);
  
  const payoutList = Object.values(byPerson);
  payoutList.sort((a, b) => b.total - a.total);
  
  if (payoutList.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 48px; color: var(--color-textMuted); font-weight: 600;">No payout data available for this period</div>';
    return;
  }
  
  container.innerHTML = payoutList.map(p => `
    <div class="payout-card">
      <div>
        <div class="payout-person">${p.person}</div>
        <div class="payout-breakdown">
          ${p.earnings > 0 ? `Earnings: $${p.earnings.toLocaleString('en-US')}` : ''}
          ${p.reimbursements > 0 ? ` • Reimbursements: $${p.reimbursements.toLocaleString('en-US')}` : ''}
          ${p.bonuses > 0 ? ` • Bonuses: $${p.bonuses.toLocaleString('en-US')}` : ''}
        </div>
      </div>
      <div class="payout-amount">$${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
    </div>
  `).join('');
}

/**
 * Update orders table
 */
function updateOrdersTable() {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;
  
  // Filter orders
  let filteredOrders = timeControls.filterByRange(state.orders);
  
  // Apply status filter
  if (state.statusFilter !== 'all') {
    filteredOrders = filteredOrders.filter(o => o.status === state.statusFilter);
  }
  
  // Apply search
  if (state.searchTerm) {
    filteredOrders = filteredOrders.filter(o => 
      o.customer.toLowerCase().includes(state.searchTerm) ||
      o.staff.toLowerCase().includes(state.searchTerm) ||
      (o.notes && o.notes.toLowerCase().includes(state.searchTerm))
    );
  }
  
  // Sort by date descending
  filteredOrders.sort((a, b) => {
    const dateA = a.date || new Date(0);
    const dateB = b.date || new Date(0);
    return dateB - dateA;
  });
  
  // Pagination
  const start = (state.currentPage - 1) * state.pageSize;
  const end = start + state.pageSize;
  const paginatedOrders = filteredOrders.slice(start, end);
  
  if (paginatedOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 48px; color: var(--color-textMuted); font-weight: 600;">No orders found</td></tr>';
    return;
  }
  
  tbody.innerHTML = paginatedOrders.map(order => {
    const time = order.date ? order.date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    }) : '--';
    
    return `
      <tr>
        <td>${time}</td>
        <td>${order.customer}</td>
        <td>${order.category.replace('_', ' ')}</td>
        <td>${order.staff}</td>
        <td style="color: var(--color-primary); font-weight: 700;">${order.getFormattedTotal()}</td>
        <td>${order.status}</td>
      </tr>
    `;
  }).join('');
  
  // Update pagination
  updatePagination(filteredOrders.length);
}

/**
 * Update pagination
 */
function updatePagination(totalItems) {
  const container = document.getElementById('tablePagination');
  if (!container) return;
  
  const totalPages = Math.ceil(totalItems / state.pageSize);
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  let html = '<div style="display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 20px;">';
  
  if (state.currentPage > 1) {
    html += '<button onclick="changePage(' + (state.currentPage - 1) + ')" class="btn-secondary">← Previous</button>';
  }
  
  html += `<span style="color: var(--color-textSecondary); font-weight: 700;">Page ${state.currentPage} of ${totalPages}</span>`;
  
  if (state.currentPage < totalPages) {
    html += '<button onclick="changePage(' + (state.currentPage + 1) + ')" class="btn-secondary">Next →</button>';
  }
  
  html += '</div>';
  
  container.innerHTML = html;
}

/**
 * Change page
 */
function changePage(page) {
  state.currentPage = page;
  updateOrdersTable();
  document.querySelector('.orders-table')?.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Update daily summary
 */
function updateDailySummary() {
  const container = document.getElementById('dailySummary');
  if (!container) return;
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  
  const stats = [
    { label: 'Total Orders', value: currentOrders.length },
    { label: 'Total Revenue', value: `$${Aggregations.totalRevenue(currentOrders).toLocaleString('en-US')}` },
    { label: 'Avg Order Value', value: currentOrders.length > 0 ? `$${(Aggregations.totalRevenue(currentOrders) / currentOrders.length).toFixed(2)}` : '$0' },
    { label: 'Team Payouts', value: `$${Aggregations.totalPayouts(currentPayouts).toLocaleString('en-US')}` }
  ];
  
  container.innerHTML = stats.map(s => `
    <div class="summary-stat">
      <div class="summary-stat-label">${s.label}</div>
      <div class="summary-stat-value">${s.value}</div>
    </div>
  `).join('');
}

/**
 * Copy payouts to clipboard
 */
async function copyPayouts() {
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  const byPerson = Aggregations.payoutsByPerson(currentPayouts);
  const payoutList = Object.values(byPerson).sort((a, b) => b.total - a.total);
  
  let text = `TAKOSUYA TEAM PAYOUTS\n${timeControls.formatRange()}\n\n`;
  
  payoutList.forEach(p => {
    text += `${p.person}: $${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
    if (p.earnings > 0) text += `  Earnings: $${p.earnings.toLocaleString('en-US')}\n`;
    if (p.reimbursements > 0) text += `  Reimbursements: $${p.reimbursements.toLocaleString('en-US')}\n`;
    if (p.bonuses > 0) text += `  Bonuses: $${p.bonuses.toLocaleString('en-US')}\n`;
    text += '\n';
  });
  
  text += `Total Payouts: $${Aggregations.totalPayouts(currentPayouts).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  
  try {
    await navigator.clipboard.writeText(text);
    showNotification('Payouts copied to clipboard!', 'success');
  } catch (error) {
    console.error('Failed to copy:', error);
    showNotification('Failed to copy payouts', 'error');
  }
}

/**
 * Copy summary to clipboard
 */
async function copySummary() {
  const range = timeControls.getRange();
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  
  const summary = `TAKOSUYA DAILY SUMMARY
${range.end.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

Total Orders: ${currentOrders.length}
Total Revenue: $${Aggregations.totalRevenue(currentOrders).toLocaleString('en-US', { minimumFractionDigits: 2 })}
Avg Order Value: $${currentOrders.length > 0 ? (Aggregations.totalRevenue(currentOrders) / currentOrders.length).toFixed(2) : '0.00'}
Team Payouts: $${Aggregations.totalPayouts(currentPayouts).toLocaleString('en-US', { minimumFractionDigits: 2 })}

Generated: ${new Date().toLocaleString()}`;
  
  try {
    await navigator.clipboard.writeText(summary);
    showNotification('Summary copied to clipboard!', 'success');
  } catch (error) {
    console.error('Failed to copy:', error);
    showNotification('Failed to copy summary', 'error');
  }
}

/**
 * Print summary
 */
function printSummary() {
  window.print();
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#f59e0b'};
    color: white;
    border-radius: 16px;
    font-weight: 700;
    font-size: 14px;
    z-index: 10000;
    animation: bounceIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'bounceOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Add animation keyframes
if (!document.getElementById('takosuya-animations')) {
  const style = document.createElement('style');
  style.id = 'takosuya-animations';
  style.textContent = `
    @keyframes bounceIn {
      0% { transform: scale(0) translateX(400px); opacity: 0; }
      50% { transform: scale(1.1) translateX(0); }
      100% { transform: scale(1) translateX(0); opacity: 1; }
    }
    @keyframes bounceOut {
      0% { transform: scale(1) translateX(0); opacity: 1; }
      100% { transform: scale(0) translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
