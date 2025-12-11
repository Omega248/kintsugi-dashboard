// =======================================
// Kintsugi Filter Chips Component
// Visual filter management with quick remove
// =======================================

class FilterChipsManager {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.filters = new Map();
    this.onChange = options.onChange || (() => {});
    this.maxChips = options.maxChips || 10;
    
    if (!this.container) {
      console.warn(`Filter chips container "${containerId}" not found`);
      return;
    }
    
    this.init();
  }
  
  init() {
    this.container.className = 'filter-chips-container';
    this.render();
  }
  
  /**
   * Add a filter chip
   * @param {string} key - Filter key
   * @param {string} label - Display label
   * @param {string} value - Filter value
   */
  addChip(key, label, value) {
    if (this.filters.size >= this.maxChips) {
      console.warn('Maximum number of filter chips reached');
      return false;
    }
    
    this.filters.set(key, { label, value });
    this.render();
    this.onChange(this.getFilters());
    return true;
  }
  
  /**
   * Remove a filter chip
   * @param {string} key - Filter key to remove
   */
  removeChip(key) {
    this.filters.delete(key);
    this.render();
    this.onChange(this.getFilters());
  }
  
  /**
   * Clear all filter chips
   */
  clearAll() {
    this.filters.clear();
    this.render();
    this.onChange(this.getFilters());
  }
  
  /**
   * Get current filters as object
   * @returns {Object} Current filters
   */
  getFilters() {
    const obj = {};
    this.filters.forEach((filter, key) => {
      obj[key] = filter.value;
    });
    return obj;
  }
  
  /**
   * Set filters from object
   * @param {Object} filters - Filters to set
   */
  setFilters(filters) {
    this.filters.clear();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all') {
        // Extract label from key (e.g., "mechanic" -> "Mechanic")
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        this.filters.set(key, { label, value });
      }
    });
    this.render();
  }
  
  /**
   * Check if there are any active filters
   * @returns {boolean} True if filters exist
   */
  hasFilters() {
    return this.filters.size > 0;
  }
  
  /**
   * Render the filter chips
   */
  render() {
    if (!this.container) return;
    
    if (this.filters.size === 0) {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
      return;
    }
    
    this.container.style.display = 'flex';
    
    let html = '<span class="filter-chips-label">Active filters:</span>';
    
    this.filters.forEach((filter, key) => {
      html += `
        <div class="filter-chip" data-key="${this.escapeHtml(key)}">
          <span class="filter-chip-label">${this.escapeHtml(filter.label)}:</span>
          <span class="filter-chip-value">${this.escapeHtml(String(filter.value))}</span>
          <button class="filter-chip-close" aria-label="Remove ${this.escapeHtml(filter.label)} filter">×</button>
        </div>
      `;
    });
    
    if (this.filters.size > 1) {
      html += `
        <button class="clear-all-filters" aria-label="Clear all filters">
          Clear all
        </button>
      `;
    }
    
    this.container.innerHTML = html;
    
    // Add event listeners
    this.container.querySelectorAll('.filter-chip-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const chip = e.target.closest('.filter-chip');
        const key = chip?.dataset.key;
        if (key) this.removeChip(key);
      });
    });
    
    const clearAllBtn = this.container.querySelector('.clear-all-filters');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => this.clearAll());
    }
  }
  
  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

/**
 * Create quick filter presets for common scenarios
 * @param {Object} options - Configuration options
 * @returns {Array} Array of preset configurations
 */
function kCreateQuickFilterPresets(options = {}) {
  const today = new Date();
  const presets = [];
  
  // This Week
  const thisWeekRange = kGetDateRange('week', today);
  presets.push({
    id: 'this-week',
    label: 'This Week',
    icon: '📅',
    filters: {
      startDate: thisWeekRange.start,
      endDate: thisWeekRange.end
    }
  });
  
  // Last Week
  const lastWeekDate = new Date(today);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeekRange = kGetDateRange('week', lastWeekDate);
  presets.push({
    id: 'last-week',
    label: 'Last Week',
    icon: '📅',
    filters: {
      startDate: lastWeekRange.start,
      endDate: lastWeekRange.end
    }
  });
  
  // This Month
  const thisMonthRange = kGetDateRange('month', today);
  presets.push({
    id: 'this-month',
    label: 'This Month',
    icon: '📆',
    filters: {
      startDate: thisMonthRange.start,
      endDate: thisMonthRange.end
    }
  });
  
  // Last Month
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthRange = kGetDateRange('month', lastMonthDate);
  presets.push({
    id: 'last-month',
    label: 'Last Month',
    icon: '📆',
    filters: {
      startDate: lastMonthRange.start,
      endDate: lastMonthRange.end
    }
  });
  
  // Unpaid (if applicable)
  if (options.includePaymentStatus) {
    presets.push({
      id: 'unpaid',
      label: 'Unpaid',
      icon: '💰',
      filters: {
        paymentStatus: 'unpaid'
      }
    });
  }
  
  // Engines Only (if applicable)
  if (options.includeEngines) {
    presets.push({
      id: 'engines-only',
      label: 'Engines Only',
      icon: '⚙️',
      filters: {
        hasEngines: true
      }
    });
  }
  
  return presets;
}

