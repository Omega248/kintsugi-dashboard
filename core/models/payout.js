/**
 * Payout Model
 * Normalized data model for payouts across all subsidiaries
 */

class Payout {
  constructor(data) {
    this.person = data.person || data.Person || data.name || data.Name || '';
    this.stateId = data.stateId || data.StateID || data.state_id || '';
    this.week = this._parseWeek(data.week || data.Week);
    this.amount = this._parseAmount(data.amount || data.Amount);
    this.type = this._normalizeType(data.type || data.Type);
    this.subsidiary = this._determineSubsidiary(data);
    this.notes = data.notes || data.Notes || '';
    this.rawData = data;
  }

  _parseWeek(weekInput) {
    if (!weekInput) return null;
    
    if (weekInput instanceof Date) {
      return weekInput;
    }

    // Try to parse week ending date
    const str = String(weekInput).trim();
    
    // Handle "Week ending MM/DD/YYYY" format
    const weekEndingMatch = str.match(/week ending\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (weekEndingMatch) {
      const d = new Date(weekEndingMatch[1]);
      if (!isNaN(d.getTime())) return d;
    }

    // Try direct date parsing
    const attempt = new Date(str);
    if (!isNaN(attempt.getTime())) return attempt;

    return null;
  }

  _parseAmount(amount) {
    if (typeof amount === 'number') return amount;
    if (!amount) return 0;
    
    // Remove currency symbols and commas
    const cleaned = String(amount)
      .replace(/[$€£¥,\s]/g, '')
      .trim();
    
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  _normalizeType(type) {
    if (!type) return 'earning';
    
    const t = String(type).toLowerCase().trim();
    
    const mappings = {
      'earning': 'earning',
      'earnings': 'earning',
      'pay': 'earning',
      'payment': 'earning',
      'salary': 'earning',
      'reimbursement': 'reimbursement',
      'reimburse': 'reimbursement',
      'refund': 'reimbursement',
      'bonus': 'bonus',
      'tip': 'bonus',
      'extra': 'bonus',
    };

    return mappings[t] || 'earning';
  }

  _determineSubsidiary(data) {
    // Check if explicitly set
    if (data.subsidiary) {
      const sub = String(data.subsidiary).toLowerCase();
      if (sub.includes('kintsugi')) return 'kintsugi';
      if (sub.includes('takosuya') || sub.includes('tako')) return 'takosuya';
    }

    // Check business field
    if (data.business || data.Business) {
      const biz = String(data.business || data.Business).toLowerCase();
      if (biz.includes('kintsugi')) return 'kintsugi';
      if (biz.includes('takosuya') || biz.includes('tako')) return 'takosuya';
    }

    // Check person/notes
    const searchText = `${this.person} ${this.notes}`.toLowerCase();
    if (searchText.includes('kintsugi') || searchText.includes('motor') || searchText.includes('mechanic')) {
      return 'kintsugi';
    }
    if (searchText.includes('takosuya') || searchText.includes('tako') || searchText.includes('chef') || searchText.includes('server')) {
      return 'takosuya';
    }

    // Default to kintsugi
    return 'kintsugi';
  }

  getFormattedAmount() {
    return `$${this.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  getFormattedWeek() {
    if (!this.week) return 'N/A';
    return this.week.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  isKintsugi() {
    return this.subsidiary === 'kintsugi';
  }

  isTakosuya() {
    return this.subsidiary === 'takosuya';
  }

  toJSON() {
    return {
      person: this.person,
      stateId: this.stateId,
      week: this.week ? this.week.toISOString() : null,
      amount: this.amount,
      type: this.type,
      subsidiary: this.subsidiary,
      notes: this.notes
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Payout;
}
