// futuresPerformancePanel.js — LIVE Poseidon Performance Panel

let performanceStats = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  avgROI: 0,
  topCoin: 'N/A',
  winRate: 0,
};

let roiHistory = [];
let tradeCountBySymbol = {};

// Live refresh interval (in ms)
const REFRESH_INTERVAL = 10000; // 10 seconds

export async function initPerformancePanel() {
  await loadAndRenderStats();
  setInterval(loadAndRenderStats, REFRESH_INTERVAL);
}

async function loadAndRenderStats() {
  try {
    const res = await fetch('/api/trade-history');
    const { trades } = await res.json();

    performanceStats.totalTrades = trades.length;
    performanceStats.wins = trades.filter(t => t.pnl > 0).length;
    performanceStats.losses = trades.filter(t => t.pnl <= 0).length;

    // ROI and win rate
    roiHistory = trades.map(t => (parseFloat(t.roi) || 0));
    performanceStats.avgROI = roiHistory.length
      ? (roiHistory.reduce((a, b) => a + b, 0) / roiHistory.length).toFixed(2)
      : '0.00';

    performanceStats.winRate = performanceStats.totalTrades
      ? ((performanceStats.wins / performanceStats.totalTrades) * 100).toFixed(1)
      : '0.0';

    // Top coin
    tradeCountBySymbol = {};
    trades.forEach(t => {
      if (t.symbol) tradeCountBySymbol[t.symbol] = (tradeCountBySymbol[t.symbol] || 0) + 1;
    });
    const sorted = Object.entries(tradeCountBySymbol).sort((a, b) => b[1] - a[1]);
    performanceStats.topCoin = sorted.length ? sorted[0][0] : 'N/A';

    renderPerformancePanel();
  } catch (err) {
    console.error('❌ Error loading performance stats:', err);
  }
}

function renderPerformancePanel() {
  const panel = document.getElementById("futures-performance-panel");
  if (!panel) return;

  panel.innerHTML = `
    <div><strong>Total Trades:</strong> ${performanceStats.totalTrades}</div>
    <div><strong>Win Rate:</strong> ${performanceStats.winRate}%</div>
    <div><strong>Avg ROI:</strong> ${performanceStats.avgROI}%</div>
    <div><strong>Top Coin:</strong> ${performanceStats.topCoin}</div>
    <hr style="border-color:#00f7ff33;">
  `;
}