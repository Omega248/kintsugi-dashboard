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
        <div class="settings-toggle" data-pref="compactMode"></div>
      </div>
      
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Show Balance Column</div>
          <div class="settings-item-description">Display running balance in tables</div>
        </div>
        <div class="settings-toggle" data-pref="showBalance"></div>
      </div>
      
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Show Tax Information</div>
          <div class="settings-item-description">Display tax-related columns</div>
        </div>
        <div class="settings-toggle" data-pref="showTax"></div>
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
    
    <div class="settings-group" id="kDiscordSettingsGroup">
      <h3 class="settings-group-title">Discord Integration</h3>
      <p class="settings-item-description" style="margin-bottom:8px;">
        Webhook URLs are saved locally in your browser only — they are never sent to any server other than Discord.
      </p>

      <div class="settings-item" style="flex-direction:column;align-items:flex-start;gap:4px;">
        <label class="settings-item-label" for="kDiscordAnalyticsUrl">Analytics Webhook URL</label>
        <div class="settings-item-description">Posts auto-updates when new repair data is detected.</div>
        <input id="kDiscordAnalyticsUrl" type="url" class="advanced-input" style="width:100%;margin-top:4px;"
               placeholder="https://discord.com/api/webhooks/…" autocomplete="off" />
      </div>

      <div class="settings-item" style="flex-direction:column;align-items:flex-start;gap:4px;margin-top:8px;">
        <label class="settings-item-label" for="kDiscordPayoutsUrl">Payouts Webhook URL</label>
        <div class="settings-item-description">Used for "Payouts Processed" announcements and the payday reminder ping.</div>
        <input id="kDiscordPayoutsUrl" type="url" class="advanced-input" style="width:100%;margin-top:4px;"
               placeholder="https://discord.com/api/webhooks/…" autocomplete="off" />
      </div>

      <div class="settings-item" style="flex-direction:column;align-items:flex-start;gap:4px;margin-top:8px;">
        <label class="settings-item-label" for="kDiscordRiptideId">@riptide248 Discord User ID</label>
        <div class="settings-item-description">Numeric Discord user ID used to ping riptide248 on payday (e.g. 123456789012345678).</div>
        <input id="kDiscordRiptideId" type="text" class="advanced-input" style="width:100%;margin-top:4px;"
               placeholder="Discord user ID (numbers only)" autocomplete="off" inputmode="numeric" />
      </div>

      <div class="settings-item" style="margin-top:8px;">
        <div>
          <div class="settings-item-label">Auto-post on new data</div>
          <div class="settings-item-description">Automatically post to the analytics webhook when new repairs are detected.</div>
        </div>
        <div class="settings-toggle" id="kDiscordAutoPostToggle"></div>
      </div>

      <div class="settings-item" style="margin-top:8px;">
        <label class="settings-item-label" for="kDiscordPaydayDay">Payday reminder day</label>
        <select id="kDiscordPaydayDay" class="select-pill">
          <option value="0">Sunday</option>
          <option value="1" selected>Monday</option>
          <option value="2">Tuesday</option>
          <option value="3">Wednesday</option>
          <option value="4">Thursday</option>
          <option value="5">Friday</option>
          <option value="6">Saturday</option>
        </select>
      </div>

      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="kDiscordSaveSettings">Save Discord Settings</button>
        <button class="btn" id="kDiscordTestAnalytics">Test Analytics Webhook</button>
        <button class="btn" id="kDiscordTestPayouts">Test Payouts Webhook</button>
      </div>
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
  
  // Update toggles
  document.querySelectorAll('.settings-toggle').forEach(toggle => {
    const pref = toggle.dataset.pref;
    if (prefs[pref]) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
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
  
  // Open settings
  btn.addEventListener('click', () => {
    panel.classList.add('open');
    overlay.classList.add('visible');
  });
  
  // Close settings
  const closeSettings = () => {
    panel.classList.remove('open');
    overlay.classList.remove('visible');
  };
  
  closeBtn.addEventListener('click', closeSettings);
  overlay.addEventListener('click', closeSettings);
  
  // Handle ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) {
      closeSettings();
    }
  });
  
  // Toggle preferences
  document.querySelectorAll('.settings-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const pref = toggle.dataset.pref;
      const current = kGetPreference(pref, false);
      const newValue = !current;
      
      kSetPreference(pref, newValue);
      toggle.classList.toggle('active', newValue);
      
      // Apply changes immediately
      kApplyPreference(pref, newValue);
      
      kShowToast('Setting updated', 'success', 1500);
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

  // ---- Discord settings ----

  // Populate Discord fields with stored values
  function kLoadDiscordFields() {
    if (typeof kDiscordGetConfig !== 'function') return;
    const cfg = kDiscordGetConfig();
    const analyticsInput = document.getElementById('kDiscordAnalyticsUrl');
    const payoutsInput = document.getElementById('kDiscordPayoutsUrl');
    const riptideInput = document.getElementById('kDiscordRiptideId');
    const paydaySelect = document.getElementById('kDiscordPaydayDay');
    const autoToggle = document.getElementById('kDiscordAutoPostToggle');

    if (analyticsInput) analyticsInput.value = cfg.analyticsWebhookUrl || '';
    if (payoutsInput) payoutsInput.value = cfg.payoutsWebhookUrl || '';
    if (riptideInput) riptideInput.value = cfg.riptide248UserId || '';
    if (paydaySelect) paydaySelect.value = String(cfg.paydayDay ?? 1);
    if (autoToggle) autoToggle.classList.toggle('active', !!cfg.autoPostEnabled);
  }
  kLoadDiscordFields();

  // Auto-post toggle
  const autoToggle = document.getElementById('kDiscordAutoPostToggle');
  if (autoToggle) {
    autoToggle.addEventListener('click', () => {
      if (typeof kDiscordGetConfig !== 'function') return;
      const current = kDiscordGetConfig();
      const newVal = !current.autoPostEnabled;
      kDiscordSaveConfig({ autoPostEnabled: newVal });
      autoToggle.classList.toggle('active', newVal);
      kShowToast(newVal ? 'Auto-post enabled' : 'Auto-post disabled', 'success', 1500);
    });
  }

  // Save Discord settings
  document.getElementById('kDiscordSaveSettings')?.addEventListener('click', () => {
    if (typeof kDiscordSaveConfig !== 'function') return;
    const analyticsUrl = (document.getElementById('kDiscordAnalyticsUrl')?.value || '').trim();
    const payoutsUrl = (document.getElementById('kDiscordPayoutsUrl')?.value || '').trim();
    const riptideId = (document.getElementById('kDiscordRiptideId')?.value || '').trim();
    const paydayDay = parseInt(document.getElementById('kDiscordPaydayDay')?.value ?? '1', 10);

    const validUrl = url => !url || url.startsWith('https://discord.com/api/webhooks/');
    if (!validUrl(analyticsUrl) || !validUrl(payoutsUrl)) {
      kShowToast('Webhook URLs must start with https://discord.com/api/webhooks/', 'error', 4000);
      return;
    }

    kDiscordSaveConfig({
      analyticsWebhookUrl: analyticsUrl,
      payoutsWebhookUrl: payoutsUrl,
      riptide248UserId: riptideId,
      paydayDay: isNaN(paydayDay) ? 1 : paydayDay
    });
    kShowToast('Discord settings saved', 'success', 2000);
  });

  // Test analytics webhook
  document.getElementById('kDiscordTestAnalytics')?.addEventListener('click', async () => {
    if (typeof kDiscordPost !== 'function') return;
    const cfg = kDiscordGetConfig();
    if (!cfg.analyticsWebhookUrl) {
      kShowToast('Enter an analytics webhook URL first', 'warning', 3000);
      return;
    }
    const ok = await kDiscordPost(cfg.analyticsWebhookUrl, {
      embeds: [{
        title: '✅ Kintsugi Dashboard — Test',
        description: 'Analytics webhook is configured correctly.',
        color: 0x4f46e5,
        timestamp: new Date().toISOString()
      }]
    });
    kShowToast(ok ? 'Test message sent!' : 'Failed — check the webhook URL', ok ? 'success' : 'error', 3000);
  });

  // Test payouts webhook
  document.getElementById('kDiscordTestPayouts')?.addEventListener('click', async () => {
    if (typeof kDiscordPost !== 'function') return;
    const cfg = kDiscordGetConfig();
    if (!cfg.payoutsWebhookUrl) {
      kShowToast('Enter a payouts webhook URL first', 'warning', 3000);
      return;
    }
    const ok = await kDiscordPost(cfg.payoutsWebhookUrl, {
      embeds: [{
        title: '✅ Kintsugi Dashboard — Test',
        description: 'Payouts webhook is configured correctly.',
        color: 0x22c55e,
        timestamp: new Date().toISOString()
      }]
    });
    kShowToast(ok ? 'Test message sent!' : 'Failed — check the webhook URL', ok ? 'success' : 'error', 3000);
  });
}

/**
 * Apply a preference change immediately
 * @param {string} pref - Preference key
 * @param {*} value - New value
 */
function kApplyPreference(pref, value) {
  switch (pref) {
    case 'compactMode':
      document.body.classList.toggle('compact-mode', value);
      break;
      
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
