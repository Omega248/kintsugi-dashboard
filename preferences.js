// =======================================
// Kintsugi User Preferences
// Persistent user settings using localStorage
// =======================================

const PREFS_KEY = 'kintsugi_preferences';

// Default preferences.
// Every key here is the single source of truth for that setting — add new
// settings by adding a default here and a control in settings-ui.js.
const DEFAULT_PREFS = {
  theme: 'dark',

  // Display
  compactMode: false,     // tighter spacing and padding
  showBalance: false,     // running balance column in tables
  showTax: false,         // tax-related columns

  // Accessibility
  highContrast: false,    // body.high-contrast — stronger borders, pure black bg
  largeText: false,       // body.large-text — bumps the whole type scale
  reduceMotion: false,    // body.reduce-motion — in-app override for OS setting

  // Behaviour
  defaultView: 'weekly',  // 'weekly' | 'monthly' | 'jobs'
  itemsPerPage: 50,       // 25 | 50 | 100
  lastVisitedPage: ''
};

// Preferences that simply map to a class on <body>.
// Keeping this as data means adding another one is a one-line change.
const PREF_BODY_CLASSES = {
  compactMode:  'compact-mode',
  highContrast: 'high-contrast',
  largeText:    'large-text',
  reduceMotion: 'reduce-motion'
};

/**
 * Get all user preferences
 * @returns {Object} User preferences
 */
function kGetPreferences() {
  const prefs = kStorageGet(PREFS_KEY, DEFAULT_PREFS);
  // Merge with defaults to ensure all keys exist
  return { ...DEFAULT_PREFS, ...prefs };
}

/**
 * Save user preferences
 * @param {Object} prefs - Preferences to save (partial updates supported)
 * @returns {boolean} Success status
 */
function kSavePreferences(prefs) {
  const current = kGetPreferences();
  const updated = { ...current, ...prefs };
  return kStorageSet(PREFS_KEY, updated);
}

/**
 * Get a specific preference value
 * @param {string} key - Preference key
 * @param {*} [defaultValue] - Default if not found
 * @returns {*} Preference value
 */
function kGetPreference(key, defaultValue) {
  const prefs = kGetPreferences();
  return prefs[key] !== undefined ? prefs[key] : defaultValue;
}

/**
 * Set a specific preference value
 * @param {string} key - Preference key
 * @param {*} value - Value to set
 * @returns {boolean} Success status
 */
function kSetPreference(key, value) {
  return kSavePreferences({ [key]: value });
}

/**
 * Reset preferences to defaults
 * @returns {boolean} Success status
 */
function kResetPreferences() {
  return kStorageSet(PREFS_KEY, DEFAULT_PREFS);
}

/**
 * Clear recent searches
 * @returns {boolean} Success status
 */
function kClearRecentSearches() {
  return kSavePreferences({ recentSearches: [] });
}

/**
 * Track page visit for analytics/shortcuts
 * @param {string} page - Page identifier
 */
function kTrackPageVisit(page) {
  if (!page) return;
  kSetPreference('lastVisitedPage', page);
}

/**
 * One-time migration of the standalone localStorage keys that
 * ui-enhancements.js used to write ('high-contrast', 'large-text',
 * 'compact-mode') into the unified preferences object.
 *
 * Without this, anyone who had those modes switched on would silently
 * lose them. Runs once, then removes the legacy keys.
 */
function kMigrateLegacyPrefs() {
  const legacy = {
    'high-contrast': 'highContrast',
    'large-text':    'largeText',
    'compact-mode':  'compactMode'
  };

  const migrated = {};
  Object.entries(legacy).forEach(([oldKey, newKey]) => {
    if (localStorage.getItem(oldKey) === 'true') migrated[newKey] = true;
    localStorage.removeItem(oldKey);
  });

  if (Object.keys(migrated).length) kSavePreferences(migrated);
}

/**
 * Initialize preferences on page load
 * Applies saved preferences to the current page
 */
function kInitPreferences() {
  kMigrateLegacyPrefs();

  const prefs = kGetPreferences();

  // Apply every body-class preference (compact mode, high contrast, etc.)
  Object.entries(PREF_BODY_CLASSES).forEach(([pref, className]) => {
    document.body.classList.toggle(className, !!prefs[pref]);
  });

  // Apply show balance preference (only if element exists on this page)
  const balanceToggle = document.getElementById('toggleBalance');
  if (balanceToggle) {
    balanceToggle.checked = prefs.showBalance || false;
  }
  
  // Apply show tax preference (only if element exists on this page)
  const taxToggle = document.getElementById('toggleTax');
  if (taxToggle && prefs.showTax) {
    taxToggle.classList.add('active');
  }
  
  // Track this page visit
  kTrackPageVisit(window.location.pathname);
}

// Auto-initialize on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', kInitPreferences);
}
