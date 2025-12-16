/**
 * KPI Card Component
 * Reusable KPI display component with trend indicators
 */

class KPICard {
  constructor(config) {
    this.title = config.title || '';
    this.value = config.value || 0;
    this.format = config.format || 'number'; // number, currency, percent
    this.subtitle = config.subtitle || '';
    this.trend = config.trend || null; // { direction: 'up'|'down'|'neutral', value: number, label: string }
    this.icon = config.icon || null;
    this.className = config.className || '';
  }

  formatValue() {
    switch (this.format) {
      case 'currency':
        return `$${Number(this.value).toLocaleString('en-US', { 
          minimumFractionDigits: 0, 
          maximumFractionDigits: 0 
        })}`;
      
      case 'currency-precise':
        return `$${Number(this.value).toLocaleString('en-US', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        })}`;
      
      case 'percent':
        return `${Number(this.value).toFixed(1)}%`;
      
      case 'number':
      default:
        return Number(this.value).toLocaleString('en-US');
    }
  }

  getTrendHTML() {
    if (!this.trend) return '';

    const { direction, value, label } = this.trend;
    const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
    const className = `kpi-trend kpi-trend-${direction}`;
    
    let displayValue = '';
    if (value !== null && value !== undefined) {
      displayValue = typeof value === 'number' 
        ? `${arrow} ${Math.abs(value).toFixed(1)}%`
        : `${arrow} ${value}`;
    }

    return `
      <div class="${className}">
        <span class="kpi-trend-value">${displayValue}</span>
        ${label ? `<span class="kpi-trend-label">${label}</span>` : ''}
      </div>
    `;
  }

  render() {
    const iconHTML = this.icon ? `<div class="kpi-icon">${this.icon}</div>` : '';
    
    return `
      <div class="kpi-card ${this.className}">
        ${iconHTML}
        <div class="kpi-content">
          <div class="kpi-title">${this.title}</div>
          <div class="kpi-value">${this.formatValue()}</div>
          ${this.subtitle ? `<div class="kpi-subtitle">${this.subtitle}</div>` : ''}
          ${this.getTrendHTML()}
        </div>
      </div>
    `;
  }

  static injectStyles() {
    if (document.getElementById('kpi-card-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'kpi-card-styles';
    styles.textContent = `
      .kpi-card {
        background: var(--color-backgroundSecondary, #2d3748);
        border: 1px solid var(--color-border, #4a5568);
        border-radius: var(--radius-lg, 12px);
        padding: var(--spacing-lg, 24px);
        transition: all var(--transition-base, 200ms);
      }

      .kpi-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .kpi-content {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm, 8px);
      }

      .kpi-title {
        font-size: 14px;
        color: var(--color-textSecondary, #cbd5e0);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .kpi-value {
        font-size: 32px;
        font-weight: 700;
        color: var(--color-text, #e5e7eb);
        line-height: 1.2;
      }

      body.theme-kintsugi .kpi-value {
        color: var(--color-secondary, #D4AF37);
      }

      .kpi-subtitle {
        font-size: 12px;
        color: var(--color-textMuted, #9ca3af);
      }

      .kpi-trend {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs, 4px);
        font-size: 13px;
        font-weight: 600;
        margin-top: var(--spacing-xs, 4px);
      }

      .kpi-trend-up {
        color: var(--color-success, #22c55e);
      }

      .kpi-trend-down {
        color: var(--color-error, #ef4444);
      }

      .kpi-trend-neutral {
        color: var(--color-textMuted, #9ca3af);
      }

      .kpi-trend-label {
        font-size: 11px;
        font-weight: 400;
        opacity: 0.8;
      }

      .kpi-icon {
        font-size: 24px;
        margin-bottom: var(--spacing-sm, 8px);
        opacity: 0.8;
      }

      /* Grid layout */
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: var(--spacing-lg, 24px);
        margin-bottom: var(--spacing-xl, 32px);
      }

      /* Dense layout for executive view */
      [data-theme-density="dense"] .kpi-card {
        padding: var(--spacing-md, 16px);
      }

      [data-theme-density="dense"] .kpi-value {
        font-size: 28px;
      }

      /* Spacious layout for elegant view */
      [data-theme-density="spacious"] .kpi-card {
        padding: var(--spacing-xl, 32px);
      }

      [data-theme-density="spacious"] .kpi-value {
        font-size: 36px;
      }
    `;

    document.head.appendChild(styles);
  }
}

// Initialize styles on load
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => KPICard.injectStyles());
  } else {
    KPICard.injectStyles();
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KPICard;
}
