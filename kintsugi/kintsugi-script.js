/**
 * Kintsugi Dashboard Script
 * Repair-centric features with elegant presentation
 */

// State management
const state = {
  orders: [],
  payouts: [],
  staff: [],
  loading: false,
  currentPage: 1,
  pageSize: 20,
  searchTerm: '',
  categoryFilter: 'all'
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Apply Kintsugi theme
  themeEngine.applyTheme('kintsugi');
  
  // Set up navigation
  navigation.setContext('kintsugi');
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
      
      if (period === 'custom') {
        showCustomDateModal();
      } else {
        timeControls.setPeriod(period);
        updateUI();
      }
    });
  });
  
  // Summary tabs
  document.querySelectorAll('.summary-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = tab.dataset.tab;
      switchSummaryTab(tabName);
    });
  });
  
  // Copy summary buttons
  document.getElementById('copyWeeklySummary')?.addEventListener('click', () => {
    copySummary('weekly');
  });
  
  document.getElementById('copyMonthlySummary')?.addEventListener('click', () => {
    copySummary('monthly');
  });
  
  // Refresh button
  document.getElementById('refreshBtn')?.addEventListener('click', async () => {
    await loadData(true);
    updateUI();
  });
  
  // Search input
  const searchInput = document.getElementById('repairSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchTerm = e.target.value.toLowerCase();
      state.currentPage = 1;
      updateRepairTable();
    });
  }
  
  // Category filter
  const categoryFilter = document.getElementById('categoryFilter');
  if (categoryFilter) {
    categoryFilter.addEventListener('change', (e) => {
      state.categoryFilter = e.target.value;
      state.currentPage = 1;
      updateRepairTable();
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
    console.log('Loading Kintsugi data...');
    
    const data = forceRefresh 
      ? await dataIngestion.refresh()
      : await dataIngestion.fetchAll();
    
    // Filter to only Kintsugi data
    state.orders = (data.orders || []).filter(o => o.isKintsugi());
    state.payouts = (data.payouts || []).filter(p => p.isKintsugi());
    state.staff = (data.staff || []).filter(s => s.isKintsugi());
    
    console.log(`Loaded ${state.orders.length} repairs, ${state.payouts.length} payouts, ${state.staff.length} mechanics`);
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
  updateRepairKPIs();
  updateCategoryBreakdown();
  updateMechanicCards();
  updateWeeklySummary();
  updateMonthlySummary();
  updatePayoutGrid();
  updateRepairTable();
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
 * Update repair KPIs
 */
function updateRepairKPIs() {
  const container = document.getElementById('repairKPIs');
  if (!container) return;
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const previousOrders = timeControls.filterByPreviousRange(state.orders);
  
  const totalRepairs = currentOrders.length;
  const previousRepairCount = previousOrders.length;
  const totalRevenue = Aggregations.totalRevenue(currentOrders);
  const previousRevenue = Aggregations.totalRevenue(previousOrders);
  const avgRepairValue = totalRepairs > 0 ? totalRevenue / totalRepairs : 0;
  const previousAvg = previousOrders.length > 0 
    ? Aggregations.totalRevenue(previousOrders) / previousOrders.length 
    : 0;
  
  const engineReplacements = currentOrders.filter(o => 
    o.category === 'engine_replacement'
  ).length;
  
  const kpis = [
    new KPICard({
      title: 'Total Repairs',
      value: totalRepairs,
      format: 'number',
      trend: Aggregations.calculateTrend(totalRepairs, previousRepairCount)
    }),
    new KPICard({
      title: 'Total Revenue',
      value: totalRevenue,
      format: 'currency',
      trend: Aggregations.calculateTrend(totalRevenue, previousRevenue)
    }),
    new KPICard({
      title: 'Avg Repair Value',
      value: avgRepairValue,
      format: 'currency',
      trend: Aggregations.calculateTrend(avgRepairValue, previousAvg)
    }),
    new KPICard({
      title: 'Engine Replacements',
      value: engineReplacements,
      format: 'number',
      subtitle: 'Specialized work'
    })
  ];
  
  container.innerHTML = kpis.map(kpi => kpi.render()).join('');
}

/**
 * Update category breakdown
 */
function updateCategoryBreakdown() {
  const container = document.getElementById('categoryGrid');
  if (!container) return;
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const byCategory = Aggregations.byCategory(currentOrders);
  
  const categories = [
    {
      key: 'standard_repair',
      name: 'Standard Repairs',
      description: 'Regular maintenance and repair work'
    },
    {
      key: 'engine_replacement',
      name: 'Engine Replacements',
      description: 'Complete engine replacement services'
    },
    {
      key: 'special_work',
      name: 'Special Work',
      description: 'Custom and specialized services'
    }
  ];
  
  container.innerHTML = categories.map(cat => {
    const orders = byCategory[cat.key] || [];
    const count = orders.length;
    const revenue = Aggregations.totalRevenue(orders);
    
    return `
      <div class="category-card">
        <div class="category-name">${cat.name}</div>
        <div class="category-count">${count}</div>
        <div class="category-revenue">
          ${revenue > 0 ? `$${revenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}` : 'No repairs'}
        </div>
        <div class="category-description" style="margin-top: 12px; font-size: 13px; color: var(--color-textMuted);">
          ${cat.description}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Update mechanic cards
 */
function updateMechanicCards() {
  const container = document.getElementById('mechanicsGrid');
  if (!container) return;
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  
  const mechanicStats = state.staff.map(mechanic => {
    const repairs = currentOrders.filter(o => o.staff === mechanic.name);
    const payouts = currentPayouts.filter(p => p.person === mechanic.name);
    const engineReplacements = repairs.filter(o => o.category === 'engine_replacement').length;
    
    return {
      name: mechanic.name,
      repairs: repairs.length,
      revenue: Aggregations.totalRevenue(repairs),
      payouts: Aggregations.totalPayouts(payouts),
      engines: engineReplacements,
      active: mechanic.active
    };
  }).filter(m => m.active);
  
  // Sort by repairs descending
  mechanicStats.sort((a, b) => b.repairs - a.repairs);
  
  if (mechanicStats.length === 0) {
    container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 48px; color: var(--color-textMuted);">No mechanic data available</div>';
    return;
  }
  
  container.innerHTML = mechanicStats.map(m => `
    <div class="mechanic-card">
      <div class="mechanic-name">${m.name}</div>
      <div class="mechanic-metrics">
        <div class="mechanic-metric">
          <span class="mechanic-metric-label">Repairs Completed</span>
          <span class="mechanic-metric-value">${m.repairs}</span>
        </div>
        <div class="mechanic-metric">
          <span class="mechanic-metric-label">Revenue Generated</span>
          <span class="mechanic-metric-value">$${m.revenue.toLocaleString('en-US')}</span>
        </div>
        <div class="mechanic-metric">
          <span class="mechanic-metric-label">Engine Replacements</span>
          <span class="mechanic-metric-value">${m.engines}</span>
        </div>
        <div class="mechanic-metric">
          <span class="mechanic-metric-label">Payouts Earned</span>
          <span class="mechanic-metric-value">$${m.payouts.toLocaleString('en-US')}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Update weekly summary
 */
function updateWeeklySummary() {
  const range = timeControls.getRange();
  const weekEnding = document.getElementById('weekEnding');
  const statsContainer = document.getElementById('weeklyStats');
  
  if (!statsContainer) return;
  
  if (weekEnding) {
    weekEnding.textContent = range.end.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  }
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  
  const stats = [
    { label: 'Total Repairs', value: currentOrders.length },
    { label: 'Total Revenue', value: `$${Aggregations.totalRevenue(currentOrders).toLocaleString('en-US')}` },
    { label: 'Engine Replacements', value: currentOrders.filter(o => o.category === 'engine_replacement').length },
    { label: 'Total Payouts', value: `$${Aggregations.totalPayouts(currentPayouts).toLocaleString('en-US')}` }
  ];
  
  statsContainer.innerHTML = stats.map(s => `
    <div class="summary-stat">
      <div class="summary-stat-label">${s.label}</div>
      <div class="summary-stat-value">${s.value}</div>
    </div>
  `).join('');
}

/**
 * Update monthly summary
 */
function updateMonthlySummary() {
  const range = timeControls.getRange();
  const monthName = document.getElementById('monthName');
  const statsContainer = document.getElementById('monthlyStats');
  
  if (!statsContainer) return;
  
  if (monthName) {
    monthName.textContent = range.start.toLocaleDateString('en-US', { 
      month: 'long', 
      year: 'numeric' 
    });
  }
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  
  const stats = [
    { label: 'Total Repairs', value: currentOrders.length },
    { label: 'Total Revenue', value: `$${Aggregations.totalRevenue(currentOrders).toLocaleString('en-US')}` },
    { label: 'Active Mechanics', value: state.staff.filter(s => s.active).length },
    { label: 'Total Payouts', value: `$${Aggregations.totalPayouts(currentPayouts).toLocaleString('en-US')}` }
  ];
  
  statsContainer.innerHTML = stats.map(s => `
    <div class="summary-stat">
      <div class="summary-stat-label">${s.label}</div>
      <div class="summary-stat-value">${s.value}</div>
    </div>
  `).join('');
}

/**
 * Switch summary tab
 */
function switchSummaryTab(tabName) {
  // Update tab active states
  document.querySelectorAll('.summary-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update panel visibility
  document.querySelectorAll('.summary-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `${tabName}Summary`);
  });
}

/**
 * Copy summary to clipboard
 */
async function copySummary(type) {
  const range = timeControls.getRange();
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  
  const totalRevenue = Aggregations.totalRevenue(currentOrders);
  const totalPayouts = Aggregations.totalPayouts(currentPayouts);
  const engines = currentOrders.filter(o => o.category === 'engine_replacement').length;
  
  const summary = `KINTSUGI MOTORWORKS ${type.toUpperCase()} SUMMARY
${type === 'weekly' ? 'Week Ending' : 'Month'}: ${range.end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

Repairs Completed: ${currentOrders.length}
Total Revenue: $${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
Engine Replacements: ${engines}
Total Mechanic Payouts: $${totalPayouts.toLocaleString('en-US', { minimumFractionDigits: 2 })}

Generated: ${new Date().toLocaleString()}`;
  
  try {
    await navigator.clipboard.writeText(summary);
    showNotification('Summary copied to clipboard', 'success');
  } catch (error) {
    console.error('Failed to copy:', error);
    showNotification('Failed to copy summary', 'error');
  }
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
    container.innerHTML = '<div style="text-align: center; padding: 48px; color: var(--color-textMuted);">No payout data available for this period</div>';
    return;
  }
  
  container.innerHTML = payoutList.map(p => `
    <div class="payout-card">
      <div class="payout-person">${p.person}</div>
      <div class="payout-details">
        <div class="payout-amount">$${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        <div class="payout-breakdown">
          Earnings: $${p.earnings.toLocaleString('en-US')} 
          ${p.reimbursements > 0 ? `| Reimbursements: $${p.reimbursements.toLocaleString('en-US')}` : ''}
          ${p.bonuses > 0 ? `| Bonuses: $${p.bonuses.toLocaleString('en-US')}` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Update repair history table
 */
function updateRepairTable() {
  const tbody = document.getElementById('repairTableBody');
  if (!tbody) return;
  
  // Filter orders
  let filteredOrders = timeControls.filterByRange(state.orders);
  
  // Apply category filter
  if (state.categoryFilter !== 'all') {
    filteredOrders = filteredOrders.filter(o => o.category === state.categoryFilter);
  }
  
  // Apply search
  if (state.searchTerm) {
    filteredOrders = filteredOrders.filter(o => 
      o.customer.toLowerCase().includes(state.searchTerm) ||
      o.staff.toLowerCase().includes(state.searchTerm) ||
      o.notes.toLowerCase().includes(state.searchTerm)
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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 48px; color: var(--color-textMuted);">No repairs found</td></tr>';
    return;
  }
  
  tbody.innerHTML = paginatedOrders.map(order => {
    const categoryLabels = {
      'standard_repair': 'Standard Repair',
      'engine_replacement': 'Engine Replacement',
      'special_work': 'Special Work',
      'other': 'Other'
    };
    
    return `
      <tr>
        <td>${order.getFormattedDate('short')}</td>
        <td>${order.customer}</td>
        <td>${categoryLabels[order.category] || order.category}</td>
        <td>${order.staff}</td>
        <td style="color: var(--color-secondary); font-weight: 600;">${order.getFormattedTotal()}</td>
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
  
  // Previous button
  if (state.currentPage > 1) {
    html += '<button onclick="changePage(' + (state.currentPage - 1) + ')" class="btn">← Previous</button>';
  }
  
  // Page info
  html += `<span style="color: var(--color-textSecondary);">Page ${state.currentPage} of ${totalPages}</span>`;
  
  // Next button
  if (state.currentPage < totalPages) {
    html += '<button onclick="changePage(' + (state.currentPage + 1) + ')" class="btn">Next →</button>';
  }
  
  html += '</div>';
  
  container.innerHTML = html;
}

/**
 * Change page
 */
function changePage(page) {
  state.currentPage = page;
  updateRepairTable();
  // Scroll to table
  document.querySelector('.repair-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Show custom date modal
 */
function showCustomDateModal() {
  const modal = document.getElementById('customDateModal');
  if (!modal) return;
  
  modal.style.display = 'flex';
  
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setMonth(today.getMonth() - 1);
  
  document.getElementById('customStartDate').valueAsDate = monthAgo;
  document.getElementById('customEndDate').valueAsDate = today;
  
  // Close on overlay click
  document.getElementById('modalOverlay').onclick = () => {
    modal.style.display = 'none';
    document.querySelector('.time-btn.active')?.classList.remove('active');
    document.querySelector('.time-btn[data-period="month"]')?.classList.add('active');
  };
  
  // Handle cancel
  document.getElementById('cancelCustomDate').onclick = () => {
    modal.style.display = 'none';
    document.querySelector('.time-btn.active')?.classList.remove('active');
    document.querySelector('.time-btn[data-period="month"]')?.classList.add('active');
  };
  
  // Handle apply
  document.getElementById('applyCustomDate').onclick = () => {
    const startDate = document.getElementById('customStartDate').valueAsDate;
    const endDate = document.getElementById('customEndDate').valueAsDate;
    
    if (startDate && endDate && startDate <= endDate) {
      timeControls.setPeriod('custom', startDate, endDate);
      modal.style.display = 'none';
      updateUI();
    } else {
      showNotification('Please select valid dates', 'error');
    }
  };
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#D4AF37'};
    color: white;
    border-radius: 14px;
    font-weight: 600;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Add animation keyframes
if (!document.getElementById('kintsugi-animations')) {
  const style = document.createElement('style');
  style.id = 'kintsugi-animations';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
