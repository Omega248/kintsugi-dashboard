// =======================================
// Kintsugi Payout Helpers
// Specialized utilities for payout summary generation and audit
// 
// Dependencies (must be loaded before this file):
// - utils.js (kGet, kStorageSet, kStorageGet, kIsValidDate, kSortBy)
// - constants.js (PAYMENT_RATES)
// =======================================

/**
 * Generate a formatted payout summary for copy-paste
 * @param {Object} mechanic - Mechanic data object
 * @param {string} mechanic.name - Mechanic name
 * @param {string} mechanic.stateId - State ID
 * @param {number} mechanic.totalRepairs - Total repairs count
 * @param {number} mechanic.engineReplacements - Engine replacements count
 * @param {number} mechanic.totalPayout - Total payout amount
 * @param {Object} options - Additional options
 * @param {Date} [options.startDate] - Period start date
 * @param {Date} [options.endDate] - Period end date
 * @param {number} [options.weekNumber] - Week number
 * @param {string} [options.notes] - Additional notes
 * @returns {string} Formatted payout summary
 */
function kGeneratePayoutSummary(mechanic, options = {}) {
  const {
    startDate,
    endDate,
    weekNumber,
    notes = ''
  } = options;

  let summary = '';
  
  // Header
  summary += '═══════════════════════════════════════\n';
  summary += '  KINTSUGI MOTORWORKS - PAYOUT SUMMARY\n';
  summary += '═══════════════════════════════════════\n\n';
  
  // Mechanic Info
  summary += `Mechanic: ${mechanic.name}\n`;
  if (mechanic.stateId) {
    summary += `State ID: ${mechanic.stateId}\n`;
  }
  summary += '\n';
  
  // Period Info
  if (startDate && endDate) {
    summary += `Period: ${kFormatDate(startDate)} - ${kFormatDate(endDate)}\n`;
  }
  if (weekNumber) {
    summary += `Week #: ${weekNumber}\n`;
  }
  if (startDate || endDate || weekNumber) {
    summary += '\n';
  }
  
  // Repair Details
  summary += '───────────────────────────────────────\n';
  summary += 'REPAIRS\n';
  summary += '───────────────────────────────────────\n';
  summary += `Total Repairs: ${mechanic.totalRepairs}\n`;
  
  if (mechanic.engineReplacements > 0) {
    summary += `Engine Replacements: ${mechanic.engineReplacements}\n`;
    const engineReimbursement = mechanic.engineReplacements * (PAYMENT_RATES?.ENGINE_REIMBURSEMENT || 12000);
    summary += `Engine Reimbursement: ${kFormatCurrency(engineReimbursement)}\n`;
  }
  summary += '\n';
  
  // Payout Details
  summary += '───────────────────────────────────────\n';
  summary += 'PAYOUT\n';
  summary += '───────────────────────────────────────\n';
  summary += `Total Payout: ${kFormatCurrency(mechanic.totalPayout)}\n`;
  summary += '\n';
  
  // Notes
  if (notes) {
    summary += '───────────────────────────────────────\n';
    summary += 'NOTES\n';
    summary += '───────────────────────────────────────\n';
    summary += `${notes}\n`;
    summary += '\n';
  }
  
  // Footer
  summary += '═══════════════════════════════════════\n';
  summary += `Generated: ${kFormatDateTime(new Date())}\n`;
  
  return summary;
}

/**
 * Generate a compact payout summary for bank transaction comments
 * @param {Object} mechanic - Mechanic data
 * @returns {string} Compact summary for bank comment
 */
function kGeneratePayoutBankComment(mechanic, options = {}) {
  const { weekNumber, startDate, endDate } = options;
  
  let comment = `Kintsugi MW - ${mechanic.name}`;
  
  if (mechanic.stateId) {
    comment += ` (ID: ${mechanic.stateId})`;
  }
  
  if (weekNumber) {
    comment += ` - Wk${weekNumber}`;
  } else if (startDate && endDate) {
    comment += ` - ${kFormatDate(startDate, 'short')} to ${kFormatDate(endDate, 'short')}`;
  }
  
  comment += ` - ${mechanic.totalRepairs} repairs`;
  
  if (mechanic.engineReplacements > 0) {
    comment += `, ${mechanic.engineReplacements} engines`;
  }
  
  comment += ` - ${kFormatCurrency(mechanic.totalPayout)}`;
  
  return comment;
}

