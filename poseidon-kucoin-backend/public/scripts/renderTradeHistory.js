// === /public/scripts/renderTradeHistory.js — Ledger-first History Renderer ===

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('trade-history-body');
  if (!tbody) return;

  /* ---------- formatters ---------- */
  const fmtNum = (v, min = 2, max = 6) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString(undefined, { minimumFractionDigits: min, maximumFractionDigits: max });
  };
  const fmtPrice = v => fmtNum(v, 4, 6);
  const fmtQty   = v => fmtNum(v, 3, 3);
  const fmtPNL   = v => fmtNum(v, 2, 6);
  const fmtROI   = v => {
    if (v == null || v === '') return '—';
    const s = String(v).trim();
    if (s.endsWith('%')) return s;
    const n = Number(s);
    return Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';
  };
  const fmtDate  = v => {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  };
  const sideText = s => (String(s).toLowerCase() === 'buy' ? 'Long' : 'Short');

  /* ---------- fetch (ledger-first) ---------- */
  async function fetchLedger(limit = 100) {
    const res = await fetch(`/api/trade-history?limit=${limit}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
    const json = await res.json();            // { success:true, trades:[...], source:'ledger' }
    return Array.isArray(json?.trades) ? json.trades : (Array.isArray(json) ? json : []);
  }

  /* ---------- render ---------- */
  function renderRows(trades) {
    tbody.innerHTML = '';

    if (!Array.isArray(trades) || trades.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="10" style="text-align:center;color:#98a2b3;padding:12px;">No trade history yet.</td>`;
      tbody.appendChild(row);
      return;
    }

    const rowsHtml = trades.map(t => {
      const status = String(t.status || '').toUpperCase();     // 'OPEN' | 'CLOSED'
      const isOpen = status === 'OPEN';

      // CLOSED → persisted values; OPEN → live overlay fields (exitLive/pnlLive/roiLive)
      const symbol   = t.symbol || t.contract || '—';
      const side     = sideText(t.side || '');
      const entry    = t.entry ?? t.entryPrice ?? '';
      const exitVal  = isOpen ? (t.exitLive ?? '') : (t.exit ?? '');
      const qty      = t.size ?? t.baseQty ?? t.quantity ?? '';
      const pnlVal   = isOpen ? (t.pnlLive ?? '')  : (t.pnl ?? '');
      const roiVal   = isOpen ? (t.roiLive ?? '')  : (t.roi ?? t.pnlPercent ?? '');
      const leverage = t.leverage ?? '';
      const dateIso  = isOpen ? (t.timestamp || t.date || '') : (t.closedAt || t.date || '');

      const pnlNum   = Number(pnlVal);
      const pnlClass = Number.isFinite(pnlNum) ? (pnlNum > 0 ? 'positive' : (pnlNum < 0 ? 'negative' : '')) : '';

      return `
        <tr>
          <td>${symbol}</td>
          <td class="th-side ${side.toLowerCase()}">${side}</td>
          <td>${entry !== '' ? fmtPrice(entry) : '—'}</td>
          <td>${exitVal !== '' ? fmtPrice(exitVal) : '—'}</td>
          <td>${leverage !== '' ? leverage : '—'}</td>
          <td>${qty !== '' ? fmtQty(qty) : '—'}</td>
          <td class="${pnlClass}">${pnlVal !== '' ? fmtPNL(pnlVal) : '—'}</td>
          <td>${fmtROI(roiVal)}</td>
          <td>${status}</td>
          <td>${fmtDate(dateIso)}</td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;
  }

  /* ---------- load & refresh ---------- */
  async function loadHistory() {
    try {
      // show lightweight placeholder while fetching
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#98a2b3;padding:12px;">Loading…</td></tr>`;
      const trades = await fetchLedger(100);
      renderRows(trades);
    } catch (err) {
      console.error('Failed to load trade history:', err);
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="10">⚠️ Error loading history</td>`;
      tbody.innerHTML = '';
      tbody.appendChild(row);
    }
  }

  loadHistory(); // initial load

  // Real-time updates via WebSocket (same event names you had)
  if (window.io) {
    const socket = io();
    socket.on('trade-closed', loadHistory);
    socket.on('trade-confirmed', loadHistory);
  }

  // Optional: periodic refresh to keep OPEN overlays up to date
  setInterval(loadHistory, 5000);
});