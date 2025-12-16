// ==========================================
// Data Normalizer
// Normalizes raw sheet data into consistent domain models
// ==========================================

class DataNormalizer {
  constructor(config) {
    this.config = config;
  }

  /**
   * Find column by keyword matching (case-insensitive)
   */
  findColumn(headers, keywords) {
    const lowerHeaders = headers.map(h => h.toLowerCase());
    for (const keyword of keywords) {
      const idx = lowerHeaders.findIndex(h => h.includes(keyword.toLowerCase()));
      if (idx !== -1) return headers[idx];
    }
    return null;
  }

  /**
   * Parse date from various formats
   */
  parseDate(dateStr) {
    if (!dateStr) return null;
    
    const str = String(dateStr).trim();
    if (!str) return null;

    // Try ISO format
    let date = new Date(str);
    if (!isNaN(date.getTime())) return date;

    // Try MM/DD/YYYY
    const match1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match1) {
      date = new Date(match1[3], match1[1] - 1, match1[2]);
      if (!isNaN(date.getTime())) return date;
    }

    // Try DD/MM/YYYY
    const match2 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match2) {
      date = new Date(match2[3], match2[2] - 1, match2[1]);
      if (!isNaN(date.getTime())) return date;
    }

    return null;
  }

  /**
   * Parse currency/number
   */
  parseNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    
    const str = String(value).replace(/[$,]/g, '').trim();
    const num = parseFloat(str);
    
    return isNaN(num) ? 0 : num;
  }

  /**
   * Determine subsidiary from row data
   */
  determineSubsidiary(row, headers) {
    // Check for explicit subsidiary column
    const subCol = this.findColumn(headers, ['subsidiary', 'business', 'org', 'organization']);
    if (subCol && row[subCol]) {
      const value = row[subCol].toLowerCase();
      if (value.includes('kintsugi')) return 'kintsugi';
      if (value.includes('tako')) return 'takosuya';
    }

    // Check name/staff column for keywords
    const nameCol = this.findColumn(headers, ['name', 'staff', 'deputy', 'mechanic', 'person']);
    if (nameCol && row[nameCol]) {
      const name = row[nameCol].toLowerCase();
      
      // Check Kintsugi keywords
      for (const keyword of this.config.subsidiaryRules.kintsugi.keywords) {
        if (name.includes(keyword.toLowerCase())) {
          return 'kintsugi';
        }
      }
      
      // Check Takosuya keywords
      for (const keyword of this.config.subsidiaryRules.takosuya.keywords) {
        if (name.includes(keyword.toLowerCase())) {
          return 'takosuya';
        }
      }
    }

    // Default assignment
    return this.config.subsidiaryRules.takosuya.defaultAssignment ? 'takosuya' : 'kintsugi';
  }

  /**
   * Normalize Orders data
   */
  normalizeOrders(rawData) {
    if (!rawData || !rawData.data || rawData.data.length === 0) {
      return [];
    }

    const { headers, data } = rawData;
    const orders = [];

    // Find relevant columns
    const dateCol = this.findColumn(headers, ['date', 'timestamp', 'time', 'created']);
    const customerCol = this.findColumn(headers, ['customer', 'client', 'name', 'owner']);
    const staffCol = this.findColumn(headers, ['staff', 'deputy', 'mechanic', 'assigned', 'handler']);
    const itemsCol = this.findColumn(headers, ['items', 'description', 'item', 'product', 'service']);
    const quantityCol = this.findColumn(headers, ['quantity', 'qty', 'amount', 'count']);
    const totalCol = this.findColumn(headers, ['total', 'price', 'cost', 'amount']);
    const statusCol = this.findColumn(headers, ['status', 'state']);
    const notesCol = this.findColumn(headers, ['notes', 'note', 'comment', 'remarks']);

    data.forEach((row, idx) => {
      const order = {
        id: `order_${idx + 1}`,
        date: this.parseDate(row[dateCol]),
        customer: row[customerCol] || 'Unknown',
        items: row[itemsCol] || 'N/A',
        quantity: this.parseNumber(row[quantityCol] || 1),
        total: this.parseNumber(row[totalCol]),
        status: row[statusCol] || 'pending',
        staff: row[staffCol] || '',
        subsidiary: this.determineSubsidiary(row, headers),
        notes: row[notesCol] || '',
        _raw: row
      };

      orders.push(order);
    });

    return orders;
  }

  /**
   * Normalize Payouts data
   */
  normalizePayouts(rawData) {
    if (!rawData || !rawData.data || rawData.data.length === 0) {
      return [];
    }

    const { headers, data } = rawData;
    const payouts = [];

    // Find relevant columns
    const personCol = this.findColumn(headers, ['person', 'name', 'staff', 'deputy', 'mechanic']);
    const stateIdCol = this.findColumn(headers, ['state', 'stateid', 'id', 'state_id']);
    const dateCol = this.findColumn(headers, ['date', 'week', 'period', 'timestamp']);
    const amountCol = this.findColumn(headers, ['amount', 'total', 'payout', 'payment']);
    const typeCol = this.findColumn(headers, ['type', 'category', 'kind']);
    const notesCol = this.findColumn(headers, ['notes', 'note', 'description']);

    data.forEach((row, idx) => {
      const payout = {
        id: `payout_${idx + 1}`,
        person: row[personCol] || 'Unknown',
        stateId: row[stateIdCol] || '',
        date: this.parseDate(row[dateCol]),
        amount: this.parseNumber(row[amountCol]),
        type: row[typeCol] || 'earnings',
        subsidiary: this.determineSubsidiary(row, headers),
        notes: row[notesCol] || '',
        _raw: row
      };

      payouts.push(payout);
    });

    return payouts;
  }

  /**
   * Normalize Deputies/Staff data
   */
  normalizeDeputies(rawData) {
    if (!rawData || !rawData.data || rawData.data.length === 0) {
      return [];
    }

    const { headers, data } = rawData;
    const deputies = [];

    // Find relevant columns
    const nameCol = this.findColumn(headers, ['name', 'person', 'staff', 'deputy']);
    const stateIdCol = this.findColumn(headers, ['state', 'stateid', 'id', 'state_id']);
    const roleCol = this.findColumn(headers, ['role', 'position', 'title']);
    const statusCol = this.findColumn(headers, ['status', 'active', 'state']);

    data.forEach((row, idx) => {
      const deputy = {
        id: `deputy_${idx + 1}`,
        name: row[nameCol] || 'Unknown',
        stateId: row[stateIdCol] || '',
        role: row[roleCol] || 'staff',
        active: !statusCol || !row[statusCol] || row[statusCol].toLowerCase() !== 'inactive',
        subsidiary: this.determineSubsidiary(row, headers),
        metrics: {
          orders: 0,
          revenue: 0,
          payouts: 0
        },
        _raw: row
      };

      deputies.push(deputy);
    });

    return deputies;
  }

  /**
   * Normalize all data and cross-reference
   */
  normalizeAll(rawSheets) {
    const orders = this.normalizeOrders(rawSheets.orders);
    const payouts = this.normalizePayouts(rawSheets.payouts);
    const deputies = this.normalizeDeputies(rawSheets.deputies);

    // Cross-reference: compute metrics for deputies
    const deputyMap = new Map(deputies.map(d => [d.name.toLowerCase(), d]));

    orders.forEach(order => {
      const key = order.staff.toLowerCase();
      if (deputyMap.has(key)) {
        const deputy = deputyMap.get(key);
        deputy.metrics.orders++;
        deputy.metrics.revenue += order.total;
      }
    });

    payouts.forEach(payout => {
      const key = payout.person.toLowerCase();
      if (deputyMap.has(key)) {
        const deputy = deputyMap.get(key);
        deputy.metrics.payouts += payout.amount;
      }
    });

    return {
      orders,
      payouts,
      deputies: Array.from(deputyMap.values())
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataNormalizer;
}
