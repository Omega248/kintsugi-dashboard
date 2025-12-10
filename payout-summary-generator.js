// =======================================
// Payout Summary Generator
// Generates copy-and-paste-ready payout summaries for bank transaction comments
// =======================================

/**
 * Generate a formatted payout summary for a mechanic
 * @param {Object} mechanicData - Mechanic payout data
 * @param {string} mechanicData.mechanic - Mechanic name
 * @param {string} mechanicData.stateId - State ID
 * @param {number} mechanicData.totalAmount - Total payout amount
 * @param {number} mechanicData.repairs - Number of repairs completed
 * @param {number} mechanicData.repairPay - Pay from repairs
 * @param {Object} mechanicData.engines - Engine replacement details
 * @param {number} mechanicData.engines.count - Total engine replacements
 * @param {Object} mechanicData.engines.byDept - Engine replacements by department
 * @param {number} mechanicData.engines.reimbursement - Total reimbursement
 * @param {number} mechanicData.engines.bonus - Total bonus
 * @param {Date} mechanicData.weekEnd - Week ending date
 * @param {string} [format='bank'] - Output format: 'bank', 'detailed', 'compact'
 * @returns {string} Formatted payout summary
 */
function generatePayoutSummary(mechanicData, format = 'bank') {
  const {
    mechanic,
    stateId,
    totalAmount,
    repairs,
    repairPay,
    engines,
    weekEnd
  } = mechanicData;

  // Format date for display
  const weekEndStr = weekEnd ? kFmtDate(weekEnd) : 'N/A';

  // Different formats for different use cases
  switch (format) {
    case 'bank':
      return generateBankCommentFormat(mechanicData);
    
    case 'detailed':
      return generateDetailedFormat(mechanicData);
    
    case 'compact':
      return generateCompactFormat(mechanicData);
    
    default:
      return generateBankCommentFormat(mechanicData);
  }
}

/**
 * Generate bank comment format (optimized for bank transaction field)
 * Single line, concise, all key info
 */
function generateBankCommentFormat(data) {
  const { mechanic, stateId, totalAmount, repairs, engines, weekEnd } = data;
  const weekEndStr = weekEnd ? kFmtDate(weekEnd) : '';
  
  let summary = `Payout: ${mechanic}`;
  
  // Add State ID if available
  if (stateId) {
    summary += ` (ID: ${stateId})`;
  }
  
  // Week ending
  summary += ` | Week: ${weekEndStr}`;
  
  // Repairs
  summary += ` | Repairs: ${repairs} × $700 = ${kFmtMoney(repairs * 700)}`;
  
  // Engines if any
  if (engines && engines.count > 0) {
    summary += ` | Engines: ${engines.count}`;
    if (engines.reimbursement > 0) {
      summary += ` (Reimb: ${kFmtMoney(engines.reimbursement)}`;
      if (engines.bonus > 0) {
        summary += ` + Bonus: ${kFmtMoney(engines.bonus)}`;
      }
      summary += ')';
    }
  }
  
  // Total
  summary += ` | TOTAL: ${kFmtMoney(totalAmount)}`;
  
  return summary;
}

/**
 * Generate detailed format (multi-line, all breakdown)
 * Best for documentation or detailed records
 */
