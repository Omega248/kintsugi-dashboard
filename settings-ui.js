// =======================================
// Kintsugi Settings UI
// User preferences and settings panel
// =======================================

/**
 * Initialize settings UI components
 * Adds settings button and panel to the page
 */
function kInitSettingsUI() {
  // Check if already initialized
  if (document.getElementById('kSettingsPanel')) return;
  
  // Create settings button
  const settingsBtn = document.createElement('button');
  settingsBtn.id = 'kSettingsButton';
  settingsBtn.className = 'settings-button';
  settingsBtn.innerHTML = '⚙️';
  settingsBtn.setAttribute('aria-label', 'Open settings');
  settingsBtn.setAttribute('title', 'Settings');
  
  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'kSettingsOverlay';
  overlay.className = 'settings-overlay';
  
  // Create settings panel
  const panel = document.createElement('div');
  panel.id = 'kSettingsPanel';
  panel.className = 'settings-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Settings');
  
  panel.innerHTML = `
    <div class="settings-panel-header">
      <h2 class="settings-panel-title">Settings</h2>
      <button class="settings-panel-close" aria-label="Close settings">×</button>
    </div>
    
    <div class="settings-group">
      <h3 class="settings-group-title">Display</h3>
      
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Compact Mode</div>
          <div class="settings-item-description">Reduce spacing and padding</div>
        </div>
        <div class="settings-toggle" data-pref="compactMode" role="switch" tabindex="0" aria-label="Compact mode"></div>
      </div>
      
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Show Balance Column</div>
          <div class="settings-item-description">Display running balance in tables</div>
        </div>
        <div class="settings-toggle" data-pref="showBalance" role="switch" tabindex="0" aria-label="Show balance column"></div>
      </div>
      
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Show Tax Information</div>
          <div class="settings-item-description">Display tax-related columns</div>
        </div>
        <div class="settings-toggle" data-pref="showTax" role="switch" tabindex="0" aria-label="Show tax information"></div>
      </div>
    </div>
    
    <div class="settings-group">
      <h3 class="settings-group-title">Accessibility</h3>

      <div class="settings-item">
        <div>
          <div class="settings-item-label">High Contrast</div>
          <div class="settings-item-description">Stronger borders and maximum contrast colours</div>
        </div>
        <div class="settings-toggle" data-pref="highContrast" role="switch" tabindex="0" aria-label="High contrast mode"></div>
      </div>

      <div class="settings-item">
        <div>
          <div class="settings-item-label">Large Text</div>
          <div class="settings-item-description">Increase font sizes across the app</div>
        </div>
        <div class="settings-toggle" data-pref="largeText" role="switch" tabindex="0" aria-label="Large text mode"></div>
      </div>

      <div class="settings-item">
        <div>
          <div class="settings-item-label">Reduce Motion</div>
          <div class="settings-item-description">Minimise animations and transitions</div>
        </div>
        <div class="settings-toggle" data-pref="reduceMotion" role="switch" tabindex="0" aria-label="Reduce motion"></div>
      </div>
    </div>

    <div class="settings-group">
      <h3 class="settings-group-title">Preferences</h3>

      <div class="settings-item">
        <label class="settings-item-label">Default View</label>
        <select class="select-pill" data-pref="defaultView">
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="jobs">Jobs</option>
        </select>
      </div>
      
      <div class="settings-item">
        <label class="settings-item-label">Items Per Page</label>
        <select class="select-pill" data-pref="itemsPerPage">
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>
    </div>
    
    <div class="settings-group">
      <h3 class="settings-group-title">Data</h3>
      
      <button class="btn" id="kClearCache">Clear Data Cache</button>
      <button class="btn" id="kClearRecentSearches">Clear Recent Searches</button>
    </div>
    
    <div class="settings-group">
      <button class="btn btn-primary settings-reset" id="kResetSettings">Reset All Settings</button>
    </div>
  `;
  
  document.body.appendChild(settingsBtn);
  document.body.appendChild(overlay);
  document.body.appendChild(panel);
  
  // Initialize toggle states
  kUpdateSettingsUI();
  
  // Add event listeners
  kAttachSettingsListeners();
}

/**
 * Update settings UI to reflect current preferences
 */
