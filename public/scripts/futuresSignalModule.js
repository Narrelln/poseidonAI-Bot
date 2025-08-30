// === /public/scripts/futuresSignalModule.js ===
// Purpose: Frontend signal analyzer (no order placement).
// - Advisory whitelist only (never hard-blocks).
// - Volume MIN check for "others"; majors/memes exempt.
// - Confidence floors from /api/policy (default 85 each); runtime override via window.POSEIDON_MIN_CONF.
// - Spot-first TA, with small cache + scanner merge.
// - Phase-aware (peak/reversal) but delegates action/PPDA decisions to backend.
// - Spam-safe feed logging; evaluator invoked with full context.
// - No auto-placement in this module.

import {
  toKuCoinContractSymbol,
  getOpenPositions,
} from '/scripts/futuresApiClient.js';

import { evaluatePoseidonDecision } from '../scripts/decisionHelper.js';
import { chooseStrategy } from './strategyRouter.js';
import { feed } from './core/feeder.js';
import { isBotActive } from '/scripts/poseidonBotModule.js';
import { detectTrendPhase } from '../scripts/trendPhaseDetector.js';
import { calculateConfidence } from '../scripts/taFrontend.js';
import {
  logSignalToFeed,
  logToLiveFeed,
  logDetailedAnalysisFeed
} from './liveFeedRenderer.js';

/* =========================
 * Configuration & Policy
 * ========================= */

// Advisory whitelists (for UX context only)
const WHITELIST_TOP   = ['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC'];
const WHITELIST_MEMES = ['SHIB','PEPE','TRUMP','FLOKI','BONK','WIF','AIDOGE','TSUKA','HARRY','WOJAK','GROK','BODEN','MAGA','MYRO','DOGE'];
const WHITELIST = new Set([...WHITELIST_TOP, ...WHITELIST_MEMES]);

// Category sets
const MAJORS = new Set(['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC']);
const MEMES  = new Set(['WIF','TRUMP','MYRO','PEPE','FLOKI','BONK','SHIB']);

// Volume policy
const VOLUME_MIN_OTHERS = 100_000; // MIN only for non-majors/memes

// Confidence floors (will be overridden by /api/policy if available)
let MIN_CONF_MAP = { major: 85, meme: 85, other: 85 };

/* pull from /api/policy -> policy.minConf */
fetch('/api/policy')
  .then(r => r.ok ? r.json() : null)
  .then(j => { if (j?.policy?.minConf) MIN_CONF_MAP = j.policy.minConf; })
  .catch(() => { /* best-effort only */ });

// Live updates (if your policy route emits them)
window.addEventListener('policy:update', e => {
  if (e?.detail?.payload) MIN_CONF_MAP = e.detail.payload;
});

// Runtime override (developer console)
//   window.POSEIDON_MIN_CONF = 80
function minConfFor(base) {
  const cat = categoryOfBase(base);
  const adaptive = Number(MIN_CONF_MAP[cat] ?? 85);
  const runtime  = Number.isFinite(+window.POSEIDON_MIN_CONF) ? +window.POSEIDON_MIN_CONF : null;
  return Number.isFinite(runtime) ? runtime : adaptive;
}

/* =========================
 * Utils
 * ========================= */

const taCache = new Map();            // key: "BASE" or "BASE-USDTM"
const _lastSkipLog = new Map();       // throttle skip messages
const _lastSigSnapshot = new Map();   // throttle TA change spam

const DEBUG = { TA: false, SKIPS: false };

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : NaN; }

function baseOf(sym = '') {
  let s = String(sym).toUpperCase().replace(/[-_]/g,'').replace(/USDTM?$/, '');
  if (s === 'XBT') s = 'BTC';
  return s;
}

function toHyphenFut(sym = '') {
  const S = String(sym).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (S.includes('-')) return S;
  return S.endsWith('USDTM') ? S : `${S}-USDTM`;
}

function normForMatch(s) {
  let b = String(s || '').toUpperCase().replace(/[-_]/g, '').replace(/USDTM?$/, '');
  if (b === 'XBT') b = 'BTC';
  return b;
}

