// =======================================
// Kintsugi Constants
// Centralized configuration and magic numbers
// =======================================

// ===== Google Sheets Configuration =====
// Note: KINTSUGI_SHEET_ID is defined in kintsugi-core.js
// This object extends that configuration with additional sheet names
const KINTSUGI_CONFIG = {
  // Sheet names
  SHEETS: {
    JOBS: "Form responses 1",
    CONFIG: "Config",
    MANUAL: "Manual",
    STATE_IDS: "State ID's",
    BANK: "bank_transactions_64952453_1761436800_1762732799_1762792939175"
  }
};

// ===== Payment Rates =====
const PAYMENT_RATES = {
  // Mechanic payments
  PAY_PER_REPAIR: 700,
  
  // Customer billing
  REPAIR_RATE: 2500,
  ENGINE_REPLACEMENT_RATE: 15000,
  ENGINE_REPLACEMENT_RATE_BCSO: 12500,
  
  // Engine reimbursement and bonuses
  ENGINE_REIMBURSEMENT: 12000,
  ENGINE_BONUS_LSPD: 1500,
  
  // Harness and Advanced Repair Kit mechanic pay
  HARNESS_RATE: 500,
  ADVANCED_REPAIR_KIT_RATE: 500,

  // Customer billing rates for harness and advanced repair kit
  HARNESS_BILLING_RATE: 5000,
  ADVANCED_REPAIR_KIT_BILLING_RATE: 2500,

  // BET and bins
  BET_RATE: 230,
  BINS_PER_15: 10
};


// ===== Department Configuration =====
const DEPARTMENT_CONFIG = {
  CIV:  { color: 0x808080, engineBonus: 0, emoji: "🚗", billingEngineRate: PAYMENT_RATES.ENGINE_REPLACEMENT_RATE_BCSO },
  EMS:  { color: 0xFF1493, engineBonus: 0, emoji: "🏥", billingEngineRate: PAYMENT_RATES.ENGINE_REPLACEMENT_RATE_BCSO },
  LSPD: { color: 0x000000, engineBonus: PAYMENT_RATES.ENGINE_BONUS_LSPD, emoji: "⚫", billingEngineRate: PAYMENT_RATES.ENGINE_REPLACEMENT_RATE },
  BCSO: { color: 0xD2B48C, engineBonus: 0, emoji: "🟤", billingEngineRate: PAYMENT_RATES.ENGINE_REPLACEMENT_RATE_BCSO },
  ODPD: { color: 0x00FFFF, engineBonus: PAYMENT_RATES.ENGINE_BONUS_LSPD, emoji: "🔷", billingEngineRate: PAYMENT_RATES.ENGINE_REPLACEMENT_RATE },
  SASM: { color: 0xFF6B35, engineBonus: PAYMENT_RATES.ENGINE_BONUS_LSPD, emoji: "🟠", billingEngineRate: PAYMENT_RATES.ENGINE_REPLACEMENT_RATE }
};

const DEFAULT_DEPARTMENTS = ["CIV", "EMS", "LSPD", "BCSO", "ODPD", "SASM"];

function normaliseDepartment(dept) {
  return String(dept || "").trim().toUpperCase();
}

function getDepartmentConfig(dept) {
  return DEPARTMENT_CONFIG[normaliseDepartment(dept)] || {
    color: 0x22c55e,
    engineBonus: 0,
    emoji: "🏢",
    billingEngineRate: PAYMENT_RATES.ENGINE_REPLACEMENT_RATE_BCSO
  };
}

// ===== UI Constants =====
const UI_CONSTANTS = {
  // Pagination
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  
  // Search debounce
  SEARCH_DEBOUNCE_MS: 300,
  
  // Animation durations
  ANIMATION_FAST: 150,
  ANIMATION_BASE: 180,
  ANIMATION_SLOW: 300,
  
  // Breakpoints
  BREAKPOINT_MOBILE: 768,
  BREAKPOINT_TABLET: 1024,
  BREAKPOINT_DESKTOP: 1440
};

// ===== Date Formats =====
const DATE_FORMATS = {
  US: "MM/DD/YYYY",
  UK: "DD/MM/YYYY",
  ISO: "YYYY-MM-DD",
  SHORT: "MM/DD/YY",
  LONG: "MMMM DD, YYYY"
};

// ===== Error Messages =====
const ERROR_MESSAGES = {
  NETWORK_ERROR: "Unable to connect. Please check your internet connection.",
  SHEET_NOT_FOUND: "Sheet not found. Please check the sheet name and sharing settings.",
  INVALID_DATA: "The data format is invalid. Please check the sheet structure.",
  NO_DATA: "No data available to display.",
  PARSE_ERROR: "Unable to parse the data. Please check the format.",
  PERMISSION_DENIED: "You don't have permission to access this sheet.",
  GENERIC_ERROR: "Something went wrong. Please try again."
};

// ===== Status Messages =====
const STATUS_MESSAGES = {
  LOADING: "Loading...",
  PROCESSING: "Processing data...",
  SAVING: "Saving...",
  SUCCESS: "Success!",
  NO_RESULTS: "No results found.",
  EMPTY_STATE: "No data to display."
};

// ===== Validation Rules =====
const VALIDATION = {
  MIN_SEARCH_LENGTH: 2,
  MAX_SEARCH_LENGTH: 100,
  MIN_AMOUNT: 0,
  MAX_AMOUNT: 1000000,
  VALID_DIRECTIONS: ["in", "out"],
  VALID_VIEWS: ["weekly", "monthly", "jobs"]
};

// ===== Export Configuration =====
const EXPORT_CONFIG = {
  DEFAULT_FILENAME: "kintsugi-export",
  CSV_ENCODING: "utf-8",
  CSV_SEPARATOR: ",",
  CSV_LINE_BREAK: "\n"
};

