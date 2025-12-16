// ===== Config =====
const ORDERS_SHEET = "Orders";
const DEPUTIES_SHEET = "Deputies";
const PAYOUT_SHEET = "Payout";
const CONFIG_SHEET = "Config";

// ===== Overview from Orders, Deputies, and Payout sheets =====

async function loadOverview() {
  const status = document.getElementById("status");

  try {
    // Show loading state
    if (status) status.textContent = "Loading dashboard...";
    
    // Load both Orders and Deputies sheets
    const [ordersResult, deputiesResult, payoutResult] = await Promise.all([
      kFetchCSV(ORDERS_SHEET, { header: true }).catch(err => ({ data: [] })),
      kFetchCSV(DEPUTIES_SHEET, { header: true }).catch(err => ({ data: [] })),
      kFetchCSV(PAYOUT_SHEET, { header: true }).catch(err => ({ data: [] }))
    ]);
    
    const orders = ordersResult.data || [];
    const deputies = deputiesResult.data || [];
    const payouts = payoutResult.data || [];
    
    if (!orders.length) {
      if (status) status.textContent = "";
      kShowEmpty('stat-boxes', 'No orders data available yet.');
      return;
    }

    // Infer column names from the Orders sheet
    const sample = orders[0];
    const deputyKey = Object.keys(sample).find((k) =>
      k.toLowerCase().includes("deputy") || k.toLowerCase().includes("name")
    ) || "Deputy";

    const quantityKey = Object.keys(sample).find((k) =>
      k.toLowerCase().includes("quantity") || k.toLowerCase().includes("qty") || k.toLowerCase().includes("amount")
    ) || "Quantity";

    const priceKey = Object.keys(sample).find((k) =>
      k.toLowerCase().includes("price") || k.toLowerCase().includes("cost") || k.toLowerCase().includes("total")
    ) || "Price";

    const dateKey = Object.keys(sample).find((k) =>
      k.toLowerCase().includes("date") || k.toLowerCase().includes("timestamp")
    ) || "Date";

    // Global aggregates
    let totalOrders = 0;
    let totalSales = 0;
    const deputiesSet = new Set();
    let latestOrderDate = null;

    // Time-bucketed aggregates
    let ordersThisWeek = 0;
    let salesThisWeek = 0;
    let ordersThisMonth = 0;
    let salesThisMonth = 0;
    const perDeputyWeek = {};

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

    orders.forEach((r) => {
      const deputy = (r[deputyKey] || "").trim();
      if (deputy) deputiesSet.add(deputy);

      const quantity = Number(r[quantityKey] || 1) || 1;
      const price = Number(r[priceKey] || 0) || 0;
      
      totalOrders += quantity;
      totalSales += price;

      // Parse order date
      let orderDate = null;
      if (dateKey && r[dateKey]) {
        const d = parseDateLike(r[dateKey]);
        if (d && !isNaN(d)) {
          orderDate = d;
          if (!latestOrderDate || d > latestOrderDate) {
            latestOrderDate = d;
          }
        }
      }

      if (orderDate && !isNaN(orderDate)) {
        const dOnly = new Date(
          orderDate.getFullYear(),
          orderDate.getMonth(),
          orderDate.getDate()
        );

        if (dOnly >= weekStart && dOnly <= weekEnd) {
          ordersThisWeek += quantity;
          salesThisWeek += price;
          if (deputy) {
            perDeputyWeek[deputy] = (perDeputyWeek[deputy] || 0) + quantity;
          }
        }

        if (dOnly >= monthStart && dOnly <= monthEnd) {
          ordersThisMonth += quantity;
          salesThisMonth += price;
        }
      }
    });

    // Calculate outstanding balance from Payout sheet
    let outstandingBalance = 0;
    let paymentsDue = 0;
    
    if (payouts.length > 0) {
      const payoutSample = payouts[0];
      const balanceKey = Object.keys(payoutSample).find((k) =>
        k.toLowerCase().includes("balance") || k.toLowerCase().includes("owed") || k.toLowerCase().includes("amount")
      ) || "Balance";
      
      payouts.forEach((p) => {
        const balance = Number(p[balanceKey] || 0) || 0;
        outstandingBalance += balance;
        if (balance > 0) paymentsDue += balance;
      });
    }

    // Top deputy this week
    let topDeputyName = null;
    let topDeputyOrders = 0;
    Object.entries(perDeputyWeek).forEach(([name, orders]) => {
      if (orders > topDeputyOrders) {
        topDeputyOrders = orders;
        topDeputyName = name;
      }
    });

    // Update UI
    kSetText("totalOrders", totalOrders.toLocaleString());
    kSetText("totalSales", kFmtMoney(totalSales));
    kSetText("outstandingBalance", kFmtMoney(outstandingBalance));
    kSetText("activeDeputies", deputiesSet.size.toLocaleString());
    kSetText("latestOrder", latestOrderDate ? kFmtDate(latestOrderDate) : "—");

    // Week/month KPIs
    kSetText("ordersThisWeek", ordersThisWeek.toLocaleString());
    kSetText("salesThisWeek", "Sales: " + kFmtMoney(salesThisWeek));

    kSetText("ordersThisMonth", ordersThisMonth.toLocaleString());
    kSetText("salesThisMonth", "Sales: " + kFmtMoney(salesThisMonth));

    // Top deputy this week
    if (topDeputyName) {
      kSetText("topDeputyWeekName", topDeputyName);
      kSetText("topDeputyWeekStats", topDeputyOrders.toLocaleString() + " orders");
    } else {
      kSetText("topDeputyWeekName", "—");
      kSetText("topDeputyWeekStats", "No orders logged this week");
    }

    // Payments due
    kSetText("paymentsDue", kFmtMoney(paymentsDue));

    // Subtitles
    kSetText("tileSub-totalOrders", "TakoSoya orders fulfilled");
    kSetText("tileSub-totalSales", "Total revenue generated");
    kSetText("tileSub-outstandingBalance", "Balance owed by PD/Mayor");
    kSetText("tileSub-activeDeputies", "Unique deputies served");
    kSetText("tileSub-latestOrder", "Most recent order date");
    kSetText("tileSub-paymentsDue", "Payments pending from agencies");

    if (status) {
      status.textContent = "";
    }
  } catch (err) {
    console.error("Error loading overview from orders sheet", err);
    if (status) {
      status.textContent = "";
    }
    
    // Show user-friendly error message
    const errorMsg = err.message.includes('404') || err.message.includes('not found')
      ? 'Unable to load orders data. Please check sheet configuration.'
      : err.message.includes('403') || err.message.includes('denied')
      ? 'Access denied. Please check sheet sharing settings.'
      : 'Unable to load dashboard data. Please try refreshing the page.';
    
    kShowToast(errorMsg, 'error', 5000);
  }
}

