// routes/sessionStatsRoute.js
const express = require('express');
const router = express.Router();

const { safeReadHistory } = require('../utils/tradeHistory');
const { getOpenFuturesPositions } = require('../kucoinHelper');
const { getCachedTokens } = require('../handlers/futuresApi');
const { getWalletBalance } = require('../handlers/walletModule');

const n = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

function computeClosedTradeStats(history) {
  const closed = history.filter(t => String(t.status).toUpperCase() === 'CLOSED');

  let trades = 0, wins = 0, losses = 0;
  let sumRoi = 0, roiCount = 0;
  let topTrade = null;

  for (const t of closed) {
    const pnl = n(t.pnl, 0);
    const roiPct = typeof t.roi === 'string'
      ? n(t.roi.replace(/\s*%$/, ''))
      : n(t.roi);

    trades++;
    if (pnl > 0) wins++;
    if (pnl < 0) losses++;

    if (Number.isFinite(roiPct)) {
      sumRoi += roiPct;
      roiCount++;
    }

    if (!topTrade || Math.abs(pnl) > Math.abs(n(topTrade.pnl))) {
      topTrade = { symbol: t.symbol, pnl: Number(pnl.toFixed(2)), roi: Number.isFinite(roiPct) ? roiPct : null };
    }
  }

  let winStreak = 0, lossStreak = 0;
  for (const t of closed) {
    const pnl = n(t.pnl, 0);
    if (pnl > 0) {
      if (lossStreak === 0) winStreak++;
      else break;
    } else if (pnl < 0) {
      if (winStreak === 0) lossStreak++;
      else break;
    } else break;
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgRoi = roiCount > 0 ? (sumRoi / roiCount) : null;

  return {
    trades,
    wins,
    losses,
    winRate: Number(winRate.toFixed(1)),
    winStreak,
    lossStreak,
    avgRoi: avgRoi !== null ? Number(avgRoi.toFixed(2)) : null,
    topTrade: topTrade || null,
  };
}

router.get('/session-stats', async (_req, res) => {
  try {
    let openPositions = [];
    try { openPositions = await getOpenFuturesPositions(); } catch {}
    const active = Array.isArray(openPositions) ? openPositions.length : 0;
    const livePnl = Array.isArray(openPositions)
      ? openPositions.reduce((s, p) => s + n(p.pnlValue ?? p.pnl ?? 0), 0)
      : 0;

    let tokens = 0;
    try {
      const list = await getCachedTokens();
      const arr =
        Array.isArray(list) ? list :
        Array.isArray(list?.top50) ? list.top50 :
        (Array.isArray(list?.gainers) || Array.isArray(list?.losers))
          ? [...(list.gainers || []), ...(list.losers || [])]
          : [];
      tokens = arr.length;
    } catch {}

    let wallets = 0;
    try {
      const bal = await getWalletBalance();
      if (Number(bal) >= 0) wallets = 1;
    } catch {}

    const history = safeReadHistory();
    const stats = computeClosedTradeStats(history);

    res.json({
      success: true,
      pnlScore: Number(livePnl.toFixed(2)),
      wallets,
      tokens,
      active,
      trades: stats.trades,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      avgRoi: stats.avgRoi,
      winStreak: stats.winStreak,
      lossStreak: stats.lossStreak,
      topTrade: stats.topTrade
    });
  } catch (err) {
    console.error('[session-stats] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;