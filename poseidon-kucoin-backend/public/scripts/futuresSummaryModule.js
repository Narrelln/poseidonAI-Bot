import { fetchFuturesPrice, fetchVolumeAndOI, getOpenPositions } from './futuresApi.js';
import { getLastClosedTrade } from './futuresPositionTracker.js';

void fetchFuturesPrice;
void fetchVolumeAndOI


export async function updateFuturesSummary(symbol = 'DOGEUSDT') {
  const summaryPanel = document.getElementById('futures-connection');
  const lastTradeEl = document.getElementById('futures-last-trade');
  const livePnlEl = document.getElementById('futures-live-pnl');

  try {
    // 1. Check connection status (you can expand this as needed)
    if (summaryPanel) summaryPanel.textContent = "Connected";
    
    // 2. Get open position (live)
    const openPositions = await getOpenPositions(symbol);
    let livePnL = '--';
    if (openPositions && openPositions.unrealisedPnl !== undefined) {
      livePnL = parseFloat(openPositions.unrealisedPnl).toFixed(2);
    }
    if (livePnlEl) livePnlEl.textContent = livePnL !== '--' ? `${livePnL} USDT` : '--';

    // 3. Last closed trade info
    const lastTrade = getLastClosedTrade ? await getLastClosedTrade(symbol) : null;
    if (lastTrade) {
      const { symbol, side, pnl, exit, date } = lastTrade;
      let summary = `${symbol || ''} ${side ? side.toUpperCase() : ''}`;
      if (pnl !== undefined) summary += ` | PNL: ${parseFloat(pnl).toFixed(2)} USDT`;
      if (date) summary += ` | ${new Date(date).toLocaleString()}`;
      if (lastTradeEl) lastTradeEl.textContent = summary;
    } else {
      if (lastTradeEl) lastTradeEl.textContent = '--';
    }

  } catch (err) {
    if (summaryPanel) summaryPanel.textContent = "Disconnected";
    if (lastTradeEl) lastTradeEl.textContent = '--';
    if (livePnlEl) livePnlEl.textContent = '--';
    console.warn("❌ Error updating auto trading summary:", err.message);
  }
}