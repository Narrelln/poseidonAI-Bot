// poseidonScanner.js — Minimal Symbol Manager (No Signal Logic)

import { setActiveSymbols } from './sessionStatsModule.js';
import { initFuturesPositionTracker } from './futuresPositionTracker.js';

let activeSymbols = [];
let scannerStarted = false;

export async function refreshSymbols() {
  try {
    const all = await fetch('/api/scan-tokens').then(r => r.json()).catch(() => ({ gainers: [], losers: [] }));
    const combined = [...(all.gainers || []), ...(all.losers || [])];

    const seen = new Set();
    const filtered = combined.filter(item => {
      const symbol = item.symbol;
      if (!symbol || seen.has(symbol)) return false;
      seen.add(symbol);
      const quoteVolume = parseFloat(item.quoteVolume || 0);
      const price = parseFloat(item.price || 0);
      let change = parseFloat(item.change || 0);
      if (Math.abs(change) > 0 && Math.abs(change) < 1) change *= 100;
      item.change = parseFloat(change.toFixed(2));
      item.price = price;
      item.quoteVolume = quoteVolume;
      return true;
    });

    if (filtered.length) {
      activeSymbols = filtered.map(e => e.symbol);
      setActiveSymbols(activeSymbols);
      activeSymbols.forEach(initFuturesPositionTracker);
    } else {
      console.warn('⚠️ No valid symbols found. Scanner skipped.');
    }
  } catch (err) {
    console.warn('⚠️ refreshSymbols error:', err.message);
  }
}

export function getActiveSymbols() {
  return activeSymbols;
}

export function startScanner() {
  if (scannerStarted) return;
  scannerStarted = true;

  setInterval(refreshSymbols, 15 * 60 * 1000);
  refreshSymbols();
}