/**
 * Kaneshiro Enterprises Executive Dashboard Script
 * Handles data loading, KPI calculations, and UI updates
 */

// State management
const state = {
  orders: [],
  payouts: [],
  staff: [],
  loading: false
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Apply Kaneshiro theme
  themeEngine.applyTheme('kaneshiro');
  
  // Set up navigation
  navigation.setContext('kaneshiro');
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
      // Update active state
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
  
  // Copy summary button
  document.getElementById('copySummaryBtn')?.addEventListener('click', copySummary);
  
  // Refresh button
  document.getElementById('refreshBtn')?.addEventListener('click', async () => {
    await loadData(true);
    updateUI();
  });
  
  // Export button
  document.getElementById('exportBtn')?.addEventListener('click', exportReport);
}

/**
 * Load data from Google Sheets
 */
async function loadData(forceRefresh = false) {
  if (state.loading) return;
  
  state.loading = true;
  
  try {
    console.log('Loading data...');
    
    const data = forceRefresh 
      ? await dataIngestion.refresh()
      : await dataIngestion.fetchAll();
    
    state.orders = data.orders || [];
    state.payouts = data.payouts || [];
    state.staff = data.staff || [];
    
    console.log(`Loaded ${state.orders.length} orders, ${state.payouts.length} payouts, ${state.staff.length} staff`);
  } catch (error) {
    console.error('Error loading data:', error);
    showError('Failed to load data. Please try again.');
  } finally {
    state.loading = false;
  }
}

/**
 * Update UI with current data
 */