function generateDetailedFormat(data) {
  const { mechanic, stateId, totalAmount, repairs, repairPay, engines, weekEnd } = data;
  const weekEndStr = weekEnd ? kFmtDate(weekEnd) : 'N/A';
  
  let lines = [];
  
  // Header
  lines.push('═══════════════════════════════════════');
  lines.push(`PAYOUT SUMMARY: ${mechanic}`);
  if (stateId) {
    lines.push(`State ID: ${stateId}`);
  }
  lines.push(`Week Ending: ${weekEndStr}`);
  lines.push('═══════════════════════════════════════');
  lines.push('');
  
  // Repairs breakdown
  lines.push('REPAIRS:');
  lines.push(`  Count: ${repairs} repairs`);
  lines.push(`  Rate: $700 per repair`);
  lines.push(`  Subtotal: ${kFmtMoney(repairPay)}`);
  lines.push('');
  
  // Engine replacements breakdown
  if (engines && engines.count > 0) {
    lines.push('ENGINE REPLACEMENTS:');
    lines.push(`  Total Count: ${engines.count}`);
    
    // Breakdown by department if available
    if (engines.byDept && Object.keys(engines.byDept).length > 0) {
      lines.push('  By Department:');
      for (const [dept, count] of Object.entries(engines.byDept)) {
        const rate = dept === 'BCSO' ? '$12k' : '$12k + $1.5k bonus';
        lines.push(`    ${dept}: ${count} × ${rate}`);
      }
    }
    
    if (engines.reimbursement > 0) {
      lines.push(`  Reimbursement: ${kFmtMoney(engines.reimbursement)}`);
    }
    if (engines.bonus > 0) {
      lines.push(`  Bonus (LSPD/Other): ${kFmtMoney(engines.bonus)}`);
    }
    lines.push(`  Subtotal: ${kFmtMoney(engines.reimbursement + engines.bonus)}`);
    lines.push('');
  }
  
  // Total
  lines.push('───────────────────────────────────────');
  lines.push(`TOTAL PAYOUT: ${kFmtMoney(totalAmount)}`);
  lines.push('───────────────────────────────────────');
  
  return lines.join('\n');
}

/**
 * Generate compact format (minimal, quick copy)
 * Best for quick reference or small spaces
 */
function generateCompactFormat(data) {
  const { mechanic, stateId, totalAmount, repairs, engines, weekEnd } = data;
  const weekEndStr = weekEnd ? kFmtDate(weekEnd) : '';
  
  let summary = `${mechanic}`;
  if (stateId) summary += ` #${stateId}`;
  summary += ` · ${weekEndStr}`;
  summary += ` · ${repairs}R`;
  if (engines && engines.count > 0) {
    summary += ` ${engines.count}E`;
  }
  summary += ` · ${kFmtMoney(totalAmount)}`;
  
  return summary;
}

/**
 * Extract mechanic payout data from weekly aggregate row
 * @param {Object} weeklyRow - Weekly aggregate row from payouts
 * @param {Map} stateIdMap - Map of mechanic names to state IDs
 * @param {number} payPerRepair - Pay rate per repair
 * @param {number} engineReimbursement - Engine reimbursement amount
 * @param {number} engineBonus - Engine bonus amount (LSPD/Other)
 * @returns {Object} Formatted mechanic data for summary generation
 */
function extractMechanicPayoutData(
  weeklyRow,
  stateIdMap,
  payPerRepair = 700,
  engineReimbursement = 12000,
  engineBonus = 1500
) {
  const { mechanic, repairs, weekEnd, engineReplacements, engineReplacementsByDept } = weeklyRow;
  
  // Get state ID
  const stateId = stateIdMap ? stateIdMap.get(mechanic) : null;
  
  // Calculate repair pay
  const repairPay = repairs * payPerRepair;
  
  // Calculate engine pay by department
  let totalReimbursement = 0;
  let totalBonus = 0;
  
  if (engineReplacementsByDept && Object.keys(engineReplacementsByDept).length > 0) {
    for (const [dept, count] of Object.entries(engineReplacementsByDept)) {
      // BCSO gets reimbursement only, no bonus
      if (dept === 'BCSO') {
        totalReimbursement += count * engineReimbursement;
      } else {
        // LSPD and others get reimbursement + bonus
        totalReimbursement += count * engineReimbursement;
        totalBonus += count * engineBonus;
      }
    }
  }
  
  const totalEnginePay = totalReimbursement + totalBonus;
  const totalAmount = repairPay + totalEnginePay;
  
  return {
    mechanic,
    stateId,
    totalAmount,
    repairs,
    repairPay,
    engines: {
      count: engineReplacements || 0,
      byDept: engineReplacementsByDept || {},
      reimbursement: totalReimbursement,
      bonus: totalBonus,
      total: totalEnginePay
    },
    weekEnd
  };
}

/**
 * Copy text to clipboard with fallback
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
async function copyToClipboard(text) {
  try {
    // Modern clipboard API (preferred)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      document.body.removeChild(textArea);
      return false;
    }
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}

/**
 * Show a temporary copy success notification
 * @param {string} [message='Copied to clipboard!'] - Message to display
 */
