// public/scripts/tradeHistoryPanel.js (browser-only)
(() => {
    const tbody = document.getElementById('trade-history-body');
    if (!tbody) return;
  
    const fmtNum = (v, min=2, max=6) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return '—';
      return n.toLocaleString(undefined, { minimumFractionDigits:min, maximumFractionDigits:max });
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
  
    async function fetchLedger() {
    const r = await fetch('/api/trade-ledger?limit=100', { cache: 'no-store' });
      if (!r.ok) throw new Error(`Ledger history fetch failed: ${r.status}`);
      const data = await r.json();
      return Array.isArray(data?.trades) ? data.trades : (Array.isArray(data) ? data : []);
    }
  
    function renderRows(trades) {
      if (!Array.isArray(trades) || trades.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#98a2b3;padding:12px;">No trades found.</td></tr>`;
        return;
      }
  
      tbody.innerHTML = trades.map(t => {
        const status = String(t.status || '').toUpperCase();
        const isOpen  = status === 'OPEN';
        const symbol  = t.symbol || t.contract || '—';
        const side    = sideText(t.side);
        const entry   = t.entry;
        const exitVal = isOpen ? (t.exitLive ?? '') : (t.exit ?? '');
        const qty     = t.size ?? t.baseQty ?? '';
        const pnlVal  = isOpen ? (t.pnlLive ?? '')  : (t.pnl ?? '');
        const roiVal  = isOpen ? (t.roiLive ?? '')  : (t.roi ?? t.pnlPercent ?? '');
  
        // 🔧 Use ledger fields explicitly
        const dateIso = isOpen
          ? (t.openedAt || t.timestamp || t.date || '')
          : (t.closedAt || t.date || '');
  
        const pnlNum  = Number(pnlVal);
        const pnlPos  = Number.isFinite(pnlNum) ? pnlNum >= 0 : true;
  
        return `
          <tr>
            <td class="th-symbol">${symbol}</td>
            <td class="th-side ${side.toLowerCase()}">${side}</td>
            <td>${entry !== '' ? fmtPrice(entry) : '—'}</td>
            <td>${exitVal !== '' ? fmtPrice(exitVal) : '—'}</td>
            <td>${qty   !== '' ? fmtQty(qty)       : '—'}</td>
            <td class="${pnlPos ? 'pnl-pos' : 'pnl-neg'}">${pnlVal !== '' ? fmtPNL(pnlVal) : '—'}</td>
            <td>${fmtROI(roiVal)}</td>
            <td>${status}</td>
            <td>${fmtDate(dateIso)}</td>
          </tr>`;
      }).join('');
    }
  
    async function loadOnce() {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:12px;color:#98a2b3;">Loading…</td></tr>`;
      try {
        const trades = await fetchLedger();
        renderRows(trades);
      } catch (e) {
        console.error('[trade-history] ledger load error:', e);
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#f88;padding:12px;">Couldn’t load trade history.</td></tr>`;
      }
    }
  
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const trades = await fetchLedger();
        renderRows(trades);
      } finally {
        refreshing = false;
      }
    }
  
    loadOnce();
    if (window.io) {
      const socket = io();
      socket.on('trade-closed', refresh);
      socket.on('trade-confirmed', refresh);
    }
    setInterval(refresh, 5000);
  })();