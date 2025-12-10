/* =============================================
   Kintsugi Dashboard - UI Enhancements
   Toast notifications, filter chips, and other UI improvements
   ============================================= */

// ===== Toast Notification System =====

class ToastManager {
  constructor() {
    this.container = null;
    this.toasts = [];
    this.init();
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.createContainer());
    } else {
      this.createContainer();
    }
  }

  createContainer() {
    // Create toast container if it doesn't exist
    if (!document.querySelector('.toast-container')) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    } else {
      this.container = document.querySelector('.toast-container');
    }
  }

  show(options) {
    const {
      type = 'info',
      title = '',
      message = '',
      duration = 5000,
      dismissible = true
    } = options;

    // Ensure container exists
    if (!this.container) {
      this.createContainer();
    }

    if (!this.container) {
      console.warn('Toast container not available');
      return null;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${this.escapeHtml(title)}</div>` : ''}
        ${message ? `<div class="toast-message">${this.escapeHtml(message)}</div>` : ''}
      </div>
      ${dismissible ? '<button class="toast-close">×</button>' : ''}
      ${duration > 0 ? `<div class="toast-progress" style="--toast-duration: ${duration}ms"></div>` : ''}
    `;

    this.container.appendChild(toast);
    this.toasts.push(toast);

    // Add close button handler
    if (dismissible) {
      const closeBtn = toast.querySelector('.toast-close');
      closeBtn?.addEventListener('click', () => this.dismiss(toast));
    }

    // Auto dismiss
    if (duration > 0) {
      setTimeout(() => this.dismiss(toast), duration);
    }

    return toast;
  }

  dismiss(toast) {
    toast.classList.add('toast-exit');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
      const index = this.toasts.indexOf(toast);
      if (index > -1) {
        this.toasts.splice(index, 1);
      }
    }, 300);
  }

  success(title, message, duration) {
    return this.show({ type: 'success', title, message, duration });
  }

  error(title, message, duration) {
    return this.show({ type: 'error', title, message, duration });
  }

  warning(title, message, duration) {
    return this.show({ type: 'warning', title, message, duration });
  }

  info(title, message, duration) {
    return this.show({ type: 'info', title, message, duration });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Create global toast instance
const toast = new ToastManager();

// ===== Filter Chips System =====

class FilterChipsManager {
  constructor(containerId) {
    this.containerId = containerId;
    this.container = null;
    this.filters = {};
    this.callbacks = {};
  }

  init() {
    // Create filter chips container if it doesn't exist
    const targetContainer = document.getElementById(this.containerId);
    if (!targetContainer) return;

    if (!targetContainer.querySelector('.filter-chips-container')) {
      this.container = document.createElement('div');
      this.container.className = 'filter-chips-container';
      targetContainer.appendChild(this.container);
    } else {
      this.container = targetContainer.querySelector('.filter-chips-container');
    }
  }

  setFilter(key, label, value) {
    this.filters[key] = { label, value };
    this.render();
  }

  removeFilter(key) {
    delete this.filters[key];
    this.render();
    if (this.callbacks.onRemove) {
      this.callbacks.onRemove(key);
    }
  }

  clearAll() {
    this.filters = {};
    this.render();
    if (this.callbacks.onClearAll) {
      this.callbacks.onClearAll();
    }
  }

  onRemove(callback) {
    this.callbacks.onRemove = callback;
  }

  onClearAll(callback) {
    this.callbacks.onClearAll = callback;
  }

  render() {
    if (!this.container) return;

    const filterKeys = Object.keys(this.filters);
    
    if (filterKeys.length === 0) {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'flex';
    
    let html = '<span class="filter-chips-label">Active filters:</span>';
    
    filterKeys.forEach(key => {
      const filter = this.filters[key];
      html += `
        <div class="filter-chip" data-key="${key}">
          <span class="filter-chip-label">${this.escapeHtml(filter.label)}:</span>
          <span class="filter-chip-value">${this.escapeHtml(filter.value)}</span>
          <button class="filter-chip-close" aria-label="Remove ${filter.label} filter">×</button>
        </div>
      `;
    });

    if (filterKeys.length > 1) {
      html += '<button class="clear-all-filters">Clear all</button>';
    }

    this.container.innerHTML = html;

    // Add event listeners
    this.container.querySelectorAll('.filter-chip-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const chip = e.target.closest('.filter-chip');
        const key = chip.getAttribute('data-key');
        this.removeFilter(key);
      });
    });

    const clearAllBtn = this.container.querySelector('.clear-all-filters');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => this.clearAll());
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ===== Trend Indicator Helper =====

