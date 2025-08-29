// ppdaEngine.js — Peak Pressure Dual-Allocation Strategy Module (Patched)

import { executeTrade, closeTrade } from './futuresExecutionModule.js';
// import { getOpenPositions, fetchFuturesPrice } from './futuresApiClient.js';
import { logToFeed } from './futuresUtils.js';
import { updatePerformance } from './futuresPerformancePanel.js';
// import { updateMemoryFromResult } from './updateMemoryFromResult.js'; ❌ removed — backend only

// ✅ Frontend-safe fallback stub
const updateMemoryFromResult = () => {};

let activePPDATrades = {};
let resolutionStats = {};
let ppdaIntervalStarted = false;

export function initPPDAEngine() {
  console.log("🧠 PPDA Engine Initialized");
  logToFeed("🧠 PPDA Engine ready — monitoring dual-entry trades.");
  monitorActivePPDA();
}

export function openDualEntry({ symbol, highConfidenceSide = 'SHORT', lowConfidenceSide = 'LONG', baseAmount = 5 }) {
  const highAmount = baseAmount * 2;
  const lowAmount = baseAmount;

  executeTrade(symbol, highConfidenceSide, highAmount);
  executeTrade(symbol, lowConfidenceSide, lowAmount);

  activePPDATrades[symbol] = {
    high: { side: highConfidenceSide, amount: highAmount },
    low: { side: lowConfidenceSide, amount: lowAmount },
    openedAt: Date.now()
  };

  resolutionStats[symbol] = {
    attempts: 0,
    success: 0,
    fail: 0,
    lastResolutionTime: null,
    recoveredROI: []
  };

  logToFeed(`📊 PPDA Dual Entry → ${symbol}: ${highConfidenceSide} (${highAmount}), ${lowConfidenceSide} (${lowAmount})`);
}

export async function resolvePPDAOutcome(symbol) {
  const trade = activePPDATrades[symbol];
  if (!trade) return;

  const positions = await getOpenPositions(symbol);
  const price = await fetchFuturesPrice(symbol);

  if (!positions || !price || !price.price) {
    logToFeed(`⚠️ Unable to resolve PPDA for ${symbol} (missing data).`);
    return;
  }

  const pnlHigh = parseFloat(positions?.[trade.high.side]?.unrealisedPnl || 0);
  const pnlLow = parseFloat(positions?.[trade.low.side]?.unrealisedPnl || 0);
  const priceVal = parseFloat(price.price);
  const now = Date.now();
  const stats = resolutionStats[symbol];
  stats.attempts++;

  const closeAndDCA = async (winner, loser, pnl) => {
    await closeTrade(symbol, winner.side);
    logToFeed(`✅ ${symbol}: Closed profitable ${winner.side}. DCA on ${loser.side}.`);

    const dcaSize = +(Math.abs(pnl / priceVal)).toFixed(3);
    
    await executeTrade(symbol, loser.side, dcaSize);

    // === Performance + Memory
    updatePerformance({ recoveredROI: pnl.toFixed(2), symbol });

    updateMemoryFromResult(symbol, winner.side, 'win', pnl, 70, {
      dcaCount: 0,
      time: now,
      tradeType: winner.side
    });

    updateMemoryFromResult(symbol, loser.side, 'loss', -pnl, 60, {
      dcaCount: 1,
      time: now,
      tradeType: loser.side
    });

    const timeTaken = ((now - trade.openedAt) / 1000).toFixed(1);
    stats.success++;
    stats.lastResolutionTime = `${timeTaken}s`;
    stats.recoveredROI.push(pnl.toFixed(2));
    delete activePPDATrades[symbol];
  };

  if (pnlHigh > 0 && pnlLow < 0) {
    await closeAndDCA(trade.high, trade.low, pnlHigh);
  } else if (pnlLow > 0 && pnlHigh < 0) {
    await closeAndDCA(trade.low, trade.high, pnlLow);
  } else {
    logToFeed(`📉 ${symbol}: No profitable PPDA side yet. Holding.`);
    stats.fail++;
  }
}

function monitorActivePPDA() {
  if (ppdaIntervalStarted) return;
  ppdaIntervalStarted = true;

  setInterval(async () => {
    const symbols = Object.keys(activePPDATrades);
    for (const symbol of symbols) {
      try {
        await resolvePPDAOutcome(symbol);
      } catch (err) {
        console.warn(`⚠️ PPDA error for ${symbol}:`, err.message);
      }
    }
  }, 60 * 1000); // 60s interval
}

export function getPPDAStats(symbol = null) {
  return symbol ? resolutionStats[symbol] : resolutionStats;
}