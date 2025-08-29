const {
  toKuCoinContractSymbol,
  getScanTokenBySymbol,
  getOpenPositions
} = require('./futuresApi');

const { evaluatePoseidonDecision } = require('../handlers/decisionHelper');
const { detectTrendPhase } = require('../handlers/trendPhaseDetector');
const { calculateConfidence } = require('../handlers/taClient');
const { getActiveSymbols } = require('../routes/newScanTokens');

const MAX_VOLUME_CAP = 20_000_000;
const taCache = new Map();
let scanIndex = 0;
let scanInterval = null;

// Normalize for base comparisons (e.g. DOGEUSDTM → DOGE)
function normalizeBaseSymbol(sym = '') {
  return sym.replace(/[-_]/g, '').toUpperCase().replace(/USDTM?$/, '');
}

async function fetchTA(rawSymbol) {
  const symbol = toKuCoinContractSymbol(rawSymbol);
  if (taCache.has(symbol)) return taCache.get(symbol);

  try {
    const res = await fetch(`http://localhost:3000/api/ta/${symbol}`);
    const ta = await res.json();
    taCache.set(symbol, ta);
    return ta;
  } catch (err) {
    console.warn(`[TA] Fallback for ${symbol}:`, err.message);
    taCache.set(symbol, null);
    return null;
  }
}

async function detectBigDrop(symbol) {
  return false;
}

async function detectBigPump(symbol) {
  return false;
}

async function analyzeAndTrigger(symbol, options = {}) {
  if (!symbol || symbol.includes('ALTCOIN') || symbol.includes('ZEUS') || symbol.includes('TEST')) {
    console.warn(`⚠️ Skipping fake/test symbol: ${symbol}`);
    return;
  }

  const contractSymbol = toKuCoinContractSymbol(symbol);
  const baseSymbol = normalizeBaseSymbol(symbol);

  try {
    const token = getScanTokenBySymbol(symbol);
    const price = parseFloat(token?.price || 0);
    const volume = parseFloat(token?.volume || 0);

    if (!price || !volume || volume > MAX_VOLUME_CAP) {
      console.warn(`⚠️ Skipping ${symbol} — invalid price: ${price}, volume: ${volume}`);
      return;
    }

    const ta = await fetchTA(symbol);
    if (!ta || ta.success === false) {
      console.warn(`❌ No TA result for ${symbol}: ${ta?.error || 'unknown error'}`);
      return;
    }

    const macdSignal = ta.macd?.signal === 'bullish' ? 'Buy' : 'Sell';
    const bbSignal = ta.bb?.breakout ? 'Breakout' : 'None';
    const volumeSpike = !!ta.volumeSpike;
    const rsi = ta.rsi ?? '--';
    const trapWarning = !!ta.trapWarning;
    const signal = ta.signal ?? 'neutral';

    // Only trade on valid signals
    if (!['bullish', 'bearish'].includes(signal)) {
      console.warn(`⛔ Skipping ${symbol} — TA signal '${signal}' not actionable`);
      return;
    }

    const confidence = parseFloat(calculateConfidence(macdSignal, bbSignal, volumeSpike));
    if (confidence < 70) {
      console.warn(`⛔ Skipping ${symbol} — Confidence too low (${confidence}%)`);
      return;
    }

    if (!options.manual) {
      const open = await getOpenPositions();
      const alreadyOpen = open.some(pos => normalizeBaseSymbol(pos.symbol) === baseSymbol);
      if (alreadyOpen) {
        console.warn(`🔒 Already in open position: ${symbol}`);
        return;
      }
    }

    const trendPhase = await detectTrendPhase(symbol);
    if (['peak', 'reversal'].includes(trendPhase.phase)) {
      const analysis = {};
      await evaluatePoseidonDecision(symbol, analysis);
      return;
    }

    const bigDrop = await detectBigDrop(symbol);
    if (bigDrop) return;

    const bigPump = await detectBigPump(symbol);
    if (bigPump) return;

    let allocationPct = 10;
    if (confidence >= 85) allocationPct = 25;

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
      manual: options.manual || false,
      allocationPct,
      price,
      range24h: ta.range24h,
      range7D: ta.range7D,
      range30D: ta.range30D
    };
    
    console.log(`[📈 ${symbol}] Price: ${price}, 24h Range: ${ta.range24h?.low} → ${ta.range24h?.high}`);
    console.log(`✅ Final constructed: ${symbol} | Signal: ${signal} | Confidence: ${confidence}%`);
    await evaluatePoseidonDecision(symbol, analysis);

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

    const symbol = symbols[scanIndex];
    if (symbol) await analyzeAndTrigger(symbol);

    scanIndex = (scanIndex + 1) % symbols.length;
  }, 12_000);
}

module.exports = {
  startSignalEngine,
  analyzeAndTrigger
};