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
  lastVisitedPage: '',
  favoriteFilters: {},
  recentSearches: []
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
 * Add a search term to recent searches
 * @param {string} term - Search term
 * @param {number} [maxItems=10] - Maximum recent searches to keep
 */
function kAddRecentSearch(term) {
  if (!term || typeof term !== 'string') return;
  
  const prefs = kGetPreferences();
  let recent = prefs.recentSearches || [];
  
  // Remove duplicates and add to front
  recent = recent.filter(t => t !== term);
  recent.unshift(term);
  
  // Keep only last 10
  recent = recent.slice(0, 10);
  
  kSavePreferences({ recentSearches: recent });
}

/**
 * Get recent searches
 * @returns {string[]} Array of recent search terms
 */
function kGetRecentSearches() {
  const prefs = kGetPreferences();
  return prefs.recentSearches || [];
}

/**
 * Clear recent searches
 * @returns {boolean} Success status
 */
function kClearRecentSearches() {
  return kSavePreferences({ recentSearches: [] });
}

/**
 * Save a favorite filter configuration
 * @param {string} name - Filter name
 * @param {Object} filters - Filter configuration
 * @returns {boolean} Success status
 */
function kSaveFavoriteFilter(name, filters) {
  if (!name || !filters) return false;
  
  const prefs = kGetPreferences();
  const favorites = prefs.favoriteFilters || {};
  
  favorites[name] = {
    ...filters,
    savedAt: new Date().toISOString()
  };
  
  return kSavePreferences({ favoriteFilters: favorites });
}

/**
 * Get all favorite filters
 * @returns {Object} Map of filter names to configurations
 */
function kGetFavoriteFilters() {
  const prefs = kGetPreferences();
  return prefs.favoriteFilters || {};
}

/**
 * Delete a favorite filter
 * @param {string} name - Filter name
 * @returns {boolean} Success status
 */
function kDeleteFavoriteFilter(name) {
  const prefs = kGetPreferences();
  const favorites = prefs.favoriteFilters || {};
  
  if (favorites[name]) {
    delete favorites[name];
    return kSavePreferences({ favoriteFilters: favorites });
  }
  
  return false;
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
  
  // Apply show balance preference
  const balanceToggle = document.getElementById('toggleBalance');
  if (balanceToggle && prefs.showBalance) {
    balanceToggle.checked = true;
  }
  
  // Apply show tax preference
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
