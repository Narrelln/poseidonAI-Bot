const DEBUG_MODE = true; // set to false to silence logs
import {
  toKuCoinContractSymbol,
  getOpenPositions,
} from '/scripts/futuresApiClient.js';

import { evaluatePoseidonDecision } from '../scripts/decisionHelper.js';
import { isBotActive } from '/scripts/poseidonBotModule.js';
import { detectTrendPhase } from '/scripts/trendPhaseDetector.js';
import { calculateConfidence } from '/scripts/taFrontend.js'; // (kept absolute like your import)
import {
  logSignalToFeed,
  logToLiveFeed,
  logDetailedAnalysisFeed
} from './liveFeedRenderer.js';

// ★ ADDED: strategy selector (kept in /public/scripts next to this file)
import { chooseStrategy } from './strategyRouter.js'; // ★ ADDED

const MAX_VOLUME_CAP = 20_000_000;

const taCache = new Map();

// ── Cycle Watch (front-end, in-memory) ───────────────────────────────
const CYCLE = {
  by: new Map(),
  WINDOW_MS: 48 * 60 * 60 * 1000, // 48h window
  PEAK_COOLDOWN_MS: 90 * 60 * 1000, // 90 mins cooldown
};

function baseKey(sym) {
  return String(sym).toUpperCase().replace(/[-_]/g,'').replace(/USDTM?$/,'');
}

function touchCycle(symbol, price, confidence, corrId) {
  // ... function body
}

function markOpened(symbol, side) {
  // ... function body
}

function markExited(symbol, reversalSide) {
  // ... function body
}
// ────────────────────────────────────────────────────────────────────

const softBanList = new Map();
let scanIndex = 0;
let scanInterval = null;

// Whitelisted tokens that bypass volume cap
const WHITELIST_TOKENS = [
  'BTCUSDTM', 'ETHUSDTM', 'BNBUSDTM', 'SOLUSDTM', 'XRPUSDTM', 'ADAUSDTM',
  'AVAXUSDTM', 'DOGEUSDTM', 'LINKUSDTM', 'LTCUSDTM',
  'SHIBUSDTM', 'PEPEUSDTM', 'TRUMPUSDTM', 'FLOKIUSDTM', 'BONKUSDTM',
  'WIFUSDTM', 'AIDOGEUSDTM', 'TSUKAUSDTM', 'HARRYUSDTM', 'WOJAKUSDTM',
  'GROKUSDTM', 'BODENUSDTM', 'MAGAUSDTM', 'MYROUSDTM'
];

async function fetchTA(symbol) {
  if (taCache.has(symbol)) return taCache.get(symbol);

  try {
    const res = await fetch(`/api/ta/${symbol}`);
    if (!res.ok) throw new Error(`TA endpoint ${res.status}`);
    const ta = await res.json();
    taCache.set(symbol, ta);
    return ta;
  } catch (err) {
    console.warn(`[TA] Fallback for ${symbol}:`, err.message);
    taCache.set(symbol, null);
    return null;
  }
}

async function fetchScannerData() {
  try {
    const res = await fetch('/api/scan-tokens');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json?.top50 || [];
  } catch (err) {
    console.error('Failed to fetch scanner data:', err.message);
    return [];
  }
}