function createTrendIndicator(value, previousValue) {
  if (!previousValue || value === previousValue) {
    return '<span class="trend-indicator trend-neutral"><span class="trend-icon">–</span> 0%</span>';
  }

  const change = value - previousValue;
  const percentChange = ((change / previousValue) * 100).toFixed(1);
  const isPositive = change > 0;

  return `
    <span class="trend-indicator ${isPositive ? 'trend-up' : 'trend-down'}">
      <span class="trend-icon">${isPositive ? '▲' : '▼'}</span>
      ${Math.abs(percentChange)}%
    </span>
  `;
}

// ===== Progress Bar Helper =====

function createProgressBar(value, max, label = '') {
  const percentage = Math.min((value / max) * 100, 100).toFixed(0);
  
  return `
    <div class="progress-container">
      ${label ? `
        <div class="progress-label">
          <span>${label}</span>
          <span class="progress-percentage">${percentage}%</span>
        </div>
      ` : ''}
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${percentage}%"></div>
      </div>
    </div>
  `;
}

// ===== Badge Helper =====

function createBadge(text, type = 'info') {
  return `<span class="badge badge-${type}">${text}</span>`;
}

// ===== Loading State Enhancements =====

function showEnhancedLoader(container, message = 'Loading...') {
  const loader = document.createElement('div');
  loader.className = 'k-loader';
  loader.innerHTML = `
    <div class="k-loader-spinner"></div>
    <div class="k-loader-text">${message}</div>
  `;
  
  if (typeof container === 'string') {
    container = document.querySelector(container);
  }
  
  if (container) {
    container.style.position = 'relative';
    container.appendChild(loader);
  }
  
  return loader;
}

function hideEnhancedLoader(loader) {
  if (loader && loader.parentNode) {
    loader.parentNode.removeChild(loader);
  }
}

// ===== Enhanced Error Display =====

function showEnhancedError(container, message, options = {}) {
  const {
    icon = '⚠',
    retryCallback = null,
    retryText = 'Retry'
  } = options;

  const errorDiv = document.createElement('div');
  errorDiv.className = 'k-error';
  errorDiv.innerHTML = `
    <div class="k-error-icon">${icon}</div>
    <div class="k-error-message">${message}</div>
    ${retryCallback ? `<button class="btn btn-primary k-error-retry">${retryText}</button>` : ''}
  `;

  if (typeof container === 'string') {
    container = document.querySelector(container);
  }

  if (container) {
    container.style.position = 'relative';
    container.appendChild(errorDiv);

    if (retryCallback) {
      const retryBtn = errorDiv.querySelector('.k-error-retry');
      retryBtn?.addEventListener('click', retryCallback);
    }
  }

  return errorDiv;
}

// ===== Smooth Scroll Helper =====

function smoothScrollTo(element, offset = 0) {
  if (typeof element === 'string') {
    element = document.querySelector(element);
  }

  if (element) {
    const top = element.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({
      top,
      behavior: 'smooth'
    });
  }
}

// ===== Number Animation =====

function animateNumber(element, start, end, duration = 1000) {
  if (typeof element === 'string') {
    element = document.querySelector(element);
  }

  if (!element) return;

  const range = end - start;
  const increment = range / (duration / 16);
  let current = start;

  const timer = setInterval(() => {
    current += increment;
    if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
      current = end;
      clearInterval(timer);
    }
    
    // Format number with commas
    const formatted = Math.round(current).toLocaleString();
    element.textContent = formatted;
  }, 16);
}

// ===== Copy to Clipboard Helper =====

async function copyToClipboard(text, showToast = true) {
  try {
    await navigator.clipboard.writeText(text);
    if (showToast) {
      toast.success('Copied!', 'Text copied to clipboard', 2000);
    }
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    if (showToast) {
      toast.error('Copy Failed', 'Could not copy to clipboard', 3000);
    }
    return false;
  }
}

