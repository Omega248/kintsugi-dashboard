// =======================================
// Kintsugi Core Helpers
// Shared utilities for Dashboard / Payouts / Mechanics / Bank
// =======================================

// Default sheet ID (can be overridden per page if needed)
const KINTSUGI_SHEET_ID = "1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks";

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
 * @param {string} sheetName
 * @param {object} options
 *   - sheetId: override SHEET_ID if needed
 *   - usePapa: use PapaParse if available (default: false)
 *   - header: return array of objects (true) or array-of-arrays (false) - default: false
 *
 * Returns:
 *   if header === false -> string[][]
 *   if header === true  -> { fields: string[], data: object[] }
 */
async function kFetchCSV(sheetName, options = {}) {
  const { sheetId, usePapa = false, header = false } = options;
  const url = kSheetCsvUrl(sheetName, sheetId);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for sheet "${sheetName}"`);

  const text = await res.text();
  if (!text.trim() || text.trim().startsWith("<")) {
    throw new Error(
      `Sheet "${sheetName}" returned HTML/empty — check tab name & sharing.`
    );
  }

  // Use PapaParse if available and requested
  if (usePapa && typeof Papa !== 'undefined') {
    return new Promise((resolve, reject) => {
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
  }

  // Use built-in parser
  const rows = kParseCSV(text);
  
  if (!header) {
    return rows;
  }

  // Convert to objects with headers
  if (rows.length === 0) return { fields: [], data: [] };
  
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
  
  return { fields, data };
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
