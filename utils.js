// =======================================
// Kintsugi Utilities
// Additional helper functions for common operations
// =======================================

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function kDebounce(func, wait = 300) {
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

/**
 * Throttle function execution
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
function kThrottle(func, limit = 300) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Deep clone an object
 * @param {*} obj - Object to clone
 * @returns {*} Cloned object
 */
function kDeepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => kDeepClone(item));
  if (obj instanceof Object) {
    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = kDeepClone(obj[key]);
      }
    }
    return cloned;
  }
}

/**
 * Check if value is empty (null, undefined, empty string, empty array, empty object)
 * @param {*} value - Value to check
 * @returns {boolean} True if empty
 */
function kIsEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Safely get nested property from object
 * @param {Object} obj - Object to traverse
 * @param {string} path - Dot-separated path (e.g., "user.address.city")
 * @param {*} defaultValue - Default value if path not found
 * @returns {*} Value at path or default value
 */
function kGet(obj, path, defaultValue = undefined) {
  const keys = path.split('.');
  let result = obj;
  
  for (const key of keys) {
    if (result === null || result === undefined) {
      return defaultValue;
    }
    result = result[key];
  }
  
  return result === undefined ? defaultValue : result;
}

/**
 * Group array of objects by key
 * @param {Array} array - Array to group
 * @param {string|Function} key - Key to group by (property name or function)
 * @returns {Object} Grouped object
 */
function kGroupBy(array, key) {
  if (!Array.isArray(array)) return {};
  
  return array.reduce((result, item) => {
    const groupKey = typeof key === 'function' ? key(item) : item[key];
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
    return result;
  }, {});
}

/**
 * Sum array of numbers or object properties
 * @param {Array} array - Array to sum
 * @param {string} [key] - Optional key for array of objects
 * @returns {number} Sum
 */
function kSum(array, key) {
  if (!Array.isArray(array)) return 0;
  
  return array.reduce((sum, item) => {
    const value = key ? kGet(item, key, 0) : item;
    const num = Number(value);
    return sum + (isNaN(num) ? 0 : num);
  }, 0);
}

/**
 * Calculate average of array of numbers or object properties
 * @param {Array} array - Array to average
 * @param {string} [key] - Optional key for array of objects
 * @returns {number} Average
 */
function kAverage(array, key) {
  if (!Array.isArray(array) || array.length === 0) return 0;
  return kSum(array, key) / array.length;
}

/**
 * Remove duplicates from array
 * @param {Array} array - Array to deduplicate
 * @param {string|Function} [key] - Optional key for objects
 * @returns {Array} Deduplicated array
 */
function kUnique(array, key) {
  if (!Array.isArray(array)) return [];
  
  if (!key) {
    return [...new Set(array)];
  }
  
  const seen = new Set();
  return array.filter(item => {
    const k = typeof key === 'function' ? key(item) : item[key];
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}

/**
 * Sort array by property
 * @param {Array} array - Array to sort
 * @param {string|Function} key - Key or function to sort by
 * @param {string} [order='asc'] - Sort order: 'asc' or 'desc'
 * @returns {Array} Sorted array (new array)
 */
function kSortBy(array, key, order = 'asc') {
  if (!Array.isArray(array)) return [];
  
  const sorted = [...array].sort((a, b) => {
    const aVal = typeof key === 'function' ? key(a) : kGet(a, key);
    const bVal = typeof key === 'function' ? key(b) : kGet(b, key);
    
    if (aVal === bVal) return 0;
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return order === 'asc' 
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }
    
    return order === 'asc' 
      ? (aVal > bVal ? 1 : -1)
      : (aVal < bVal ? 1 : -1);
  });
  
  return sorted;
}

/**
 * Format number with thousands separators
 * @param {number} num - Number to format
 * @param {number} [decimals=0] - Number of decimal places
 * @returns {string} Formatted number
 */
function kFormatNumber(num, decimals = 0) {
  const n = Number(num);
  if (!isFinite(n)) return '0';
  
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * Format percentage
 * @param {number} value - Value to format as percentage
 * @param {number} [decimals=1] - Number of decimal places
 * @returns {string} Formatted percentage
 */
function kFormatPercent(value, decimals = 1) {
  const n = Number(value);
  if (!isFinite(n)) return '0%';
  
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }) + '%';
}