// ===== Debounce Helper (if not in utils.js) =====

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ===== Accessibility Helpers =====

function toggleHighContrast(enabled) {
  if (enabled) {
    document.body.classList.add('high-contrast');
    localStorage.setItem('high-contrast', 'true');
  } else {
    document.body.classList.remove('high-contrast');
    localStorage.removeItem('high-contrast');
  }
}

function toggleLargeText(enabled) {
  if (enabled) {
    document.body.classList.add('large-text');
    localStorage.setItem('large-text', 'true');
  } else {
    document.body.classList.remove('large-text');
    localStorage.removeItem('large-text');
  }
}

function toggleCompactMode(enabled) {
  if (enabled) {
    document.body.classList.add('compact-mode');
    localStorage.setItem('compact-mode', 'true');
  } else {
    document.body.classList.remove('compact-mode');
    localStorage.removeItem('compact-mode');
  }
}

// Initialize accessibility preferences on load
function initAccessibility() {
  if (localStorage.getItem('high-contrast') === 'true') {
    document.body.classList.add('high-contrast');
  }
  if (localStorage.getItem('large-text') === 'true') {
    document.body.classList.add('large-text');
  }
  if (localStorage.getItem('compact-mode') === 'true') {
    document.body.classList.add('compact-mode');
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAccessibility);
} else {
  initAccessibility();
}

// ===== Pagination Helper =====

class PaginationManager {
  constructor(options = {}) {
    this.currentPage = 1;
    this.itemsPerPage = options.itemsPerPage || 50;
    this.totalItems = 0;
    this.containerId = options.containerId;
    this.onPageChange = options.onPageChange || (() => {});
  }

  setTotalItems(total) {
    this.totalItems = total;
    this.render();
  }

  setPage(page) {
    const totalPages = Math.ceil(this.totalItems / this.itemsPerPage);
    if (page < 1 || page > totalPages) return;
    
    this.currentPage = page;
    this.render();
    this.onPageChange(page);
  }

  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const totalPages = Math.ceil(this.totalItems / this.itemsPerPage);
    const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
    const endItem = Math.min(this.currentPage * this.itemsPerPage, this.totalItems);

    let html = '<div class="pagination">';
    
    // Previous button
    html += `<button class="pagination-button" ${this.currentPage === 1 ? 'disabled' : ''} onclick="pagination.setPage(${this.currentPage - 1})">‹</button>`;
    
    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      html += `<button class="pagination-button" onclick="pagination.setPage(1)">1</button>`;
      if (startPage > 2) {
        html += '<span class="pagination-info">...</span>';
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="pagination-button ${i === this.currentPage ? 'active' : ''}" onclick="pagination.setPage(${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        html += '<span class="pagination-info">...</span>';
      }
      html += `<button class="pagination-button" onclick="pagination.setPage(${totalPages})">${totalPages}</button>`;
    }
    
    // Next button
    html += `<button class="pagination-button" ${this.currentPage === totalPages ? 'disabled' : ''} onclick="pagination.setPage(${this.currentPage + 1})">›</button>`;
    
    // Info
    html += `<span class="pagination-info">${startItem}-${endItem} of ${this.totalItems}</span>`;
    
    html += '</div>';
    
    container.innerHTML = html;
  }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.toast = toast;
  window.FilterChipsManager = FilterChipsManager;
  window.PaginationManager = PaginationManager;
  window.createTrendIndicator = createTrendIndicator;
  window.createProgressBar = createProgressBar;
  window.createBadge = createBadge;
  window.showEnhancedLoader = showEnhancedLoader;
  window.hideEnhancedLoader = hideEnhancedLoader;
  window.showEnhancedError = showEnhancedError;
  window.smoothScrollTo = smoothScrollTo;
  window.animateNumber = animateNumber;
  window.copyToClipboard = copyToClipboard;
  window.toggleHighContrast = toggleHighContrast;
  window.toggleLargeText = toggleLargeText;
  window.toggleCompactMode = toggleCompactMode;
}