export async function analyzeAndTrigger(symbol, options = {}, attempt = 1) {
  try {
    if (!isBotActive() && !options.manual) return null;
    if (!symbol || (typeof symbol === 'object' && !symbol.symbol)) return null;
    if (typeof symbol === 'object') symbol = symbol.symbol;
    if (!symbol || typeof symbol !== 'string') return null;
    if (symbol.includes('ALTCOIN') || symbol.includes('ZEUS') || symbol.includes('TEST')) return null;

    const contractSymbol = toKuCoinContractSymbol(symbol);
    const safeSymbol = contractSymbol.endsWith('M') ? contractSymbol : contractSymbol + 'M';

    const allScannerSymbols = await fetchScannerData();

    function normalizeSymbolForMatch(s) {
      return s.replace(/[-_]/g, '').replace(/USDTM?$/, '').toUpperCase();
    }

    const normalizedTarget = normalizeSymbolForMatch(safeSymbol);
    let scannerMatch = allScannerSymbols.find(t =>
      normalizeSymbolForMatch(t.symbol) === normalizedTarget
    );

    if (!scannerMatch) {
      scannerMatch = allScannerSymbols.find(t =>
        normalizeSymbolForMatch(t.symbol).startsWith(normalizedTarget)
      );
    }

    if (!scannerMatch) {
      console.warn(`❌ No scanner match for ${safeSymbol} — Attempt ${attempt}`);
      if (attempt >= 2) {
        console.warn('🔍 All symbols available:', allScannerSymbols.map(s => s.symbol));
      }
      return null;
    }

    const price  = scannerMatch.price;
    const volume = scannerMatch.quoteVolume;

    // ★ ADDED: we also compute 24h delta and base for strategy routing (non-breaking)
    const delta24h = Number(scannerMatch.priceChgPct ?? scannerMatch.change ?? 0); // ★ ADDED
    const base = String(safeSymbol).toUpperCase().replace(/[-_]/g,'').replace(/USDTM?$/,''); // ★ ADDED

    const isWhitelisted = WHITELIST_TOKENS.includes(safeSymbol);

    if (!price || !volume || price <= 0 || (!isWhitelisted && volume > MAX_VOLUME_CAP)) {
      console.warn(`⛔ Invalid price/volume for ${safeSymbol}`, scannerMatch);
      return null;
    }

    const delta = scannerMatch.priceChgPct ?? '--';
    const ta = await fetchTA(safeSymbol);
    if (!ta) return null;

    if (DEBUG_MODE) {
      console.log(`[FRONTEND TA] ${safeSymbol}`, {
        signal: ta.signal,
        confidence: ta.confidence,
        price: ta.price
      });
    }

    const macdSignal  = ta.macdSignal || '--';
    const bbSignal    = ta.bbSignal || '--';
    const volumeSpike = !!ta.volumeSpike;
    const rsi         = ta.rsi ?? '--';
    const trapWarning = !!ta.trapWarning;

    const confidence = parseFloat(calculateConfidence(macdSignal, bbSignal, volumeSpike));

    const result = {
      symbol: safeSymbol,
      signal: ta.signal,
      confidence,
      rsi,
      macdSignal,
      bbSignal,
      volume,
      price,
      trapWarning,
      volumeSpike,
      openPosition: false,
      skipped: false
    };

    if (!['bullish', 'bearish'].includes(ta.signal) || confidence < 70) {
      if (DEBUG_MODE) {
        console.warn(`🟡 Skipped ${safeSymbol} → Signal: ${ta.signal}, Confidence: ${confidence}`);
      }
      result.skipped = true;
      return result;
    }

    if (!options.manual) {
      const open = await getOpenPositions();
      const alreadyOpen = open.some(pos => toKuCoinContractSymbol(pos.symbol) === safeSymbol);
      if (alreadyOpen) {
        result.openPosition = true;
        result.skipped = true;
        return result;
      }
    }

    const trendPhase = await detectTrendPhase(safeSymbol);
    if (['peak', 'reversal'].includes(trendPhase.phase)) {
      logSignalToFeed({ symbol: safeSymbol, confidence, signal: ta.signal || '--', delta, volume, price });
      await evaluatePoseidonDecision(safeSymbol, {});
      result.skipped = true;
      return result;
    }

    const bigDrop = false;
    const bigPump = false;
    const allocationPct = confidence >= 85 ? 25 : 10;

    // ★ ADDED: pick the micro‑strategy for this symbol *right now*
    const strategy = chooseStrategy(base, {
      delta24h,
      rsi: Number(rsi),         // Number() to normalize '--' to NaN safely inside chooser
      volumeSpike,
      taSignal: ta.signal
    }); // ★ ADDED

    const analysis = {
      symbol: safeSymbol,
      signal: ta.signal,
      macdSignal,
      bbSignal,
      volumeSpike,
      confidence,
      rsi,
      trapWarning,
      bigDrop,
      bigPump,
      manual: options.manual || false,
      allocationPct,
      strategy // ★ ADDED
    };

    logSignalToFeed({
      symbol: safeSymbol,
      confidence,
      signal: ta.signal || '--',
      delta,
      volume,
      price
    });

    logDetailedAnalysisFeed({
      symbol: safeSymbol,
      signal: ta.signal,
      rsi,
      macdSignal,
      bbSignal,
      confidence,
      volumeSpike,
      trapWarning
    });

    await evaluatePoseidonDecision(safeSymbol, analysis);

    return result;

  } catch (err) {
    console.error(`✘ Analysis failed for ${symbol}:`, err.message);
    logToLiveFeed({ symbol, message: err.message, type: 'error' });
    return null;
  }
}

export async function startSignalEngine() {
  if (scanInterval) return;

  console.log('🚀 Starting Signal Engine...');
  scanInterval = setInterval(async () => {
    if (!isBotActive()) return;

    const symbols = await fetchScannerData();
    if (!symbols || symbols.length === 0) {
      console.warn('⚠️ No valid symbols in active list.');
      return;
    }

    const symbol = symbols[scanIndex];
    if (symbol) await analyzeAndTrigger(symbol);
    scanIndex = (scanIndex + 1) % symbols.length;
  }, 12_000);
}

export async function detectBigDrop(symbol) {
  return false;
}

export async function detectBigPump(symbol) {
  return false;
}

window.analyzeAndTrigger = analyzeAndTrigger;
window.startSignalEngine = startSignalEngine;