// =======================================
// Kintsugi Core Helpers
// Shared utilities for Dashboard / Payouts / Mechanics / Bank
// =======================================

// Default sheet ID (can be overridden per page if needed)
const KINTSUGI_SHEET_ID = "1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks";

// Cache for parsed CSV data to avoid redundant fetches
const kCsvCache = new Map();
const kCacheTimeout = 5 * 60 * 1000; // 5 minutes

// ----- SHEETS / CSV -----

/**
 * Build a Google Sheets CSV URL for a given sheet/tab.
 * If sheetIdOverride is provided, use that instead of the default.
 */
function kSheetCsvUrl(sheetName, sheetIdOverride) {
  const id = sheetIdOverride || KINTSUGI_SHEET_ID;
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheetName
  )}`;
}

/**
 * Minimal CSV parser (no external dependencies).
 * Handles quoted fields, escaped quotes, and newlines.
 * @param {string} text - CSV text
 * @returns {string[][]} - Array of rows, each row is an array of string values
 */
function kParseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cur);
    cur = "";
  };

  const pushRow = () => {
    if (row.length || cur) {
      pushCell();
      rows.push(row);
      row = [];
    }
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") pushCell();
      else if (c === "\r") continue;
      else if (c === "\n") pushRow();
      else cur += c;
    }
  }

  if (cur || row.length) pushRow();
  return rows;
}

/**
 * Fetch CSV from a sheet and parse it.
 * @param {string} sheetName - Name of the sheet/tab to fetch
 * @param {object} options - Configuration options
 * @param {string} [options.sheetId] - Override default sheet ID
 * @param {boolean} [options.usePapa=false] - Use PapaParse if available
 * @param {boolean} [options.header=false] - Return objects with headers
 * @param {boolean} [options.cache=true] - Enable caching
 * @returns {Promise<Array|Object>} Parsed CSV data
 * 
 * Returns:
 *   if header === false -> string[][]
 *   if header === true  -> { fields: string[], data: object[] }
 */
async function kFetchCSV(sheetName, options = {}) {
  const { sheetId, usePapa = false, header = false, cache = true } = options;
  const url = kSheetCsvUrl(sheetName, sheetId);
  
  // Check cache first
  if (cache && kCsvCache.has(url)) {
    const cached = kCsvCache.get(url);
    if (Date.now() - cached.timestamp < kCacheTimeout) {
      return kDeepClone(cached.data);
    }
    kCsvCache.delete(url);
  }

  try {
    const res = await fetch(url);
    
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Sheet "${sheetName}" not found. Please check the sheet name.`);
      } else if (res.status === 403) {
        throw new Error(`Access denied to sheet "${sheetName}". Please check sharing settings.`);
      } else {
        throw new Error(`HTTP ${res.status} error while fetching sheet "${sheetName}"`);
      }
    }

    const text = await res.text();
    
    if (!text.trim()) {
      throw new Error(`Sheet "${sheetName}" is empty.`);
    }
    
    if (text.trim().startsWith("<")) {
      throw new Error(
        `Sheet "${sheetName}" returned HTML — check tab name & sharing settings.`
      );
    }

    // Use PapaParse if available and requested
    if (usePapa && typeof Papa !== 'undefined') {
      const parsed = await new Promise((resolve, reject) => {
        Papa.parse(text, {
          header,
          skipEmptyLines: "greedy",
          dynamicTyping: false,
          complete: (parsed) => {
            if (parsed.errors && parsed.errors.length) {
              console.warn(`PapaParse errors for "${sheetName}"`, parsed.errors);
            }

            if (header) {
              const data = parsed.data || [];
              const fields =
                (parsed.meta && parsed.meta.fields) ||
                (data[0] ? Object.keys(data[0]) : []);
              resolve({ fields, data });
            } else {
              resolve(parsed.data || []);
            }
          },
          error: reject,
        });
      });
      
      // Cache the result
      if (cache) {
        kCsvCache.set(url, { data: parsed, timestamp: Date.now() });
      }
      
      return parsed;
    }

    // Use built-in parser
    const rows = kParseCSV(text);
    
    let result;
    if (!header) {
      result = rows;
    } else {
      // Convert to objects with headers
      if (rows.length === 0) {
        result = { fields: [], data: [] };
      } else {
        const fields = rows[0].map(h => h.trim());
        const data = [];
        
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const obj = {};
          fields.forEach((field, idx) => {
            obj[field] = row[idx] || "";
          });
          data.push(obj);
        }
        
        result = { fields, data };
      }
    }
    
    // Cache the result
    if (cache) {
      kCsvCache.set(url, { data: result, timestamp: Date.now() });
    }
    
    return result;
    
  } catch (error) {
    console.error(`Error fetching CSV from "${sheetName}":`, error);
    throw error;
  }
}

/**
 * Legacy alias for backwards compatibility with PapaParse usage
 */
const kFetchCsvPapa = kFetchCSV;

// ----- DATES & MONEY -----

/**
 * Robust date parser for sheet strings.
 * Supports:
 *  - dd/mm/yyyy
 *  - dd-mm-yyyy
 *  - yyyy-mm-dd
 *  - falls back to new Date(s) but returns null on invalid
 */
function kParseDateLike(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // dd/mm/yyyy or dd-mm-yyyy
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d.getTime()) ? null : d;
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const yyyy = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a Date as MM/DD/YYYY (US style).
 */
function kFmtDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Format a number as money with no decimals.
 */
function kFmtMoney(n, prefix = "$") {
  const val = Number(n || 0);
  if (!isFinite(val)) return `${prefix}0`;
  return (
    prefix +
    val.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    })
  );
}

