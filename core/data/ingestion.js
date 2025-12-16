/**
 * Data Ingestion Layer
 * Fetches and normalizes data from Google Sheets
 */

class DataIngestion {
  constructor(sheetId) {
    this.sheetId = sheetId || '1dE7HwPTh07G6gvNfnd45JiZ2arRH3RnheekPFr-p5Ro';
    this.cache = {
      orders: null,
      payouts: null,
      staff: null,
      lastFetch: {}
    };
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Fetch CSV data from Google Sheets
   */
  async fetchSheet(gid, cacheName) {
    // Check cache
    if (this.cache[cacheName] && this.cache.lastFetch[cacheName]) {
      const age = Date.now() - this.cache.lastFetch[cacheName];
      if (age < this.cacheTimeout) {
        console.log(`Using cached ${cacheName} data (${Math.round(age/1000)}s old)`);
        return this.cache[cacheName];
      }
    }

    const url = `https://docs.google.com/spreadsheets/d/${this.sheetId}/export?format=csv&gid=${gid}`;
    
    try {
      console.log(`Fetching ${cacheName} from Google Sheets...`);
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const csvText = await response.text();
      const data = this.parseCSV(csvText);
      
      // Update cache
      this.cache[cacheName] = data;
      this.cache.lastFetch[cacheName] = Date.now();
      
      console.log(`Fetched ${data.length} rows of ${cacheName}`);
      return data;
    } catch (error) {
      console.error(`Error fetching ${cacheName}:`, error);
      // Return cached data if available, otherwise empty array
      return this.cache[cacheName] || [];
    }
  }

  /**
   * Parse CSV text into array of objects
   */
  parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];

    const headers = this.parseCSVLine(lines[0]);
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === 0) continue;

      const row = {};
      headers.forEach((header, index) => {
        row[header.trim()] = values[index] || '';
      });
      data.push(row);
    }

    return data;
  }

  /**
   * Parse a single CSV line (handles quoted fields with commas)
   */
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    // Add last field
    result.push(current);

    return result;
  }

  /**
   * Fetch and normalize orders data
   */
  async fetchOrders() {
    const rawData = await this.fetchSheet('175091786', 'orders');
    return rawData.map(row => new Order(row));
  }

  /**
   * Fetch and normalize payouts data
   */
  async fetchPayouts() {
    const rawData = await this.fetchSheet('425317715', 'payouts');
    return rawData.map(row => new Payout(row));
  }

  /**
   * Fetch and normalize staff/deputy data
   */
  async fetchStaff() {
    const rawData = await this.fetchSheet('0', 'staff');
    return rawData.map(row => new Staff(row));
  }

  /**
   * Fetch all data at once
   */
  async fetchAll() {
    const [orders, payouts, staff] = await Promise.all([
      this.fetchOrders(),
      this.fetchPayouts(),
      this.fetchStaff()
    ]);

    return { orders, payouts, staff };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache = {
      orders: null,
      payouts: null,
      staff: null,
      lastFetch: {}
    };
  }

  /**
   * Force refresh data (bypass cache)
   */
  async refresh() {
    this.clearCache();
    return await this.fetchAll();
  }
}

// Create global instance
const dataIngestion = new DataIngestion();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DataIngestion, dataIngestion };
}
