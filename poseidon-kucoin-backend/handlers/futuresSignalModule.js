// === FSM / Signal Engine (patched) ===
// - Local calculateConfidence (server-side)
// - Quote-volume aware gating
// - Uses poseidonScanner for active symbols
// - Compatible with taHandler output

const {
  toKuCoinContractSymbol,
  getScanTokenBySymbol,
  getOpenPositions
} = require('./futuresApi');

// If you keep a server decision helper, leave this import;
// otherwise swap to your server-side evaluatePoseidonDecision implementation.
const { evaluatePoseidonDecision } = require('../handlers/decisionHelper');
const { detectTrendPhase } = require('../handlers/trendPhaseDetector');

// ⬇︎ moved: getActiveSymbols should come from the scanner module
const { getActiveSymbols } = require('../handlers/poseidonScanner');

const axios = require('axios');

const MAX_QUOTE_VOL = 20_000_000;
const taCache = new Map();
let scanIndex = 0;
let scanInterval = null;

const BASE = `http://localhost:${process.env.PORT || 3000}`;

// --- helpers ---------------------------------------------------------------
function normalizeBaseSymbol(sym = '') {
  return String(sym).replace(/[-_]/g, '').toUpperCase().replace(/USDTM?$/, '');
}

// Same scoring you used in handlers/taHandler.js
function calculateConfidence(macdSignal, bbSignal, volumeSpike) {
  let score = 0;
  if (macdSignal === 'bullish' || macdSignal === 'bearish') score += 30;
  if (bbSignal === 'breakout') score += 30;
  if (volumeSpike) score += 40;
  return Math.min(score, 100);
}

async function fetchTA(rawSymbol) {
  // Endpoint expects futures or spot; our /api/ta normalizes internally.
  const symbol = toKuCoinContractSymbol(rawSymbol);
  if (taCache.has(symbol)) return taCache.get(symbol);

  try {
    const { data } = await axios.get(`${BASE}/api/ta/${encodeURIComponent(symbol)}`, { timeout: 12000 });
    taCache.set(symbol, data || null);
    return data || null;
  } catch (err) {
    console.warn(`[TA] fetch failed for ${symbol}:`, err.message);
    taCache.set(symbol, null);
    return null;
  }
}

async function detectBigDrop(_symbol) { return false; }
async function detectBigPump(_symbol) { return false; }

// --- core ------------------------------------------------------------------
async function analyzeAndTrigger(symbol, options = {}) {
  if (!symbol || /ALTCOIN|ZEUS|TEST/i.test(symbol)) {
    console.warn(`⚠️ Skipping fake/test symbol: ${symbol}`);
    return;
  }

  const contractSymbol = toKuCoinContractSymbol(symbol);
  const baseSymbol = normalizeBaseSymbol(symbol);

  try {
    // Scanner snapshot (prefer quoteVolume)
    const token = getScanTokenBySymbol(symbol);
    const price = Number(token?.price || 0);
    const quoteVolume =
      Number(token?.quoteVolume ?? token?.turnover ?? token?.volume ?? 0);

    if (!(price > 0) || !(quoteVolume > 0) || quoteVolume > MAX_QUOTE_VOL) {
      console.warn(`⚠️ Skipping ${symbol} — invalid price: ${price}, qVol: ${quoteVolume}`);
      return;
    }

    // TA (server)
    const ta = await fetchTA(symbol);
    if (!ta || ta.nodata || ta.success === false) {
      console.warn(`❌ No TA result for ${symbol}: ${ta?.error || 'unknown'}`);
      return;
    }

    // Normalize TA fields to your server format
    const macdSignal  = ta.macdSignal || (ta.macd?.signal === 'bullish' ? 'bullish' : 'bearish');
    const bbSignal    = ta.bbSignal || (ta.bb?.breakout ? 'breakout' : 'neutral');
    const volumeSpike = !!ta.volumeSpike;
    const rsi         = Number.isFinite(Number(ta.rsi)) ? Number(ta.rsi) : null;
    const trapWarning = !!ta.trapWarning;
    const signal      = ta.signal ?? 'neutral';

    // Only trade on actionable signals
    if (!['bullish', 'bearish'].includes(signal)) {
      console.warn(`⛔ Skipping ${symbol} — TA signal '${signal}' not actionable`);
      return;
    }

    // Confidence (server-side calc to avoid frontend import)
    const confidence = calculateConfidence(macdSignal, bbSignal, volumeSpike);
    if (confidence < 70) {
      console.warn(`⛔ Skipping ${symbol} — Confidence too low (${confidence}%)`);
      return;
    }

    // Already open guard (futures positions)
    if (!options.manual) {
      const open = await getOpenPositions().catch(() => []);
      const alreadyOpen = open.some(pos => normalizeBaseSymbol(pos.symbol) === baseSymbol);
      if (alreadyOpen) {
        console.warn(`🔒 Already in open position: ${symbol}`);
        return;
      }
    }

    // Trend-phase guard
    const trendPhase = await detectTrendPhase(contractSymbol).catch(() => null);
    if (trendPhase && ['peak', 'reversal'].includes(trendPhase.phase)) {
      // Observe-only
      await evaluatePoseidonDecision(contractSymbol, {});
      return;
    }

    // Big moves (stubs)
    if (await detectBigDrop(contractSymbol)) return;
    if (await detectBigPump(contractSymbol)) return;

    let allocationPct = confidence >= 85 ? 25 : 10;

    const analysis = {
      macdSignal,
      bbSignal,
      volumeSpike,
      confidence,
      rsi,
      trapWarning,
      signal,
      bigDrop: false,
      bigPump: false,
      manual: !!options.manual,
      allocationPct,
      price,
      // ranges from TA (these may be 24h-derived in your handler)
      range24h: ta.range24h,
      range7D:  ta.range7D,
      range30D: ta.range30D,
      // pass volumes for downstream engines (quote-volume preferred)
      quoteVolume,
    };

    console.log(`[📈 ${contractSymbol}] Price: ${price}, 24h Range: ${ta.range24h?.low} → ${ta.range24h?.high}`);
    console.log(`✅ Final constructed: ${contractSymbol} | Signal: ${signal} | Confidence: ${confidence}%`);

    await evaluatePoseidonDecision(contractSymbol, analysis);
  } catch (err) {
    console.error(`❌ Analysis failed for ${symbol}:`, err.message);
  }
}

async function startSignalEngine() {
  if (scanInterval) {
    console.warn('⚠️ Signal Engine already running.');
    return;
  }

  console.log('🚀 Starting Signal Engine...');

  scanInterval = setInterval(async () => {
    const symbols = getActiveSymbols();
    if (!symbols || symbols.length === 0) {
      console.warn('⚠️ No valid symbols in active list.');
      return;
    }

    const item = symbols[scanIndex];
    const sym = typeof item === 'string' ? item : (item?.symbol || '');
    if (sym) await analyzeAndTrigger(sym);

    scanIndex = (scanIndex + 1) % symbols.length;
  }, 12_000);
}

module.exports = {
  startSignalEngine,
  analyzeAndTrigger
};