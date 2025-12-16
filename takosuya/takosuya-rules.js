/**
 * Takosuya Business Rules Configuration
 * Defines subsidiary-specific rules for fast-paced food operations
 */

const TakosuyaRules = {
  // Subsidiary identification rules
  subsidiary: {
    name: 'Takosuya',
    keywords: ['takosuya', 'tako', 'food', 'restaurant', 'kitchen', 'chef', 'server', 'meal'],
    categories: ['food_order', 'beverage', 'meal', 'special'],
    roles: ['chef', 'cook', 'server', 'waiter', 'host', 'bartender']
  },

  // Category mappings for orders
  categories: {
    'food_order': {
      label: 'Food Orders',
      description: 'Main dishes and food items',
      avgPrice: 15
    },
    'beverage': {
      label: 'Beverages',
      description: 'Drinks and beverages',
      avgPrice: 8
    },
    'special': {
      label: 'Specials',
      description: 'Daily specials and featured items',
      avgPrice: 20
    },
    'other': {
      label: 'Other',
      description: 'Miscellaneous items',
      avgPrice: 10
    }
  },

  // Payment calculation rules
  payments: {
    baseRate: 15,
    tipPercentage: 15,
    payPerOrder: 5, // Base pay per order for staff
    bonusThreshold: 50 // Orders needed for bonus
  },

  // Language customization (operations-focused)
  language: {
    order: 'Order',
    orders: 'Orders',
    staff: 'Team Member',
    staffPlural: 'Team',
    customer: 'Customer',
    total: 'Total',
    completed: 'Served',
    pending: 'In Kitchen'
  },

  // Display preferences
  display: {
    defaultView: 'daily',
    showThroughput: true,
    showPeakHours: true,
    showPopularItems: true,
    groupByShift: true
  },

  // Filters and defaults
  filters: {
    defaultTimeRange: 'week',
    categories: ['food_order', 'beverage', 'special', 'other'],
    statusOptions: ['completed', 'pending', 'preparing']
  },

  // Operational metrics
  operations: {
    targetOrdersPerHour: 20,
    targetAvgOrderValue: 18,
    peakHours: ['11:00-14:00', '17:00-21:00']
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakosuyaRules;
}
