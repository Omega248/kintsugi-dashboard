// ================== CONFIG ==================

// Google Sheet
const SHEET_ID =
  "1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks";

// Bank data tab (existing)
const BANK_SHEET =
  "bank_transactions_64952453_1761436800_1762732799_1762792939175";

// Manual/global values tab inside SAME spreadsheet
// Structure: columns Key | Value (see description above)
const MANUAL_SHEET = "Manual";

// Defaults (can be overridden by Manual sheet)
let BET_RATE = 300;
let BINS_PER_15 = 10;
let MANUAL_BET_LEFT = 0;
let MANUAL_RED_BINS = 0;

// ================== DOM REFS ==================

const fileInput = document.getElementById("fileInput");
const filterBtns = document.querySelectorAll(".btn[data-filter]");
const qfilterBtns = document.querySelectorAll(".btn[data-qfilter]");
const clearQuickBtn = document.getElementById("clearQuick");
const searchInput = document.getElementById("searchInput");
const toggleBalance = document.getElementById("toggleBalance");
const toggleTaxBtn = document.getElementById("toggleTax");

const tableHead = document.querySelector("#table thead");
const tableBody = document.querySelector("#table tbody");

const totalInEl = document.getElementById("totalIn");
const totalOutEl = document.getElementById("totalOut");
const netEl = document.getElementById("netTotal");
const countInEl = document.getElementById("countIn");
const countOutEl = document.getElementById("countOut");

const betTotalEl = document.getElementById("betTotal");
const betNoteEl = document.getElementById("betNote");
const binsTotalEl = document.getElementById("binsTotal");
const binsNoteEl = document.getElementById("binsNote");

const statusEl = document.getElementById("status");
const configToggle = document.getElementById("configToggle");
const configPanel = document.getElementById("configPanel");
const cfgBetRate = document.getElementById("cfgBetRate");
const cfgBinsPer15 = document.getElementById("cfgBinsPer15");
const cfgManualBetLeft = document.getElementById("cfgManualBetLeft");
const cfgManualRedBins = document.getElementById("cfgManualRedBins");
const applyConfigBtn = document.getElementById("applyConfig");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const detailsPanel = document.getElementById("detailsPanel");

// ================== STATE ==================

let allRows = [];
let headers = [];
let columnOrder = [];
let currentFilter = "all";
let quickFilter = null;
let showBalance = false;
let showTax = false;

// metrics
let totalBET = 0;
let betPurchasedBET = 0;
let betPurchasedValue = 0;
let betReimbBET = 0;
let grantTotalIn = 0;
let grantSpentAfter = 0;
let grantRemaining = 0;
let earliestGrantDate = null;
let binsFromBET = 0;
let flagReasonsCount = {};

// drag/resize
let dragSrcKey = null;
let isResizing = false;
let resizeInfo = null;

// ================== CSV HELPERS ==================

function sheetCsvUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheetName
  )}`;
}

function rawParseCSV(text) {
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

  if (cur || row.length) {
    pushCell();
    rows.push(row);
  }

  return rows;
}

function parseCSVToObjects(text) {
  const rows = rawParseCSV(text);
  if (!rows.length) return { fields: [], data: [] };
  const fields = rows[0].map((h) => h.trim());
  const data = rows.slice(1).map((r) => {
    const obj = {};
    fields.forEach((h, i) => {
      obj[h] = r[i] ?? "";
    });
    return obj;
  });
  return { fields, data };
}

// ================== MANUAL VALUES FROM SHEET ==================

async function loadManualFromSheet() {
  try {
    const res = await fetch(sheetCsvUrl(MANUAL_SHEET));
    if (!res.ok) {
      // If sheet doesn't exist or not shared, just use defaults silently.
      console.warn("Manual sheet not reachable, using defaults");
      return;
    }
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<")) {
      console.warn("Manual sheet returned HTML/empty, using defaults");
      return;
    }

    const { fields, data } = parseCSVToObjects(text);
    if (!fields.length || !data.length) return;

    const keyCol =
      fields.find((h) => h.toLowerCase() === "key") || fields[0];
    const valCol =
      fields.find((h) => h.toLowerCase() === "value") || fields[1];

    data.forEach((row) => {
      const rawKey = (row[keyCol] || "").toString().trim();
      const key = rawKey.toUpperCase();
      const rawVal = (row[valCol] || "").toString().trim();
      const num = rawVal === "" ? NaN : Number(rawVal);

      if (key === "BET_RATE" && !isNaN(num) && num > 0) BET_RATE = num;
      if (key === "BINS_PER_15" && !isNaN(num) && num > 0)
        BINS_PER_15 = num;
      if (key === "MANUAL_BET_LEFT" && !isNaN(num) && num >= 0)
        MANUAL_BET_LEFT = num;
      if (key === "MANUAL_RED_BINS" && !isNaN(num) && num >= 0)
        MANUAL_RED_BINS = num;
    });
  } catch (err) {
    console.warn("Failed to load manual values, using defaults:", err);
  }

  // Reflect loaded values into config UI (if present)
  if (cfgBetRate) cfgBetRate.value = BET_RATE;
  if (cfgBinsPer15) cfgBinsPer15.value = BINS_PER_15;
  if (cfgManualBetLeft) cfgManualBetLeft.value = MANUAL_BET_LEFT;
  if (cfgManualRedBins) cfgManualRedBins.value = MANUAL_RED_BINS;
}

// ================== LOAD BANK FROM SHEET ==================

async function loadBankFromSheet() {
  try {
    statusEl.textContent = "Loading from bank sheet...";
    const res = await fetch(sheetCsvUrl(BANK_SHEET));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<")) {
      throw new Error(
        "Bank sheet returned HTML/empty. Check tab name & sharing."
      );
    }

    const parsed = parseCSVToObjects(text);
    headers = parsed.fields || [];
    allRows = dedupeById(parsed.data || []);
    columnOrder = [...headers];

    computeDerived();
    render();

    statusEl.textContent = `Loaded ${allRows.length} rows from "${BANK_SHEET}"`;
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Could not load from sheet. Upload CSV or check bank sheet & sharing.";
  }
}

// ================== OPTIONAL FILE OVERRIDE (DEV ONLY) ==================

if (fileInput) {
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    statusEl.textContent = "Parsing CSV (local file)...";
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result || "";
        const parsed = parseCSVToObjects(text);
        headers = parsed.fields || [];
        allRows = dedupeById(parsed.data || []);
        columnOrder = [...headers];
        computeDerived();
        render();
        statusEl.textContent = `Loaded ${allRows.length} unique rows from ${file.name}`;
      } catch (err) {
        console.error(err);
        statusEl.textContent = "Error parsing CSV: " + err.message;
      }
    };
    reader.onerror = () => {
      statusEl.textContent = "Error reading file.";
    };
    reader.readAsText(file);
  });
}

// ================== FILTERS / TOGGLES ==================

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    render();
  });
});

qfilterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = btn.dataset.qfilter;
    if (quickFilter === val) {
      quickFilter = null;
      btn.classList.remove("active");
    } else {
      quickFilter = val;
      qfilterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    }
    render();
  });
});

if (clearQuickBtn) {
  clearQuickBtn.addEventListener("click", () => {
    quickFilter = null;
    qfilterBtns.forEach((b) => b.classList.remove("active"));
    render();
  });
}

if (searchInput) {
  searchInput.addEventListener("input", () => render());
}

if (toggleBalance) {
  toggleBalance.addEventListener("change", () => {
    showBalance = toggleBalance.checked;
    render();
  });
}

if (toggleTaxBtn) {
  toggleTaxBtn.addEventListener("click", () => {
    showTax = !showTax;
    toggleTaxBtn.classList.toggle("active", showTax);
    toggleTaxBtn.textContent = showTax ? "Hide Tax" : "Show Tax";
    render();
  });
}

// ================== CONFIG PANEL (LOCAL ONLY) ==================

if (configToggle && configPanel) {
  configToggle.addEventListener("click", () => {
    const open = configPanel.style.display === "flex";
    configPanel.style.display = open ? "none" : "flex";
  });
}

if (applyConfigBtn) {
  applyConfigBtn.addEventListener("click", () => {
    const br = parseFloat(cfgBetRate?.value);
    const bp15 = parseFloat(cfgBinsPer15?.value);
    const manualBet = parseFloat(cfgManualBetLeft?.value);
    const manualBins = parseFloat(cfgManualRedBins?.value);

    if (!isNaN(br) && br > 0) BET_RATE = br;
    if (!isNaN(bp15) && bp15 > 0) BINS_PER_15 = bp15;
    if (!isNaN(manualBet) && manualBet >= 0) MANUAL_BET_LEFT = manualBet;
    if (!isNaN(manualBins) && manualBins >= 0) MANUAL_RED_BINS = manualBins;

    computeDerived();
    render();

    statusEl.textContent =
      "Overrides applied in this session. To persist, update the 'Manual' sheet.";
  });
}

// ================== CORE LOGIC ==================

function dedupeById(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const id = (r.id || r.ID || "").toString().trim();
    if (!id || !seen.has(id)) {
      if (id) seen.add(id);
      out.push(r);
    }
  }
  return out;
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function computeDerived() {
  totalBET = 0;
  betPurchasedBET = 0;
  betPurchasedValue = 0;
  betReimbBET = 0;
  grantTotalIn = 0;
  grantSpentAfter = 0;
  grantRemaining = 0;
  earliestGrantDate = null;
  binsFromBET = 0;
  flagReasonsCount = {};

  allRows.forEach((r) => {
    r._dateObj = parseDate(r.date || r.Date || r.DateTime);
  });

  allRows.forEach((r) => {
    const commentRaw = r.comment || r.Comment || r.Description || "";
    const comment = commentRaw.toString().toLowerCase();
    const dir = (r.direction || r.Direction || "").toLowerCase();
    const amt = parseFloat(r.amount || r["Amount ($)"] || r.Amount || 0);

    // BET detection
    let bet = null;
    if (dir === "out" && comment.includes("bet")) {
      const m = comment.match(/(\d+(?:\.\d+)?)\s*bet/);
      if (m) {
        bet = parseFloat(m[1]);
      } else if (!isNaN(amt) && amt > 0 && BET_RATE > 0) {
        bet = Math.round(amt / BET_RATE);
      }
    }
    r._bet = bet && bet > 0 ? Math.round(bet) : null;

    // Category
    r._category = classifyBase(r, comment, dir);

    // Grant tracking
    if (r._category === "Grant" && dir === "in" && !isNaN(amt) && amt > 0) {
      grantTotalIn += amt;
      if (
        r._dateObj &&
        (!earliestGrantDate || r._dateObj < earliestGrantDate)
      ) {
        earliestGrantDate = r._dateObj;
      }
    }

    // BET purchase / reimbursement
    if (r._bet && dir === "out" && r._category === "BET Purchase") {
      betPurchasedBET += r._bet;
      if (!isNaN(amt) && amt > 0) betPurchasedValue += amt;
    }
    if (r._bet && r._category === "BET Reimbursement") {
      betReimbBET += r._bet;
    }

    computeFlagsBase(r, comment, dir, amt);
  });

  totalBET = betPurchasedBET;

  // Grant spending
  if (earliestGrantDate && grantTotalIn > 0) {
    allRows.forEach((r) => {
      const dir = (r.direction || "").toLowerCase();
      const amt = parseFloat(r.amount || r["Amount ($)"] || 0);
      if (
        dir === "out" &&
        r._dateObj &&
        r._dateObj >= earliestGrantDate &&
        !isNaN(amt)
      ) {
        grantSpentAfter += amt;
      }
    });
    grantRemaining = grantTotalIn - grantSpentAfter;
  }

  // BET & bins summary
  const netBETUsed = Math.max(betPurchasedBET - betReimbBET, 0);
  const betPerBin = 15 / BINS_PER_15;
  binsFromBET = betPerBin > 0 ? Math.floor(netBETUsed / betPerBin) : 0;

  betTotalEl.textContent = intFmt(totalBET) + " BET";

  const betBits = [];
  if (totalBET > 0) {
    betBits.push(
      `Purchased ${intFmt(betPurchasedBET)}`,
      `Reimbursed ${intFmt(betReimbBET)}`,
      `Net est ${intFmt(netBETUsed)}`
    );
  }
  if (MANUAL_BET_LEFT > 0) {
    betBits.push(`Manual BET left: ${intFmt(MANUAL_BET_LEFT)}`);
  }
  betNoteEl.textContent = betBits.join(" • ");

  binsTotalEl.textContent = intFmt(binsFromBET) + " bins";
  const binBits = [`${BINS_PER_15} bins = 15 BET`];
  if (MANUAL_RED_BINS > 0) {
    binBits.push(`Manual red bins left: ${intFmt(MANUAL_RED_BINS)}`);
  }
  binsNoteEl.textContent = binBits.join(" • ");

  computeRunningBalance();
  summarizeFlags();
  addComputedColumns(["BET (est)", "Category", "Flag", "Balance"]);
}

function classifyBase(r, c, dir) {
  const lowerType = (r.type || r.Type || "").toLowerCase();
  const fromId = (
    r.from_account_id ||
    r.From_Account_ID ||
    ""
  )
    .toString()
    .trim()
    .toLowerCase();

  const hasAcross = c.includes("across");
  const hasRepairOrAcross =
    c.includes("repair") || c.includes("service") || hasAcross;

  if (r._bet && (c.includes("refund") || c.includes("reimburse"))) {
    return "BET Reimbursement";
  }
  if (r._bet) return "BET Purchase";
  if (c.includes("tax") || lowerType.includes("tax")) return "Tax";
  if (dir === "in" && fromId === "10") return "Grant";
  if (c.includes("grant") || c.includes("charles danger")) return "Grant";
  if (dir === "in" && hasRepairOrAcross) return "Repair Income";
  return "Other";
}

function computeFlagsBase(r, c, dir, amt) {
  r._flagReasons = [];

  if (c.includes("bet") && !r._bet && dir === "out") {
    addFlagReason(
      r,
      "bet_unparsed",
      "Comment mentions BET but quantity/price could not be parsed. Confirm BET count and pricing."
    );
  }

  if (r._bet && !isNaN(amt) && amt > 0 && BET_RATE > 0) {
    const eff = amt / r._bet;
    const minRate = BET_RATE * 0.9;
    const maxRate = BET_RATE * 1.1;
    if (eff < minRate || eff > maxRate) {
      addFlagReason(
        r,
        "bet_price_out_of_band",
        `Effective BET price ${eff.toFixed(
          2
        )} is outside expected band vs BET rate ${BET_RATE}.`
      );
    }
  }

  if (!isNaN(amt) && amt < 0) {
    addFlagReason(
      r,
      "negative_amount",
      "Transaction has a negative amount. Verify if this is a reversal or data error."
    );
  }
}

function addFlagReason(row, key, msg) {
  if (!row._flagReasons) row._flagReasons = [];
  row._flagReasons.push(msg);
  if (!flagReasonsCount[key]) flagReasonsCount[key] = 0;
  flagReasonsCount[key] += 1;
}

function summarizeFlags() {
  allRows.forEach((r) => {
    r._flag = !!(r._flagReasons && r._flagReasons.length);
  });
}

function computeRunningBalance() {
  let start = grantTotalIn || 0;
  const sorted = [...allRows].sort((a, b) => {
    const da = a._dateObj ? a._dateObj.getTime() : 0;
    const db = b._dateObj ? b._dateObj.getTime() : 0;
    return da - db;
  });

  let bal = start;
  sorted.forEach((r) => {
    const dir = (r.direction || "").toLowerCase();
    const amt = parseFloat(r.amount || r["Amount ($)"] || 0);
    if (!isNaN(amt)) {
      if (dir === "in") bal += amt;
      if (dir === "out") bal -= amt;
    }
    r._balance = bal;
  });
}

function addComputedColumns(cols) {
  cols.forEach((c) => {
    if (!headers.includes(c)) headers.push(c);
    if (!columnOrder.includes(c)) columnOrder.push(c);
  });
}

// ================== RENDERING ==================

function render() {
  if (!allRows.length) return;
  const rows = getFilteredRows();

  const totalIn = sumByDirection(rows, "in");
  const totalOut = sumByDirection(rows, "out");
  const net = totalIn - totalOut;

  const countIn = rows.filter(
    (r) => (r.direction || "").toLowerCase() === "in"
  ).length;
  const countOut = rows.filter(
    (r) => (r.direction || "").toLowerCase() === "out"
  ).length;

  totalInEl.textContent = money(totalIn);
  totalOutEl.textContent = money(totalOut);
  netEl.textContent = money(net);
  countInEl.textContent = `${countIn} in transactions`;
  countOutEl.textContent = `${countOut} out transactions`;

  drawTable(rows);
}

function getFilteredRows() {
  let rows = [...allRows];

  if (currentFilter !== "all") {
    rows = rows.filter(
      (r) => (r.direction || "").toLowerCase() === currentFilter
    );
  }

  if (quickFilter === "bet") {
    rows = rows.filter((r) => r._bet);
  } else if (quickFilter === "grant") {
    rows = rows.filter(
      (r) => (r._category || "").toLowerCase() === "grant"
    );
  }

  const q = (searchInput?.value || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      Object.values(r).some(
        (v) => v && String(v).toLowerCase().includes(q)
      )
    );
  }

  return rows;
}

function sumByDirection(rows, dir) {
  return rows.reduce((sum, r) => {
    if ((r.direction || "").toLowerCase() === dir) {
      const n = parseFloat(r.amount || r["Amount ($)"] || 0);
      if (!isNaN(n)) sum += n;
    }
    return sum;
  }, 0);
}

function getTypeClass(t) {
  const v = (t || "").toLowerCase();
  if (v.includes("purchase")) return "type-purchase";
  if (v.includes("transfer")) return "type-transfer";
  if (v.includes("business") || v.includes("payment") || v.includes("invoice"))
    return "type-business";
  if (v.includes("tax")) return "type-tax";
  return "type-other";
}

function getCategoryClass(c) {
  const v = (c || "").toLowerCase();
  if (v.includes("bet purchase")) return "cat-bet-purchase";
  if (v.includes("bet reimbursement")) return "cat-bet-refund";
  if (v === "grant") return "cat-grant";
  if (v === "repair income") return "cat-repair";
  if (v === "tax") return "cat-tax";
  return "cat-other";
}

function drawTable(rows) {
  tableHead.innerHTML = "";
  tableBody.innerHTML = "";
  if (detailsPanel) detailsPanel.style.display = "none";

  const rename = {
    from_account_id: "Account ID",
    from_civ_name: "Sender",
    from_account_name: "Sender Account",
    to_account_id: "Receiver Account ID",
    to_account_name: "Receiver Account",
  };

  const baseHidden = new Set(["to_civ_name"]);
  const taxFields = [
    "tax_percentage",
    "tax_type",
    "tax_id",
    "tax_amount",
    "tax",
    "tax amount",
  ];
  const hidden = new Set(baseHidden);
  if (!showTax) taxFields.forEach((f) => hidden.add(f));

  let cols = columnOrder.filter(
    (h) => !hidden.has(h.toLowerCase())
  );

  if (!showBalance) {
    cols = cols.filter((c) => c.toLowerCase() !== "balance");
  } else if (!cols.includes("Balance")) {
    cols.push("Balance");
  }

  const trh = document.createElement("tr");
  cols.forEach((h) => {
    const key = h.toLowerCase();
    const th = document.createElement("th");
    th.textContent = rename[key] || h;
    th.dataset.key = h;
    th.draggable = true;

    if (key === "date") th.classList.add("col-date");

    const resizer = document.createElement("div");
    resizer.className = "col-resizer";
    resizer.addEventListener("mousedown", (e) =>
      onResizeMouseDown(e, th)
    );
    th.appendChild(resizer);

    th.addEventListener("dragstart", onHeaderDragStart);
    th.addEventListener("dragover", onHeaderDragOver);
    th.addEventListener("drop", onHeaderDrop);
    th.addEventListener("dragend", onHeaderDragEnd);

    trh.appendChild(th);
  });
  tableHead.appendChild(trh);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    if (r._bet) tr.classList.add("row-bet");
    tr.addEventListener("click", () => showDetails(r));

    cols.forEach((h) => {
      const key = h.toLowerCase();
      const td = document.createElement("td");
      const dir = (r.direction || "").toLowerCase();

      if (key.includes("amount") && key !== "bet (est)") {
        const n = parseFloat(r[h] || r["Amount ($)"] || r.amount || 0);
        if (!isNaN(n) && n !== 0) {
          td.textContent = money(n);
          if (dir === "out") td.classList.add("amount-out");
          if (dir === "in") td.classList.add("amount-in");
        }
      } else if (key === "bet (est)") {
        td.textContent = r._bet ? intFmt(r._bet) : "";
        td.style.textAlign = "right";
      } else if (key === "type") {
        const val = r[h] || "";
        const pill = document.createElement("span");
        pill.className = "pill-type " + getTypeClass(val);
        pill.textContent = val || "other";
        td.appendChild(pill);
      } else if (key === "category") {
        const cat = r._category || "Other";
        const pill = document.createElement("span");
        pill.className = "pill-cat " + getCategoryClass(cat);
        pill.textContent = cat;
        td.appendChild(pill);
      } else if (key === "flag") {
        if (r._flag) {
          const pill = document.createElement("span");
          pill.className = "flag-pill";
          pill.textContent = "Flag";
          pill.title = (r._flagReasons || []).join(" • ");
          td.appendChild(pill);
        }
      } else if (key === "balance") {
        td.textContent =
          typeof r._balance === "number" ? money(r._balance) : "";
        td.style.textAlign = "right";
      } else if (key === "date") {
        const formatted = formatDateShort(
          r[h] || r.Date || r.date || r.DateTime
        );
        td.textContent = formatted;
        td.classList.add("col-date");
      } else {
        td.textContent = r[h] ?? "";
      }

      tr.appendChild(td);
    });

    tableBody.appendChild(tr);
  });
}

// ================== DETAILS & UTILS ==================

function formatDateShort(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function showDetails(r) {
  if (!detailsPanel) return;

  const id = (r.id || r.ID || "") || "N/A";
  const sender = r.from_civ_name || r.Sender || "N/A";
  const recv =
    r.to_account_name ||
    r["Receiver Account"] ||
    r.to_civ_name ||
    "N/A";
  const amt = parseFloat(r.amount || r["Amount ($)"] || 0);
  const bet = r._bet ? intFmt(r._bet) + " BET" : "—";
  const cat = r._category || "Other";
  const comment = r.comment || r.Description || "";
  const date = formatDateShort(r.date || r.Date || r.DateTime);
  const balance =
    typeof r._balance === "number" ? money(r._balance) : null;
  const reasons = r._flagReasons || [];

  detailsPanel.innerHTML = `
    <div>
      <div class="label">Transaction ID</div>
      <strong>${id}</strong>
    </div>
    <div style="margin-top:4px;">
      <div class="label">Sender → Receiver</div>
      <strong>${sender}</strong> → <strong>${recv}</strong>
    </div>
    <div style="margin-top:4px;">
      <div class="label">Amount / BET / Category</div>
      <strong>${money(amt)}</strong>
      &nbsp;|&nbsp; <strong>${bet}</strong>
      &nbsp;|&nbsp; <strong>${cat}</strong>
      ${balance ? `&nbsp;|&nbsp; Balance after: <strong>${balance}</strong>` : ""}
    </div>
    <div style="margin-top:4px;">
      <div class="label">Date</div>
      ${date || "N/A"}
    </div>
    <div style="margin-top:4px;">
      <div class="label">Comment</div>
      ${comment || '<span style="color:#6b7280">No comment</span>'}
    </div>
    ${
      reasons.length
        ? `<div style="margin-top:6px;">
             <div class="label">Why this is flagged</div>
             <ul>${reasons.map((t) => `<li>${t}</li>`).join("")}</ul>
           </div>`
        : ""
    }
  `;
  detailsPanel.style.display = "block";
}

function money(v) {
  if (v === null || v === undefined || isNaN(v)) return "$0";
  const n = Math.round(v);
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US");
}

function intFmt(v) {
  return Number(v || 0).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

function toCsv(cols, rows) {
  const esc = (val) => {
    if (val == null) return "";
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const lines = rows.map((r) => cols.map((c) => esc(r[c])).join(","));
  return [head, ...lines].join("\n");
}

function buildDisplayRows(rows) {
  const rename = {
    from_account_id: "Account ID",
    from_civ_name: "Sender",
    from_account_name: "Sender Account",
    to_account_id: "Receiver Account ID",
    to_account_name: "Receiver Account",
  };

  const baseHidden = new Set(["to_civ_name"]);
  const taxFields = [
    "tax_percentage",
    "tax_type",
    "tax_id",
    "tax_amount",
    "tax",
    "tax amount",
  ];
  const hidden = new Set(baseHidden);
  if (!showTax) taxFields.forEach((f) => hidden.add(f));

  let colsRaw = columnOrder.filter(
    (h) => !hidden.has(h.toLowerCase())
  );
  if (!showBalance) {
    colsRaw = colsRaw.filter((c) => c.toLowerCase() !== "balance");
  }

  const cols = colsRaw.map(
    (h) => rename[h.toLowerCase()] || h
  );

  const rowsMapped = rows.map((r) => {
    const obj = {};
    colsRaw.forEach((h, i) => {
      const outKey = cols[i];
      const lower = h.toLowerCase();
      if (lower === "bet (est)") obj[outKey] = r._bet || "";
      else if (lower === "category") obj[outKey] = r._category || "";
      else if (lower === "flag")
        obj[outKey] = (r._flagReasons || []).join(" | ");
      else if (lower === "balance")
        obj[outKey] =
          typeof r._balance === "number" ? money(r._balance) : "";
      else if (lower === "date")
        obj[outKey] = formatDateShort(r[h] || r.Date || r.date || r.DateTime);
      else obj[outKey] = r[h] ?? "";
    });
    return obj;
  });

  return { cols, rows: rowsMapped };
}

// ================== DRAG / RESIZE ==================

function onHeaderDragStart(e) {
  if (isResizing) {
    e.preventDefault();
    return;
  }
  dragSrcKey = e.target.dataset.key;
  e.dataTransfer.effectAllowed = "move";
}

function onHeaderDragOver(e) {
  if (!dragSrcKey || isResizing) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function onHeaderDrop(e) {
  if (!dragSrcKey || isResizing) return;
  e.preventDefault();
  const th = e.target.closest("th");
  const targetKey = th?.dataset.key;
  if (!targetKey || targetKey === dragSrcKey) return;

  const from = columnOrder.indexOf(dragSrcKey);
  const to = columnOrder.indexOf(targetKey);
  if (from === -1 || to === -1) return;

  columnOrder.splice(from, 1);
  columnOrder.splice(to, 0, dragSrcKey);

  render();
}

function onHeaderDragEnd() {
  dragSrcKey = null;
}

function onResizeMouseDown(e, th) {
  e.stopPropagation();
  e.preventDefault();
  isResizing = true;

  const startX = e.clientX;
  const startWidth = th.offsetWidth;
  const table = th.closest("table");
  const index = Array.from(th.parentNode.children).indexOf(th);

  resizeInfo = { startX, startWidth, table, index };

  document.addEventListener("mousemove", onResizeMouseMove);
  document.addEventListener("mouseup", onResizeMouseUp);
}

function onResizeMouseMove(e) {
  if (!isResizing || !resizeInfo) return;

  const delta = e.clientX - resizeInfo.startX;
  const newWidth = Math.max(60, resizeInfo.startWidth + delta);

  const th = resizeInfo.table.querySelectorAll("th")[resizeInfo.index];
  th.style.width = newWidth + "px";

  resizeInfo.table.querySelectorAll("tr").forEach((row) => {
    const cell = row.children[resizeInfo.index];
    if (cell) cell.style.width = newWidth + "px";
  });
}

function onResizeMouseUp() {
  isResizing = false;
  resizeInfo = null;
  document.removeEventListener("mousemove", onResizeMouseMove);
  document.removeEventListener("mouseup", onResizeMouseUp);
}

// ================== INIT ==================

document.addEventListener("DOMContentLoaded", async () => {
  await loadManualFromSheet(); // optional, safe if sheet missing
  await loadBankFromSheet();
});
