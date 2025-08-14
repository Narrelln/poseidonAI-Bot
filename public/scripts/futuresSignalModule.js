// === /public/scripts/futuresSignalModule.js ===
// Spam‑silenced + quoteVolume aware + majors/meme exemptions + structured feed
// Last updated: 2025-08-12

import {
  toKuCoinContractSymbol,
  getOpenPositions,
} from '/scripts/futuresApiClient.js';

import { evaluatePoseidonDecision } from '../scripts/decisionHelper.js';
import { feed } from './core/feeder.js';              // <-- structured live feed
import { isBotActive } from '/scripts/poseidonBotModule.js';
import { detectTrendPhase } from '../scripts/trendPhaseDetector.js';
import { calculateConfidence } from '../scripts/taFrontend.js';
import {
  logSignalToFeed,
  logToLiveFeed,
  logDetailedAnalysisFeed
} from './liveFeedRenderer.js';

const MAX_VOLUME_CAP = 20_000_000; // quote (USDT) turnover cap for non-majors
const MAJORS = ['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC']; // cap exempt
const MEME_EXEMPT = ['WIF','TRUMP','MYRO','PEPE','FLOKI','BONK'];                // cap exempt

const taCache = new Map();

// -------------------- spam silencer --------------------
let DEBUG_LOGS = {
  TA: false,    // show TA rows
  SKIPS: false, // show "Skipped ..." rows
};

const _lastSkipLog = new Map();
function shouldLogSkip(key, ms = 15000) {
  const now = Date.now();
  const prev = _lastSkipLog.get(key) || 0;
  if (now - prev >= ms) { _lastSkipLog.set(key, now); return true; }
  return false;
}
const _lastSigSnapshot = new Map();
function signalChanged(sym, sig, conf) {
  const bucket = conf >= 85 ? '85+' : conf >= 70 ? '70+' : 'low';
  const prev = _lastSigSnapshot.get(sym);
  const changed = !prev || prev.sig !== sig || prev.bucket !== bucket;
  if (changed) _lastSigSnapshot.set(sym, { sig, bucket });
  return changed;
}
// -------------------------------------------------------

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

