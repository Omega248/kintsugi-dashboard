/**
 * Subsidiary Assignment Rules Engine
 * Configurable rules for assigning data to subsidiaries
 */

class SubsidiaryRules {
  constructor() {
    this.rules = {
      kintsugi: {
        keywords: ['kintsugi', 'motor', 'repair', 'mechanic', 'engine', 'vehicle', 'car'],
        categories: ['standard_repair', 'engine_replacement', 'special_work'],
        roles: ['mechanic', 'tech', 'technician', 'repair']
      },
      takosuya: {
        keywords: ['takosuya', 'tako', 'food', 'restaurant', 'kitchen'],
        categories: ['food_order', 'beverage', 'meal'],
        roles: ['chef', 'cook', 'server', 'waiter', 'host']
      }
    };
  }

  /**
   * Add custom rule for a subsidiary
   */
  addRule(subsidiary, ruleType, value) {
    if (!this.rules[subsidiary]) {
      this.rules[subsidiary] = { keywords: [], categories: [], roles: [] };
    }

    if (Array.isArray(value)) {
      this.rules[subsidiary][ruleType].push(...value);
    } else {
      this.rules[subsidiary][ruleType].push(value);
    }
  }

  /**
   * Remove rule for a subsidiary
   */
  removeRule(subsidiary, ruleType, value) {
    if (!this.rules[subsidiary]) return;

    const index = this.rules[subsidiary][ruleType].indexOf(value);
    if (index > -1) {
      this.rules[subsidiary][ruleType].splice(index, 1);
    }
  }

  /**
   * Determine subsidiary based on data
   */
  determine(data) {
    // Explicit subsidiary takes precedence
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

    // Score each subsidiary based on rules
    const scores = {
      kintsugi: 0,
      takosuya: 0
    };

    // Check keywords in all text fields
    const searchText = this._extractSearchText(data).toLowerCase();
    
    for (const [subsidiary, rules] of Object.entries(this.rules)) {
      // Check keywords
      for (const keyword of rules.keywords) {
        if (searchText.includes(keyword)) {
          scores[subsidiary] += 2;
        }
      }

      // Check categories
      const category = (data.category || data.Category || data.Type || '').toLowerCase();
      for (const cat of rules.categories) {
        if (category.includes(cat) || cat.includes(category)) {
          scores[subsidiary] += 3;
        }
      }

      // Check roles
      const role = (data.role || data.Role || '').toLowerCase();
      for (const r of rules.roles) {
        if (role.includes(r) || r.includes(role)) {
          scores[subsidiary] += 3;
        }
      }
    }

    // Return subsidiary with highest score, default to kintsugi
    if (scores.takosuya > scores.kintsugi) {
      return 'takosuya';
    }
    return 'kintsugi';
  }

  /**
   * Extract all searchable text from data object
   */
  _extractSearchText(data) {
    const fields = [
      'notes', 'Notes',
      'customer', 'Customer',
      'staff', 'Staff',
      'person', 'Person',
      'name', 'Name',
      'category', 'Category', 'Type',
      'role', 'Role',
      'description', 'Description'
    ];

    return fields
      .map(field => data[field] || '')
      .filter(val => val)
      .join(' ');
  }

  /**
   * Get all rules for a subsidiary
   */
  getRules(subsidiary) {
    return this.rules[subsidiary] || null;
  }

  /**
   * Load rules from configuration
   */
  loadConfig(config) {
    if (config.kintsugi) {
      this.rules.kintsugi = {
        ...this.rules.kintsugi,
        ...config.kintsugi
      };
    }

    if (config.takosuya) {
      this.rules.takosuya = {
        ...this.rules.takosuya,
        ...config.takosuya
      };
    }
  }

  /**
   * Export current rules configuration
   */
  exportConfig() {
    return JSON.parse(JSON.stringify(this.rules));
  }
}

// Create global instance
const subsidiaryRules = new SubsidiaryRules();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SubsidiaryRules, subsidiaryRules };
}
