// routes/tradeLedgerRoute.js
// Trade history served from Poseidon's persistent tradeLedger (ledger-first)

const express = require('express');
const router = express.Router();

const { list } = require('../utils/tradeLedger'); // ✅ ledger source of truth

// ---------- helpers ----------
const up = s => String(s || '').toUpperCase();
const toFixed = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : '';
};
const hyphenFut = (sym) => {
  const S = up(sym).replace(/[^A-Z0-9-]/g, '');
  if (S.includes('-')) return S;
  return S.endsWith('USDTM') ? `${S.slice(0, -5)}-USDTM` : `${S}-USDTM`;
};
const normSide = (s) => (up(s) === 'BUY' ? 'BUY' : 'SELL');
const pctStr = (v) => {
  if (typeof v === 'string' && v.trim().endsWith('%')) return v.trim();
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : '';
};

async function handleTradeHistory(req, res) {
  try {
    res.set('Cache-Control', 'no-store');

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, 500)
      : 100;

    // tradeLedger.list(limit) → newest→oldest,
    // enriches OPEN rows with { exitLive, pnlLive, roiLive } (display-only).
    const rows = await list(limit);

    const normalized = (rows || []).map(r => {
      const status = up(r.status);
      const symbol = hyphenFut(r.symbol || '');
      const side = normSide(r.side);

      const entry = r.entry !== '' ? Number(r.entry) : '';
      const exit  = status === 'OPEN'
        ? (r.exitLive !== '' ? Number(r.exitLive) : (r.exit !== '' ? Number(r.exit) : ''))
        : (r.exit !== '' ? Number(r.exit) : '');

      const pnl = status === 'OPEN'
        ? (r.pnlLive !== '' ? Number(r.pnlLive) : (r.pnl !== '' ? Number(r.pnl) : ''))
        : (r.pnl !== '' ? Number(r.pnl) : '');

      const roi = status === 'OPEN'
        ? (r.roiLive || r.roi || '')
        : (r.roi || '');

      return {
        symbol,
        side,                                          // BUY | SELL
        entry: entry !== '' ? toFixed(entry, 6) : '',
        exit:  exit  !== '' ? toFixed(exit,  6) : '',
        size:  (typeof r.size === 'number') ? toFixed(r.size, 3) : (r.size || ''),
        pnl:   pnl   !== '' ? toFixed(pnl,   6) : '',
        roi:   pctStr(roi),
        status,
        openedAt: r.timestamp || r.openedAt || '',
        closedAt: r.closedAt || ''
      };
    });

    // Return both ok:true and success:true for widest compatibility
    return res.json({
      ok: true,
      success: true,
      source: 'trade-ledger',
      trades: normalized,
      count: normalized.length
    });
  } catch (err) {
    console.error('[trade-ledger] route error:', err?.response?.data || err.message);
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
}

/**
 * GET /api/trade-history
 * (Assumes this router mounts at /api)
 *
 * Query:
 *   - limit: number of most recent rows to return (default 100, max 500)
 */
router.get('/trade-history', handleTradeHistory);

// ✅ Optional alias used by some frontend helpers (e.g., capitalScoreModule)
router.get('/trade-ledger', handleTradeHistory);

module.exports = router;