/**
 * Copy text to clipboard with fallback
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
async function kCopyToClipboard(text) {
  try {
    // Modern API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    return success;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Format date for display
 * @param {Date|string} date - Date to format
 * @param {string} [format='default'] - Format type: 'default', 'short', 'long'
 * @returns {string} Formatted date
 */
function kFormatDate(date, format = 'default') {
  if (!date) return '';
  
  const d = date instanceof Date ? date : new Date(date);
  if (!kIsValidDate(d)) return '';
  
  switch (format) {
    case 'short':
      return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    case 'long':
      return d.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    default:
      return d.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'numeric', 
        day: 'numeric' 
      });
  }
}

/**
 * Format date and time for display
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date and time
 */
function kFormatDateTime(date) {
  if (!date) return '';
  
  const d = date instanceof Date ? date : new Date(date);
  if (!kIsValidDate(d)) return '';
  
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format currency with locale support
 * @param {number} amount - Amount to format
 * @param {string} [currency='USD'] - Currency code
 * @returns {string} Formatted currency
 */
function kFormatCurrency(amount, currency = 'USD') {
  if (typeof amount !== 'number' || !isFinite(amount)) {
    return '$0';
  }
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

/**
 * Perform audit on payout data
 * @param {Array} mechanics - Array of mechanic payout data
 * @param {Array} bankRecords - Array of bank transaction records
 * @returns {Object} Audit results
 */
function kAuditPayouts(mechanics, bankRecords = []) {
  const audit = {
    totalExpected: 0,
    totalPaid: 0,
    discrepancy: 0,
    missingPayouts: [],
    duplicates: [],
    anomalies: [],
    mechanicsWithIssues: []
  };
  
  // Calculate total expected
  mechanics.forEach(mech => {
    audit.totalExpected += mech.totalPayout || 0;
    
    // Check for anomalies
    if ((mech.totalRepairs === 0 || !mech.totalRepairs) && (mech.totalPayout > 0)) {
      audit.anomalies.push({
        mechanic: mech.name,
        issue: 'Zero repairs but expecting payout',
        repairs: mech.totalRepairs,
        payout: mech.totalPayout
      });
    }
    
    if (!mech.stateId || mech.stateId.trim() === '') {
      audit.anomalies.push({
        mechanic: mech.name,
        issue: 'Missing State ID',
        repairs: mech.totalRepairs,
        payout: mech.totalPayout
      });
    }
  });
  
  // Analyze bank records if provided
  if (bankRecords && bankRecords.length > 0) {
    const payoutTransactions = bankRecords.filter(record => 
      record.direction === 'out' && 
      (record.comment?.toLowerCase().includes('kintsugi') || 
       record.comment?.toLowerCase().includes('mechanic'))
    );
    
    payoutTransactions.forEach(tx => {
      audit.totalPaid += Math.abs(tx.amount || 0);
    });
    
    // Check for duplicates
    const txMap = new Map();
    payoutTransactions.forEach(tx => {
      const key = `${tx.amount}_${tx.timestamp}_${tx.comment}`;
      if (txMap.has(key)) {
        audit.duplicates.push({
          amount: tx.amount,
          timestamp: tx.timestamp,
          comment: tx.comment,
          count: txMap.get(key) + 1
        });
        txMap.set(key, txMap.get(key) + 1);
      } else {
        txMap.set(key, 1);
      }
    });
  }
  
  audit.discrepancy = audit.totalExpected - audit.totalPaid;
  
  return audit;
}

/**
 * Find mechanics with missing payouts
 * @param {Array} mechanics - Array of mechanic data
 * @param {Array} bankRecords - Array of bank transaction records
 * @returns {Array} Mechanics with missing payouts
 */
function kFindMissingPayouts(mechanics, bankRecords) {
  const paid = new Set();
  
  // Extract mechanic names from bank records
  bankRecords.forEach(record => {
    if (record.direction === 'out' && record.comment) {
      const comment = record.comment.toLowerCase();
      mechanics.forEach(mech => {
        if (comment.includes(mech.name.toLowerCase())) {
          paid.add(mech.name);
        }
      });
    }
  });
  
  // Find mechanics who weren't paid
  return mechanics.filter(mech => 
    mech.totalPayout > 0 && !paid.has(mech.name)
  );
}

/**
 * Generate week number for a date
 * @param {Date} date - Date to get week number for
 * @returns {number} Week number (1-52/53)
 */
function kGetWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Validate mechanic payout data
 * @param {Object} mechanic - Mechanic data to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function kValidateMechanicPayout(mechanic) {
  const errors = [];
  
  if (!mechanic.name || mechanic.name.trim() === '') {
    errors.push('Mechanic name is required');
  }
  
  if (!mechanic.stateId || mechanic.stateId.trim() === '') {
    errors.push('State ID is missing');
  }
  
  if (typeof mechanic.totalRepairs !== 'number' || mechanic.totalRepairs < 0) {
    errors.push('Invalid total repairs count');
  }
  
  if (typeof mechanic.totalPayout !== 'number' || mechanic.totalPayout < 0) {
    errors.push('Invalid total payout amount');
  }
  
  if (mechanic.totalRepairs === 0 && mechanic.totalPayout > 0) {
    errors.push('Payout without repairs');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create a filter preset for quick access
 * @param {string} name - Preset name
 * @param {Object} filters - Filter configuration
 * @returns {Object} Filter preset
 */
function kCreateFilterPreset(name, filters) {
  return {
    name,
    filters,
    timestamp: Date.now()
  };
}

/**
 * Get filter presets from storage
 * @returns {Array} Array of filter presets
 */
function kGetFilterPresets() {
  return kStorageGet('kintsugi_filter_presets', []);
}

/**
 * Save filter preset to storage
 * @param {Object} preset - Filter preset to save
 * @returns {boolean} Success status
 */
function kSaveFilterPreset(preset) {
  const presets = kGetFilterPresets();
  
  // Check if preset with same name exists
  const existingIndex = presets.findIndex(p => p.name === preset.name);
  if (existingIndex >= 0) {
    presets[existingIndex] = preset;
  } else {
    presets.push(preset);
  }
  
  return kStorageSet('kintsugi_filter_presets', presets);
}

/**
 * Delete filter preset
 * @param {string} name - Preset name to delete
 * @returns {boolean} Success status
 */
function kDeleteFilterPreset(name) {
  const presets = kGetFilterPresets();
  const filtered = presets.filter(p => p.name !== name);
  return kStorageSet('kintsugi_filter_presets', filtered);
}

/**
 * Fuzzy search in text
 * @param {string} text - Text to search in
 * @param {string} query - Search query
 * @returns {boolean} True if query matches
 */
function kFuzzyMatch(text, query) {
  if (!text || !query) return false;
  
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  
  // Exact match
  if (textLower.includes(queryLower)) return true;
  
  // Fuzzy match - all query characters appear in order
  let textIndex = 0;
  for (let i = 0; i < queryLower.length; i++) {
    textIndex = textLower.indexOf(queryLower[i], textIndex);
    if (textIndex === -1) return false;
    textIndex++;
  }
  
  return true;
}

/**
 * Multi-field search
 * @param {Object} item - Item to search in
 * @param {string} query - Search query
 * @param {string[]} fields - Fields to search in
 * @returns {boolean} True if query matches any field
 */
function kMultiFieldSearch(item, query, fields) {
  if (!query || !query.trim()) return true;
  
  return fields.some(field => {
    const value = kGet(item, field, '');
    return kFuzzyMatch(String(value), query);
  });
}

/**
 * Sort table data by column
 * @param {Array} data - Data to sort
 * @param {string} column - Column to sort by
 * @param {string} direction - Sort direction: 'asc' or 'desc'
 * @returns {Array} Sorted data (new array)
 */
function kSortTable(data, column, direction = 'asc') {
  return kSortBy(data, column, direction);
}

/**
 * Filter table data by multiple criteria
 * @param {Array} data - Data to filter
 * @param {Object} filters - Filter criteria
 * @returns {Array} Filtered data
 */
function kFilterTable(data, filters) {
  if (!filters || Object.keys(filters).length === 0) return data;
  
  return data.filter(item => {
    return Object.entries(filters).every(([key, value]) => {
      if (value === null || value === undefined || value === '' || value === 'all') {
        return true;
      }
      
      const itemValue = kGet(item, key);
      
      if (Array.isArray(value)) {
        return value.includes(itemValue);
      }
      
      return itemValue === value;
    });
  });
}
