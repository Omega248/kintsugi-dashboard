// =======================================
// Kintsugi User Preferences
// Persistent user settings using localStorage
// =======================================

const PREFS_KEY = 'kintsugi_preferences';

// Default preferences
const DEFAULT_PREFS = {
  theme: 'dark',
  compactMode: false,
  showBalance: false,
  showTax: false,
  defaultView: 'weekly',
  itemsPerPage: 50,
  lastVisitedPage: ''
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
 * Initialize preferences on page load
 * Applies saved preferences to the current page
 */
function kInitPreferences() {
  const prefs = kGetPreferences();
  
  // Apply compact mode if enabled
  if (prefs.compactMode) {
    document.body.classList.add('compact-mode');
  }
  
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
