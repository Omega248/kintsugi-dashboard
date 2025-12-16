// ==========================================
// Theme Manager
// Handles theme switching and CSS variable management
// ==========================================

class ThemeManager {
  constructor(config) {
    this.config = config;
    this.current = config.defaults.subsidiary;
  }

  /**
   * Get theme configuration
   */
  getTheme(subsidiaryKey) {
    return this.config.themes[subsidiaryKey] || this.config.themes.kaneshiro;
  }

  /**
   * Apply theme to document
   */
  applyTheme(subsidiaryKey) {
    const theme = this.getTheme(subsidiaryKey);
    const root = document.documentElement;

    // Set CSS variables
    root.style.setProperty('--primary', theme.primary);
    root.style.setProperty('--secondary', theme.secondary);
    root.style.setProperty('--background', theme.background);
    root.style.setProperty('--surface', theme.surface);
    root.style.setProperty('--text', theme.text);
    root.style.setProperty('--text-muted', theme.textMuted);
    root.style.setProperty('--border', theme.border);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--success', theme.success);
    root.style.setProperty('--warning', theme.warning);
    root.style.setProperty('--error', theme.error);

    // Set theme class on body
    document.body.className = `theme-${subsidiaryKey}`;
    
    this.current = subsidiaryKey;
  }

  /**
   * Get current theme key
   */
  getCurrentTheme() {
    return this.current;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeManager;
}