/**
 * Truncate string with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
function kTruncate(str, maxLength = 50) {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Capitalize first letter of string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function kCapitalize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Convert string to title case
 * @param {string} str - String to convert
 * @returns {string} Title case string
 */
function kTitleCase(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .split(' ')
    .map(word => kCapitalize(word))
    .join(' ');
}

/**
 * Generate a simple hash from string
 * @param {string} str - String to hash
 * @returns {string} Hash string
 */
function kSimpleHash(str) {
  let hash = 0;
  if (!str || str.length === 0) return hash.toString();
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(36);
}

/**
 * Check if date is valid
 * @param {Date} date - Date to check
 * @returns {boolean} True if valid date
 */
function kIsValidDate(date) {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Get date range (start and end of period)
 * @param {string} period - Period type: 'day', 'week', 'month', 'year'
 * @param {Date} [date] - Reference date (default: today)
 * @returns {Object} Object with start and end dates
 */
function kGetDateRange(period, date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  
  let start, end;
  
  switch (period) {
    case 'day':
      start = new Date(d);
      end = new Date(d);
      end.setHours(23, 59, 59, 999);
      break;
      
    case 'week':
      const day = (d.getDay() + 6) % 7; // Monday = 0
      start = new Date(d);
      start.setDate(d.getDate() - day);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
      
    case 'month':
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      break;
      
    case 'year':
      start = new Date(d.getFullYear(), 0, 1);
      end = new Date(d.getFullYear(), 11, 31);
      end.setHours(23, 59, 59, 999);
      break;
      
    default:
      start = new Date(d);
      end = new Date(d);
      end.setHours(23, 59, 59, 999);
  }
  
  return { start, end };
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} [type='info'] - Toast type: 'info', 'success', 'warning', 'error'
 * @param {number} [duration=3000] - Duration in milliseconds
 */
function kShowToast(message, type = 'info', duration = 3000) {
  // Remove existing toasts
  const existing = document.querySelectorAll('.k-toast');
  existing.forEach(toast => toast.remove());
  
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `k-toast k-toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');
  
  // Style the toast
  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '12px 20px',
    borderRadius: 'var(--radius-md, 8px)',
    backgroundColor: type === 'error' ? 'var(--color-error, #ef4444)' :
                     type === 'success' ? 'var(--color-success, #22c55e)' :
                     type === 'warning' ? 'var(--color-warning, #facc15)' :
                     'var(--accent-primary, #4f46e5)',
    color: 'white',
    fontSize: '14px',
    fontWeight: '500',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
    zIndex: '10000',
    animation: 'kToastSlideIn 0.3s ease',
    maxWidth: '400px'
  });
  
  // Add animation
  if (!document.querySelector('#k-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'k-toast-styles';
    style.textContent = `
      @keyframes kToastSlideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes kToastSlideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(toast);
  
  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      toast.style.animation = 'kToastSlideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}

/**
 * Safely execute async function with error handling
 * @param {Function} fn - Async function to execute
 * @param {*} [defaultValue] - Default value on error
 * @returns {Promise<*>} Result or default value
 */
async function kSafeAsync(fn, defaultValue = null) {
  try {
    return await fn();
  } catch (error) {
    console.error('Async operation failed:', error);
    return defaultValue;
  }
}

/**
 * Retry async operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} [maxRetries=3] - Maximum number of retries
 * @param {number} [delay=1000] - Initial delay in milliseconds
 * @returns {Promise<*>} Result
 */
async function kRetryAsync(fn, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  
  throw lastError;
}
