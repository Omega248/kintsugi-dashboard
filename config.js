// ==========================================
// Kaneshiro Enterprises Platform Configuration
// ==========================================

const CONFIG = {
  // Google Sheets Configuration
  sheets: {
    baseUrl: 'https://docs.google.com/spreadsheets/d/1dE7HwPTh07G6gvNfnd45JiZ2arRH3RnheekPFr-p5Ro',
    sheetId: '1dE7HwPTh07G6gvNfnd45JiZ2arRH3RnheekPFr-p5Ro',
    tabs: {
      orders: { name: 'Orders', gid: '175091786' },
      payouts: { name: 'Payouts', gid: '425317715' },
      deputies: { name: 'Deputies', gid: '0' }
    }
  },

  // Subsidiary Assignment Rules
  subsidiaryRules: {
    // Rule: Assign based on staff/deputy name prefix or explicit column
    // If sheet has 'subsidiary' column, use it
    // Otherwise, use these rules:
    kintsugi: {
      keywords: ['mechanic', 'kintsugi', 'motorworks'],
      defaultAssignment: false
    },
    takosuya: {
      keywords: ['deputy', 'takosuya', 'tako'],
      defaultAssignment: true // Default to Takosuya if uncertain
    }
  },

  // Theme Configuration
  themes: {
    kaneshiro: {
      name: 'Kaneshiro Enterprises',
      primary: '#D4AF37', // Gold
      secondary: '#000000', // Black
      background: '#0a0a0a',
      surface: '#1a1a1a',
      text: '#ffffff',
      textMuted: '#a0a0a0',
      border: '#2a2a2a',
      accent: '#D4AF37',
      success: '#4ade80',
      warning: '#fbbf24',
      error: '#ef4444'
    },
    kintsugi: {
      name: 'Kintsugi',
      primary: '#D4AF37', // Gold vein
      secondary: '#2d2d2d', // Charcoal
      background: '#1a1a1a',
      surface: '#2a2a2a',
      text: '#e5e5e5',
      textMuted: '#999999',
      border: '#3a3a3a',
      accent: '#C9A961',
      success: '#6ee7b7',
      warning: '#fcd34d',
      error: '#fca5a5'
    },
    takosuya: {
      name: 'Takosuya',
      primary: '#7c3aed', // Purple/Violet
      secondary: '#f97316', // Orange
      background: '#fafafa', // Light/bright
      surface: '#ffffff',
      text: '#1a1a1a',
      textMuted: '#666666',
      border: '#e5e5e5',
      accent: '#7c3aed',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444'
    }
  },

  // Default Settings
  defaults: {
    subsidiary: 'kaneshiro', // Start with parent view
    dateRange: 'all',
    pageSize: 50
  }
};

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