function showCopyNotification(message = 'Copied to clipboard!') {
  // Use existing toast function if available
  if (typeof kShowToast === 'function') {
    kShowToast(message, 'success', 2000);
    return;
  }
  
  // Fallback: simple notification
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    background: var(--color-success, #22c55e);
    color: white;
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    font-size: var(--font-size-md, 13px);
    font-weight: 500;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

/**
 * Generate and copy payout summary
 * @param {Object} weeklyRow - Weekly aggregate row
 * @param {Map} stateIdMap - State ID map
 * @param {string} [format='bank'] - Output format
 * @returns {Promise<boolean>} Success status
 */
async function generateAndCopyPayoutSummary(weeklyRow, stateIdMap, format = 'bank') {
  try {
    const mechanicData = extractMechanicPayoutData(weeklyRow, stateIdMap);
    const summary = generatePayoutSummary(mechanicData, format);
    const success = await copyToClipboard(summary);
    
    if (success) {
      showCopyNotification('Payout summary copied!');
    } else {
      // Show the summary in a dialog if copy failed
      showSummaryDialog(summary);
    }
    
    return success;
  } catch (err) {
    console.error('Failed to generate payout summary:', err);
    if (typeof kShowToast === 'function') {
      kShowToast('Failed to generate summary', 'error');
    }
    return false;
  }
}

/**
 * Show summary in a modal dialog (fallback if clipboard fails)
 * @param {string} summary - Summary text to display
 */
function showSummaryDialog(summary) {
  const overlay = document.createElement('div');
  overlay.className = 'k-summary-overlay';
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
  
  const dialog = document.createElement('div');
  dialog.className = 'k-summary-dialog';
  dialog.style.cssText = `
    background: var(--bg-secondary, #050816);
    border: 1px solid var(--border-default, #1f2937);
    border-radius: var(--radius-lg, 18px);
    padding: var(--space-lg, 24px);
    max-width: 600px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
  `;
  
  dialog.innerHTML = `
    <h3 style="margin: 0 0 16px; color: var(--text-primary, #e5e7eb); font-size: 18px;">Payout Summary</h3>
    <textarea readonly style="
      width: 100%;
      min-height: 200px;
      padding: 12px;
      background: var(--bg-primary, #020817);
      border: 1px solid var(--border-default, #1f2937);
      border-radius: 8px;
      color: var(--text-primary, #e5e7eb);
      font-family: monospace;
      font-size: 12px;
      resize: vertical;
      margin-bottom: 16px;
    ">${summary}</textarea>
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button class="k-summary-select btn" style="min-width: 100px;">Select All</button>
      <button class="k-summary-close btn btn-primary" style="min-width: 80px;">Close</button>
    </div>
  `;
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  const textarea = dialog.querySelector('textarea');
  
  // Select all button
  dialog.querySelector('.k-summary-select').addEventListener('click', () => {
    textarea.select();
    document.execCommand('copy');
    showCopyNotification();
  });
  
  // Close button
  const closeDialog = () => {
    overlay.style.animation = 'kFadeOut 0.2s ease';
    setTimeout(() => overlay.remove(), 200);
  };
  
  dialog.querySelector('.k-summary-close').addEventListener('click', closeDialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
  
  // Select text on load
  setTimeout(() => textarea.select(), 100);
}

/**
 * Generate batch summaries for multiple mechanics
 * @param {Array} weeklyRows - Array of weekly aggregate rows
 * @param {Map} stateIdMap - State ID map
 * @param {string} [format='bank'] - Output format
 * @returns {string} Combined summaries
 */
function generateBatchSummaries(weeklyRows, stateIdMap, format = 'bank') {
  if (!Array.isArray(weeklyRows) || weeklyRows.length === 0) {
    return '';
  }
  
  const summaries = weeklyRows.map(row => {
    const mechanicData = extractMechanicPayoutData(row, stateIdMap);
    return generatePayoutSummary(mechanicData, format);
  });
  
  // Join with double newline for bank format, more spacing for detailed
  const separator = format === 'detailed' ? '\n\n\n' : '\n\n';
  return summaries.join(separator);
}