function categoryOfBase(b) {
  if (MAJORS.has(b)) return 'major';
  if (MEMES.has(b))  return 'meme';
  return 'other';
}

function shouldLogSkip(key, ms = 15000) {
  const now = Date.now();
  const prev = _lastSkipLog.get(key) || 0;
  if (now - prev >= ms) { _lastSkipLog.set(key, now); return true; }
  return false;
}

function signalChanged(sym, sig, conf) {
  const bucket = conf >= 85 ? '85+' : conf >= 70 ? '70+' : 'low';
  const prev = _lastSigSnapshot.get(sym);
  const changed = !prev || prev.sig !== sig || prev.bucket !== bucket;
  if (changed) _lastSigSnapshot.set(sym, { sig, bucket });
  return changed;
}

/* =========================
 * Data Fetchers
 * ========================= */

// TA (spot-first; light cache)
async function fetchTA(symbol) {
  const key = String(symbol || '').toUpperCase();
  if (taCache.has(key)) return taCache.get(key);

  const base = baseOf(key);
  const candidates = [`${base}-USDT`, base]; // spot first, then bare

  for (const c of candidates) {
    try {
      const res = await fetch(`/api/ta/${encodeURIComponent(c)}`);
      if (!res.ok) continue;
      const ta = await res.json();
      if (ta && !ta.nodata) {
        taCache.set(key, ta);
        return ta;
      }
    } catch { /* ignore */ }
  }

  taCache.set(key, null);
  // quiet failure; feed debug once/minute per symbol
  return null;
}