function kUpdateSettingsUI() {
  const prefs = kGetPreferences();
  
  // Update toggles (class drives the visuals, aria-checked drives screen readers)
  document.querySelectorAll('.settings-toggle').forEach(toggle => {
    const on = !!prefs[toggle.dataset.pref];
    toggle.classList.toggle('active', on);
    toggle.setAttribute('aria-checked', String(on));
  });
  
  // Update selects
  document.querySelectorAll('select[data-pref]').forEach(select => {
    const pref = select.dataset.pref;
    if (prefs[pref]) {
      select.value = prefs[pref];
    }
  });
}

/**
 * Attach event listeners to settings UI elements
 */
function kAttachSettingsListeners() {
  const panel = document.getElementById('kSettingsPanel');
  const overlay = document.getElementById('kSettingsOverlay');
  const btn = document.getElementById('kSettingsButton');
  const closeBtn = panel.querySelector('.settings-panel-close');
  
  // Open settings — remember what had focus so we can restore it on close
  let lastFocused = null;

  btn.addEventListener('click', () => {
    lastFocused = document.activeElement;
    panel.classList.add('open');
    overlay.classList.add('visible');
    closeBtn.focus();
  });

  // Close settings
  const closeSettings = () => {
    panel.classList.remove('open');
    overlay.classList.remove('visible');
    // Return focus where the user left it, not to the top of the page
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  };

  closeBtn.addEventListener('click', closeSettings);
  overlay.addEventListener('click', closeSettings);

  // ESC to close, Tab cycles within the panel while it's open
  document.addEventListener('keydown', (e) => {
    if (!panel.classList.contains('open')) return;

    if (e.key === 'Escape') {
      closeSettings();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = panel.querySelectorAll(
      'button, [href], select, input, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  
  // Toggle preferences (mouse + keyboard — these are divs, not real checkboxes)
  document.querySelectorAll('.settings-toggle').forEach(toggle => {
    const flip = () => {
      const pref = toggle.dataset.pref;
      const newValue = !kGetPreference(pref, false);

      kSetPreference(pref, newValue);
      toggle.classList.toggle('active', newValue);
      toggle.setAttribute('aria-checked', String(newValue));

      // Apply changes immediately
      kApplyPreference(pref, newValue);

      kShowToast('Setting updated', 'success', 1500);
    };

    toggle.addEventListener('click', flip);
    toggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();   // stop Space scrolling the page
        flip();
      }
    });
  });
  
  // Select preferences
  document.querySelectorAll('select[data-pref]').forEach(select => {
    select.addEventListener('change', (e) => {
      const pref = select.dataset.pref;
      const value = e.target.value;
      
      kSetPreference(pref, value);
      kShowToast('Preference saved', 'success', 1500);
    });
  });
  
  // Clear cache
  document.getElementById('kClearCache')?.addEventListener('click', () => {
    if (typeof kCsvCache !== 'undefined') {
      kCsvCache.clear();
    }
    kShowToast('Cache cleared', 'success', 2000);
  });
  
  // Clear recent searches
  document.getElementById('kClearRecentSearches')?.addEventListener('click', () => {
    kClearRecentSearches();
    kShowToast('Recent searches cleared', 'success', 2000);
  });
  
  // Reset settings
  document.getElementById('kResetSettings')?.addEventListener('click', () => {
    kConfirm(
      'Reset all settings to defaults?',
      'This will restore all preferences to their default values. This action cannot be undone.',
      () => {
        kResetPreferences();
        kUpdateSettingsUI();
        kShowToast('Settings reset to defaults', 'success', 2000);
        
        // Reload page to apply changes
        setTimeout(() => location.reload(), 1000);
      }
    );
  });

}

/**
 * Apply a preference change immediately
 * @param {string} pref - Preference key
 * @param {*} value - New value
 */
function kApplyPreference(pref, value) {
  // Preferences that are purely a class on <body> (compact mode, high
  // contrast, large text, reduce motion) are handled by the shared map.
  if (PREF_BODY_CLASSES[pref]) {
    document.body.classList.toggle(PREF_BODY_CLASSES[pref], value);
    return;
  }

  switch (pref) {
    case 'showBalance':
      const balanceToggle = document.getElementById('toggleBalance');
      if (balanceToggle) {
        balanceToggle.checked = value;
        // Trigger change event to update UI
        balanceToggle.dispatchEvent(new Event('change'));
      }
      break;
      
    case 'showTax':
      const taxToggle = document.getElementById('toggleTax');
      if (taxToggle) {
        taxToggle.classList.toggle('active', value);
        // Trigger click event to update UI
        taxToggle.click();
      }
      break;
  }
}

// Auto-initialize on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure other scripts are loaded
    setTimeout(kInitSettingsUI, 100);
  });
}
