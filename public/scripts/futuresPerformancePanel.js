// futuresPerformancePanel.js — LIVE Poseidon Performance Panel (PPDA-Enhanced, hardened)

let performanceStats = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  avgROI: 0,                // average ROI over (closed) trades
  topCoin: 'N/A',
  winRate: 0,
  ppdaResolutions: 0,       // number of trades with recoveredROI
  avgRecoveryROI: 0,        // average of recoveredROI
  lastResolvedSymbol: 'N/A',
};

let roiHistoryAll = [];       // ROI from trades (for avgROI)
let recoveryRoiHistory = [];  // recoveredROI only (for avgRecoveryROI)
let tradeCountBySymbol = {};
let _timer = null;

// Live refresh interval (ms)
const REFRESH_INTERVAL = 10_000;

// ---------- helpers ----------
function toNum(v) {
  if (v == null) return NaN;
  const n = Number(String(v).replace(/[,%$]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function pickTradesShape(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.trades)) return payload.trades;
  if (payload.success && Array.isArray(payload.trades)) return payload.trades;
  if (Array.isArray(payload.rows)) return payload.rows; // legacy fallback
  return [];
}

function isClosed(t) {
  const s = String(t.status || t.state || '').toUpperCase();
  return s === 'CLOSED' || s === 'FILLED' || s === 'DONE';
}

function safeSymbol(t) {
  return (t.symbol || t.contract || t.pair || 'N/A').toString().toUpperCase();
}

// ---------- public API ----------
export async function initPerformancePanel() {
  // avoid multiple timers if called more than once
  if (_timer) clearInterval(_timer);
  await loadAndRenderStats();
  _timer = setInterval(loadAndRenderStats, REFRESH_INTERVAL);
}

// Can be called by PPDA resolver when a recovery happens in real time
export function updatePerformance({ recoveredROI, symbol }) {
  const r = toNum(recoveredROI);
  if (Number.isFinite(r)) {
    recoveryRoiHistory.push(r);
    performanceStats.ppdaResolutions += 1;
    performanceStats.avgRecoveryROI = (
      recoveryRoiHistory.reduce((a, b) => a + b, 0) / recoveryRoiHistory.length
    ).toFixed(2);
  }
  if (symbol) performanceStats.lastResolvedSymbol = String(symbol).toUpperCase();
  renderPerformancePanel();
}

// ---------- core ----------
async function loadAndRenderStats() {
  try {
    const res = await fetch('/api/trade-history', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json().catch(() => ({}));
    const trades = pickTradesShape(payload);

    // Tally basics
    const closed = trades.filter(isClosed);
    performanceStats.totalTrades = closed.length;

    const wins = [];
    const losses = [];
    const roiAll = [];

    tradeCountBySymbol = {};

    for (const t of closed) {
      const sym = safeSymbol(t);
      const pnl = toNum(t.pnl);
      const roi = toNum(t.roi);

      tradeCountBySymbol[sym] = (tradeCountBySymbol[sym] || 0) + 1;

      if (Number.isFinite(roi)) roiAll.push(roi);
      if (Number.isFinite(pnl)) {
        if (pnl > 0) wins.push(t);
        else if (pnl < 0) losses.push(t);
      }
    }

    performanceStats.wins = wins.length;
    performanceStats.losses = losses.length;
    performanceStats.winRate = performanceStats.totalTrades
      ? ((performanceStats.wins / performanceStats.totalTrades) * 100).toFixed(1)
      : '0.0';

    roiHistoryAll = roiAll;
    performanceStats.avgROI = roiHistoryAll.length
      ? (roiHistoryAll.reduce((a, b) => a + b, 0) / roiHistoryAll.length).toFixed(2)
      : '0.00';

    // Top coin by closed-trade count
    const sorted = Object.entries(tradeCountBySymbol).sort((a, b) => b[1] - a[1]);
    performanceStats.topCoin = sorted.length ? sorted[0][0] : 'N/A';

    // PPDA recovery metrics (pull from trade records if present)
    const recoveries = closed
      .map(t => ({ sym: safeSymbol(t), r: toNum(t.recoveredROI ?? t.ppdaRecoveredROI) }))
      .filter(x => Number.isFinite(x.r));

    recoveryRoiHistory = recoveries.map(x => x.r);
    performanceStats.ppdaResolutions = recoveryRoiHistory.length;
    performanceStats.avgRecoveryROI = recoveryRoiHistory.length
      ? (recoveryRoiHistory.reduce((a, b) => a + b, 0) / recoveryRoiHistory.length).toFixed(2)
      : '0.00';
    performanceStats.lastResolvedSymbol = recoveries.length
      ? recoveries[recoveries.length - 1].sym
      : 'N/A';

    renderPerformancePanel();
  } catch (err) {
    console.error('❌ Error loading performance stats:', err.message || err);
    // keep previous values; just render them
    renderPerformancePanel();
  }
}

function renderPerformancePanel() {
  const panel = document.getElementById('futures-performance-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div><strong>Total Trades:</strong> ${performanceStats.totalTrades}</div>
    <div><strong>Win Rate:</strong> ${performanceStats.winRate}%</div>
    <div><strong>Avg ROI:</strong> ${performanceStats.avgROI}%</div>
    <div><strong>Top Coin:</strong> ${performanceStats.topCoin}</div>
    <hr style="border-color:#00f7ff33;">
    <div><strong>PPDA Resolved:</strong> ${performanceStats.ppdaResolutions}</div>
    <div><strong>Avg Recovery ROI:</strong> ${performanceStats.avgRecoveryROI}%</div>
    <div><strong>Last Recovery:</strong> ${performanceStats.lastResolvedSymbol}</div>
  `;
}