function updateUI() {
  updateDateRange();
  updateConsolidatedKPIs();
  updateSubsidiaryCards();
  updateAlerts();
  updateExecutiveSummary();
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
 * Update consolidated KPIs
 */
function updateConsolidatedKPIs() {
  const container = document.getElementById('consolidatedKPIs');
  if (!container) return;
  
  // Filter by time range
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  const previousOrders = timeControls.filterByPreviousRange(state.orders);
  const previousPayouts = timeControls.filterByPreviousRange(state.payouts, 'week');
  
  // Calculate metrics
  const totalRevenue = Aggregations.totalRevenue(currentOrders);
  const previousRevenue = Aggregations.totalRevenue(previousOrders);
  const totalOrders = currentOrders.length;
  const previousOrderCount = previousOrders.length;
  const totalPayouts = Aggregations.totalPayouts(currentPayouts);
  const previousPayoutTotal = Aggregations.totalPayouts(previousPayouts);
  const activeStaff = state.staff.filter(s => s.active).length;
  
  // Create KPI cards
  const kpis = [
    new KPICard({
      title: 'Total Revenue',
      value: totalRevenue,
      format: 'currency',
      trend: Aggregations.calculateTrend(totalRevenue, previousRevenue)
    }),
    new KPICard({
      title: 'Total Orders',
      value: totalOrders,
      format: 'number',
      trend: Aggregations.calculateTrend(totalOrders, previousOrderCount)
    }),
    new KPICard({
      title: 'Total Payouts',
      value: totalPayouts,
      format: 'currency',
      trend: Aggregations.calculateTrend(totalPayouts, previousPayoutTotal)
    }),
    new KPICard({
      title: 'Active Staff',
      value: activeStaff,
      format: 'number'
    })
  ];
  
  container.innerHTML = kpis.map(kpi => kpi.render()).join('');
}

/**
 * Update subsidiary comparison cards
 */
function updateSubsidiaryCards() {
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  
  // Kintsugi metrics
  const kintsugiSummary = Aggregations.subsidiarySummary(
    currentOrders, currentPayouts, state.staff, 'kintsugi'
  );
  updateSubsidiaryCard('kintsugi', kintsugiSummary);
  
  // Takosuya metrics
  const takosuyaSummary = Aggregations.subsidiarySummary(
    currentOrders, currentPayouts, state.staff, 'takosuya'
  );
  updateSubsidiaryCard('takosuya', takosuyaSummary);
}

/**
 * Update individual subsidiary card
 */
function updateSubsidiaryCard(subsidiary, summary) {
  const container = document.getElementById(`${subsidiary}Metrics`);
  if (!container) return;
  
  const metrics = [
    { label: 'Revenue', value: `$${summary.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}` },
    { label: 'Orders', value: summary.totalOrders.toLocaleString('en-US') },
    { label: 'Avg Order', value: `$${summary.avgOrderValue.toLocaleString('en-US', { minimumFractionDigits: 0 })}` },
    { label: 'Active Staff', value: summary.activeStaff.toLocaleString('en-US') }
  ];
  
  container.innerHTML = metrics.map(m => `
    <div class="subsidiary-metric">
      <span class="metric-label">${m.label}</span>
      <span class="metric-value">${m.value}</span>
    </div>
  `).join('');
}

/**
 * Update alerts section
 */
function updateAlerts() {
  const container = document.getElementById('alertsContainer');
  if (!container) return;
  
  const alerts = Aggregations.identifyAlerts(state.staff, state.payouts);
  
  if (alerts.length === 0) {
    container.innerHTML = '<div class="alert-empty">No alerts at this time. All systems nominal.</div>';
    return;
  }
  
  container.innerHTML = alerts.map(alert => {
    const iconMap = {
      warning: '⚠️',
      error: '❌',
      info: 'ℹ️'
    };
    
    return `
      <div class="alert ${alert.type}">
        <div class="alert-icon">${iconMap[alert.type]}</div>
        <div class="alert-content">
          <div class="alert-title">${alert.title}</div>
          <div class="alert-message">${alert.message}</div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Update executive summary
 */
function updateExecutiveSummary() {
  const summaryEl = document.getElementById('summaryText');
  if (!summaryEl) return;
  
  const currentOrders = timeControls.filterByRange(state.orders);
  const currentPayouts = timeControls.filterByRange(state.payouts, 'week');
  
  const summary = Aggregations.generateExecutiveSummary({
    orders: currentOrders,
    payouts: currentPayouts,
    staff: state.staff
  });
  
  summaryEl.textContent = summary;
}

/**
 * Copy executive summary to clipboard
 */
async function copySummary() {
  const summaryEl = document.getElementById('summaryText');
  if (!summaryEl) return;
  
  try {
    await navigator.clipboard.writeText(summaryEl.textContent);
    showNotification('Summary copied to clipboard', 'success');
  } catch (error) {
    console.error('Failed to copy:', error);
    showNotification('Failed to copy summary', 'error');
  }
}

/**
 * Export report
 */
function exportReport() {
  const summary = document.getElementById('summaryText')?.textContent || '';
  const dateRange = timeControls.formatRange();
  
  const report = `KANESHIRO ENTERPRISES - EXECUTIVE REPORT
Date Range: ${dateRange}
Generated: ${new Date().toLocaleString()}

${summary}
`;
  
  // Create download
  const blob = new Blob([report], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kaneshiro-executive-report-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showNotification('Report exported successfully', 'success');
}

/**
 * Show custom date modal
 */
function showCustomDateModal() {
  const modal = document.getElementById('customDateModal');
  if (!modal) return;
  
  modal.style.display = 'flex';
  
  // Set default dates
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  
  document.getElementById('customStartDate').valueAsDate = weekAgo;
  document.getElementById('customEndDate').valueAsDate = today;
  
  // Handle cancel
  document.getElementById('cancelCustomDate').onclick = () => {
    modal.style.display = 'none';
    // Revert to previous selection
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
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#D4AF37'};
    color: white;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

/**
 * Show error message
 */
function showError(message) {
  console.error(message);
  showNotification(message, 'error');
}

// Add animation keyframes
if (!document.getElementById('notification-animations')) {
  const style = document.createElement('style');
  style.id = 'notification-animations';
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