async function fetchScannerTop() {
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

/* =========================
 * Audit helpers (optional)
 * ========================= */
function emitSignalAudit(eventName, payload){
  if (!window.POSEIDON_SIGNAL_AUDIT) return;
  try {
    window.dispatchEvent(new CustomEvent('poseidon:signal', {
      detail: { event: eventName, at: Date.now(), ...payload }
    }));
  } catch {}
}
function sideFromTaSignal(sig=''){
  const s = String(sig).toLowerCase();
  if (s === 'bullish') return 'BUY';
  if (s === 'bearish') return 'SELL';
  return 'HOLD';
}

/* =========================
 * Main Entry
 * ========================= */

export async function analyzeAndTrigger(symbol, options = {}, attempt = 1) {
  try {
    if (!isBotActive() && !options.manual) return null;

    // Normalize input to hyphenated FUT
    if (typeof symbol === 'object') symbol = symbol.symbol;
    if (!symbol || typeof symbol !== 'string') return null;

    const contract = toKuCoinContractSymbol(symbol);
    const fut      = toHyphenFut(contract);
    const base     = baseOf(fut);
    const corrId   = `${fut}-${Date.now()}`;

    // Advisory whitelist note (no early return)
    const isWhitelisted = WHITELIST.has(base);
    if (!isWhitelisted && shouldLogSkip(`wl-${fut}`, 20000)) {
      feed.decision(fut, 'Not on advisory whitelist', { base }, 'info', ['gate']);
    }

    // Scanner resolve (price + qv); allow options to override
    const top50 = await fetchScannerTop();
    const target = normForMatch(fut);
    let row = top50.find(t => normForMatch(t.symbol) === target)
          || top50.find(t => normForMatch(t.symbol).startsWith(target));

    const optPrice = n(options.price);
    const optQV    = n(options.quoteVolume);

    const price = Number.isFinite(optPrice)
      ? optPrice
      : n(row?.price ?? row?.lastPrice);

    const qv = Number.isFinite(optQV)
      ? optQV
      : n(row?.quoteVolume24h ?? row?.quoteVolume ?? row?.turnover ?? row?.volume);

    const delta24h = n(row?.priceChgPct ?? row?.change ?? options.change ?? 0);
    const delta    = Number.isFinite(delta24h) ? delta24h : '--';

    if (!Number.isFinite(price) || !Number.isFinite(qv)) {
      if (shouldLogSkip(`no-data-${fut}`, 20000)) {
        feed.decision(
          fut,
          'Insufficient market data',
          { havePrice: Number.isFinite(price), haveVolume: Number.isFinite(qv) },
          'warn',
          ['scanner'],
          corrId
        );
      }
      return null;
    }

    // Volume policy: MIN only for non-majors/memes
    const isMajor = MAJORS.has(base);
    const isMeme  = MEMES.has(base);
    const badVol  = (!isMajor && !isMeme) ? !(qv >= VOLUME_MIN_OTHERS) : false;

    feed.scanner(fut, 'Analyzing', { price, quoteVolume: qv, delta }, 'debug', [], corrId);

    // TA (server); pass spot-normalized symbol
    const ta = await fetchTA(fut);
    if (!ta) {
      if (shouldLogSkip(`no-ta-${fut}`, 20000)) {
        feed.ta(fut, 'TA unavailable', {}, 'debug', [], corrId);
      }
      return null;
    }

    if (DEBUG.TA && signalChanged(fut, (ta.signal || 'neutral'), Number(ta.confidence) || 0)) {
      console.log(`[FRONTEND TA] ${fut}`, { signal: ta.signal, confidence: ta.confidence, price: ta.price });
    }
    feed.ta(fut, 'TA fetched', {
      signal: ta.signal, confServer: ta.confidence, price: ta.price,
      rsi: ta.rsi, macd: ta.macdSignal, bb: ta.bbSignal, volumeSpike: !!ta.volumeSpike
    }, 'debug', [], corrId);

    // Snapshot to audit bus
    emitSignalAudit('analysis', {
      symbol: fut,
      price: Number(ta.price) || price,
      side: sideFromTaSignal(ta.signal),
      confidence: ta.confidence,
      reason: `TA rsi=${ta.rsi} macd=${ta.macdSignal} bb=${ta.bbSignal}`,
      corr: corrId
    });

    // Local (frontend) confidence for UI gates
    const macdSignal  = ta.macdSignal || '--';
    const bbSignal    = ta.bbSignal   || '--';
    const volumeSpike = !!ta.volumeSpike;
    const rsi         = n(ta.rsi);
    const trapWarning = !!ta.trapWarning;
    const taSignal    = (ta.signal || 'neutral').toLowerCase();

    const confidence = calculateConfidence({
      macdSignal, bbSignal, volumeSpike, rsi, trapWarning, price,
      range24h: ta.range24h, range7D: ta.range7D, range30D: ta.range30D
    });

    const MIN_CONF = minConfFor(base);
    const strategy = chooseStrategy(base, { delta24h, rsi, volumeSpike, taSignal });

    // Reasons to skip (frontend gate only)
    const reasons = [];
    if (!Number.isFinite(price) || price <= 0) reasons.push('bad-price');
    if (badVol)                                reasons.push('volume-min');
    if (taSignal === 'neutral')                reasons.push('neutral');
    if (!(confidence >= MIN_CONF))             reasons.push('low-confidence');

    const category = options.category || '';
    const isMover  = !!options.isMover;

    if (reasons.length) {
      const topReason = reasons[0];

      if (shouldLogSkip(`skip-${fut}-${topReason}`, 10000)) {
        feed.decision(
          fut,
          'Skipped',
          { reason: topReason, confidence, taSignal, quoteVolume: qv, category, isMover },
          topReason === 'volume-min' ? 'warn' : 'info',
          ['gate'],
          corrId
        );
      }

      logSignalToFeed({ symbol: fut, confidence, signal: taSignal || '--', delta, volume: qv, price, category, isMover });
      logDetailedAnalysisFeed({ symbol: fut, signal: taSignal, rsi, macdSignal, bbSignal, confidence, volumeSpike, trapWarning });

      emitSignalAudit('skipped', {
        symbol: fut,
        side: sideFromTaSignal(taSignal),
        price, confidence, reason: topReason, corr: corrId
      });

      // Still let backend observe for memory/telemetry
      await evaluatePoseidonDecision(fut, {
        signal: taSignal, confidence, rsi, macdSignal, bbSignal,
        volumeSpike, trapWarning, strategy, manual: true
      });

      return {
        symbol: fut, signal: taSignal, confidence, rsi, macdSignal, bbSignal,
        volume: qv, price, trapWarning, volumeSpike, openPosition: false, skipped: true, strategy, reason: topReason
      };
    }

    // Avoid duplicate entry for same contract
    if (!options.manual) {
      const open = await getOpenPositions();
      const alreadyOpen = open.some(pos => toKuCoinContractSymbol(pos.symbol) === fut);
      if (alreadyOpen) {
        if (shouldLogSkip(`open-${fut}`, 15000)) {
          feed.decision(fut, 'Skipped (already open)', {}, 'info', ['gate'], corrId);
        }
        emitSignalAudit('skipped', {
          symbol: fut,
          side: sideFromTaSignal(taSignal),
          price,
          confidence,
          reason: 'already-open',
          corr: corrId
        });
        return {
          symbol: fut, signal: taSignal, confidence, rsi, macdSignal, bbSignal,
          volume: qv, price, trapWarning, volumeSpike, openPosition: true, skipped: true, strategy
        };
      }
    }

    // Trend phase (advisory; do not block)
    const trendPhase = await detectTrendPhase(fut);
    if (trendPhase?.phase) {
      feed.decision(
        fut,
        `Phase: ${trendPhase.phase}`,
        {},
        ['peak','reversal'].includes(trendPhase.phase) ? 'warn' : 'info',
        ['phase'],
        corrId
      );
    }

    // Allocation suggestion for UI only (backend does its own calc)
    const allocationPct = confidence >= 85 ? 25 : 10;

    // Final analysis envelope → backend evaluator (no auto-place here)
    const analysis = {
      symbol: fut,
      signal: taSignal,
      macdSignal,
      bbSignal,
      volumeSpike,
      confidence,
      rsi,
      trapWarning,
      manual: !!options.manual,
      allocationPct,
      corr: corrId,
      strategy,
      category,
      isMover,
      phase: trendPhase?.phase || null,  // let backend decide PPDA/guards
      price,
      quoteVolume: qv
    };

    // UI feeds
    logSignalToFeed({ symbol: fut, confidence, signal: taSignal || '--', delta, volume: qv, price, category, isMover });
    logDetailedAnalysisFeed({ symbol: fut, signal: taSignal, rsi, macdSignal, bbSignal, confidence, volumeSpike, trapWarning });

    feed.decision(
      fut,
      'Trade candidate',
      { taSignal, confidence, price, quoteVolume: qv, allocationPct, strategy, category, isMover },
      'success',
      ['candidate'],
      corrId
    );

    emitSignalAudit('decision', {
      symbol: fut,
      side: sideFromTaSignal(taSignal),
      confidence,
      price,
      reason: `candidate conf=${confidence} strat=${strategy}`,
      corr: corrId
    });

    await evaluatePoseidonDecision(fut, analysis);

    return {
      symbol: fut,
      signal: taSignal,
      confidence,
      rsi,
      macdSignal,
      bbSignal,
      volume: qv,
      price,
      trapWarning,
      volumeSpike,
      openPosition: false,
      skipped: false,
      strategy,
      category,
      isMover
    };

  } catch (err) {
    console.error(`✘ Analysis failed for ${symbol}:`, err.message);
    logToLiveFeed({ symbol, message: err.message, type: 'error' });
    try { feed.error(String(symbol || 'SYSTEM'), 'Analysis failed', { err: err.message }); } catch {}
    return null;
  }
}

/* Backwards-compat stubs (intentionally no-ops here) */
export async function detectBigDrop(_symbol) { return false; }
export async function detectBigPump(_symbol) { return false; }
export function startSignalEngine() {
  console.log('[startSignalEngine] No-op (scanner owns loops)');
}

// Dev toggles (in console):
//   DEBUG.TA = true/false
//   DEBUG.SKIPS = true/false
//   window.POSEIDON_MIN_CONF = 80
//   window.flushTACache?.()