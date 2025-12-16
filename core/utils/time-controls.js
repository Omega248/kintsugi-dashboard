/**
 * Time Controls
 * Global time range selector for filtering data
 */

class TimeControls {
  constructor() {
    this.currentRange = null;
    this.currentPeriod = 'month'; // day, week, month, custom
    this.listeners = [];
    this.customStart = null;
    this.customEnd = null;
  }

  /**
   * Set the time period
   */
  setPeriod(period, customStart = null, customEnd = null) {
    this.currentPeriod = period;
    
    if (period === 'custom' && customStart && customEnd) {
      this.customStart = customStart;
      this.customEnd = customEnd;
      this.currentRange = { start: customStart, end: customEnd };
    } else {
      this.currentRange = this._calculateRange(period);
    }

    this._notifyListeners();
    return this.currentRange;
  }

  /**
   * Get the current time range
   */
  getRange() {
    if (!this.currentRange) {
      this.currentRange = this._calculateRange(this.currentPeriod);
    }
    return this.currentRange;
  }

  /**
   * Get current period type
   */
  getPeriod() {
    return this.currentPeriod;
  }

  /**
   * Calculate date range for a given period
   */
  _calculateRange(period) {
    const now = new Date();
    let start, end;

    switch (period) {
      case 'day':
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        end = new Date(now);
        end.setHours(23, 59, 59, 999);
        break;

      case 'week':
        // Week starts on Monday
        const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
        start = new Date(now);
        start.setDate(now.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;

      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        break;

      case 'custom':
        if (this.customStart && this.customEnd) {
          start = new Date(this.customStart);
          start.setHours(0, 0, 0, 0);
          end = new Date(this.customEnd);
          end.setHours(23, 59, 59, 999);
        } else {
          // Default to current month if custom dates not set
          return this._calculateRange('month');
        }
        break;

      default:
        // Default to month
        return this._calculateRange('month');
    }

    return { start, end };
  }

  /**
   * Filter data array by current time range
   */
  filterByRange(data, dateField = 'date') {
    const range = this.getRange();
    
    return data.filter(item => {
      const date = item[dateField];
      if (!date) return false;

      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return false;

      return d >= range.start && d <= range.end;
    });
  }

  /**
   * Get previous period range (for comparison)
   */
  getPreviousRange() {
    const current = this.getRange();
    const duration = current.end.getTime() - current.start.getTime();

    return {
      start: new Date(current.start.getTime() - duration),
      end: new Date(current.end.getTime() - duration)
    };
  }

  /**
   * Filter data by previous period
   */
  filterByPreviousRange(data, dateField = 'date') {
    const range = this.getPreviousRange();
    
    return data.filter(item => {
      const date = item[dateField];
      if (!date) return false;

      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return false;

      return d >= range.start && d <= range.end;
    });
  }

  /**
   * Register listener for period changes
   */
  onChange(callback) {
    this.listeners.push(callback);
  }

  /**
   * Unregister listener
   */
  offChange(callback) {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Notify all listeners of range change
   */
  _notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.currentRange, this.currentPeriod);
      } catch (error) {
        console.error('Error in time controls listener:', error);
      }
    });
  }

  /**
   * Format current range as string
   */
  formatRange() {
    const range = this.getRange();
    const options = { month: 'short', day: 'numeric' };
    
    const startStr = range.start.toLocaleDateString('en-US', options);
    const endStr = range.end.toLocaleDateString('en-US', options);

    if (range.start.getFullYear() !== range.end.getFullYear()) {
      return `${startStr}, ${range.start.getFullYear()} – ${endStr}, ${range.end.getFullYear()}`;
    }

    return `${startStr} – ${endStr}, ${range.end.getFullYear()}`;
  }

  /**
   * Get weeks in current range
   */
  getWeeksInRange() {
    const range = this.getRange();
    const weeks = [];
    
    const current = new Date(range.start);
    current.setHours(0, 0, 0, 0);
    
    // Find the Monday of the week containing start date
    const dayOfWeek = (current.getDay() + 6) % 7;
    current.setDate(current.getDate() - dayOfWeek);

    while (current <= range.end) {
      const weekEnd = new Date(current);
      weekEnd.setDate(current.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      weeks.push({
        start: new Date(current),
        end: weekEnd
      });

      current.setDate(current.getDate() + 7);
    }

    return weeks;
  }

  /**
   * Check if date is in current range
   */
  isInRange(date) {
    if (!date) return false;
    
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return false;

    const range = this.getRange();
    return d >= range.start && d <= range.end;
  }
}

// Create global instance
const timeControls = new TimeControls();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TimeControls, timeControls };
}
