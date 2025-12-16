/**
 * Staff/Deputy Model
 * Normalized data model for staff and deputies across all subsidiaries
 */

class Staff {
  constructor(data) {
    this.name = data.name || data.Name || data.person || data.Person || '';
    this.stateId = data.stateId || data.StateID || data.state_id || '';
    this.role = data.role || data.Role || '';
    this.active = this._parseActive(data.active || data.Active || data.status);
    this.subsidiary = this._determineSubsidiary(data);
    this.metrics = this._initMetrics(data);
    this.rawData = data;
  }

  _parseActive(active) {
    if (typeof active === 'boolean') return active;
    if (!active) return true; // Default to active
    
    const str = String(active).toLowerCase().trim();
    return str !== 'false' && str !== 'inactive' && str !== 'no' && str !== '0';
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

    // Check role
    const role = (this.role || '').toLowerCase();
    if (role.includes('mechanic') || role.includes('tech') || role.includes('repair')) {
      return 'kintsugi';
    }
    if (role.includes('chef') || role.includes('cook') || role.includes('server') || role.includes('waiter')) {
      return 'takosuya';
    }

    // Default to kintsugi
    return 'kintsugi';
  }

  _initMetrics(data) {
    return {
      totalOrders: data.totalOrders || 0,
      totalRevenue: data.totalRevenue || 0,
      totalPayouts: data.totalPayouts || 0,
      avgOrderValue: data.avgOrderValue || 0,
      ...data.metrics
    };
  }

  updateMetrics(newMetrics) {
    this.metrics = {
      ...this.metrics,
      ...newMetrics
    };
  }

  isKintsugi() {
    return this.subsidiary === 'kintsugi';
  }

  isTakosuya() {
    return this.subsidiary === 'takosuya';
  }

  hasStateId() {
    return Boolean(this.stateId && this.stateId.trim());
  }

  toJSON() {
    return {
      name: this.name,
      stateId: this.stateId,
      role: this.role,
      active: this.active,
      subsidiary: this.subsidiary,
      metrics: this.metrics
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Staff;
}
