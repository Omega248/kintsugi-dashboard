// === Config ===
const SHEET_ID = "1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks";
const JOBS_SHEET = "Form responses 1";
const PAY_PER_REPAIR = 700;

// === Helpers ===
function sheetCsvUrl(sheet) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheet
  )}`;
}

function parseCSV(text) {
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
  if (!d) return "–";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = d.getFullYear();
  return `${mm}/${dd}/${yy}`;
}

function fmtMoney(n) {
  return (
    "$" +
    (n || 0).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    })
  );
}

// === Core ===
async function loadOverview() {
  const repairsEl = document.getElementById("statRepairs");
  const payoutEl = document.getElementById("statPayout");
  const latestWeekEl = document.getElementById("statLatestWeek");
  const mechEl = document.getElementById("statMechanics");
  const statusEl = document.getElementById("overviewStatus");

  // If markup changed or we're on the wrong page, bail quietly
  if (!repairsEl || !payoutEl || !latestWeekEl || !mechEl || !statusEl) {
    console.warn(
      "Dashboard elements not found; ensure index.html has statRepairs, statPayout, statLatestWeek, statMechanics, overviewStatus."
    );
    return;
  }

  try {
    statusEl.textContent = "Loading overview from sheet…";

    const res = await fetch(sheetCsvUrl(JOBS_SHEET));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    if (text.trim().startsWith("<")) {
      throw new Error("Got HTML instead of CSV; check sheet sharing.");
    }

    const rows = parseCSV(text);
    if (!rows.length) throw new Error("No data returned from jobs sheet.");

    const headers = rows[0].map((h) => h.trim());
    const iMech = headers.indexOf("Mechanic");
    const iAcross = headers.indexOf("How many Across");
    const iWeek = headers.indexOf("Week Ending");

    if (iMech === -1 || iAcross === -1 || iWeek === -1) {
      throw new Error(
        'Missing required columns in "Form responses 1". Need "Mechanic", "How many Across", "Week Ending".'
      );
    }

    let totalRepairs = 0;
    const mechSet = new Set();
    let latestWeek = null;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.length) continue;

      const mech = (row[iMech] || "").trim();
      const across = Number(row[iAcross] || "0") || 0;
      const weekDate = parseDateLike(row[iWeek]);

      if (!mech || !across) continue;

      totalRepairs += across;
      mechSet.add(mech);

      if (weekDate && (!latestWeek || weekDate > latestWeek)) {
        latestWeek = weekDate;
      }
    }

    const totalPayout = totalRepairs * PAY_PER_REPAIR;
    const activeMechs = mechSet.size;

    repairsEl.textContent =
      totalRepairs > 0 ? totalRepairs.toLocaleString("en-US") : "0";
    payoutEl.textContent = fmtMoney(totalPayout);
    latestWeekEl.textContent = latestWeek ? fmtDate(latestWeek) : "–";
    mechEl.textContent = activeMechs.toString();

    statusEl.textContent = "Overview loaded.";
  } catch (err) {
    console.error(err);
    const statusEl = document.getElementById("overviewStatus");
    if (statusEl) {
      statusEl.textContent =
        "Failed to load overview from sheet. Check console for details.";
    }
  }
}

// === Init ===
document.addEventListener("DOMContentLoaded", () => {
  loadOverview();
});
