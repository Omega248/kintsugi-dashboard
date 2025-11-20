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
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${sheetName}`);
  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error(`Got HTML instead of CSV for ${sheetName}. Check sharing.`);
  }

  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (parsed) => {
        if (parsed.errors && parsed.errors.length) {
          console.warn(`Papa parse errors for ${sheetName}`, parsed.errors);
        }
        resolve(parsed.data || []);
      },
      error: reject,
    });
  });
}

// ===== Nav sync (keep tabs using current querystring for other pages) =====
function syncNavLinksWithCurrentSearch() {
  const qs = window.location.search || "";
  document.querySelectorAll(".nav-tabs a").forEach((a) => {
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

// ===== Overview from jobs sheet (GLOBAL ONLY) =====

async function loadOverview() {
  const status = document.getElementById("status");

  try {
    const rows = await fetchCsvRows(JOBS_SHEET);
    if (!rows.length) {
      if (status) status && (status.textContent = "");
      return;
    }

    // infer keys
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

    const tsKey =
      Object.keys(sample).find((k) =>
        k.toLowerCase().includes("timestamp")
      ) || null;

    // global aggregates
    let totalRepairs = 0;
    const mechanics = new Set();
    let latestWeekDate = null;
    let lastActivity = null;

    // time-bucketed aggregates
    let repairsThisWeek = 0;
    let repairsThisMonth = 0;
    const perMechWeek = {};

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Monday-start week
    const day = (today.getDay() + 6) % 7; // Mon=0..Sun=6
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - day);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    rows.forEach((r) => {
      const mech = (r[mechKey] || "").trim();
      if (mech) mechanics.add(mech);

      const across = acrossKey ? Number(r[acrossKey] || 0) || 0 : 0;
      totalRepairs += across;

      // Week ending for global latest week tile
      let weekDate = null;
      if (weekKey && r[weekKey]) {
        const d = parseDateLike(r[weekKey]);
        if (d && !isNaN(d)) {
          weekDate = d;
          if (!latestWeekDate || d > latestWeekDate) {
            latestWeekDate = d;
          }
        }
      }

      // Prefer timestamp for "this week/month" classification, fall back to week ending
      let jobDate = null;
      if (tsKey && r[tsKey]) {
        const d = parseDateLike(r[tsKey]);
        if (d && !isNaN(d)) jobDate = d;
      }
      if (!jobDate) jobDate = weekDate;

      if (jobDate && !isNaN(jobDate)) {
        const dOnly = new Date(
          jobDate.getFullYear(),
          jobDate.getMonth(),
          jobDate.getDate()
        );

        if (!lastActivity || dOnly > lastActivity) {
          lastActivity = dOnly;
        }

        if (dOnly >= weekStart && dOnly <= weekEnd) {
          repairsThisWeek += across;
          if (mech) {
            perMechWeek[mech] = (perMechWeek[mech] || 0) + across;
          }
        }

        if (dOnly >= monthStart && dOnly <= monthEnd) {
          repairsThisMonth += across;
        }
      }
    });

    const totalPayout = totalRepairs * PAY_PER_REPAIR;
    const payoutThisWeek = repairsThisWeek * PAY_PER_REPAIR;
    const payoutThisMonth = repairsThisMonth * PAY_PER_REPAIR;

    // Top mechanic this week
    let topMechName = null;
    let topMechRepairs = 0;
    Object.entries(perMechWeek).forEach(([name, reps]) => {
      if (reps > topMechRepairs) {
        topMechRepairs = reps;
        topMechName = name;
      }
    });

    setText("totalRepairs", totalRepairs.toLocaleString());
    setText("totalPayout", money(totalPayout));
    setText("activeMechanics", mechanics.size.toLocaleString());
    setText("latestWeek", latestWeekDate ? fmtDate(latestWeekDate) : "—");

    // Week/month KPIs
    setText("repairsThisWeek", repairsThisWeek.toLocaleString());
    setText(
      "payoutThisWeek",
      "Payout: " + money(payoutThisWeek)
    );

    setText("repairsThisMonth", repairsThisMonth.toLocaleString());
    setText(
      "payoutThisMonth",
      "Payout: " + money(payoutThisMonth)
    );

    // Top mechanic this week
    if (topMechName) {
      setText("topMechWeekName", topMechName);
      setText(
        "topMechWeekStats",
        topMechRepairs.toLocaleString() +
          " repairs · " +
          money(topMechRepairs * PAY_PER_REPAIR)
      );
    } else {
      setText("topMechWeekName", "—");
      setText("topMechWeekStats", "No repairs logged this week");
    }

    // Subtitles
    setText("tileSub-totalRepairs", "");
    setText("tileSub-totalPayout", "");
    setText("tileSub-activeMechanics", "");
    setText("tileSub-manualBetLeft", "");
    setText("tileSub-manualRedBins", "");
    setText(
      "tileSub-latestWeek",
      lastActivity ? "Last job: " + fmtDate(lastActivity) : ""
    );

    if (status) {
      const fmtRange =
        fmtDate(weekStart) + " – " + fmtDate(weekEnd);
      status && (status.textContent = "");
    }
  } catch (err) {
    console.error("Error loading overview from jobs sheet", err);
    if (status) {
      status && (status.textContent = "");
    }
  }
}

// ===== Config sheet// ===== Config sheet (BET / bin manual overrides) =====

async function loadConfig() {
  try {
    const rows = await fetchCsvRows(CONFIG_SHEET);
    if (!rows.length) {
      return;
    }

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
  syncNavLinksWithCurrentSearch();
  await loadOverview();
  await loadConfig();
});
