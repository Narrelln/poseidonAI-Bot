// scripts/renderTradeHistory.js

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('trade-history-body');
  if (!tbody) return;

  // Live loader
  async function loadHistory() {
    try {
      const res = await fetch('/api/trade-history');
      const json = await res.json();
      const trades = Array.isArray(json) ? json : json.trades || [];

      tbody.innerHTML = '';

      if (trades.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="7">No trade history yet.</td>`;
        tbody.appendChild(row);
        return;
      }

      trades.forEach(trade => {
        const row = document.createElement('tr');
        const pnlVal = parseFloat(trade.pnl);
        const pnlClass = !isNaN(pnlVal) && pnlVal > 0 ? 'positive' : (pnlVal < 0 ? 'negative' : '');
        row.innerHTML = `
          <td>${trade.symbol}</td>
          <td>${trade.side}</td>
          <td>${trade.entry}</td>
          <td>${trade.exit || '-'}</td>
          <td class="${pnlClass}">${isNaN(pnlVal) ? '-' : pnlVal.toFixed(2)}</td>
          <td>${trade.status}</td>
          <td>${trade.date || '-'}</td>
        `;
        tbody.appendChild(row);
      });
    } catch (err) {
      console.error('Failed to load trade history:', err);
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="7">⚠️ Error loading history</td>`;
      tbody.appendChild(row);
    }
  }

  // Initial load
  loadHistory();

  // Live updates via Socket.io
  if (window.io) {
    const socket = io(); // Connect to backend

    // Reload on any trade open or close event
    socket.on('trade-closed', () => loadHistory());
    socket.on('trade-confirmed', () => loadHistory());
  }
});