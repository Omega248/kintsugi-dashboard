/**
 * Theme Engine
 * Manages subsidiary-specific theming and branding
 */

class ThemeEngine {
  constructor() {
    this.currentTheme = null;
    this.themes = {
      kaneshiro: {
        name: 'Kaneshiro Enterprises',
        colors: {
          primary: '#000000',
          secondary: '#D4AF37',
          accent: '#B8860B',
          background: '#000000',
          backgroundSecondary: '#0a0a0a',
          backgroundTertiary: '#1a1a1a',
          text: '#ffffff',
          textSecondary: '#cccccc',
          textMuted: '#999999',
          border: '#333333',
          success: '#22c55e',
          warning: '#f59e0b',
          error: '#ef4444'
        },
        fonts: {
          primary: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          heading: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          mono: "'SF Mono', 'Monaco', 'Courier New', monospace"
        },
        spacing: {
          xs: '4px',
          sm: '8px',
          md: '16px',
          lg: '24px',
          xl: '32px',
          xxl: '48px'
        },
        borderRadius: {
          sm: '4px',
          md: '8px',
          lg: '12px',
          xl: '16px'
        },
        identity: {
          style: 'executive',
          density: 'dense',
          animation: 'subtle'
        }
      },
      kintsugi: {
        name: 'Kintsugi',
        colors: {
          primary: '#2d3748',
          secondary: '#D4AF37',
          accent: '#B8860B',
          background: '#1a202c',
          backgroundSecondary: '#2d3748',
          backgroundTertiary: '#374151',
          text: '#e5e7eb',
          textSecondary: '#cbd5e0',
          textMuted: '#9ca3af',
          border: '#4a5568',
          success: '#22c55e',
          warning: '#f59e0b',
          error: '#ef4444',
          goldVein: '#D4AF37',
          goldVeinGlow: 'rgba(212, 175, 55, 0.3)'
        },
        fonts: {
          primary: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          heading: "'Crimson Pro', Georgia, serif",
          mono: "'SF Mono', 'Monaco', 'Courier New', monospace"
        },
        spacing: {
          xs: '6px',
          sm: '12px',
          md: '20px',
          lg: '32px',
          xl: '48px',
          xxl: '64px'
        },
        borderRadius: {
          sm: '6px',
          md: '10px',
          lg: '14px',
          xl: '18px'
        },
        identity: {
          style: 'elegant',
          density: 'spacious',
          animation: 'slow'
        }
      },
      takosuya: {
        name: 'Takosuya',
        colors: {
          primary: '#dc2626',
          secondary: '#f59e0b',
          accent: '#fb923c',
          background: '#fef3f2',
          backgroundSecondary: '#ffe4e1',
          backgroundTertiary: '#ffd4cc',
          text: '#1a1a1a',
          textSecondary: '#4a4a4a',
          textMuted: '#737373',
          border: '#fca5a5',
          success: '#22c55e',
          warning: '#f59e0b',
          error: '#ef4444'
        },
        fonts: {
          primary: "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          heading: "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          mono: "'SF Mono', 'Monaco', 'Courier New', monospace"
        },
        spacing: {
          xs: '4px',
          sm: '8px',
          md: '16px',
          lg: '24px',
          xl: '32px',
          xxl: '48px'
        },
        borderRadius: {
          sm: '8px',
          md: '12px',
          lg: '16px',
          xl: '20px'
        },
        identity: {
          style: 'warm',
          density: 'comfortable',
          animation: 'energetic'
        }
      }
    };
  }

  /**
   * Apply theme to the page
   */
  applyTheme(themeName) {
    const theme = this.themes[themeName];
    if (!theme) {
      console.error(`Theme "${themeName}" not found`);
      return;
    }

    this.currentTheme = themeName;

    // Remove existing theme classes
    document.body.classList.remove('theme-kaneshiro', 'theme-kintsugi', 'theme-takosuya');
    document.body.classList.add(`theme-${themeName}`);

    // Apply CSS variables
    const root = document.documentElement;

    // Colors
    for (const [key, value] of Object.entries(theme.colors)) {
      root.style.setProperty(`--color-${key}`, value);
    }

    // Fonts
    for (const [key, value] of Object.entries(theme.fonts)) {
      root.style.setProperty(`--font-${key}`, value);
    }

    // Spacing
    for (const [key, value] of Object.entries(theme.spacing)) {
      root.style.setProperty(`--spacing-${key}`, value);
    }

    // Border radius
    for (const [key, value] of Object.entries(theme.borderRadius)) {
      root.style.setProperty(`--radius-${key}`, value);
    }

    // Set data attributes for identity
    document.body.dataset.themeStyle = theme.identity.style;
    document.body.dataset.themeDensity = theme.identity.density;
    document.body.dataset.themeAnimation = theme.identity.animation;

    // Store preference
    try {
      localStorage.setItem('kaneshiro_theme', themeName);
    } catch (e) {
      console.warn('Could not save theme preference:', e);
    }

    // Dispatch custom event
    window.dispatchEvent(new CustomEvent('themechange', {
      detail: { theme: themeName, config: theme }
    }));
  }

