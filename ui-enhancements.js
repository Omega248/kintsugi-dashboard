/* =============================================
   Kintsugi Dashboard - UI Enhancements
   Toast notifications, filter chips, and other UI improvements
   ============================================= */

// ===== Trend Indicator Helper =====

function createTrendIndicator(value, previousValue) {
  if (!previousValue || value === previousValue) {
    return '<span class="trend-indicator trend-neutral"><span class="trend-icon">–</span> 0%</span>';
  }

  const change = value - previousValue;
  const percentChange = ((change / previousValue) * 100).toFixed(1);
  const isPositive = change > 0;

  return `
    <span class="trend-indicator ${isPositive ? 'trend-up' : 'trend-down'}">
      <span class="trend-icon">${isPositive ? '▲' : '▼'}</span>
      ${Math.abs(percentChange)}%
    </span>
  `;
}

// ===== Progress Bar Helper =====

function createProgressBar(value, max, label = '') {
  const percentage = Math.min((value / max) * 100, 100).toFixed(0);
  
  return `
    <div class="progress-container">
      ${label ? `
        <div class="progress-label">
          <span>${label}</span>
          <span class="progress-percentage">${percentage}%</span>
        </div>
      ` : ''}
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${percentage}%"></div>
      </div>
    </div>
  `;
}

// ===== Badge Helper =====

function createBadge(text, type = 'info') {
  return `<span class="badge badge-${type}">${text}</span>`;
}

// ===== Loading State Enhancements =====

function showEnhancedLoader(container, message = 'Loading...') {
  const loader = document.createElement('div');
  loader.className = 'k-loader';
  loader.innerHTML = `
    <div class="k-loader-spinner"></div>
    <div class="k-loader-text">${kEscapeHtml(message)}</div>
  `;
  
  if (typeof container === 'string') {
    container = document.querySelector(container);
  }
  
  if (container) {
    container.style.position = 'relative';
    container.appendChild(loader);
  }
  
  return loader;
}

function hideEnhancedLoader(loader) {
  if (loader && loader.parentNode) {
    loader.parentNode.removeChild(loader);
  }
}

// ===== Enhanced Error Display =====

function showEnhancedError(container, message, options = {}) {
  const {
    icon = '⚠',
    retryCallback = null,
    retryText = 'Retry'
  } = options;

  const errorDiv = document.createElement('div');
  errorDiv.className = 'k-error';
  errorDiv.innerHTML = `
    <div class="k-error-icon">${icon}</div>
    <div class="k-error-message">${kEscapeHtml(message)}</div>
    ${retryCallback ? `<button class="btn btn-primary k-error-retry">${retryText}</button>` : ''}
  `;

  if (typeof container === 'string') {
    container = document.querySelector(container);
  }

  if (container) {
    container.style.position = 'relative';
    container.appendChild(errorDiv);

    if (retryCallback) {
      const retryBtn = errorDiv.querySelector('.k-error-retry');
      retryBtn?.addEventListener('click', retryCallback);
    }
  }

  return errorDiv;
}

// ===== Smooth Scroll Helper =====

function smoothScrollTo(element, offset = 0) {
  if (typeof element === 'string') {
    element = document.querySelector(element);
  }

  if (element) {
    const top = element.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({
      top,
      behavior: 'smooth'
    });
  }
}

// ===== Number Animation =====

function animateNumber(element, start, end, duration = 1000) {
  if (typeof element === 'string') {
    element = document.querySelector(element);
  }

  if (!element) return;

  const range = end - start;
  const increment = range / (duration / 16);
  let current = start;

  const timer = setInterval(() => {
    current += increment;
    if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
      current = end;
      clearInterval(timer);
    }
    
    // Format number with commas
    const formatted = Math.round(current).toLocaleString();
    element.textContent = formatted;
  }, 16);
}

// ===== Accessibility Helpers =====

// These modes are stored in the unified preferences object (preferences.js),
// which is what applies the body classes on load. They previously kept their
// own separate localStorage keys, so the settings panel and this file could
// disagree about whether e.g. compact mode was on.

function toggleHighContrast(enabled) {
  kSetPreference('highContrast', enabled);
  document.body.classList.toggle('high-contrast', enabled);
}

function toggleLargeText(enabled) {
  kSetPreference('largeText', enabled);
  document.body.classList.toggle('large-text', enabled);
}

function toggleCompactMode(enabled) {
  kSetPreference('compactMode', enabled);
  document.body.classList.toggle('compact-mode', enabled);
}

// Body classes are applied by kInitPreferences() in preferences.js on
// DOMContentLoaded — no separate init needed here.