// ===== Config sheet (optional configuration values) =====

async function loadConfig() {
  try {
    const { data: rows } = await kFetchCSV(CONFIG_SHEET, { header: true, cache: true });
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

    // Apply any config values if they exist
    // Currently no manual overrides needed for Kaneshiro Enterprises
  } catch (err) {
    console.error("Error loading Config sheet", err);
    // Config is optional, so we don't show error to user
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

// ==== Keyboard Shortcuts ====

function initKeyboardShortcuts() {
  kRegisterShortcuts({
    'ctrl+r': (e) => {
      // Reload data
      loadOverview().then(() => kShowToast('Data refreshed', 'success', 2000));
    },
    'ctrl+1': () => {
      // Navigate to Dashboard
      window.location.href = 'index.html';
    },
    'ctrl+2': () => {
      // Navigate to Payouts
      window.location.href = 'Payouts/payouts-index.html';
    },
    'ctrl+3': () => {
      // Navigate to Mechanics
      window.location.href = 'Mechanics/mechanics-index.html';
    },
    'ctrl+4': () => {
      // Navigate to Bank
      window.location.href = 'Bank_Record/bank-index.html';
    }
  });
}

// ==== Init ====

document.addEventListener("DOMContentLoaded", async () => {
  kSyncNavLinksWithCurrentSearch();
  initKeyboardShortcuts();
  
  // Load overview first
  try {
    await loadOverview();
    await loadConfig();
  } catch (err) {
    console.error('Error during dashboard initialization:', err);
  }
});