async function fetchTA(symbol) {
  if (taCache.has(symbol)) return taCache.get(symbol);
  try {
    const res = await fetch(`/api/ta/${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error(`TA endpoint ${res.status}`);
    const ta = await res.json();
    if (!ta || ta.nodata) { taCache.set(symbol, null); return null; }
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

// Normalize “BTC-USDTM” / “BTCUSDTM” / “BTCUSDT” to base key “BTC”
function normForMatch(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[-_]/g, '')
    .replace(/USDTM?$/, '');
}

export async function analyzeAndTrigger(symbol, options = {}, attempt = 1) {
  try {
    if (!isBotActive() && !options.manual) return null;
    if (!symbol || (typeof symbol === 'object' && !symbol.symbol)) return null;
    if (typeof symbol === 'object') symbol = symbol.symbol;
    if (!symbol || typeof symbol !== 'string') return null;
    if (/ALTCOIN|ZEUS|TEST/i.test(symbol)) return null;

    const contractSymbol = toKuCoinContractSymbol(symbol);
    const safeSymbol = contractSymbol.endsWith('M') ? contractSymbol : contractSymbol + 'M';

    // correlation id ties this pipeline together in the feed
    const corrId = `${safeSymbol}-${Date.now()}`;

    // ---- find scanner row for this symbol (match on BASE) ----
    const allScannerSymbols = await fetchScannerData();
    const targetBase = normForMatch(safeSymbol);

    let scannerMatch = allScannerSymbols.find(t => normForMatch(t.symbol) === targetBase);
    if (!scannerMatch) {
      scannerMatch = allScannerSymbols.find(t => normForMatch(t.symbol).startsWith(targetBase));
    }
    if (!scannerMatch) {
      if (shouldLogSkip(`no-scan-${safeSymbol}`, 20000)) {
        feed.decision(safeSymbol, 'No scanner match', { attempt, have: allScannerSymbols.map(s => s.symbol) }, 'warn', ['scanner'], corrId);
      }
      return null;
    }

    // ---- resolve price & quote volume (USDT turnover) from scanner row ----
    const base = safeSymbol.replace('-USDTM', '').toUpperCase();
    const isMajor  = MAJORS.includes(base);
    const isMemeOk = MEME_EXEMPT.includes(base);

    const price  = Number(scannerMatch.price ?? scannerMatch.lastPrice);
    const volume = Number(scannerMatch.quoteVolume ?? scannerMatch.turnover ?? scannerMatch.volume);

    const badPrice = !Number.isFinite(price) || price <= 0;
    let   badVol   = !Number.isFinite(volume) || volume <= 0;

    // cap only for non‑exempt tokens
    if (!isMajor && !isMemeOk && Number.isFinite(volume) && volume > MAX_VOLUME_CAP) {
      badVol = true;
    }

    if (badPrice || badVol) {
      // one informative line to feed (not console) to avoid spam
      if (shouldLogSkip(`badpv-${safeSymbol}`, 15000)) {
        feed.scanner(safeSymbol, 'Invalid price/volume', {
          price: scannerMatch.price ?? scannerMatch.lastPrice,
          quoteVolume: scannerMatch.quoteVolume ?? scannerMatch.turnover ?? scannerMatch.volume,
          isMajor, isMemeOk
        }, 'warn', ['gate'], corrId);
      }
      return null;
    }

    const delta = scannerMatch.priceChgPct ?? scannerMatch.change ?? '--';
    feed.scanner(safeSymbol, 'Analyzing', { price, quoteVolume: volume, delta }, 'debug', [], corrId);

    // ---- TA (server) ----
    const ta = await fetchTA(safeSymbol);
    if (!ta) {
      if (shouldLogSkip(`no-ta-${safeSymbol}`, 20000)) {
        feed.ta(safeSymbol, 'TA unavailable', {}, 'warn', [], corrId);
      }
      return null;
    }

    if (DEBUG_LOGS.TA && signalChanged(safeSymbol, (ta.signal || 'neutral'), Number(ta.confidence) || 0)) {
      console.log(`[FRONTEND TA] ${safeSymbol}`, {
        signal: ta.signal,
        confidence: ta.confidence,
        price: ta.price
      });
    }
    feed.ta(safeSymbol, 'TA fetched', {
      signal: ta.signal, confServer: ta.confidence, price: ta.price,
      rsi: ta.rsi, macd: ta.macdSignal, bb: ta.bbSignal, volumeSpike: !!ta.volumeSpike
    }, 'debug', [], corrId);

    const macdSignal  = ta.macdSignal || '--';
    const bbSignal    = ta.bbSignal || '--';
    const volumeSpike = !!ta.volumeSpike;
    const rsi         = n(ta.rsi);
    const trapWarning = !!ta.trapWarning;

    const confidence = calculateConfidence(
      macdSignal, bbSignal, volumeSpike, rsi, trapWarning, price,
      { range24h: ta.range24h, range7D: ta.range7D, range30D: ta.range30D }
    );

    const taSignal = ta.signal || 'neutral';

    const result = {
      symbol: safeSymbol,
      signal: taSignal,
      confidence,
      rsi,
      macdSignal,
      bbSignal,
      volume,   // quote (USDT) turnover
      price,
      trapWarning,
      volumeSpike,
      openPosition: false,
      skipped: false
    };

    // skip weak/neutral
    if (!['bullish', 'bearish'].includes(taSignal) || confidence < 70) {
      if (DEBUG_LOGS.SKIPS && shouldLogSkip(safeSymbol)) {
        console.warn(`🟡 Skipped ${safeSymbol} → Signal: ${taSignal}, Confidence: ${confidence}`);
      }
      if (shouldLogSkip(`weak-${safeSymbol}`, 10000)) {
        feed.decision(safeSymbol, 'Skipped (weak/neutral)', { taSignal, confidence }, 'info', ['gate'], corrId);
      }
      result.skipped = true;
      return result;
    }

    // avoid duplicate entries
    if (!options.manual) {
      const open = await getOpenPositions();
      const alreadyOpen = open.some(pos => toKuCoinContractSymbol(pos.symbol) === safeSymbol);
      if (alreadyOpen) {
        result.openPosition = true;
        result.skipped = true;
        if (shouldLogSkip(`open-${safeSymbol}`, 15000)) {
          feed.decision(safeSymbol, 'Skipped (already open)', {}, 'info', ['gate'], corrId);
        }
        return result;
      }
    }

    // trend-phase guardrails
    const trendPhase = await detectTrendPhase(safeSymbol);
    if (trendPhase && ['peak', 'reversal'].includes(trendPhase.phase)) {
      logSignalToFeed({ symbol: safeSymbol, confidence, signal: taSignal || '--', delta, volume, price });
      await evaluatePoseidonDecision(safeSymbol, {}); // observe only
      result.skipped = true;
      feed.decision(safeSymbol, `Skipped (phase: ${trendPhase.phase})`, {}, 'info', ['phase'], corrId);
      return result;
    }

    // allocation suggestion by confidence
    const allocationPct = confidence >= 85 ? 25 : 10;

    const analysis = {
      symbol: safeSymbol,
      signal: taSignal,
      macdSignal,
      bbSignal,
      volumeSpike,
      confidence,
      rsi,
      trapWarning,
      bigDrop: false,
      bigPump: false,
      manual: !!options.manual,
      allocationPct,
      corr: corrId
    };

    logSignalToFeed({ symbol: safeSymbol, confidence, signal: taSignal || '--', delta, volume, price });
    logDetailedAnalysisFeed({ symbol: safeSymbol, signal: taSignal, rsi, macdSignal, bbSignal, confidence, volumeSpike, trapWarning });

    feed.decision(safeSymbol, 'Trade candidate', {
      taSignal, confidence, price, quoteVolume: volume, allocationPct
    }, 'success', ['candidate'], corrId);

    await evaluatePoseidonDecision(safeSymbol, analysis);
    return result;

  } catch (err) {
    console.error(`✘ Analysis failed for ${symbol}:`, err.message);
    logToLiveFeed({ symbol, message: err.message, type: 'error' });
    try { feed.error(String(symbol || 'SYSTEM'), 'Analysis failed', { err: err.message }); } catch {}
    return null;
  }
}

export async function detectBigDrop(_symbol) { return false; }
export async function detectBigPump(_symbol) { return false; }

export function startSignalEngine() {
  console.log('[startSignalEngine] No-op (migrated to poseidonScanner)');
}

// Toggle from DevTools as needed:
//   DEBUG_LOGS.TA = true/false
//   DEBUG_LOGS.SKIPS = true/false
window.analyzeAndTrigger = analyzeAndTrigger;