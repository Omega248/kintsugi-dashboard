// =======================================
// Kintsugi Filter Chips Component
// Visual filter management with quick remove
//
// Dependencies (must be loaded before this file):
// - utils.js (kGetDateRange, kGet)
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
    return kEscapeHtml(text);
  }
}