  /**
   * Get current theme name
   */
  getCurrentTheme() {
    return this.currentTheme;
  }

  /**
   * Get theme configuration
   */
  getTheme(themeName) {
    return this.themes[themeName] || null;
  }

  /**
   * Get all available themes
   */
  getAllThemes() {
    return Object.keys(this.themes);
  }

  /**
   * Restore saved theme preference
   */
  restorePreference() {
    try {
      const saved = localStorage.getItem('kaneshiro_theme');
      if (saved && this.themes[saved]) {
        this.applyTheme(saved);
        return true;
      }
    } catch (e) {
      console.warn('Could not restore theme preference:', e);
    }
    return false;
  }

  /**
   * Add or update a theme
   */
  registerTheme(name, config) {
    this.themes[name] = {
      ...this.themes[name],
      ...config
    };
  }

  /**
   * Inject base theme styles
   */
  injectBaseStyles() {
    if (document.getElementById('theme-engine-styles')) return;

    const styleEl = document.createElement('style');
    styleEl.id = 'theme-engine-styles';
    styleEl.textContent = `
      /* Theme Engine Base Styles */
      :root {
        --transition-fast: 150ms ease;
        --transition-base: 200ms ease;
        --transition-slow: 300ms ease;
      }

      body {
        background-color: var(--color-background);
        color: var(--color-text);
        font-family: var(--font-primary);
        transition: background-color var(--transition-base), color var(--transition-base);
      }

      /* Executive Theme (Kaneshiro) */
      body.theme-kaneshiro {
        font-weight: 500;
        letter-spacing: -0.01em;
      }

      body.theme-kaneshiro h1,
      body.theme-kaneshiro h2,
      body.theme-kaneshiro h3 {
        font-weight: 700;
        letter-spacing: -0.02em;
      }

      /* Elegant Theme (Kintsugi) */
      body.theme-kintsugi {
        font-weight: 400;
        letter-spacing: 0.01em;
      }

      body.theme-kintsugi h1,
      body.theme-kintsugi h2,
      body.theme-kintsugi h3 {
        font-family: var(--font-heading);
        font-weight: 600;
        letter-spacing: -0.01em;
      }

      /* Warm Theme (Takosuya) */
      body.theme-takosuya {
        font-weight: 400;
      }

      body.theme-takosuya h1,
      body.theme-takosuya h2,
      body.theme-takosuya h3 {
        font-weight: 700;
      }

      /* Animation speeds */
      [data-theme-animation="subtle"] * {
        transition-duration: 150ms !important;
      }

      [data-theme-animation="slow"] * {
        transition-duration: 300ms !important;
      }

      [data-theme-animation="energetic"] * {
        transition-duration: 200ms !important;
      }

      /* Gold vein accent for Kintsugi */
      body.theme-kintsugi .gold-vein {
        background: linear-gradient(90deg, 
          transparent 0%,
          var(--color-goldVein) 50%,
          transparent 100%
        );
        height: 1px;
        opacity: 0.5;
      }

      body.theme-kintsugi .gold-accent {
        color: var(--color-secondary);
      }

      /* Rounded corners for Takosuya */
      body.theme-takosuya .card,
      body.theme-takosuya .stat-box,
      body.theme-takosuya button {
        border-radius: var(--radius-lg);
      }
    `;

    document.head.appendChild(styleEl);
  }
}

// Create global instance
const themeEngine = new ThemeEngine();

// Initialize on load
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      themeEngine.injectBaseStyles();
    });
  } else {
    themeEngine.injectBaseStyles();
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThemeEngine, themeEngine };
}
