// === /public/scripts/capitalScoreModule.js ===
export async function renderCapitalScore() {
  const el = document.getElementById('capital-score-display');
  if (!el) return;

  try {
    const res = await fetch('/api/trade-history');
    const data = await res.json();
    const trades = data?.trades || [];

    if (!trades.length) {
      el.textContent = '--';
      return;
    }

    let total = 0;
    let score = 0;
    let wins = 0;

    trades.forEach(trade => {
      const pnl = parseFloat(trade.pnl || 0);
      const roi = parseFloat(trade.roi || 0);
      const isWin = roi > 0;

      if (!isNaN(pnl)) total += Math.abs(pnl);
      if (isWin) {
        wins++;
        score += roi;
      } else {
        score -= Math.abs(roi) * 0.5;
      }
    });

    const accuracy = (wins / trades.length) * 100;

    if (!total || isNaN(score)) {
      el.textContent = '0.0 (0%)';
      return;
    }

    const capitalScore = Math.max(0, Math.min(100, (score / total) * 100));
    el.textContent = `${capitalScore.toFixed(1)} (${accuracy.toFixed(0)}%)`;
  } catch (err) {
    console.warn('⚠️ Failed to compute capital score:', err.message);
    el.textContent = '⚠️';
  }
}