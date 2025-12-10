// =======================================
// Data Formatting Utilities
// Centralized formatters for consistent data display across the application
// =======================================

/**
 * Format currency with symbol and thousands separators
 * @param {number} amount - Amount to format
 * @param {string} [symbol='$'] - Currency symbol
 * @param {number} [decimals=0] - Number of decimal places
 * @param {boolean} [showSymbol=true] - Whether to show currency symbol
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount, symbol = '$', decimals = 0, showSymbol = true) {
  const num = Number(amount || 0);
  if (!isFinite(num)) return showSymbol ? `${symbol}0` : '0';
  
  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  
  return showSymbol ? `${symbol}${formatted}` : formatted;
}

/**
 * Format number with thousands separators
 * @param {number} num - Number to format
 * @param {number} [decimals=0] - Number of decimal places
 * @returns {string} Formatted number
 */
function formatNumber(num, decimals = 0) {
  const n = Number(num || 0);
  if (!isFinite(n)) return '0';
  
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * Format date in MM/DD/YYYY format
 * @param {Date|string|number} date - Date to format
 * @param {string} [format='MM/DD/YYYY'] - Output format
 * @returns {string} Formatted date string
 */
function formatDate(date, format = 'MM/DD/YYYY') {
  if (!date) return '';
  
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  
  switch (format) {
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'DD/MM/YYYY':
      return `${dd}/${mm}/${yyyy}`;
    case 'Month DD, YYYY':
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
      return `${monthNames[d.getMonth()]} ${dd}, ${yyyy}`;
    case 'MMM DD, YYYY':
      const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${monthAbbr[d.getMonth()]} ${dd}, ${yyyy}`;
    default:
      return `${mm}/${dd}/${yyyy}`;
  }
}

/**
 * Format date and time
 * @param {Date|string|number} date - Date to format
 * @param {boolean} [includeSeconds=false] - Include seconds
 * @returns {string} Formatted date and time string
 */
function formatDateTime(date, includeSeconds = false) {
  if (!date) return '';
  
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const dateStr = formatDate(d);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  const timeStr = includeSeconds 
    ? `${hours}:${minutes}:${seconds}`
    : `${hours}:${minutes}`;
  
  return `${dateStr} ${timeStr}`;
}

/**
 * Format time duration in human-readable format
 * @param {number} milliseconds - Duration in milliseconds
 * @param {boolean} [short=false] - Use short format (1h 30m vs 1 hour 30 minutes)
 * @returns {string} Formatted duration
 */
function formatDuration(milliseconds, short = false) {
  if (!milliseconds || milliseconds < 0) return short ? '0s' : '0 seconds';
  
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  const parts = [];
  
  if (days > 0) {
    parts.push(short ? `${days}d` : `${days} day${days > 1 ? 's' : ''}`);
  }
  if (hours % 24 > 0) {
    parts.push(short ? `${hours % 24}h` : `${hours % 24} hour${hours % 24 > 1 ? 's' : ''}`);
  }
  if (minutes % 60 > 0) {
    parts.push(short ? `${minutes % 60}m` : `${minutes % 60} minute${minutes % 60 > 1 ? 's' : ''}`);
  }
  if (seconds % 60 > 0 && parts.length === 0) {
    parts.push(short ? `${seconds % 60}s` : `${seconds % 60} second${seconds % 60 > 1 ? 's' : ''}`);
  }
  
  return parts.slice(0, 2).join(' ');
}

/**
 * Format percentage with symbol
 * @param {number} value - Percentage value (0-100)
 * @param {number} [decimals=1] - Number of decimal places
 * @param {boolean} [includeSymbol=true] - Include % symbol
 * @returns {string} Formatted percentage
 */
function formatPercentage(value, decimals = 1, includeSymbol = true) {
  const num = Number(value || 0);
  if (!isFinite(num)) return includeSymbol ? '0%' : '0';
  
  const formatted = num.toFixed(decimals);
  return includeSymbol ? `${formatted}%` : formatted;
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @param {number} [decimals=2] - Number of decimal places
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  if (!bytes || bytes < 0) return 'N/A';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Format phone number
 * @param {string} phone - Phone number string
 * @param {string} [format='US'] - Format type: 'US', 'international'
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phone, format = 'US') {
  if (!phone) return '';
  
  // Remove all non-numeric characters
  const cleaned = String(phone).replace(/\D/g, '');
  
  if (format === 'US') {
    // US format: (123) 456-7890
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    } else if (cleaned.length === 11 && cleaned[0] === '1') {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
  }
  
  // Default: return cleaned number
  return cleaned;
}

/**
 * Format relative time (time ago)
 * @param {Date|string|number} date - Date to format
 * @param {boolean} [short=false] - Use short format
 * @returns {string} Relative time string
 */
function formatRelativeTime(date, short = false) {
  if (!date) return '';
  
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const now = new Date();
  const diff = now - d;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (short) {
    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (weeks < 4) return `${weeks}w ago`;
    if (months < 12) return `${months}mo ago`;
    return `${years}y ago`;
  }
  
  if (seconds < 60) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (weeks === 1) return '1 week ago';
  if (weeks < 4) return `${weeks} weeks ago`;
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  if (years === 1) return '1 year ago';
  return `${years} years ago`;
}

/**
 * Format address in multiple lines
 * @param {Object} address - Address object
 * @param {string} address.street - Street address
 * @param {string} address.city - City
 * @param {string} address.state - State
 * @param {string} address.zip - ZIP code
 * @param {string} [separator=', '] - Separator between parts
 * @returns {string} Formatted address
 */
function formatAddress(address, separator = ', ') {
  if (!address) return '';
  
  const parts = [];
  if (address.street) parts.push(address.street);
  if (address.city) parts.push(address.city);
  if (address.state) parts.push(address.state);
  if (address.zip) parts.push(address.zip);
  
  return parts.join(separator);
}

/**
 * Format name (proper case)
 * @param {string} name - Name to format
 * @param {string} [format='first last'] - Format: 'first last', 'last, first', 'initials'
 * @returns {string} Formatted name
 */
function formatName(name, format = 'first last') {
  if (!name || typeof name !== 'string') return '';
  
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '';
  
  const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  
  if (format === 'initials') {
    return parts.map(p => p.charAt(0).toUpperCase()).join('');
  }
  
  if (format === 'last, first' && parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(' ');
    return `${capitalize(last)}, ${capitalize(first)}`;
  }
  
  // Default: 'first last' - proper case all parts
  return parts.map(capitalize).join(' ');
}

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} [maxLength=50] - Maximum length
 * @param {string} [ellipsis='...'] - Ellipsis string
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength = 50, ellipsis = '...') {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;
  
  return text.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Format boolean as Yes/No or other custom labels
 * @param {boolean} value - Boolean value
 * @param {Object} [labels] - Custom labels
 * @param {string} [labels.true='Yes'] - Label for true
 * @param {string} [labels.false='No'] - Label for false
 * @returns {string} Formatted boolean
 */
function formatBoolean(value, labels = { true: 'Yes', false: 'No' }) {
  return value ? labels.true : labels.false;
}

/**
 * Format list of items with proper grammar
 * @param {Array} items - Array of items
 * @param {string} [conjunction='and'] - Conjunction word ('and', 'or')
 * @returns {string} Formatted list
 */
function formatList(items, conjunction = 'and') {
  if (!Array.isArray(items) || items.length === 0) return '';
  if (items.length === 1) return String(items[0]);
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  
  const last = items[items.length - 1];
  const rest = items.slice(0, -1);
  return `${rest.join(', ')}, ${conjunction} ${last}`;
}

/**
 * Format status with optional badge styling
 * @param {string} status - Status string
 * @param {Object} [statusMap] - Map of statuses to display values
 * @returns {string} Formatted status
 */
function formatStatus(status, statusMap = null) {
  if (!status) return '';
  
  if (statusMap && statusMap[status]) {
    return statusMap[status];
  }
  
  // Default: capitalize first letter of each word
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format week ending date (common in payouts)
 * @param {Date} date - Date to format
 * @returns {string} Formatted week ending string
 */
function formatWeekEnding(date) {
  if (!date) return '';
  return `Week ending ${formatDate(date)}`;
}

/**
 * Format month ending date (common in payouts)
 * @param {Date} date - Date to format
 * @returns {string} Formatted month ending string
 */
function formatMonthEnding(date) {
  if (!date) return '';
  return `Month ending ${formatDate(date)}`;
}

/**
 * Format count with singular/plural label
 * @param {number} count - Count value
 * @param {string} singular - Singular label
 * @param {string} [plural] - Plural label (defaults to singular + 's')
 * @returns {string} Formatted count with label
 */
function formatCount(count, singular, plural = null) {
  const num = Number(count || 0);
  const label = num === 1 ? singular : (plural || `${singular}s`);
  return `${formatNumber(num)} ${label}`;
}

/**
 * Format range (e.g., "1-10 of 100")
 * @param {number} start - Start index (1-based)
 * @param {number} end - End index
 * @param {number} total - Total count
 * @returns {string} Formatted range
 */
function formatRange(start, end, total) {
  if (!total || total === 0) return 'No items';
  if (total === 1) return '1 of 1';
  return `${formatNumber(start)}-${formatNumber(end)} of ${formatNumber(total)}`;
}

// =======================================
// Legacy Aliases (for backwards compatibility)
// =======================================

const fmtMoney = formatCurrency;
const fmtDate = formatDate;
const fmtNumber = formatNumber;
