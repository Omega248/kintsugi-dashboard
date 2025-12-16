/**
 * Order/Repair Model
 * Normalized data model for orders and repairs across all subsidiaries
 */

class Order {
  constructor(data) {
    this.id = data.id || this._generateId(data);
    this.date = this._parseDate(data.date);
    this.customer = data.customer || data.Customer || '';
    this.category = this._normalizeCategory(data.category || data.Category || data.Type);
    this.total = this._parseAmount(data.total || data.Total || data.Amount);
    this.status = data.status || data.Status || 'completed';
    this.staff = data.staff || data.Staff || data.Mechanic || data.mechanic || '';
    this.subsidiary = this._determineSubsidiary(data);
    this.notes = data.notes || data.Notes || '';
    this.rawData = data; // Keep original data for reference
  }

  _generateId(data) {
    // Generate ID from timestamp and customer if not provided
    const timestamp = this.date ? this.date.getTime() : Date.now();
    const customer = data.customer || data.Customer || 'unknown';
    return `${timestamp}-${customer.substring(0, 8).replace(/\s/g, '')}`;
  }

  _parseDate(dateInput) {
    if (!dateInput) return null;
    
    // If already a Date object
    if (dateInput instanceof Date) {
      return isNaN(dateInput.getTime()) ? null : dateInput;
    }

    // Try various date formats
    const formats = [
      // ISO format: 2024-01-15
      /^(\d{4})-(\d{2})-(\d{2})/,
      // US format: 1/15/2024 or 01/15/2024
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,
      // UK format: 15/1/2024 or 15/01/2024
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    ];

    const str = String(dateInput).trim();
    
    // Try ISO format first
    if (formats[0].test(str)) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) return d;
    }

    // Try parsing as-is
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

  _normalizeCategory(category) {
    if (!category) return 'other';
    
    const cat = String(category).toLowerCase().trim();
    
    // Map various category names to standard ones
    const mappings = {
      'repair': 'standard_repair',
      'standard': 'standard_repair',
      'standard_repair': 'standard_repair',
      'engine': 'engine_replacement',
      'engine_replacement': 'engine_replacement',
      'special': 'special_work',
      'special_work': 'special_work',
      'custom': 'special_work',
      'food': 'food_order',
      'order': 'food_order',
      'beverage': 'beverage',
      'drink': 'beverage',
    };

    return mappings[cat] || 'other';
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

    // Check category - repairs go to Kintsugi, food to Takosuya
    const category = this.category || this._normalizeCategory(data.category || data.Category || data.Type);
    if (category.includes('repair') || category.includes('engine') || category.includes('mechanic')) {
      return 'kintsugi';
    }
    if (category.includes('food') || category.includes('beverage') || category.includes('order')) {
      return 'takosuya';
    }

    // Default based on notes or staff
    const searchText = `${data.notes || ''} ${data.Notes || ''} ${this.staff}`.toLowerCase();
    if (searchText.includes('kintsugi') || searchText.includes('motor') || searchText.includes('mechanic')) {
      return 'kintsugi';
    }
    if (searchText.includes('takosuya') || searchText.includes('tako') || searchText.includes('food')) {
      return 'takosuya';
    }

    // Last resort - default to kintsugi
    return 'kintsugi';
  }

  // Utility methods
  isKintsugi() {
    return this.subsidiary === 'kintsugi';
  }

  isTakosuya() {
    return this.subsidiary === 'takosuya';
  }

  getFormattedDate(format = 'short') {
    if (!this.date) return 'N/A';
    
    const options = {
      short: { month: 'numeric', day: 'numeric', year: '2-digit' },
      long: { month: 'long', day: 'numeric', year: 'numeric' },
      iso: null // Handle separately
    };

    if (format === 'iso') {
      return this.date.toISOString().split('T')[0];
    }

    return this.date.toLocaleDateString('en-US', options[format] || options.short);
  }

  getFormattedTotal() {
    return `$${this.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  toJSON() {
    return {
      id: this.id,
      date: this.date ? this.date.toISOString() : null,
      customer: this.customer,
      category: this.category,
      total: this.total,
      status: this.status,
      staff: this.staff,
      subsidiary: this.subsidiary,
      notes: this.notes
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Order;
}
