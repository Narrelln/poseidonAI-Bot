const {
  toKuCoinContractSymbol,
  getOpenPositions
} = require('./futuresApi');

const { evaluatePoseidonDecision } = require('./decisionHelper');
const { detectTrendPhase } = require('./trendPhaseDetector');
const { calculateConfidence } = require('./taClient');
const { adjustConfidenceByProfile } = require('./data/tokenPatternMemory');

const MAX_VOLUME_CAP = 20_000_000;
const taCache = new Map();

async function fetchTA(symbol) {
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

// 🔧 Volatility confidence adjuster
function applyVolatilityAdjustment(symbol, confidence, volume) {
  const majorTokens = ['BTCUSDTM', 'ETHUSDTM', 'BNBUSDTM', 'SOLUSDTM', 'XRPUSDTM', 'ADAUSDTM'];
  const isMajor = majorTokens.includes(symbol.toUpperCase());

  const volatilityBoost = volume < 2_000_000 ? 1.15 : 1.0; // boost low-volume tokens
  const majorPenalty = isMajor ? 0.9 : 1.0;

  const adjusted = confidence * volatilityBoost * majorPenalty;
  return parseFloat(adjusted.toFixed(2));
}

async function analyzeAndTrigger(rawSymbol, options = {}) {
  if (!rawSymbol || rawSymbol.includes('ALTCOIN') || rawSymbol.includes('ZEUS') || rawSymbol.includes('TEST')) {
    console.warn(`⚠️ Skipping fake/test symbol: ${rawSymbol}`);
    return;
  }

  const symbol = toKuCoinContractSymbol(rawSymbol);
  const safeSymbol = symbol.replace(/[-_]/g, '').toUpperCase();

  try {
    const ta = await fetchTA(symbol);
    if (!ta || ta.success === false) {
      console.warn(`[Analyzer] No TA result for ${safeSymbol}`);
      return;
    }

    const price = parseFloat(ta.price || 0);
    const volume = parseFloat(ta.volume || 0);

    if (!price || !volume || volume > MAX_VOLUME_CAP) {
      console.warn(`⚠️ Invalid TA price/volume for ${symbol}`);
      return;
    }

    const macdSignal = ta.macdSignal || 'Neutral';
    const bbSignal = ta.bbSignal || 'Middle';
    const rsi = ta.rsi ?? '--';
    const signal = ta.signal ?? 'neutral';
    const volumeSpike = !!ta.volumeSpike;
    const trapWarning = !!ta.trapWarning;

    let confidence = parseFloat(calculateConfidence(macdSignal, bbSignal, volumeSpike));
    confidence = await adjustConfidenceByProfile(symbol, confidence);
    confidence = applyVolatilityAdjustment(symbol, confidence, volume);

    if (!['bullish', 'bearish'].includes(signal)) {
      console.warn(`⛔ No valid signal for ${symbol} — TA returned '${signal}' with confidence ${confidence}%`);
      return;
    }

    if (confidence < 70) {
      console.warn(`⛔ Skipping ${symbol} — Confidence too low (${confidence}%)`);
      return;
    }

    if (!options.manual) {
      const open = await getOpenPositions();
      const alreadyOpen = open.some(pos => toKuCoinContractSymbol(pos.symbol) === symbol);
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
      symbol,
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
      allocationPct
    };

    console.log(`✅ Final constructed: ${symbol} | Signal: ${signal} | Confidence: ${confidence}%`);
    await evaluatePoseidonDecision(symbol, analysis);

  } catch (err) {
    console.error(`❌ Analysis failed for ${symbol}:`, err.message);
  }
}

module.exports = {
  analyzeAndTrigger,
  detectBigDrop,
  detectBigPump
};