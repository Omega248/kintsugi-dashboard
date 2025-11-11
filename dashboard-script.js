// ===== Config =====
const SHEET_ID = "1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks";
const JOBS_SHEET = "Form responses 1";
const CONFIG_SHEET = "Config";
const PAY_PER_REPAIR = 700;

// Build CSV URL for a sheet
function sheetCsvUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheetName
  )}`;
}

// Generic CSV fetch using PapaParse
async function fetchCsvRows(sheetName) {
  const url = sheetCsvUrl(sheetName);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} loading ${sheetName}`);
  }
  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error(`Got HTML instead of CSV for ${sheetName} (check sharing).`);
  }

  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length) {
    console.warn(`Papa parse errors for ${sheetName}`, parsed.errors);
  }
  return parsed.data || [];
}

// ==== Overview from jobs sheet ====

async function loadOverview() {
  const status = document.getElementById("status");
  try {
    const rows = await fetchCsvRows(JOBS_SHEET);
    if (!rows.length) {
      status.textContent = "No rows found in Form responses 1.";
      return;
    }

    // Infer columns
    const sample = rows[0];
    const mechKey =
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("mechanic")
      ) || "Mechanic";

    const acrossKey =
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("across")
      ) ||
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("repairs")
      );

    const weekKey =
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("week ending")
      ) || null;

    let totalRepairs = 0;
    const mechanics = new Set();
    let latestWeekDate = null;

    rows.forEach((r) => {
      const mech = (r[mechKey] || "").trim();
      if (mech) mechanics.add(mech);

      const across = acrossKey ? Number(r[acrossKey] || 0) || 0 : 0;
      totalRepairs += across;

      if (weekKey && r[weekKey]) {
        const d = parseDateLike(r[weekKey]);
        if (d && (!latestWeekDate || d > latestWeekDate)) {
          latestWeekDate = d;
        }
      }
    });

    const totalPayout = totalRepairs * PAY_PER_REPAIR;

    // Update DOM
    setText("totalRepairs", totalRepairs.toLocaleString());
    setText("totalPayout", money(totalPayout));
    setText("activeMechanics", mechanics.size.toLocaleString());
    setText(
      "latestWeek",
      latestWeekDate ? fmtDate(latestWeekDate) : "—"
    );

    status.textContent = "Overview loaded.";
  } catch (err) {
    console.error(err);
    if (status) {
      status.textContent =
        "Error loading overview. Check sheet ID, sharing & column names.";
    }
  }
}

// ==== Config (BET / bins) ====

async function loadConfig() {
  try {
    const rows = await fetchCsvRows(CONFIG_SHEET);
    if (!rows.length) return;

    const map = {};
    rows.forEach((r) => {
      const key = (r.Key || r.key || "").trim();
      if (!key) return;
      const raw = r.Value ?? r.value;
      const num = raw === "" || raw === undefined ? null : Number(raw);
      map[key] = isNaN(num) ? raw : num;
    });

    if (map.MANUAL_BET_LEFT !== undefined) {
      setText(
        "manualBetLeft",
        Number(map.MANUAL_BET_LEFT || 0).toLocaleString()
      );
    }
    if (map.MANUAL_RED_BINS !== undefined) {
      setText(
        "manualRedBins",
        Number(map.MANUAL_RED_BINS || 0).toLocaleString()
      );
    }
  } catch (err) {
    console.error("Error loading Config sheet", err);
  }
}

// ==== Helpers ====

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function parseDateLike(raw) {
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
    return isNaN(d) ? null : d;
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const yyyy = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function fmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function money(n) {
  const v = Number(n || 0);
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ==== Init ====

document.addEventListener("DOMContentLoaded", async () => {
  await loadOverview();
  await loadConfig();
});
