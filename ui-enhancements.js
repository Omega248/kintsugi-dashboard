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

function toggleHighContrast(enabled) {
  if (enabled) {
    document.body.classList.add('high-contrast');
    localStorage.setItem('high-contrast', 'true');
  } else {
    document.body.classList.remove('high-contrast');
    localStorage.removeItem('high-contrast');
  }
}

function toggleLargeText(enabled) {
  if (enabled) {
    document.body.classList.add('large-text');
    localStorage.setItem('large-text', 'true');
  } else {
    document.body.classList.remove('large-text');
    localStorage.removeItem('large-text');
  }
}

function toggleCompactMode(enabled) {
  if (enabled) {
    document.body.classList.add('compact-mode');
    localStorage.setItem('compact-mode', 'true');
  } else {
    document.body.classList.remove('compact-mode');
    localStorage.removeItem('compact-mode');
  }
}

// Initialize accessibility preferences on load
function initAccessibility() {
  if (localStorage.getItem('high-contrast') === 'true') {
    document.body.classList.add('high-contrast');
  }
  if (localStorage.getItem('large-text') === 'true') {
    document.body.classList.add('large-text');
  }
  if (localStorage.getItem('compact-mode') === 'true') {
    document.body.classList.add('compact-mode');
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAccessibility);
} else {
  initAccessibility();
}
