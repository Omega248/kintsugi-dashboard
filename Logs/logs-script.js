// ===== Logs Page Script =====
// Fetches structured log entries from GET /api/logs (Bearer TRIGGER_TOKEN)
// and displays them in a filterable, auto-refreshing table.
// Also shows Discord Gateway connection status and provides a Start button.

const AUTO_REFRESH_INTERVAL_MS = 30_000; // 30 seconds

let allEntries = [];          // All log entries fetched from the API
let refreshTimer  = null;     // setInterval handle
let countdownTimer = null;    // setInterval handle for the countdown display
let nextRefreshAt  = 0;       // timestamp of next scheduled refresh
let cleared = false;          // true when the user pressed "Clear display"

// ===== DOM helpers =====

const $ = id => document.getElementById(id);

function setStatus(msg) {
  const el = $('status');
  if (el) el.textContent = msg;
}

function setRefreshLabel(text, active = true) {
  const dot   = $('refreshDot');
  const label = $('refreshLabel');
  if (label) label.textContent = text;
  if (dot) {
    dot.className = 'refresh-dot' + (active ? ' refresh-dot--active' : '');
  }
}

// ===== Fetch logs from the bot API =====

async function fetchLogs() {
  const cfg = window.KINTSUGI_BOT_CONFIG;
  if (!cfg?.url || !cfg?.token) {
    setStatus('⚠️ Bot config not loaded — cannot fetch logs. Check that bot-config.js is deployed.');
    setRefreshLabel('Config missing', false);
    return null;
  }

  const url = cfg.url.replace(/\/$/, '') + '/api/logs';
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });

    if (res.status === 401) {
      setStatus('⚠️ Unauthorized — TRIGGER_TOKEN may be incorrect.');
      setRefreshLabel('Auth error', false);
      return null;
    }
    if (res.status === 503) {
      setStatus('⚠️ KV namespace not bound — logs require the bot to be fully deployed.');
      setRefreshLabel('KV unavailable', false);
      return null;
    }
    if (!res.ok) {
      setStatus(`⚠️ API error ${res.status}`);
      setRefreshLabel('Error', false);
      return null;
    }

    const json = await res.json();
    return Array.isArray(json.entries) ? json.entries : [];
  } catch (err) {
    setStatus(`⚠️ Network error: ${err.message}`);
    setRefreshLabel('Network error', false);
    return null;
  }
}

// ===== Render =====

function levelClass(level) {
  switch ((level ?? '').toLowerCase()) {
    case 'error': return 'level-error';
    case 'warn':  return 'level-warn';
    default:      return 'level-info';
  }
}

function levelLabel(level) {
  return (level ?? 'info').toUpperCase();
}

function fmtTimestamp(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return ts;
  }
}

