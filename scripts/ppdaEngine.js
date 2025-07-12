// ppdaEngine.js — Peak Pressure Dual-Allocation Strategy Module

import { executeTrade, closeTrade } from './futuresExecutionModule.js';
import { getOpenPositions, fetchFuturesPrice } from './futuresApi.js';
import { logToFeed } from './futuresUtils.js';
import { updatePerformance } from './futuresPerformancePanel.js';
import { updateMemoryFromResult } from './futuresDecisionEngine.js';

let activePPDATrades = {};

export function initPPDAEngine() {
  console.log("🧠 PPDA Engine Initialized");
  logToFeed("🧠 PPDA Engine ready — monitoring dual-entry trades.");
}

// === Open Dual Trade Entry ===
export function openDualEntry({ symbol, highConfidenceSide = 'SHORT', lowConfidenceSide = 'LONG', baseAmount = 5 }) {
  const highAmount = baseAmount * 2;
  const lowAmount = baseAmount;

  executeTrade(symbol, highConfidenceSide, highAmount);
  executeTrade(symbol, lowConfidenceSide, lowAmount);

  activePPDATrades[symbol] = {
    high: { side: highConfidenceSide, amount: highAmount },
    low: { side: lowConfidenceSide, amount: lowAmount },
    openedAt: Date.now(),
  };

  logToFeed(`📊 PPDA Dual Entry → ${symbol}: ${highConfidenceSide} (${highAmount}), ${lowConfidenceSide} (${lowAmount})`);
}

// === Resolve PPDA Outcome ===
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

  // === Profitable Side Handling ===
  if (pnlHigh > 0 && pnlLow < 0) {
    closeTrade(symbol, trade.high.side);
    logToFeed(`✅ ${symbol}: Closed profitable ${trade.high.side}. DCA on ${trade.low.side}.`);

    executeTrade(symbol, trade.low.side, Math.abs(pnlHigh / priceVal));

    updatePerformance({ direction: trade.high.side, confidence: 70, result: 'win' });
    updatePerformance({ direction: trade.low.side, confidence: 60, result: 'loss' });

    updateMemoryFromResult(symbol, trade.high.side, 'win');
    updateMemoryFromResult(symbol, trade.low.side, 'loss');
  } else if (pnlLow > 0 && pnlHigh < 0) {
    closeTrade(symbol, trade.low.side);
    logToFeed(`✅ ${symbol}: Closed profitable ${trade.low.side}. DCA on ${trade.high.side}.`);

    executeTrade(symbol, trade.high.side, Math.abs(pnlLow / priceVal));

    updatePerformance({ direction: trade.low.side, confidence: 70, result: 'win' });
    updatePerformance({ direction: trade.high.side, confidence: 60, result: 'loss' });

    updateMemoryFromResult(symbol, trade.low.side, 'win');
    updateMemoryFromResult(symbol, trade.high.side, 'loss');
  } else {
    logToFeed(`📉 ${symbol}: No profitable PPDA side yet. Holding.`);
  }
}