// ----- URL + NAV HELPERS -----

/**
 * Get current URLSearchParams as a plain object.
 */
function kGetUrlParams() {
  const url = new URL(window.location.href);
  const out = {};
  url.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * Merge partial params into current URL and replace state.
 * Example:
 *   kUpdateUrlParams({ mech: "Bob", week: "all" })
 */
function kUpdateUrlParams(partial) {
  const url = new URL(window.location.href);
  const p = url.searchParams;

  Object.keys(partial || {}).forEach((key) => {
    const val = partial[key];
    if (
      val === undefined ||
      val === null ||
      val === "" ||
      val === "all" ||
      val === "0"
    ) {
      p.delete(key);
    } else {
      p.set(key, String(val));
    }
  });

  const newUrl =
    url.pathname + (p.toString() ? "?" + p.toString() : "") + url.hash;
  window.history.replaceState({}, "", newUrl);
}

/**
 * Sync nav tab links so they carry the current querystring.
 * (Use this on any page that has .nav-tabs a)
 */
function kSyncNavLinksWithCurrentSearch() {
  const qs = window.location.search || "";
  const links = document.querySelectorAll(".nav-tabs a");
  links.forEach((a) => {
    if (!a) return;
    const current = a.getAttribute("href") || "";
    let base = a.getAttribute("data-base-href");
    if (!base) {
      base = current.split("?")[0];
      a.setAttribute("data-base-href", base);
    }
    a.setAttribute("href", base + qs);
  });
}

/**
 * Convenience: run nav sync once on DOMContentLoaded.
 */
function kInitNavSyncOnLoad() {
  document.addEventListener("DOMContentLoaded", () => {
    try {
      kSyncNavLinksWithCurrentSearch();
    } catch (e) {
      console.warn("kInitNavSyncOnLoad failed:", e);
    }
  });
}

// ----- DOM HELPERS -----

/**
 * Set text content of an element by ID.
 * @param {string} id - Element ID
 * @param {string|number} value - Text content to set
 */
function kSetText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * Set HTML content of an element by ID (use with caution).
 * @param {string} id - Element ID
 * @param {string} html - HTML content to set
 */
function kSetHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/**
 * Show loading state for an element.
 * @param {string|HTMLElement} target - Element ID or element
 * @param {string} [message='Loading...'] - Loading message
 */
function kShowLoading(target, message = 'Loading...') {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  
  const loader = document.createElement('div');
  loader.className = 'k-loader';
  loader.innerHTML = `
    <div class="k-loader-spinner"></div>
    <div class="k-loader-text">${message}</div>
  `;
  
  el.style.position = 'relative';
  el.style.minHeight = '100px';
  el.appendChild(loader);
}

/**
 * Hide loading state for an element.
 * @param {string|HTMLElement} target - Element ID or element
 */
function kHideLoading(target) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  
  const loaders = el.querySelectorAll('.k-loader');
  loaders.forEach(loader => loader.remove());
}

/**
 * Show error state for an element.
 * @param {string|HTMLElement} target - Element ID or element
 * @param {string} message - Error message
 * @param {Function} [onRetry] - Optional retry callback
 */
function kShowError(target, message, onRetry) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  
  const error = document.createElement('div');
  error.className = 'k-error';
  error.innerHTML = `
    <div class="k-error-icon">⚠️</div>
    <div class="k-error-message">${message}</div>
    ${onRetry ? '<button class="k-error-retry btn">Try Again</button>' : ''}
  `;
  
  if (onRetry) {
    const retryBtn = error.querySelector('.k-error-retry');
    retryBtn.addEventListener('click', onRetry);
  }
  
  el.style.position = 'relative';
  el.style.minHeight = '100px';
  el.appendChild(error);
}

/**
 * Show empty state for an element.
 * @param {string|HTMLElement} target - Element ID or element
 * @param {string} message - Empty state message
 * @param {string} [icon='📭'] - Icon to display
 */
function kShowEmpty(target, message, icon = '📭') {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  
  const empty = document.createElement('div');
  empty.className = 'k-empty';
  empty.innerHTML = `
    <div class="k-empty-icon">${icon}</div>
    <div class="k-empty-message">${message}</div>
  `;
  
  el.style.position = 'relative';
  el.style.minHeight = '100px';
  el.appendChild(empty);
}

/**
 * Get element by ID safely.
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
function kGetEl(id) {
  return document.getElementById(id);
}

/**
 * Add class to element.
 */
function kAddClass(el, className) {
  if (el && el.classList) el.classList.add(className);
}

/**
 * Remove class from element.
 */
function kRemoveClass(el, className) {
  if (el && el.classList) el.classList.remove(className);
}

/**
 * Toggle class on element.
 */
function kToggleClass(el, className) {
  if (el && el.classList) el.classList.toggle(className);
}

/**
 * Check if element has class.
 */
function kHasClass(el, className) {
  return el && el.classList && el.classList.contains(className);
}

// ----- EXPORT CSV HELPERS -----

/**
 * Convert data to CSV format.
 * @param {string[]} cols - Column names
 * @param {object[]} rows - Array of objects
 * @returns {string} - CSV text
 */
function kToCsv(cols, rows) {
  const esc = (val) => {
    if (val == null) return "";
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const lines = rows.map((r) => cols.map((c) => esc(r[c])).join(","));
  return [head, ...lines].join("\n");
}

/**
 * Download CSV file to user's computer.
 * @param {string} filename - File name
 * @param {string} csv - CSV text content
 */
function kDownloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
