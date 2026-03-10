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
      <h3 class="settings-group-title">Discord Integration</h3>
      <p class="settings-item-description" style="margin-bottom:8px;">
        Paste a Discord Incoming Webhook URL to enable one-click posting of analytics
        and weekly payout summaries to your Discord server.
        <a href="https://support.discord.com/hc/en-us/articles/228383668" target="_blank" rel="noopener noreferrer" style="color:var(--accent-secondary);">How to create a webhook ↗</a>
      </p>
      <div class="settings-item" style="flex-direction:column;align-items:flex-start;gap:6px;">
        <label class="settings-item-label" for="kDiscordWebhookUrl">Webhook URL</label>
        <input
          type="url"
          id="kDiscordWebhookUrl"
          class="search-input"
          placeholder="https://discord.com/api/webhooks/..."
          style="width:100%;box-sizing:border-box;"
          autocomplete="off"
          spellcheck="false"
        />
        <div style="display:flex;gap:8px;margin-top:2px;">
          <button class="btn btn-primary" id="kSaveDiscordWebhook">Save</button>
          <button class="btn" id="kTestDiscordWebhook">Test</button>
          <button class="btn" id="kClearDiscordWebhook">Clear</button>
        </div>
        <div id="kDiscordWebhookStatus" style="font-size:10px;color:var(--text-secondary);min-height:14px;"></div>
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
    // Populate Discord webhook URL from storage each time panel opens
    const wInput = document.getElementById('kDiscordWebhookUrl');
    if (wInput && typeof kGetDiscordWebhookUrl === 'function') {
      wInput.value = kGetDiscordWebhookUrl();
    }
    const wStatus = document.getElementById('kDiscordWebhookStatus');
    if (wStatus) wStatus.textContent = '';
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

  // Discord webhook UI refs
  const discordInput = document.getElementById('kDiscordWebhookUrl');
  const discordStatus = document.getElementById('kDiscordWebhookStatus');

  // Discord webhook: save
  document.getElementById('kSaveDiscordWebhook')?.addEventListener('click', () => {
    if (typeof kSetDiscordWebhookUrl !== 'function') return;
    const url = discordInput ? discordInput.value.trim() : '';
    if (url && typeof kValidateDiscordWebhookUrl === 'function' && !kValidateDiscordWebhookUrl(url)) {
      if (discordStatus) discordStatus.textContent = '⚠️ URL must be a valid discord.com/api/webhooks/… address.';
      kShowToast('Invalid webhook URL', 'error', 3000);
      return;
    }
    kSetDiscordWebhookUrl(url);
    if (discordStatus) discordStatus.textContent = url ? '✅ Webhook URL saved.' : '🗑️ Webhook URL cleared.';
    kShowToast(url ? 'Discord webhook URL saved' : 'Discord webhook URL cleared', 'success', 2000);
  });

  // Discord webhook: test
  document.getElementById('kTestDiscordWebhook')?.addEventListener('click', async () => {
    if (typeof kSendDiscordWebhook !== 'function') return;
    const inputUrl = discordInput ? discordInput.value.trim() : '';
    const savedUrl = typeof kGetDiscordWebhookUrl === 'function' ? kGetDiscordWebhookUrl() : '';
    if (!savedUrl) {
      if (discordStatus) discordStatus.textContent = '⚠️ Save a webhook URL first, then test.';
      kShowToast('No webhook URL saved yet. Enter and save a URL first.', 'error', 3000);
      return;
    }
    if (inputUrl && inputUrl !== savedUrl) {
      if (discordStatus) discordStatus.textContent = '⚠️ Unsaved changes. Save the URL before testing.';
      kShowToast('Save the URL before testing.', 'error', 3000);
      return;
    }
    if (discordStatus) discordStatus.textContent = '⏳ Sending test message…';
    const ok = await kSendDiscordWebhook({
      embeds: [{
        title: '✅ Kintsugi Motorworks — Webhook test',
        description: 'Your Discord webhook is connected and working!',
        color: 0x22c55e,
        footer: { text: 'Kintsugi Dashboard' },
        timestamp: new Date().toISOString(),
      }],
    });
    if (discordStatus) discordStatus.textContent = ok ? '✅ Test message sent!' : '❌ Test failed — check the URL and try again.';
  });

  // Discord webhook: clear
  document.getElementById('kClearDiscordWebhook')?.addEventListener('click', () => {
    if (typeof kSetDiscordWebhookUrl === 'function') kSetDiscordWebhookUrl('');
    if (discordInput) discordInput.value = '';
    if (discordStatus) discordStatus.textContent = '🗑️ Webhook URL cleared.';
    kShowToast('Discord webhook URL cleared', 'success', 2000);
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
