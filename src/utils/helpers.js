// ==========================================
// Utility Helpers
// ==========================================

const Helpers = {
  /**
   * Format date to MM/DD/YYYY
   */
  formatDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      return '—';
    }
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  },

  /**
   * Format currency
   */
  formatCurrency(amount, prefix = '$') {
    const num = Number(amount || 0);
    if (!isFinite(num)) return `${prefix}0`;
    return prefix + num.toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 0 
    });
  },

  /**
   * Format number with commas
   */
  formatNumber(num) {
    return Number(num || 0).toLocaleString('en-US');
  },

  /**
   * Calculate percentage change
   */
  percentChange(current, previous) {
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  },

  /**
   * Debounce function
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * Deep clone object
   */
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  /**
   * Group array by key
   */
  groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key];
      if (!result[group]) {
        result[group] = [];
      }
      result[group].push(item);
      return result;
    }, {});
  },

  /**
   * Filter array by date range
   */
  filterByDateRange(array, dateKey, range) {
    if (range === 'all' || !range) return array;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let startDate;
    if (range === 'today') {
      startDate = today;
    } else if (range === 'week') {
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 7);
    } else if (range === 'month') {
      startDate = new Date(today);
      startDate.setMonth(today.getMonth() - 1);
    } else if (range === 'custom' && range.start) {
      startDate = new Date(range.start);
    } else {
      return array;
    }

    return array.filter(item => {
      const date = item[dateKey];
      return date && date >= startDate;
    });
  },

  /**
   * Sort array
   */
  sortBy(array, key, desc = false) {
    return array.sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      
      if (aVal === bVal) return 0;
      
      const comparison = aVal > bVal ? 1 : -1;
      return desc ? -comparison : comparison;
    });
  },

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
  },

  /**
   * Download CSV
   */
  downloadCSV(filename, data, headers) {
    const escape = val => {
      if (val == null) return '';
      const str = String(val);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const headerRow = headers.join(',');
    const dataRows = data.map(row => 
      headers.map(h => escape(row[h])).join(',')
    );

    const csv = [headerRow, ...dataRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  /**
   * Show toast notification
   */
  showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => document.body.removeChild(toast), 300);
    }, duration);
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Helpers;
}
