// Position enhancer: Notes + Age + robust ROI/PNL normalization.
// Safe to load multiple times; uses an observer to re-apply after table updates.

(function () {
  const positionNotes = {};       // contract -> note (swap to localStorage if you want persistence)
  const positionOpenedAt = {};    // contract -> ms timestamp

  // -------- math helpers --------
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const fmt2 = (x) => num(x).toFixed(2);
  const upper = (s) => String(s || "").toUpperCase();

  function deriveRoiAndPnl(p) {
    const side    = upper(p.side);
    const size    = num(p.size);                                  // contracts
    const entry   = num(p.entryPrice);
    const mark    = num(p.markPrice || p.price || p.last || entry);
    const mult    = num(p.multiplier || p.contractMultiplier || 1);
    const lev     = Math.max(1, num(p.leverage) || 1);

    // Notional at current mark (fallback to entry)
    const notionalNow = size * mult * (mark || entry || 0);

    // Prefer provided margin; else derive (value/leverage)
    const margin = num(p.margin) || (num(p.value || notionalNow) / lev);

    // PnL: prefer server’s unrealized; else compute
    let pnl = num(p.pnlValue || p.unrealizedPnl);
    if (!pnl && size && entry && mark) {
      const dir = side === 'SELL' ? -1 : 1;
      pnl = (mark - entry) * size * mult * dir;
    }
    const roi = margin > 0 ? (pnl / margin) * 100 : 0;
    return { pnl, roi, margin };
  }

  // Public normalizer (exported on window for reuse by your loaders)
  function normalizePositionRow(raw) {
    const p = { ...raw };
    const { pnl, roi, margin } = deriveRoiAndPnl(p);
    return {
      contract   : String(p.contract || p.symbol || ''),
      side       : upper(p.side),
      entryPrice : fmt2(p.entryPrice),
      size       : num(p.size),
      value      : fmt2(p.value || p.notional || 0),
      margin     : fmt2(margin),
      pnlValue   : fmt2(pnl),
      roi        : `${roi.toFixed(2)}%`,
      leverage   : `${Math.max(1, num(p.leverage) || 1)}x`,
      liquidation: p.liquidation ? fmt2(p.liquidation) : '--',
      notes      : p.notes || positionNotes[p.contract || p.symbol || ''] || '',
      age        : '--' // live-rendered below
    };
  }

  // -------- DOM helpers --------
  function findPositionsTbody() {
    // Prefer explicit id if present
    const byId = document.getElementById('open-positions-body');
    if (byId) return byId;

    // Fallback: first .open-positions-table > tbody
    const tbl = document.querySelector('.open-positions-table');
    if (tbl) return tbl.querySelector('tbody') || null;

    return null;
  }

  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function wireRowEnhancements(tr) {
    // Contract text assumed in the first cell
    const symCell = tr.cells[0];
    if (!symCell) return;

    const contract = String(symCell.textContent || '').trim();
    if (!contract) return;

    // Add Notes cell if not present
    if (!tr.querySelector('.position-note-input')) {
      const td = tr.insertCell(-1);
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Add note...';
      input.className = 'position-note-input';
      input.value = positionNotes[contract] || '';
      input.addEventListener('input', () => { positionNotes[contract] = input.value; });
      td.appendChild(input);
    }

    // Add Age cell if not present
    if (!tr.querySelector('.position-age')) {
      const tdAge = tr.insertCell(-1);
      tdAge.className = 'position-age';
      tdAge.dataset.contract = contract;
      if (!positionOpenedAt[contract]) {
        positionOpenedAt[contract] = Date.now();
      }
    }
  }

  function enhanceOpenPositionsTable() {
    const body = findPositionsTbody();
    if (!body) return;

    // Enhance existing rows
    [...body.rows].forEach(wireRowEnhancements);
  }

  function updatePositionAges() {
    const cells = document.querySelectorAll('.position-age');
    const now = Date.now();
    cells.forEach(cell => {
      const contract = cell.dataset.contract;
      const openedAt = positionOpenedAt[contract];
      if (!openedAt) return;
      const secs = Math.floor((now - openedAt) / 1000);
      cell.textContent = formatDuration(secs);
    });
  }

  // Watch table for refreshes and re-apply enhancements
  function startObserver() {
    const body = findPositionsTbody();
    if (!body) return;
    const obs = new MutationObserver(() => {
      // new rows likely appended—enhance them
      enhanceOpenPositionsTable();
    });
    obs.observe(body, { childList: true, subtree: false });
  }

  // Boot once DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    enhanceOpenPositionsTable();
    startObserver();
    // live ticking age
    setInterval(updatePositionAges, 1000);
  });

  // Export normalizer for your loader to use when painting rows
  window.normalizePositionRow = normalizePositionRow;
})();