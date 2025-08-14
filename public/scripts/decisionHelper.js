// === decisionHelper.js — Frontend Poseidon Trade Evaluator (ES Module)

import { getCachedScannerData } from './scannerCache.js';
import { getWalletBalance } from './walletModule.js'; // Stub or real version if needed
import { openDualEntry } from './ppdaEngine.js'; // Optional: stub if not available

// Capital state (dummy placeholder)
const capitalState = {
  total: 0,
  allocated: 0,
  free: 0,
  update(wallet, allocations = []) {
    this.total = wallet.available || 0;
    this.allocated = allocations.reduce((sum, a) => sum + a, 0);
    this.free = Math.max(this.total - this.allocated, 0);
  }
};

function normalize(symbol) {
  return symbol.replace(/[-_]/g, '').replace(/USDTM?$/, '').toUpperCase();
}

function getScannerToken(symbol, top50) {
  const norm = normalize(symbol);
  return top50.find(t => normalize(t.symbol) === norm);
}

export async function evaluatePoseidonDecision(symbol, signal = {}) {
  console.log(`[DecisionHelper] Evaluating ${symbol}`, signal);

  try {
    const { top50 } = await getCachedScannerData();
    const token = getScannerToken(symbol, top50);

    const price = parseFloat(token?.price || 0);
    const volume = parseFloat(token?.volume || 0);
    if (!price || isNaN(price)) return;
    if (!volume || isNaN(volume)) return;

    if (volume > 20_000_000 && !signal?.override) {
      console.warn(`[DecisionHelper] Skipping ${symbol} — volume too high`);
      return;
    }

    if (volume < 100_000) {
      console.warn(`[DecisionHelper] Skipping ${symbol} — volume too low`);
      return;
    }

    if (!signal?.manual && signal?.confidence >= 75) {
      const phase = signal.phase || "unknown";
      if (["peak", "reversal"].includes(phase)) {
        console.log(`[DecisionHelper] PPDA Triggered for ${symbol}`);
        openDualEntry({
          symbol,
          highConfidenceSide: "SHORT",
          lowConfidenceSide: "LONG",
          baseAmount: 1
        });
        return;
      }
    }

    const side = signal.forceLong ? "LONG" : "SHORT";
    const wallet = await getWalletBalance();
    const basePercent = signal?.confidence >= 85 ? 0.25 : 0.10;
    const capital = Math.min(wallet.available * basePercent, 250);
    const size = +(capital / price).toFixed(3);

    capitalState.update(wallet, [capital]);

    console.log(`[DecisionHelper] ✅ ${symbol} → ${side} entry @ ${price}, size: ${size}`);
    // Place mock trade here (or pass to executor module)


  } catch (err) {
    console.error(`[DecisionHelper] Fatal error in ${symbol}:`, err.message);
  }
}
