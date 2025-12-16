// ==========================================
// Google Sheets Data Client
// Handles fetching and caching sheet data
// ==========================================

class SheetsClient {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Build CSV export URL for a sheet tab
   */
  buildCsvUrl(tabConfig) {
    const { sheetId } = this.config.sheets;
    const { name } = tabConfig;
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  }

  /**
   * Parse CSV text into array of rows
   */
  parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            cell += '"';
            i++; // Skip next quote
          } else {
            inQuotes = false;
          }
        } else {
          cell += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          row.push(cell.trim());
          cell = '';
        } else if (char === '\n') {
          row.push(cell.trim());
          if (row.length > 0 && row.some(c => c !== '')) {
            rows.push(row);
          }
          row = [];
          cell = '';
        } else if (char !== '\r') {
          cell += char;
        }
      }
    }

    // Push last cell and row
    if (cell || row.length > 0) {
      row.push(cell.trim());
      if (row.some(c => c !== '')) {
        rows.push(row);
      }
    }

    return rows;
  }

  /**
   * Fetch and parse sheet data with caching
   */
  async fetchSheet(tabConfig) {
    const url = this.buildCsvUrl(tabConfig);
    const cacheKey = `${tabConfig.name}_${tabConfig.gid}`;

    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
      this.cache.delete(cacheKey);
    }

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch ${tabConfig.name}: ${response.status}`);
      }

      const text = await response.text();
      
      if (!text || text.trim().startsWith('<')) {
        throw new Error(`Invalid data from ${tabConfig.name}. Check sharing settings.`);
      }

      const rows = this.parseCSV(text);
      
      if (rows.length === 0) {
        return { headers: [], data: [] };
      }

      const headers = rows[0].map(h => h.trim());
      const data = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, idx) => {
          obj[header] = row[idx] || '';
        });
        return obj;
      });

      const result = { headers, data };

      // Cache result
      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error(`Error fetching ${tabConfig.name}:`, error);
      throw error;
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Fetch all sheets in parallel
   */
  async fetchAllSheets() {
    const { orders, payouts, deputies } = this.config.sheets.tabs;
    
    try {
      const [ordersData, payoutsData, deputiesData] = await Promise.all([
        this.fetchSheet(orders),
        this.fetchSheet(payouts),
        this.fetchSheet(deputies)
      ]);

      return {
        orders: ordersData,
        payouts: payoutsData,
        deputies: deputiesData
      };
    } catch (error) {
      console.error('Error fetching sheets:', error);
      throw error;
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetsClient;
}
