// Performance Metrics
export function initStats() {
  console.log("📊 ROI tracking online");
}
// futuresPerformancePanel.js — Poseidon Strategy Performance Stats

let stats = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  roiSum: 0,
  topCoin: '',
  coinStats: {}
};

// === Call to update UI after each trade ===
export function updatePerformance({ direction, confidence, result }) {
  stats.totalTrades++;

  if (result === 'win') {
    stats.wins++;
    const roi = parseFloat(confidence) || 20;
    stats.roiSum += roi;
  } else if (result === 'loss') {
    stats.losses++;
    stats.roiSum -= 10; // Estimated loss ROI
  }

  // Track most used coin
  if (!stats.coinStats[direction]) stats.coinStats[direction] = 0;
  stats.coinStats[direction]++;
  updateTopCoin();

  renderPerformance();
}

function updateTopCoin() {
  let max = 0;
  let top = '';
  for (const symbol in stats.coinStats) {
    if (stats.coinStats[symbol] > max) {
      max = stats.coinStats[symbol];
      top = symbol;
    }
  }
  stats.topCoin = top;
}

// === Render to DOM ===
function renderPerformance() {
  const totalEl = document.getElementById("fut-total");
  const winrateEl = document.getElementById("fut-winrate");
  const roiEl = document.getElementById("fut-roi");
  const topCoinEl = document.getElementById("fut-topcoin");

  if (totalEl) totalEl.textContent = stats.totalTrades;
  if (winrateEl) {
    const rate = stats.wins / Math.max(stats.totalTrades, 1) * 100;
    winrateEl.textContent = `${rate.toFixed(1)}%`;
  }
  if (roiEl) {
    const avgROI = stats.roiSum / Math.max(stats.totalTrades, 1);
    roiEl.textContent = `${avgROI.toFixed(1)}%`;
  }
  if (topCoinEl) topCoinEl.textContent = stats.topCoin || '--';
}

// === Optional: Reset for session start ===
export function resetPerformanceStats() {
  stats = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    roiSum: 0,
    topCoin: '',
    coinStats: {}
  };
  renderPerformance();
}