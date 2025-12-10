// ===== Config =====
const JOBS_SHEET = "Form responses 1";
const CONFIG_SHEET = "Config";
const PAY_PER_REPAIR = 700;

// ===== Overview from jobs sheet (GLOBAL ONLY) =====

async function loadOverview() {
  const status = document.getElementById("status");

  try {
    const { data: rows } = await kFetchCSV(JOBS_SHEET, { header: true });
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

    kSetText("totalRepairs", totalRepairs.toLocaleString());
    kSetText("totalPayout", kFmtMoney(totalPayout));
    kSetText("activeMechanics", mechanics.size.toLocaleString());
    kSetText("latestWeek", latestWeekDate ? kFmtDate(latestWeekDate) : "—");

    // Week/month KPIs
    kSetText("repairsThisWeek", repairsThisWeek.toLocaleString());
    kSetText(
      "payoutThisWeek",
      "Payout: " + kFmtMoney(payoutThisWeek)
    );

    kSetText("repairsThisMonth", repairsThisMonth.toLocaleString());
    kSetText(
      "payoutThisMonth",
      "Payout: " + kFmtMoney(payoutThisMonth)
    );

    // Top mechanic this week
    if (topMechName) {
      kSetText("topMechWeekName", topMechName);
      kSetText(
        "topMechWeekStats",
        topMechRepairs.toLocaleString() +
          " repairs · " +
          kFmtMoney(topMechRepairs * PAY_PER_REPAIR)
      );
    } else {
      kSetText("topMechWeekName", "—");
      kSetText("topMechWeekStats", "No repairs logged this week");
    }

    // Subtitles
    kSetText("tileSub-totalRepairs", "");
    kSetText("tileSub-totalPayout", "");
    kSetText("tileSub-activeMechanics", "");
    kSetText("tileSub-manualBetLeft", "");
    kSetText("tileSub-manualRedBins", "");
    kSetText(
      "tileSub-latestWeek",
      lastActivity ? "Last job: " + kFmtDate(lastActivity) : ""
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
    const { data: rows } = await kFetchCSV(CONFIG_SHEET, { header: true });
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
      kSetText(
        "manualBetLeft",
        Number(map.MANUAL_BET_LEFT || 0).toLocaleString()
      );
    }
    if (map.MANUAL_RED_BINS !== undefined) {
      kSetText(
        "manualRedBins",
        Number(map.MANUAL_RED_BINS || 0).toLocaleString()
      );
    }
  } catch (err) {
    console.error("Error loading Config sheet", err);
  }
}

// ==== Helpers (now using kintsugi-core.js) ====
// All date/money formatting helpers are in kintsugi-core.js

function parseDateLike(raw) {
  return kParseDateLike(raw);
}

function fmtDate(d) {
  return kFmtDate(d);
}

function money(n) {
  return kFmtMoney(n);
}

// ==== Init ====

document.addEventListener("DOMContentLoaded", async () => {
  kSyncNavLinksWithCurrentSearch();
  await loadOverview();
  await loadConfig();
});
