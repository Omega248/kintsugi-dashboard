// =======================================
// Kintsugi Audit View Component
// Payout audit and data validation display
//
// Dependencies (must be loaded before this file):
// - payout-helpers.js (kAuditPayouts, kFormatCurrency, kFormatDateTime)
// - ui-enhancements.js (kShowToast)
// =======================================

class PayoutAuditView {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = options;
    this.auditData = null;
    
    if (!this.container) {
      console.warn(`Audit view container "${containerId}" not found`);
      return;
    }
    
    this.init();
  }
  
  init() {
    this.container.className = 'audit-view-container';
  }
  
  /**
   * Run audit and display results
   * @param {Array} mechanics - Mechanic data
   * @param {Array} bankRecords - Bank records (optional)
   */
  runAudit(mechanics, bankRecords = []) {
    this.auditData = kAuditPayouts(mechanics, bankRecords);
    this.render();
  }
  
  /**
   * Render audit results
   */
  render() {
    if (!this.container || !this.auditData) return;
    
    const audit = this.auditData;
    const hasIssues = audit.anomalies.length > 0 || 
                      audit.missingPayouts.length > 0 || 
                      audit.duplicates.length > 0 ||
                      Math.abs(audit.discrepancy) > 0.01;
    
    let html = `
      <div class="audit-view">
        <div class="audit-header">
          <h2 class="audit-title">
            <span class="audit-icon">🔍</span>
            Payout Audit Report
          </h2>
          <div class="audit-status ${hasIssues ? 'audit-status-warning' : 'audit-status-ok'}">
            ${hasIssues ? '⚠️ Issues Found' : '✓ No Issues'}
          </div>
        </div>
        
        <div class="audit-summary-cards">
          ${this.renderSummaryCard('Total Expected', kFormatCurrency(audit.totalExpected), 'info')}
          ${this.renderSummaryCard('Total Paid', kFormatCurrency(audit.totalPaid), audit.totalPaid > 0 ? 'success' : 'neutral')}
          ${this.renderSummaryCard('Discrepancy', kFormatCurrency(Math.abs(audit.discrepancy)), 
            Math.abs(audit.discrepancy) > 0.01 ? 'warning' : 'success')}
        </div>
        
        ${audit.anomalies.length > 0 ? this.renderAnomalies(audit.anomalies) : ''}
        ${audit.missingPayouts.length > 0 ? this.renderMissingPayouts(audit.missingPayouts) : ''}
        ${audit.duplicates.length > 0 ? this.renderDuplicates(audit.duplicates) : ''}
        
        ${!hasIssues ? this.renderNoIssues() : ''}
        
        <div class="audit-actions">
          <button class="btn btn-primary" onclick="window.auditView?.exportReport()">
            📄 Export Audit Report
          </button>
          <button class="btn" onclick="window.auditView?.close()">
            Close Audit
          </button>
        </div>
      </div>
    `;
    
    this.container.innerHTML = html;
    this.container.style.display = 'block';
    
    // Smooth scroll to audit view
    this.container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  
  /**
   * Render summary card
   */
  renderSummaryCard(label, value, type = 'neutral') {
    const colors = {
      info: 'var(--color-info)',
      success: 'var(--color-success)',
      warning: 'var(--color-warning)',
      error: 'var(--color-error)',
      neutral: 'var(--text-secondary)'
    };
    
    return `
      <div class="audit-summary-card" style="border-left-color: ${colors[type]}">
        <div class="audit-summary-label">${label}</div>
        <div class="audit-summary-value" style="color: ${colors[type]}">${value}</div>
      </div>
    `;
  }
  
  /**
   * Render anomalies section
   */
  renderAnomalies(anomalies) {
    return `
      <div class="audit-section audit-section-warning">
        <h3 class="audit-section-title">
          <span class="audit-section-icon">⚠️</span>
          Anomalies Detected (${anomalies.length})
        </h3>
        <div class="audit-table-wrap">
          <table class="audit-table">
            <thead>
              <tr>
                <th>Mechanic</th>
                <th>Issue</th>
                <th>Repairs</th>
                <th>Payout</th>
              </tr>
            </thead>
            <tbody>
              ${anomalies.map(a => `
                <tr>
                  <td>${this.escapeHtml(a.mechanic)}</td>
                  <td class="audit-issue">${this.escapeHtml(a.issue)}</td>
                  <td>${a.repairs}</td>
                  <td>${kFormatCurrency(a.payout)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  
  /**
   * Render missing payouts section
   */
  renderMissingPayouts(missing) {
    return `
      <div class="audit-section audit-section-error">
        <h3 class="audit-section-title">
          <span class="audit-section-icon">❌</span>
          Missing Payouts (${missing.length})
        </h3>
        <div class="audit-table-wrap">
          <table class="audit-table">
            <thead>
              <tr>
                <th>Mechanic</th>
                <th>Expected Payout</th>
              </tr>
            </thead>
            <tbody>
              ${missing.map(m => `
                <tr>
                  <td>${this.escapeHtml(m.name)}</td>
                  <td class="audit-amount">${kFormatCurrency(m.totalPayout)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  
  /**
   * Render duplicates section
   */
  renderDuplicates(duplicates) {
    return `
      <div class="audit-section audit-section-warning">
        <h3 class="audit-section-title">
          <span class="audit-section-icon">⚡</span>
          Possible Duplicate Transactions (${duplicates.length})
        </h3>
        <div class="audit-table-wrap">
          <table class="audit-table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Timestamp</th>
                <th>Comment</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              ${duplicates.map(d => `
                <tr>
                  <td class="audit-amount">${kFormatCurrency(d.amount)}</td>
                  <td>${this.escapeHtml(String(d.timestamp))}</td>
                  <td>${this.escapeHtml(d.comment || 'N/A')}</td>
                  <td class="audit-count">${d.count}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  
  /**
   * Render no issues message
   */
  renderNoIssues() {
    return `
      <div class="audit-section audit-section-success">
        <div class="audit-no-issues">
          <div class="audit-no-issues-icon">✓</div>
          <div class="audit-no-issues-text">
            <h3>All Clear!</h3>
            <p>No issues detected in payout data. All mechanics have valid information and payouts match expectations.</p>
          </div>
        </div>
      </div>
    `;
  }
  
  /**
   * Export audit report as text
   */
  exportReport() {
    if (!this.auditData) return;
    
    const audit = this.auditData;
    let report = '';
    
    report += '═══════════════════════════════════════\n';
    report += '  KINTSUGI MOTORWORKS - AUDIT REPORT\n';
    report += '═══════════════════════════════════════\n\n';
    
    report += `Generated: ${kFormatDateTime(new Date())}\n\n`;
    
    // Summary
    report += '───────────────────────────────────────\n';
    report += 'SUMMARY\n';
    report += '───────────────────────────────────────\n';
    report += `Total Expected: ${kFormatCurrency(audit.totalExpected)}\n`;
    report += `Total Paid: ${kFormatCurrency(audit.totalPaid)}\n`;
    report += `Discrepancy: ${kFormatCurrency(Math.abs(audit.discrepancy))}\n\n`;
    
    // Anomalies
    if (audit.anomalies.length > 0) {
      report += '───────────────────────────────────────\n';
      report += `ANOMALIES (${audit.anomalies.length})\n`;
      report += '───────────────────────────────────────\n';
      audit.anomalies.forEach(a => {
        report += `• ${a.mechanic}: ${a.issue}\n`;
        report += `  Repairs: ${a.repairs}, Payout: ${kFormatCurrency(a.payout)}\n`;
      });
      report += '\n';
    }
    
    // Missing payouts
    if (audit.missingPayouts.length > 0) {
      report += '───────────────────────────────────────\n';
      report += `MISSING PAYOUTS (${audit.missingPayouts.length})\n`;
      report += '───────────────────────────────────────\n';
      audit.missingPayouts.forEach(m => {
        report += `• ${m.name}: ${kFormatCurrency(m.totalPayout)}\n`;
      });
      report += '\n';
    }
    
    // Duplicates
    if (audit.duplicates.length > 0) {
      report += '───────────────────────────────────────\n';
      report += `DUPLICATE TRANSACTIONS (${audit.duplicates.length})\n`;
      report += '───────────────────────────────────────\n';
      audit.duplicates.forEach(d => {
        report += `• ${kFormatCurrency(d.amount)} - ${d.timestamp}\n`;
        report += `  Comment: ${d.comment || 'N/A'}\n`;
        report += `  Count: ${d.count}\n`;
      });
      report += '\n';
    }
    
    report += '═══════════════════════════════════════\n';
    
    // Download as file
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kintsugi-audit-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    kShowToast('Audit report downloaded', 'success', 3000);
  }
  
  /**
   * Close audit view
   */
  close() {
    if (!this.container) return;
    this.container.style.display = 'none';
    this.container.innerHTML = '';
  }
  
  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

/**
 * Create and initialize audit view
 * @param {string} containerId - Container element ID
 * @returns {PayoutAuditView} Audit view instance
 */
function kCreateAuditView(containerId) {
  return new PayoutAuditView(containerId);
}