/**
 * Render quick filter preset buttons
 * @param {string} containerId - Container element ID
 * @param {Array} presets - Array of preset configurations
 * @param {Function} onSelect - Callback when preset is selected
 */
function kRenderQuickFilterPresets(containerId, presets, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Quick filter preset container "${containerId}" not found`);
    return;
  }
  
  container.className = 'quick-filter-presets';
  
  let html = '<span class="filter-chips-label">Quick filters:</span>';
  
  presets.forEach(preset => {
    html += `
      <button class="filter-preset-btn btn" data-preset-id="${preset.id}">
        ${preset.icon ? `<span class="preset-icon">${preset.icon}</span>` : ''}
        <span class="preset-label">${preset.label}</span>
      </button>
    `;
  });
  
  container.innerHTML = html;
  
  // Add event listeners
  container.querySelectorAll('.filter-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetId = btn.dataset.presetId;
      const preset = presets.find(p => p.id === presetId);
      if (preset && onSelect) {
        onSelect(preset);
      }
    });
  });
}

/**
 * Create a sortable table header with indicators
 * @param {string} tableId - Table element ID
 * @param {Function} onSort - Callback when column is sorted (column, direction)
 */
function kEnableSortableTable(tableId, onSort) {
  const table = document.getElementById(tableId);
  if (!table) {
    console.warn(`Table "${tableId}" not found`);
    return;
  }
  
  const headers = table.querySelectorAll('th[data-sortable]');
  
  headers.forEach(th => {
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    th.classList.add('sortable-header');
    
    // Add sort indicator
    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';
    indicator.innerHTML = '↕';
    th.appendChild(indicator);
    
    th.addEventListener('click', () => {
      const column = th.dataset.sortable;
      const currentDirection = th.dataset.sortDirection || 'none';
      
      // Update direction
      let newDirection;
      if (currentDirection === 'none') {
        newDirection = 'asc';
      } else if (currentDirection === 'asc') {
        newDirection = 'desc';
      } else {
        newDirection = 'asc';
      }
      
      // Clear all other headers
      headers.forEach(h => {
        h.dataset.sortDirection = 'none';
        const ind = h.querySelector('.sort-indicator');
        if (ind) ind.innerHTML = '↕';
        h.classList.remove('sorted-asc', 'sorted-desc');
      });
      
      // Update this header
      th.dataset.sortDirection = newDirection;
      th.classList.add(`sorted-${newDirection}`);
      indicator.innerHTML = newDirection === 'asc' ? '↑' : '↓';
      
      // Call callback
      if (onSort) {
        onSort(column, newDirection);
      }
    });
  });
}

/**
 * Add visual loading state to table
 * @param {string} tableId - Table element ID
 * @param {boolean} loading - Loading state
 */
function kSetTableLoading(tableId, loading) {
  const table = document.getElementById(tableId);
  if (!table) return;
  
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  
  if (loading) {
    tbody.classList.add('loading');
    tbody.style.opacity = '0.5';
    tbody.style.pointerEvents = 'none';
  } else {
    tbody.classList.remove('loading');
    tbody.style.opacity = '1';
    tbody.style.pointerEvents = 'auto';
  }
}

/**
 * Highlight table rows matching search
 * @param {string} tableId - Table element ID
 * @param {string} searchTerm - Search term to highlight
 */
function kHighlightTableSearch(tableId, searchTerm) {
  const table = document.getElementById(tableId);
  if (!table) return;
  
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  
  const rows = tbody.querySelectorAll('tr');
  
  if (!searchTerm || searchTerm.trim() === '') {
    // Clear all highlights
    rows.forEach(row => {
      row.classList.remove('search-match', 'search-hidden');
    });
    return;
  }
  
  const searchLower = searchTerm.toLowerCase();
  
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    if (text.includes(searchLower)) {
      row.classList.add('search-match');
      row.classList.remove('search-hidden');
    } else {
      row.classList.remove('search-match');
      row.classList.add('search-hidden');
    }
  });
}
