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
 * Show custom confirm dialog
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {Function} onConfirm - Callback on confirm
 * @param {Function} [onCancel] - Optional callback on cancel
 */
function kConfirm(title, message, onConfirm, onCancel) {
  // Remove existing dialogs
  const existing = document.querySelectorAll('.k-confirm-overlay');
  existing.forEach(el => el.remove());
  
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'k-confirm-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: kFadeIn 0.2s ease;
  `;
  
  // Create dialog
  const dialog = document.createElement('div');
  dialog.className = 'k-confirm-dialog';
  dialog.style.cssText = `
    background: var(--bg-secondary, #050816);
    border: 1px solid var(--border-default, #1f2937);
    border-radius: var(--radius-lg, 18px);
    padding: var(--space-lg, 24px);
    max-width: 400px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
  `;
  
  dialog.innerHTML = `
    <h3 style="margin: 0 0 16px; color: var(--text-primary, #e5e7eb); font-size: 18px;">${title}</h3>
    <p style="margin: 0 0 24px; color: var(--text-secondary, #9ca3af); line-height: 1.6; font-size: 14px;">${message}</p>
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button class="k-confirm-cancel btn" style="min-width: 80px;">Cancel</button>
      <button class="k-confirm-ok btn btn-primary" style="min-width: 80px;">Confirm</button>
    </div>
  `;
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  const closeDialog = () => {
    overlay.style.animation = 'kFadeOut 0.2s ease';
    setTimeout(() => overlay.remove(), 200);
  };
  
  // Handle confirm
  dialog.querySelector('.k-confirm-ok').addEventListener('click', () => {
    closeDialog();
    if (onConfirm) onConfirm();
  });
  
  // Handle cancel
  dialog.querySelector('.k-confirm-cancel').addEventListener('click', () => {
    closeDialog();
    if (onCancel) onCancel();
  });
  
  // Handle ESC key
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      if (onCancel) onCancel();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
  
  // Focus the confirm button
  setTimeout(() => dialog.querySelector('.k-confirm-ok').focus(), 100);
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

/**
 * Register keyboard shortcuts
 * @param {Object} shortcuts - Map of key combinations to handlers
 * Example: { 'ctrl+s': saveHandler, 'ctrl+/': helpHandler }
 */
function kRegisterShortcuts(shortcuts) {
  if (!shortcuts || typeof shortcuts !== 'object') return;
  
  document.addEventListener('keydown', (e) => {
    const key = [];
    if (e.ctrlKey || e.metaKey) key.push('ctrl');
    if (e.altKey) key.push('alt');
    if (e.shiftKey) key.push('shift');
    key.push(e.key.toLowerCase());
    
    const combo = key.join('+');
    const handler = shortcuts[combo];
    
    if (handler) {
      e.preventDefault();
      handler(e);
    }
  });
}

/**
 * Format date range as human-readable string
 * @param {Date} start - Start date
 * @param {Date} end - End date
 * @returns {string} Formatted date range
 */
function kFormatDateRange(start, end) {
  if (!kIsValidDate(start) || !kIsValidDate(end)) return '';
  
  const formatDate = (d) => {
    return d.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
  };
  
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/**
 * Parse query string to object
 * @param {string} [search] - Query string (default: window.location.search)
 * @returns {Object} Parsed query parameters
 */
function kParseQuery(search = window.location.search) {
  const params = new URLSearchParams(search);
  const result = {};
  
  for (const [key, value] of params) {
    result[key] = value;
  }
  
  return result;
}

/**
 * Build query string from object
 * @param {Object} params - Parameters object
 * @returns {string} Query string (without leading ?)
 */
function kBuildQuery(params) {
  if (!params || typeof params !== 'object') return '';
  
  const searchParams = new URLSearchParams();
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  
  return searchParams.toString();
}

// =======================================
// Data Validation Helpers
// =======================================

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
function kValidateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

/**
 * Validate number within range
 * @param {number} value - Value to validate
 * @param {number} [min] - Minimum value
 * @param {number} [max] - Maximum value
 * @returns {boolean} True if valid
 */
function kValidateNumber(value, min, max) {
  const num = Number(value);
  if (!isFinite(num)) return false;
  if (min !== undefined && num < min) return false;
  if (max !== undefined && num > max) return false;
  return true;
}

/**
 * Escape HTML to prevent XSS (basic text escaping only)
 * Note: This only performs basic text escaping, not full HTML sanitization.
 * For displaying user input as text, not for allowing safe HTML tags.
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for HTML insertion
 */
function kEscapeHtml(text) {
  if (!text || typeof text !== 'string') return '';
  
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Legacy alias for kEscapeHtml
 * @deprecated Use kEscapeHtml instead for clarity
 */
function kSanitizeHtml(html) {
  console.warn('kSanitizeHtml is deprecated. Use kEscapeHtml for text escaping.');
  return kEscapeHtml(html);
}

/**
 * Validate required fields in an object
 * @param {Object} obj - Object to validate
 * @param {string[]} required - Array of required field names
 * @returns {Object} { valid: boolean, missing: string[] }
 */
function kValidateRequired(obj, required) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(required)) {
    return { valid: false, missing: [] };
  }
  
  const missing = required.filter(field => {
    const value = kGet(obj, field);
    return kIsEmpty(value);
  });
  
  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Validate CSV data structure
 * @param {Array} data - CSV data array
 * @param {string[]} requiredColumns - Required column names
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function kValidateCsvData(data, requiredColumns = []) {
  const errors = [];
  
  if (!Array.isArray(data)) {
    errors.push('Data must be an array');
    return { valid: false, errors };
  }
  
  if (data.length === 0) {
    errors.push('Data is empty');
    return { valid: false, errors };
  }
  
  if (requiredColumns.length > 0 && data.length > 0) {
    const firstRow = data[0];
    const columns = typeof firstRow === 'object' ? Object.keys(firstRow) : [];
    
    const missing = requiredColumns.filter(col => !columns.includes(col));
    if (missing.length > 0) {
      errors.push(`Missing required columns: ${missing.join(', ')}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// =======================================
// Local Storage Helpers
// =======================================

/**
 * Save data to localStorage with error handling
 * @param {string} key - Storage key
 * @param {*} value - Value to store (will be JSON stringified)
 * @returns {boolean} Success status
 */
function kStorageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
    return false;
  }
}

/**
 * Get data from localStorage with error handling
 * @param {string} key - Storage key
 * @param {*} [defaultValue] - Default value if key not found
 * @returns {*} Stored value or default
 */
function kStorageGet(key, defaultValue = null) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error('Failed to read from localStorage:', error);
    return defaultValue;
  }
}

/**
 * Remove item from localStorage
 * @param {string} key - Storage key
 * @returns {boolean} Success status
 */
function kStorageRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error('Failed to remove from localStorage:', error);
    return false;
  }
}

/**
 * Clear all localStorage items with optional prefix filter
 * @param {string} [prefix] - Only clear keys starting with this prefix
 * @returns {boolean} Success status
 */
function kStorageClear(prefix) {
  try {
    if (prefix) {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(prefix)) {
          localStorage.removeItem(key);
        }
      });
    } else {
      localStorage.clear();
    }
    return true;
  } catch (error) {
    console.error('Failed to clear localStorage:', error);
    return false;
  }
}
