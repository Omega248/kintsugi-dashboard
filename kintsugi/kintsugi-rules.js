/**
 * Kintsugi Business Rules Configuration
 * Defines subsidiary-specific rules for data assignment and processing
 */

const KintsugiRules = {
  // Subsidiary identification rules
  subsidiary: {
    name: 'Kintsugi',
    keywords: ['kintsugi', 'motor', 'motorworks', 'repair', 'mechanic', 'engine', 'vehicle', 'car', 'auto'],
    categories: ['standard_repair', 'engine_replacement', 'special_work', 'repair'],
    roles: ['mechanic', 'tech', 'technician', 'repair specialist']
  },

  // Category mappings for repairs
  categories: {
    'standard_repair': {
      label: 'Standard Repairs',
      description: 'Regular maintenance and repair work',
      rate: 2500,
      payoutRate: 700
    },
    'engine_replacement': {
      label: 'Engine Replacements',
      description: 'Complete engine replacement services',
      rate: 15000,
      rateBCSO: 12100,
      reimbursement: 12000,
      bonusLSPD: 1500,
      payoutRate: 700
    },
    'special_work': {
      label: 'Special Work',
      description: 'Custom and specialized repair services',
      rate: 'variable',
      payoutRate: 700
    }
  },

  // Payment calculation rules
  payments: {
    repairRate: 2500,
    engineReplacementRate: 15000,
    engineReplacementRateBCSO: 12100,
    engineReimbursement: 12000,
    engineBonusLSPD: 1500,
    payPerRepair: 700
  },

  // Language customization (repair-centric terminology)
  language: {
    order: 'Repair',
    orders: 'Repairs',
    staff: 'Mechanic',
    staffPlural: 'Mechanics',
    customer: 'Client',
    total: 'Service Value',
    completed: 'Completed',
    pending: 'In Progress'
  },

  // Display preferences
  display: {
    defaultView: 'weekly',
    showCategories: true,
    showEngineBreakdown: true,
    highlightSpecialWork: true,
    groupByMechanic: true
  },

  // Filters and defaults
  filters: {
    defaultTimeRange: 'month',
    categories: ['standard_repair', 'engine_replacement', 'special_work'],
    statusOptions: ['completed', 'in_progress', 'pending']
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KintsugiRules;
}
