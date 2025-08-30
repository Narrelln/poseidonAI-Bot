// routes/sessionStatsRoute.js
// Ledger-first session stats + streaks/topTrade + tokens/active counts

const express = require('express');
const router  = express.Router();

// Safe fetch (Node 18+ has global fetch; else lazy-load node-fetch)
const fetch = global.fetch || ((...args) =>
  import('node-fetch').then(({ default: f }) => f(...args))
);

// sources we already have elsewhere
const { getOpenFuturesPositions } = require('../kucoinHelper');

// Safe optional imports (won't crash if file names differ)
let getCapitalStatus;
try { ({ getCapitalStatus } = require('../handlers/capitalStatus')); } catch (_) {}
let getActiveSymbols;
try { ({ getActiveSymbols } = require('../routes/newScanTokens')); } catch (_) {}
let TradeLedgerModel;
try { TradeLedgerModel = require('../models/TradeLedger'); } catch (_) {}

function toNum(v) {
  if (v == null) return NaN;
  const n = Number(String(v).replace(/[,%$]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

async function fetchLedger(limit = 500) {
  // Prefer Mongo model if available
  if (TradeLedgerModel) {
    const rows = await TradeLedgerModel.find({}).sort({ closedAt: 1 }).limit(limit).lean();
    return Array.isArray(rows) ? rows : [];
  }
  // Fallback: call the HTTP route your server already mounted
  try {
    const r = await fetch(`http://localhost:${process.env.PORT || 3000}/api/trade-ledger?limit=${limit}`);
    const j = await r.json();
    if (j && j.success && Array.isArray(j.trades)) return j.trades;
    if (Array.isArray(j)) return j;
    if (Array.isArray(j?.rows)) return j.rows;
  } catch {}
  return [];
}

function tallyWinsLosses(rows) {
  let wins = 0, losses = 0;
  for (const t of rows) {
    if (String(t.status || '').toUpperCase() !== 'CLOSED') continue;
    const pnl = toNum(t.pnl);
    if (!Number.isFinite(pnl) || pnl === 0) continue;
    if (pnl > 0) wins++; else losses++;
  }
  return { wins, losses };
}

function computeTopTrade(rows) {
  let best = null;
  for (const t of rows) {
    if (String(t.status || '').toUpperCase() !== 'CLOSED') continue;
    const pnl = toNum(t.pnl);
    if (!Number.isFinite(pnl)) continue;
    if (!best || Math.abs(pnl) > Math.abs(best.pnl)) {
      best = { symbol: t.symbol || 'N/A', pnl, roi: t.roi ?? null };
    }
  }
  return best;
}

function computeStreaks(rows) {
  const sorted = rows
    .filter(t => String(t.status || '').toUpperCase() === 'CLOSED')
    .sort((a, b) => {
      const ta = toNum(a.closedAt ?? a.closeTime ?? a.updatedAt ?? a.time ?? 0);
      const tb = toNum(b.closedAt ?? b.closeTime ?? b.updatedAt ?? b.time ?? 0);
      return ta - tb;
    });

  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (const t of sorted) {
    const pnl = toNum(t.pnl);
    if (!Number.isFinite(pnl) || pnl === 0) { curW = 0; curL = 0; continue; }
    if (pnl > 0) { curW++; curL = 0; if (curW > maxW) maxW = curW; }
    else         { curL++; curW = 0; if (curL > maxL) maxL = curL; }
  }
  return { winStreak: maxW, lossStreak: maxL };
}

router.get('/session-stats', async (_req, res) => {
  try {
    // tokens & active
    let tokens = 0;
    try {
      if (typeof getActiveSymbols === 'function') {
        const arr = await getActiveSymbols(); // can be sync; await is harmless
        tokens = Array.isArray(arr) ? arr.length : 0;
      }
    } catch {}

    const positions = await getOpenFuturesPositions().catch(() => []);
    const activeTrades = Array.isArray(positions) ? positions.length : 0;

    // capital score (prefer dedicated component if available)
    let capitalScore = 0;
    if (typeof getCapitalStatus === 'function') {
      const cap = await getCapitalStatus().catch(() => null);
      if (cap && typeof cap.score === 'number') capitalScore = cap.score;
    }

    // ledger-driven stats
    const ledger = await fetchLedger(500);
    const { wins, losses } = tallyWinsLosses(ledger);
    const total = wins + losses;
    const winRate = total ? +(wins * 100 / total).toFixed(1) : 0;

    const top = computeTopTrade(ledger);
    const streaks = computeStreaks(ledger);

    return res.json({
      // counts
      wallets: 0,             // fill when you wire multi-wallet tracking
      tokens,
      active: activeTrades,

      // performance
      pnlScore: capitalScore, // % used by the front-end
      wins, losses, winRate,
      winStreak: streaks.winStreak,
      lossStreak: streaks.lossStreak,
      topTrade: top ? {
        symbol: top.symbol,
        pnl: Number(top.pnl.toFixed(2)),
        roi: top.roi ?? null
      } : null,

      // for debugging
      _rows: undefined
    });
  } catch (err) {
    console.error('❌ /api/session-stats error:', err.message);
    res.status(500).json({ error: 'session-stats failed' });
  }
});

module.exports = router;