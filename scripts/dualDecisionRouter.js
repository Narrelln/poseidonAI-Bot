// === dualDecisionRouter.js — Smart Strategy Delegator with Auto Execution ===

import { evaluatePoseidonDecision, updateMemoryFromResult } from './evaluatePoseidonDecision.js';
import { evaluatePPDA } from './ppdaDecisionEngine.js';
import { executeTrade } from './futuresExecutionModule.js';
import { getActiveSymbols } from './futuresSignalModule.js';

let lastExecuted = {};

export async function routeTradeDecision(symbol) {
  const cooldown = 30 * 1000; // 30 sec cooldown per symbol
  const now = Date.now();

  if (lastExecuted[symbol] && now - lastExecuted[symbol] < cooldown) {
    return; // ⏳ Skip if still in cooldown
  }

  // === Try Conservative First
  const conservativeDecision = await evaluatePoseidonDecision(symbol);

  if (conservativeDecision === "TP") {
    updateMemoryFromResult(symbol, "TP");
    lastExecuted[symbol] = now;
    return;
  }

  if (conservativeDecision === "SL") {
    updateMemoryFromResult(symbol, "SL");
    lastExecuted[symbol] = now;
    return;
  }

  if (conservativeDecision === "DCA") {
    executeTrade(symbol, "LONG", 100, false, 5); // Default 5x leverage
    updateMemoryFromResult(symbol, "DCA");
    lastExecuted[symbol] = now;
    return;
  }

  // === Fallback: Try PPDA if HOLD
  if (conservativeDecision === "HOLD") {
    const ppdaDecision = await evaluatePPDA(symbol);

    if (ppdaDecision?.action === "LONG" || ppdaDecision?.action === "SHORT") {
      executeTrade(symbol, ppdaDecision.action, 100, false, 5);
      lastExecuted[symbol] = now;
    }
  }
}