function fmtDetails(entry) {
  const skip = new Set(['ts', 'level', 'event']);
  const parts = Object.entries(entry)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `<span class="detail-key">${k}:</span> <span class="detail-val">${escapeHtml(val)}</span>`;
    });
  return parts.length ? parts.join('  ') : '<span class="detail-empty">—</span>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getFilteredEntries() {
  const level  = $('levelFilter')?.value ?? 'all';
  const search = ($('searchInput')?.value ?? '').trim().toLowerCase();

  return allEntries.filter(e => {
    if (level !== 'all' && (e.level ?? 'info').toLowerCase() !== level) return false;
    if (search) {
      const haystack = JSON.stringify(e).toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function renderTable() {
  if (cleared) return;

  const tbody    = $('logsBody');
  if (!tbody) return;

  const filtered = getFilteredEntries();

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No log entries match the current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(e => {
    const cls = levelClass(e.level);
    return `<tr class="log-row ${cls}">
      <td class="col-ts">${fmtTimestamp(e.ts)}</td>
      <td class="col-level"><span class="level-badge ${cls}">${levelLabel(e.level)}</span></td>
      <td class="col-event">${escapeHtml(e.event ?? '')}</td>
      <td class="col-details">${fmtDetails(e)}</td>
    </tr>`;
  }).join('');
}

function updateKpis() {
  const total = allEntries.length;
  const info  = allEntries.filter(e => (e.level ?? 'info') === 'info').length;
  const warn  = allEntries.filter(e => e.level === 'warn').length;
  const error = allEntries.filter(e => e.level === 'error').length;

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('kpiTotal', total);
  set('kpiInfo',  info);
  set('kpiWarn',  warn);
  set('kpiError', error);
}

// ===== Load & refresh =====

async function loadLogs() {
  setRefreshLabel('Fetching…', true);
  setStatus('');
  cleared = false;

  const entries = await fetchLogs();
  if (entries === null) return; // error already shown

  allEntries = entries;
  updateKpis();
  renderTable();

  const now = new Date();
  setRefreshLabel(`Updated ${now.toLocaleTimeString()}`, true);
  setStatus(allEntries.length === 0 ? 'No log entries yet.' : '');
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  nextRefreshAt = Date.now() + AUTO_REFRESH_INTERVAL_MS;

  countdownTimer = setInterval(() => {
    const secs = Math.max(0, Math.round((nextRefreshAt - Date.now()) / 1000));
    const dot  = $('refreshDot');
    if (dot) dot.className = 'refresh-dot refresh-dot--active';
    const label = $('refreshLabel');
    if (label && !label.textContent.startsWith('Updated')) {
      // Keep "Updated …" until we're about to refresh
    }
    if (secs <= 5) {
      if (label) label.textContent = `Refreshing in ${secs}s…`;
    }
  }, 1000);
}

function scheduleAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  startCountdown();
  refreshTimer = setInterval(async () => {
    await loadLogs();
    startCountdown();
  }, AUTO_REFRESH_INTERVAL_MS);
}

// ===== Gateway status & start =====

function setGatewayBadge(text, state) {
  const badge = $('gatewayBadge');
  if (!badge) return;
  badge.textContent = text;
  badge.className   = 'gateway-status-badge' + (state ? ` ${state}` : '');
}

async function fetchGatewayStatus() {
  const cfg = window.KINTSUGI_BOT_CONFIG;
  if (!cfg?.url || !cfg?.token) {
    setGatewayBadge('Config missing', '');
    return null;
  }
  try {
    const res = await fetch(cfg.url.replace(/\/$/, '') + '/api/gateway-status', {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    if (!res.ok) {
      setGatewayBadge('Auth error', 'disconnected');
      return null;
    }
    const data = await res.json();
    if (data.connected) {
      setGatewayBadge('Connected', 'connected');
    } else {
      setGatewayBadge('Disconnected', 'disconnected');
    }
    return data;
  } catch {
    setGatewayBadge('Unreachable', 'disconnected');
    return null;
  }
}

async function startGateway() {
  const cfg = window.KINTSUGI_BOT_CONFIG;
  if (!cfg?.url || !cfg?.token) {
    setStatus('⚠️ Bot config not loaded — cannot start gateway.');
    return;
  }
  setGatewayBadge('Starting…', '');
  const btn = $('gatewayStartBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(cfg.url.replace(/\/$/, '') + '/api/gateway-start', {
      method:  'POST',
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const status = data.status ?? 'ok';
      setGatewayBadge(
        status === 'already_connected' ? 'Already connected' : 'Started',
        'connected',
      );
      setStatus('Gateway started — the bot will now reply to @mentions.');
    } else {
      setGatewayBadge('Start failed', 'disconnected');
      setStatus(`⚠️ Gateway start failed (HTTP ${res.status}): ${data.error ?? ''}`);
    }
  } catch (err) {
    setGatewayBadge('Start failed', 'disconnected');
    setStatus(`⚠️ Gateway start error: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ===== Event listeners =====

document.addEventListener('DOMContentLoaded', () => {
  // Wire up controls
  $('levelFilter')?.addEventListener('change', renderTable);
  $('searchInput')?.addEventListener('input', kDebounce(renderTable, 200));

  $('refreshBtn')?.addEventListener('click', async () => {
    await loadLogs();
    startCountdown();
  });

  $('clearBtn')?.addEventListener('click', () => {
    cleared = true;
    const tbody = $('logsBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Display cleared. Press Refresh to reload.</td></tr>';
    setRefreshLabel('Cleared', false);
  });

  $('gatewayStartBtn')?.addEventListener('click', startGateway);

  // Initial load + start auto-refresh + gateway status
  loadLogs().then(() => scheduleAutoRefresh());
  fetchGatewayStatus();
});
