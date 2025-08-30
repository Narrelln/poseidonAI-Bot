// === evaluatePoseidonDecision.js — Symbol-level Trade Decision Engine
/* eslint-disable no-console */

const axios = require('axios');
const { getPattern } = require('./data/tokenPatternMemory');
const { getPatternProfile } = require('./patternStats');
const {
  updateMemoryFromResult,
  getLearningMemory,
  recordDecisionTrace
} = require('./learningMemory');
const { detectTrendPhase } = require('./trendPhaseDetector.js');
const { openDualEntry } = require('./ppdaEngine.js');
const { getWalletBalance } = require('./walletModule.js');
const { fetchTA } = require('./taClient.js');
const { enhanceWithRails } = require('./railsEnhancer');
const tpTracker            = require('./partialTPManager');
const { getContractSpecs } = require('../kucoinHelper.js'); // lot/min etc.
const { withTimeout }      = require('../utils/withTimeout'); // ✅ timeout guard

// Optional local placement helper (soft import)
let placeFuturesOrder = null;
try { ({ placeFuturesOrder } = require('./placeFuturesOrder.js')); } catch {}

// Optional rails snapshot (soft import; supports multiple possible paths)
let getRailsSnapshot = null;
try { ({ getSnapshot: getRailsSnapshot } = require('../handlers/extremaRails.js')); } catch {}
try { if (!getRailsSnapshot) ({ getSnapshot: getRailsSnapshot } = require('./handlers/extremaRails.js')); } catch {}

// ------------------- config / flags -------------------
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

const AUTO_EXEC_MIN_CONF = Number(process.env.AUTO_EXEC_MIN_CONF || 10); // low to allow autoplace after gates
const AUTO_PLACE_DEFAULT = String(process.env.AUTOPLACE_DEFAULT || 'true').toLowerCase() === 'true';
const HARD_AWAIT_MS      = Number(process.env.HARD_AWAIT_MS || 12000); // unified await cap for slow calls

// Leverage tolerance bands
const LEV_NEAR_BAND = Number(process.env.LEV_NEAR_BAND || 0.5);  // ≤0.5% from ATL/ATH → high lev
const LEV_MID_BAND  = Number(process.env.LEV_MID_BAND  || 1.5);  // ≤1.5% → mid lev
const LEV_HI_MAJOR  = Number(process.env.LEV_HI_MAJOR  || 35);
const LEV_LO_MAJOR  = Number(process.env.LEV_LO_MAJOR  || 20);
const LEV_HI_OTHER  = Number(process.env.LEV_HI_OTHER  || 25);
const LEV_LO_OTHER  = Number(process.env.LEV_LO_OTHER  || 15);

function autoPlaceEnabled() {
  try { return !!(globalThis.__POSEIDON_AUTO_PLACE ?? AUTO_PLACE_DEFAULT); }
  catch { return AUTO_PLACE_DEFAULT; }
}

// Hard gate: only these sources may request execution (kept in sync with decisionHelper)
const ALLOWED_SOURCES = new Set([
  'CYCLE_WATCHER',
  'REVERSAL_WATCHER',
  'PREDATOR_SCALP',
  'FORCE_TRADE',
  'MANUAL',
  'AUTOPILOT',
  'SCANNER'
]);

// Sanity
const VOL_MIN_SANITY    = 50_000;          // low-liquidity guard
const MAX_VOLUME_CAP    = 20_000_000;      // legacy/profile cap (kept)
const MIN_VOLUME_CAP    = 100_000;
const TRADE_COOLDOWN_MS = 60_000;

// ---- ATL/ATH “smart bounce” behaviour ----
const ATL_BOUNCE_STRICT = String(process.env.ATL_BOUNCE_STRICT || 'true').toLowerCase() === 'true';
const ATH_BOUNCE_STRICT = String(process.env.ATH_BOUNCE_STRICT || 'false').toLowerCase() === 'true'; // off by default
const NEAR_BAND_PCT     = Number(process.env.NEAR_BAND_PCT || 0.8); // within 0.8% of 24h low/high counts as "near"

// ------------------- small utils -------------------
const fmtVol = (v) => v >= 1e9 ? (v/1e9).toFixed(2) + 'B'
                  : v >= 1e6 ? (v/1e6).toFixed(1) + 'M'
                  : v >= 1e3 ? (v/1e3).toFixed(0) + 'K' : String(v|0);
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : NaN; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pctDiff = (a, b) => {
  const A = Number(a), B = Number(b);
  if (!(A > 0) || !(B > 0)) return Infinity;
  return Math.abs((A - B) / B) * 100;
};

function baseFromSymbol(sym = '') {
  let s = String(sym).toUpperCase().replace(/[-_/]/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -5);
  else if (s.endsWith('USDT')) s = s.slice(0, -4);
  return s;
}
function toContract(any) {
  let s = String(any || '').toUpperCase();
  if (/^[A-Z0-9]+-USDTM$/.test(s)) return s;
  s = s.replace(/[-_]/g,'');
  if (s.endsWith('USDTM')) return s.replace(/USDTM$/, '') + '-USDTM';
  if (s.endsWith('USDT'))  return s.replace(/USDT$/,  '') + '-USDTM';
  return `${s}-USDTM`;
}
function toSpot(any) {
  return String(toContract(any)).toUpperCase().replace('-USDTM', 'USDT');
}
function sideFromSignal(sig) {
  const s = String(sig || '').toLowerCase();
  if (s === 'bearish') return 'SELL';
  if (s === 'bullish') return 'BUY';
  return null;
}
function logDecision(symbol, msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${symbol} → ${msg}`);
}

// ------------------- WL / majors -------------------
let GLOBAL_WL = new Set();
try {
  const WL = require('../config/tokenWhitelist.json'); // { top:[], memes:[] }
  const arr = [...(WL.top || []), ...(WL.memes || [])].map(s => String(s || '').toUpperCase());
  if (arr.includes('BTC') && !arr.includes('XBT')) arr.push('XBT');
  if (arr.includes('XBT') && !arr.includes('BTC')) arr.push('BTC');
  GLOBAL_WL = new Set(arr);
} catch {
  GLOBAL_WL = new Set(['BTC','XBT','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC','SHIB','PEPE','TRUMP','FLOKI','BONK','WIF','MYRO']);
}
const MAJORS      = new Set(['BTC','XBT','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC']);
const MEME_EXEMPT = new Set(['WIF','TRUMP','MYRO','PEPE','FLOKI','BONK']);
const isGloballyWhitelisted = (b) => GLOBAL_WL.has(String(b||'').toUpperCase());

// ------------------- frozen Top50 fetcher -------------------
async function fetchFrozenTopSet() {
  try {
    const { data } = await axios.get(`${BASE}/api/scan-tokens`, { timeout: 6000 });
    const rows = Array.isArray(data?.top50) ? data.top50 : [];
    const set = new Set();
    for (const r of rows) {
      const b = baseFromSymbol(r?.symbol || r?.base || r);
      if (b) set.add(b);
    }
    return set;
  } catch (e) {
    console.warn('[Evaluator] failed to fetch frozen Top50:', e?.message || e);
    return new Set();
  }
}

// ------------------- multi-horizon structural rails -------------------
const STRUCT_NEAR_BAND = 1.2; // % window defining "near ATL/ATH"

// horizon weights should sum ~1
const HORIZON_WEIGHTS = { '12h':0.06, '24h':0.08, '36h':0.08, '48h':0.10, '7d':0.22, '14d':0.22, '30d':0.24 };
const H_ORDER = ['12h','24h','36h','48h','7d','14d','30d'];

function loadRailsSnapshot(contract, ta) {
  const out = {};
  let gotAny = false;

  if (getRailsSnapshot) {
    try {
      const snap = getRailsSnapshot(contract);
      const rails = snap?.rails || {};
      for (const h of H_ORDER) {
        const r = rails[h];
        if (r && (Number.isFinite(r.atl) || Number.isFinite(r.ath))) {
          out[h] = { atl: Number(r.atl), ath: Number(r.ath) };
          gotAny = true;
        }
      }
    } catch {}
  }

  // Fallbacks from TA where applicable
  if (!gotAny && ta) {
    if (ta?.range24h?.low || ta?.range24h?.high) {
      out['24h'] = { atl: Number(ta?.range24h?.low ?? NaN), ath: Number(ta?.range24h?.high ?? NaN) };
      gotAny = true;
    }
    const atl30 = Number(ta?.rails?.atl30 ?? ta?.range30D?.low ?? NaN);
    const ath30 = Number(ta?.rails?.ath30 ?? ta?.range30D?.high ?? NaN);
    if (Number.isFinite(atl30) || Number.isFinite(ath30)) {
      out['30d'] = { atl: atl30, ath: ath30 };
      gotAny = true;
    }
  }

  return out;
}

// Compute structural side preference and up-to-40 points using multi-horizon rails
function computeStructure(price, railsByH) {
  const closeness = (p, ref) => {
    if (!Number.isFinite(ref) || !(p > 0)) return 0;
    const diff = pctDiff(p, ref);
    return diff <= STRUCT_NEAR_BAND ? clamp(1 - (diff / STRUCT_NEAR_BAND), 0, 1) : 0;
  };

  let buyAccum = 0, sellAccum = 0;
  const contrib = [];

  for (const h of H_ORDER) {
    const w = HORIZON_WEIGHTS[h] ?? 0;
    const rails = railsByH[h];
    if (!rails) continue;

    const nearATL = closeness(price, rails.atl);
    const nearATH = closeness(price, rails.ath);

    if (nearATL > 0) { buyAccum += w * nearATL;  contrib.push(`struct:${h}:ATL*x${(w*nearATL).toFixed(3)}`); }
    if (nearATH > 0) { sellAccum += w * nearATH; contrib.push(`struct:${h}:ATH*x${(w*nearATH).toFixed(3)}`); }
  }

  const buyPts  = Math.round(40 * clamp(buyAccum, 0, 1));
  const sellPts = Math.round(40 * clamp(sellAccum, 0, 1));

  const deadband = 0.03;
  let sidePref = null, tag = '';
  if (buyAccum - sellAccum > deadband) { sidePref = 'BUY';  tag = 'nearATL'; }
  else if (sellAccum - buyAccum > deadband) { sidePref = 'SELL'; tag = 'nearATH'; }

  const structPts = Math.max(buyPts, sellPts);
  return { sidePref, tag, structPts, structDebug: contrib };
}

// ------------------- confidence (0..100) -------------------
const LIQUID_BAND_MIN = MIN_VOLUME_CAP;
const LIQUID_BAND_MAX = MAX_VOLUME_CAP;

function computeConfidence({ price, railsByH, taSignal, momentum01, phase, quoteVolume }) {
  const reasons = [];

  const { sidePref, tag, structPts, structDebug } = computeStructure(price, railsByH);
  if (structDebug.length) reasons.push(...structDebug);
  reasons.push(`structure:${tag||'none'}+${structPts}`);

  const m = clamp(Number(momentum01 || 0), 0, 1);
  let mom = Math.round(30 * m);
  const taSide = sideFromSignal(taSignal);
  if (sidePref && taSide) {
    const aligned = (sidePref === 'BUY' && taSide === 'BUY') || (sidePref === 'SELL' && taSide === 'SELL');
    if (aligned) mom = Math.min(30, mom + 4);
    reasons.push(`momentum:${m.toFixed(2)}${aligned?'+aligned':''}+${mom}`);
  } else {
    reasons.push(`momentum:${m.toFixed(2)}+${mom}`);
  }

  let phasePts = 8;
  if (String(phase).toLowerCase() === 'reversal') phasePts = 18;
  else if (String(phase).toLowerCase() === 'impulse') phasePts = 14;
  reasons.push(`phase:${phase||'n/a'}+${phasePts}`);

  let liq = 0;
  if (Number.isFinite(quoteVolume)) {
    if (quoteVolume >= LIQUID_BAND_MIN && quoteVolume <= LIQUID_BAND_MAX) {
      const mid = Math.sqrt(LIQUID_BAND_MIN * LIQUID_BAND_MAX);
      const ratio = Math.max(0, 1 - Math.abs(Math.log(quoteVolume / mid)) / Math.log(LIQUID_BAND_MAX / mid));
      liq = Math.round(10 * ratio);
    }
  }
  reasons.push(`liquidity:${fmtVol(quoteVolume||0)}+${liq}`);

  const conf = clamp(structPts + mom + phasePts + liq, 0, 100);
  reasons.push(`total:${conf}`);
  return { conf, reasons, sidePref, structPts };
}

// --- 12h-first ATL/ATH proximity boosts (0..8 pts), fallback to 24h ---
function atlBoost(price, ta) {
  const lo12 = Number(ta?.range12h?.low);
  const lo24 = Number(ta?.range24h?.low);
  const ref  = Number.isFinite(lo12) ? lo12 : Number.isFinite(lo24) ? lo24 : NaN;
  if (!Number.isFinite(price) || !Number.isFinite(ref) || ref <= 0) return { pts: 0, note: 'atl:none' };

  const diffPct = Math.abs((price - ref) / ref) * 100;
  const band = Number.isFinite(lo12) ? 1.6 : 2.0;
  const frac = Math.max(0, 1 - (diffPct / band));
  const pts = Math.round(8 * frac);
  const tag = Number.isFinite(lo12) ? '12h' : '24h';
  return { pts, note: `atl${tag}:dist=${diffPct.toFixed(2)}%+${pts}` };
}
function athBoost(price, ta) {
  const hi12 = Number(ta?.range12h?.high);
  const hi24 = Number(ta?.range24h?.high);
  const ref  = Number.isFinite(hi12) ? hi12 : Number.isFinite(hi24) ? hi24 : NaN;
  if (!Number.isFinite(price) || !Number.isFinite(ref) || ref <= 0) return { pts: 0, note: 'ath:none' };

  const diffPct = Math.abs((ref - price) / ref) * 100;
  const band = Number.isFinite(hi12) ? 1.6 : 2.0;
  const frac = Math.max(0, 1 - (diffPct / band));
  const pts = Math.round(8 * frac);
  const tag = Number.isFinite(hi12) ? '12h' : '24h';
  return { pts, note: `ath${tag}:dist=${diffPct.toFixed(2)}%+${pts}` };
}

// ---- “bounce confirmation” helpers ----
function nearATL(price, ta) {
  const lo = Number(ta?.range24h?.low);
  if (!(price > 0) || !(lo > 0)) return { ok:false, distPct:Infinity };
  const distPct = ((price - lo) / lo) * 100;
  return { ok: distPct >= 0 && distPct <= NEAR_BAND_PCT, distPct };
}
function nearATH(price, ta) {
  const hi = Number(ta?.range24h?.high);
  if (!(price > 0) || !(hi > 0)) return { ok:false, distPct:Infinity };
  const distPct = ((hi - price) / hi) * 100;
  return { ok: distPct >= 0 && distPct <= NEAR_BAND_PCT, distPct };
}
function reclaimPxLong(ta) {
  const fib = ta?.fib?.levels || {};
  const lo  = Number(ta?.range24h?.low);
  const f382 = Number(fib['0.382']);
  if (Number.isFinite(f382)) return f382;
  if (Number.isFinite(lo))   return lo * (1 + 0.004); // +0.4% over ATL
  return NaN;
}
function reclaimPxShort(ta) {
  const fib = ta?.fib?.levels || {};
  const hi  = Number(ta?.range24h?.high);
  const f618 = Number(fib['0.618']);
  if (Number.isFinite(f618)) return f618;
  if (Number.isFinite(hi))   return hi * (1 - 0.004); // -0.4% under ATH
  return NaN;
}

// ------------------- leverage rules (Adaptive) -------------------
function dynamicLeverage(base, price, ta, confAdj) {
  const b = String(base || '').toUpperCase();
  const isMajor = MAJORS.has(b) || b === 'BTC' || b === 'XBT';

  // Step 1: baseline leverage range
  const lo = isMajor ? LEV_LO_MAJOR : LEV_LO_OTHER;
  const hi = isMajor ? LEV_HI_MAJOR : LEV_HI_OTHER;

  // Step 2: measure aggression = distance from ATL/ATH
  const atl = Number(ta?.range24h?.low);
  const ath = Number(ta?.range24h?.high);
  let distPct = null;
  const taSide = sideFromSignal(ta?.signal);

  if (taSide === 'BUY' && atl > 0) {
    distPct = ((price - atl) / atl) * 100; // % above ATL
  } else if (taSide === 'SELL' && ath > 0) {
    distPct = ((ath - price) / ath) * 100; // % below ATH
  }

  // Step 3: tolerance → leverage
  let lev = lo;
  if (distPct !== null) {
    if (distPct <= LEV_NEAR_BAND) lev = hi;               // very close → max
    else if (distPct <= LEV_MID_BAND) lev = (hi + lo) / 2; // mid ground
    else lev = lo;                                         // far → conservative
  }

  // Step 4: confidence boost (small nudge)
  if (confAdj >= 85 && lev < hi) lev += 2;

  return clamp(lev, lo, hi);
}

// ------------------- TA fetch wrapper (tries SPOT then CONTRACT) -------------------
async function fetchTAUnified(spot, contract) {
  // best-effort: try spot first (most clients expect SPOT), fallback to contract
  const reasons = [];
  try {
    const taSpot = await withTimeout(fetchTA(spot), HARD_AWAIT_MS, 'ta(spot) timeout');
    if (taSpot && Number.isFinite(Number(taSpot?.price))) return { ta: taSpot, reasons };
    reasons.push('ta:spot:bad');
  } catch (e) { reasons.push('ta:spot:err'); }
  try {
    const taContract = await withTimeout(fetchTA(contract), HARD_AWAIT_MS, 'ta(contract) timeout');
    return { ta: taContract, reasons };
  } catch (e) {
    reasons.push('ta:contract:err');
    return { ta: null, reasons };
  }
}

// ------------------- placement helper (auto place) -------------------
async function placeAuto(symbol, side, notionalUsd, leverage, tpPercent, slPercent, price) {
  if (placeFuturesOrder) {
    return await withTimeout(
      placeFuturesOrder({
        contract: symbol,
        side,
        notionalUsd,
        leverage,
        tpPercent,
        slPercent,
        testPrice: price,
        manual: false
      }),
      HARD_AWAIT_MS,
      'placeFuturesOrder timeout'
    );
  }

  // Fallback to REST route
  const { data } = await axios.post(
    `${BASE}/api/place-futures-trade`,
    {
      contract: symbol,
      side,
      margin: notionalUsd,
      leverage,
      confidence: 85,
      price,
      note: `AUTO • TP ${tpPercent}% / SL ${slPercent}%`,
    },
    { timeout: 15000 }
  );
  return data;
}

// ------------------- optional positions getter (soft) -------------------
let getOpenPositions = null;
try { ({ getOpenPositions } = require('./walletModule.js')); } catch {}

// ------------------- swing-aware DCA helpers -------------------
function computeBounceTrigger(side, ta) {
  const fib = ta?.fib?.levels || null;
  if (!fib) return null;
  if (side === 'BUY') {
    const trigger = Number(fib['0.382'] ?? fib['0.5']);
    return Number.isFinite(trigger) ? trigger : null;
  } else {
    const trigger = Number(fib['0.618'] ?? fib['0.5']);
    return Number.isFinite(trigger) ? trigger : null;
  }
}
function dcaSizeFromFirst(firstNotionalUsd, walletAvail) {
  const twoX = firstNotionalUsd * 2;
  const cap  = Math.max(5, Number((walletAvail * 0.10).toFixed(2)));
  return Math.max(5, Math.min(twoX, cap));
}

// ----- TP Tracker bootstrap for a newly opened position -----
async function startTPForNewPosition(contract, side, entryPrice, confidenceHint) {
  try {
    // Pull fresh positions to find the one we just opened
    let positions = [];
    try { positions = await (getOpenPositions ? getOpenPositions() : []); } catch {}
    const c = String(contract).toUpperCase();

    const pos = (positions || []).find(p => {
      const pc = String(p.contract || p.symbol || '').toUpperCase();
      const s  = String(p.side || p.direction || '').toLowerCase();
      return pc === c && (s.includes('buy') === (side === 'BUY'));
    });

    // Fallback specs (lot/min) from contract list
    const specs = await getContractSpecs(contract).catch(() => ({}));
    const lotSize = Number(specs?.lotSize ?? 1);
    const minSize = Number(specs?.minSize ?? 0);

    const initParams = {
      symbol: c.replace('-USDTM', 'USDT'),
      side:   side === 'BUY' ? 'long' : 'short',
      entryPrice: Number(entryPrice),
      size:   Number(pos?.size || pos?.quantity || pos?.currentQty || 0) || 0,
      initialMargin: Number(pos?.value || pos?.margin || pos?.initialMargin || 0) || null,
      lotSize,
      minSize,
      confidence: Number(confidenceHint || 70)
    };

    tpTracker.initTPTracker(initParams);

    (async () => {
      const spot = toSpot(contract);
      const key  = initParams.symbol;
      const startTs = Date.now();

      while (true) {
        try {
          await new Promise(r => setTimeout(r, 1000));

          // If position is closed, stop
          let live = [];
          try { live = await (getOpenPositions ? getOpenPositions() : []); } catch {}
          const stillOpen = (live || []).some(p => {
            const pc = String(p.contract || p.symbol || '').toUpperCase();
            const s  = String(p.side || p.direction || '').toLowerCase();
            return pc === c && (s.includes('buy') === (side === 'BUY'));
          });
          if (!stillOpen) break;

          // TA tick (use unified fetch with timeout and fallback)
          let taTickObj = await fetchTAUnified(spot, contract);
          let taTick = taTickObj?.ta || null;
          const price = Number(taTick?.price);
          if (!Number.isFinite(price) || price <= 0) continue;

          // trend phase (best effort)
          let trendPhase = 'uptrend';
          try {
            const livePhase = await detectTrendPhase(contract);
            if (livePhase?.phase) trendPhase = String(livePhase.phase);
          } catch {}

          // try to fill margin if missed initially
          const match = (live || []).find(p => {
            const pc = String(p.contract || p.symbol || '').toUpperCase();
            const s  = String(p.side || p.direction || '').toLowerCase();
            return pc === c && (s.includes('buy') === (side === 'BUY'));
          });
          const marginNow = Number(match?.value || match?.margin || match?.initialMargin || 0) || undefined;

          await tpTracker.updateTPStatus({
            symbol: key,
            currentPrice: price,
            trendPhase,
            confidence: Number(taTick?.confidence || confidenceHint || 70),
            ...(Number.isFinite(marginNow) ? { initialMargin: marginNow } : {})
          });

          if (Date.now() - startTs > 48 * 3600 * 1000) break;
        } catch (_) {
          // swallow and continue
        }
      }

      try { tpTracker.onExit(key); } catch {}
    })();

  } catch (e) {
    console.warn('[TPTracker] bootstrap error:', e?.message || e);
  }
}

// ------------------- local evaluator state -------------------
const tradeCooldown = {}; // symbol -> ts
function isInCooldown(symbol) { return Date.now() - (tradeCooldown[symbol] || 0) < TRADE_COOLDOWN_MS; }
function touchCooldown(symbol) { tradeCooldown[symbol] = Date.now(); }

function suggestAutoShutdown(reason = '3 consecutive placement failures') {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('poseidon:auto-shutdown-suggested', { detail: { reason } })); } catch {}
}

// ------------------- MAIN -------------------
/**
 * @param {string} symbol "BTC-USDTM" | "BTCUSDT" | "BTC"
 * @param {object} payload {...}
 */
async function evaluatePoseidonDecision(symbol, payload = {}) {
  const contract = toContract(symbol);
  const base     = baseFromSymbol(contract);
  const spot     = toSpot(contract);
  const traceId  = String(payload.traceId || '');

  // --------- HARD GATES ---------
  const src   = String(payload.source || '').toUpperCase();
  const allow = payload.allowExecute === true;

  if (!ALLOWED_SOURCES.has(src)) {
    console.log(`EVAL [${contract}] ❌ blocked: src=${src || 'UNKNOWN'}`);
    return { success: true, executed: false, reason: 'blocked_source', reasons: ['blocked_source'] };
  }
  if (!allow) {
    console.log(`EVAL [${contract}] ❌ blocked: allowExecute=false (src=${src})`);
    return { success: true, executed: false, reason: 'not_allowed', reasons: ['not_allowed'] };
  }

  // Frozen set check
  const disableFrozenCheck = String(process.env.DISABLE_FROZEN_CHECK || '').toLowerCase() === 'true';
  if (!disableFrozenCheck) {
    const frozen = await fetchFrozenTopSet();
    const baseAllowed = frozen.has(base) || isGloballyWhitelisted(base);
    if (!baseAllowed) {
      console.log(`EVAL [${contract}] ❌ blocked: not in frozen Top50 (base=${base})`);
      return { success: true, executed: false, reason: 'not_in_frozen_pool', reasons: ['not_in_frozen_pool'] };
    }
  }

  // --------- ANALYSIS / CONTEXT ---------
  try {
    const { ta, reasons: taFetchReasons } = await fetchTAUnified(spot, contract);
    if (!ta) {
      logDecision(contract, '⚠️ TA unavailable');
      return { success: true, executed: false, reason: 'ta_unavailable', reasons: ['ta_unavailable', ...(taFetchReasons||[])] };
    }
    const price = n(payload.price ?? ta?.price);
    const reasonsArr = []; // accumulate reasons for early exits

    if (!Number.isFinite(price) || price <= 0) {
      logDecision(contract, '⚠️ Invalid price');
      return { success: true, executed: false, reason: 'bad_price', reasons: ['bad_price'] };
    }

    // Quote volume (USDT) — prefer explicit 24h
    const qv = n(payload.quoteVolume ?? payload.quoteVolume24h ?? ta?.quoteVolume24h ?? ta?.quoteVolume ?? ta?.turnover);

    const BASE_UP = base.toUpperCase();
    const isMajor = MAJORS.has(BASE_UP) || BASE_UP === 'BTC' || BASE_UP === 'XBT';
    const isMeme  = MEME_EXEMPT.has(BASE_UP);

    if (Number.isFinite(qv)) {
      if (qv < VOL_MIN_SANITY) {
        logDecision(contract, `❌ Low turnover (${fmtVol(qv)})`);
        return { success: true, executed: false, reason: 'volume_too_low', reasons: ['volume_too_low', `qv:${qv}`] };
      }
      if (!isMajor && !isMeme && qv > 10_000_000_000) {
        logDecision(contract, `⚠️ Very high turnover for OTHER (${fmtVol(qv)}) — continuing`);
      }
    }

    // ---- Profile / memory volume guard ----
    const policy = payload.policy || {};
    const minConf = Number.isFinite(Number(policy.minConfidence)) ? Number(policy.minConfidence) : undefined;

    const pattern   = getPattern(contract) || {};
    const isWL      = !!pattern.whitelisted || isGloballyWhitelisted(base) || isMajor || isMeme;
    const requiresV = Number(pattern?.needsVolume ?? MIN_VOLUME_CAP);

    if (Number.isFinite(requiresV) && requiresV > 0) {
      if (!(Number.isFinite(qv) && qv >= requiresV)) {
        logDecision(contract, `🔇 Volume below profile min (${fmtVol(qv)} < ${fmtVol(requiresV)})`);
        return { success: true, executed: false, reason: 'profile_volume_gate', reasons: ['profile_volume_gate', `qv:${qv}`, `min:${requiresV}`] };
      }
    }
    if (Number.isFinite(qv) && qv > MAX_VOLUME_CAP && !isWL && !payload.override) {
      logDecision(contract, `❌ Above legacy cap (${fmtVol(qv)}) and not WL`);
      return { success: true, executed: false, reason: 'legacy_volume_cap', reasons: ['legacy_volume_cap', `qv:${qv}`] };
    }

    // ---- Memory guardrails ----
    const mem = (() => {
      try { const m = getLearningMemory(contract) || {}; return { LONG: m.LONG || {}, SHORT: m.SHORT || {} }; }
      catch { return { LONG: {}, SHORT: {} }; }
    })();
    for (const sideKey of ['LONG','SHORT']) {
      const mside = mem[sideKey] || { wins:0, trades:0, currentStreak:0 };
      if (mside.trades >= 8 && mside.wins / mside.trades < 0.30 && Math.abs(mside.currentStreak) > 2) {
        logDecision(contract, `❌ Skip ${sideKey} — cold memory (W:${mside.wins}/${mside.trades}, Streak:${mside.currentStreak})`);
        return { success: true, executed: false, reason: 'cold_memory', reasons: ['cold_memory', `wins:${mside.wins}`, `trades:${mside.trades}`, `streak:${mside.currentStreak}`] };
      }
    }

    // ---- Structural rails ----
    const railsByH = loadRailsSnapshot(contract, ta);
    if (!Object.keys(railsByH).length) {
      const atl30 = n(payload.atl30 ?? ta?.rails?.atl30 ?? ta?.range30D?.low);
      const ath30 = n(payload.ath30 ?? ta?.rails?.ath30 ?? ta?.range30D?.high);
      if (Number.isFinite(atl30) || Number.isFinite(ath30)) {
        railsByH['30d'] = { atl: atl30, ath: ath30 };
      }
    }

    // Momentum (0..1 expected from TA)
    const momentum01 = n(ta?.momentumScore ?? ta?.momentum ?? ta?.momo ?? 0);
    const phase = payload.phase || null;

    // === Intraday pattern profile (expected move & consistency) ===
    let patt = null;
    try { patt = await withTimeout(getPatternProfile(contract, { days: 7 }), 6000, 'patternProfile timeout'); } catch (_) {}
    // Fallback safe defaults
    patt = patt || {
      emPct: 1.2, realizedVsEM: 0, consistency01: 0.5,
      morningMovePct: 0.4, middayPullbackPct: -0.6, afternoonReboundPct: 0.5
    };

    // “Tolerance” = how far today has progressed vs EM
    // If today is < 60% of EM, there’s room → small boost.
    // If already > 120% of EM, probably exhausted → haircut.
    let pattDelta = 0;
    if (patt.realizedVsEM <= 0.6) pattDelta = +4;
    else if (patt.realizedVsEM <= 0.9) pattDelta = +2;
    else if (patt.realizedVsEM >= 1.2) pattDelta = -5;
    else if (patt.realizedVsEM >= 1.0) pattDelta = -2;

    // Consistency matters — confident pattern → add a bit
    pattDelta += Math.round(4 * patt.consistency01 - 2); // from -2..+2

    // We’ll add pattDelta to conf later; also derive leverage tolerance:
    const toleranceScore = clamp((1 - Math.abs((patt.realizedVsEM ?? 1) - 1)), 0, 1); // 1 when near EM, 0 far

    // === Confidence + side selection ===
    const { conf, reasons: confBreakdown, sidePref, structPts } = computeConfidence({
      price, railsByH, taSignal: ta?.signal, momentum01, phase, quoteVolume: qv
    });

    // 12h-first ATL/ATH boost (with 24h fallback)
    const { pts: atlPts, note: atlNote } = atlBoost(price, ta);
    if (atlPts > 0) confBreakdown.push(atlNote);
    const { pts: athPts, note: athNote } = athBoost(price, ta);
    if (athPts > 0) confBreakdown.push(athNote);

    // Pattern-based confidence nudge
    if (pattDelta !== 0) confBreakdown.push(`pattern:EM=${patt.emPct || 'n/a'} rvEM=${Number(patt.realizedVsEM ?? 0).toFixed(2)} cons=${Number(patt.consistency01 ?? 0).toFixed(2)} Δ${pattDelta>=0?'+':''}${pattDelta}`);

    let confAdj = conf + atlPts + athPts + pattDelta;
    let side = null; // allow rails enhancer to set a side hint

    // === Rails enhancer (structure-aware nudges) ===
    try {
      const fibNext =
        Number(ta?.fib?.levels?.['1.272']) ||
        Number(ta?.fib?.levels?.['1.618']) ||
        Number(ta?.range24h?.high) || null;

      const railBoost = await enhanceWithRails(toSpot(contract), {
        price,
        rsi: ta?.rsi,
        fibNextLevel: fibNext,
        taSignal: ta?.signal
      });

      if (railBoost && railBoost.ok) {
        confAdj += Number(railBoost.delta || 0);
        if (Array.isArray(railBoost.reasons) && railBoost.reasons.length) {
          confBreakdown.push(...(railBoost.reasons));
        }
        if (!side && railBoost.sidePref) {
          side = railBoost.sidePref;
          confBreakdown.push(`side:rails(${railBoost.horizon || 'n/a'})`);
        }
        try {
          if (railBoost.targets || railBoost.invalidation) {
            global.__POSEIDON_LAST_RAILS_HINT__ = {
              symbol: contract,
              horizon: railBoost.horizon,
              targets: railBoost.targets || null,
              invalidation: railBoost.invalidation || null
            };
          }
        } catch {}
      }
    } catch (e) {
      console.warn('[Evaluator] railsEnhancer error:', e?.message || e);
    }

    // Now apply minConfidence AFTER rails + pattern delta
    if (Number.isFinite(minConf) && confAdj < minConf) {
      logDecision(contract, `⛔ Below profile minConfidence (${confAdj} < ${minConf})`);
      touchCooldown(contract);
      return { success: true, executed: false, reason: 'below_min_confidence', confidence: confAdj, reasons: confBreakdown };
    }

    // Side selection (respect pre-set from structure/rails)
    const taSide = sideFromSignal(payload.signal ?? ta?.signal); // BUY|SELL|null
    if (!side) {
      if (sidePref) {
        side = sidePref; confBreakdown.push(`side:structure(${structPts})`);
      } else if (String(payload.sideHint || '').toLowerCase() === 'long') {
        side = 'BUY';  confBreakdown.push('side:hint-long');
      } else if (String(payload.sideHint || '').toLowerCase() === 'short') {
        side = 'SELL'; confBreakdown.push('side:hint-short');
      } else if (taSide) {
        side = taSide; confBreakdown.push('side:ta');
      } else {
        logDecision(contract, '⛔ No clear side (structure/TA ambiguous) — skipping');
        touchCooldown(contract);
        return { success: true, executed: false, reason: 'no_clear_side', reasons: ['no_clear_side'] };
      }
    }

    // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
    // HARD “bounce” gate near ATL/ATH to avoid knife-catching:
    if (side === 'BUY' && ATL_BOUNCE_STRICT) {
      const near = nearATL(price, ta);
      if (near.ok) {
        const need = reclaimPxLong(ta); // prefer Fib 0.382, else ATL +0.4%
        if (Number.isFinite(need) && price < need) {
          logDecision(contract, `🛑 await_bounce_long • price=${price.toFixed(6)} < reclaim=${need.toFixed(6)} • distATL=${near.distPct.toFixed(2)}%`);
          touchCooldown(contract);
          return { success: true, executed: false, reason: 'await_bounce_long', reclaim: need, price, confidence: confAdj, reasons: confBreakdown };
        }
      }
    }
    if (side === 'SELL' && ATH_BOUNCE_STRICT) {
      const near = nearATH(price, ta);
      if (near.ok) {
        const need = reclaimPxShort(ta); // prefer Fib 0.618, else ATH -0.4%
        if (Number.isFinite(need) && price > need) {
          logDecision(contract, `🛑 await_bounce_short • price=${price.toFixed(6)} > reclaim=${need.toFixed(6)} • distATH=${near.distPct.toFixed(2)}%`);
          touchCooldown(contract);
          return { success: true, executed: false, reason: 'await_bounce_short', reclaim: need, price, confidence: confAdj, reasons: confBreakdown };
        }
      }
    }
    // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

    // ---- PPDA hook (optional extreme) ----
    if (!payload.manual && (payload.override === true || confAdj >= AUTO_EXEC_MIN_CONF)) {
      try {
        const phaseLive = await withTimeout(detectTrendPhase(contract), HARD_AWAIT_MS, 'trendPhase timeout');
        if (phaseLive && ['peak','reversal'].includes(phaseLive.phase)) {
          logDecision(contract, `🔀 PPDA trigger (${phaseLive.phase}, C:${confAdj})`);
          openDualEntry({ symbol: contract, highConfidenceSide: 'SHORT', lowConfidenceSide: 'LONG', baseAmount: 1 });
          touchCooldown(contract);
          if (traceId) try { recordDecisionTrace(contract, { traceId, source: src, phase, side, confidence: confAdj, price }); } catch {}
          return { success: true, executed: true, tx: { mode: 'ppda' } };
        }
      } catch {}
    }

    // ---- Learning memory (best effort) ----
    try {
      updateMemoryFromResult(contract, {
        confidence: confAdj,
        price,
        range24hHigh: ta?.range24h?.high,
        range24hLow : ta?.range24h?.low,
        trapWarning : !!ta?.trapWarning,
        traceId,
        source: src,
        phase,
        side
      });
    } catch {}
    if (traceId) { try { recordDecisionTrace(contract, { traceId, source: src, phase, side, confidence: confAdj, price }); } catch {} }

    // ---- Log final decision context ----
    const extraNote = payload.note ? ` • note="${String(payload.note).slice(0,120)}"` : '';
    logDecision(contract, `🎛 side=${side} • C=${confAdj} • reasons=[${confBreakdown.join(' | ')}]${extraNote}`);

    // ---- Autoplace (optional) ----
    if (!autoPlaceEnabled()) {
      touchCooldown(contract);
      return {
        success: true, executed: false, reason: 'gate_passed_no_autoplace',
        side, confidence: confAdj, reasons: confBreakdown, traceId
      };
    }

    if (!payload.manual && confAdj >= AUTO_EXEC_MIN_CONF) {
      // TP/SL: prefer policy if present; else adaptive fallback
      const policyTPs = Array.isArray(policy.tpPercents) ? policy.tpPercents.filter(x => Number.isFinite(Number(x))) : null;
      const tpPercent = Number.isFinite(payload.tpPercent)
        ? Number(payload.tpPercent)
        : (policyTPs && policyTPs.length ? Number(policyTPs[0]) :
            (confAdj >= 90 ? 60 : confAdj >= 85 ? 40 : confAdj >= 75 ? 30 : 20));

      const slPercent = Number.isFinite(payload.slPercent)
        ? Number(payload.slPercent)
        : (Number.isFinite(policy.slPercent) ? Number(policy.slPercent) : 10);

      // ===== Leverage tuned by intraday pattern & major/meme class =====
      const baseIsMajor = MAJORS.has(base.toUpperCase()) || ['BTC','XBT'].includes(base.toUpperCase());
      const levLo = baseIsMajor ? 20 : 15;
      const levHi = baseIsMajor ? 35 : 25;

      // Closer to EM (toleranceScore high) + early day (rvEM<0.6) → higher lev.
      // Late and exhausted (>1.2×EM) → lower lev.
      let lev = levLo + Math.round( (levHi - levLo) * clamp(0.5 * toleranceScore + (patt.realizedVsEM < 0.6 ? 0.3 : 0) - (patt.realizedVsEM > 1.2 ? 0.4 : 0), 0, 1) );

      // Confidence nudge
      if (confAdj >= 85 && lev < levHi) lev += 2;
      let leverage = clamp(lev, levLo, levHi);

      // Optional blend with ATL/ATH proximity model (take the safer of the two: min)
      try {
        const levDyn = dynamicLeverage(base, price, ta, confAdj);
        leverage = clamp(Math.min(levDyn, leverage), levLo, levHi);
      } catch {}

      // Clamp against exchange limits
      let specs = {};
      try { specs = await getContractSpecs(contract) || {}; } catch {}
      const exchMaxLev = Number(specs?.maxLeverage) || 100;
      const exchMinLev = Number(specs?.minLeverage) || 1;
      const finalLeverage = Math.min(Math.max(leverage, exchMinLev), exchMaxLev);

      // Risk per trade = 5% of wallet available (fallback $1000 if unknown)
      let wallet = { available: 1000 };
      try {
        const w = await getWalletBalance();
        wallet.available = Number(w?.available ?? (typeof w === 'number' ? w : 1000));
      } catch {}
      const notionalUsd = Math.max(5, Number((wallet.available * 0.05).toFixed(2)));

      try {
        const tx = await placeAuto(contract, side, notionalUsd, finalLeverage, tpPercent, slPercent, price);

        const entry = Number(price);
        const target = side === 'BUY'
          ? entry * (1 + tpPercent / 100)
          : entry * (1 - tpPercent / 100);

        logDecision(
          contract,
          `✅ AUTO ${side === 'BUY' ? 'BUY' : 'SELL'} ${contract} | ${entry.toFixed(5)} → ${target.toFixed(5)} | $${notionalUsd.toFixed(2)} | ${finalLeverage}x | TP ${tpPercent}%`
        );

        // Start TP tracker for this fresh position
        try { await startTPForNewPosition(contract, side, entry, confAdj); } catch (e) { console.warn('[TPTracker] start error:', e?.message || e); }

        // -------- Swing-aware DCA plan --------
        const triggerPx = computeBounceTrigger(side, ta);
        if (Number.isFinite(triggerPx)) {
          try {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('poseidon:signal', {
                detail: { event: 'dca-plan', symbol: contract, side: side === 'BUY' ? 'buy' : 'sell', trigger: triggerPx, addNotional: notionalUsd * 2 }
              }));
            }
          } catch {}

          (async () => {
            try {
              const deadline = Date.now() + 6 * 60 * 60 * 1000; // 6h validity
              while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 15_000));
                let taTickObj = await fetchTAUnified(spot, contract);
                let taTick = taTickObj?.ta || null;
                const p = Number(taTick?.price);
                if (!Number.isFinite(p)) continue;
                const ok = (side === 'BUY') ? (p >= triggerPx) : (p <= triggerPx);
                if (ok) {
                  let w = { available: wallet.available };
                  try { const wb = await getWalletBalance(); w.available = Number(wb?.available ?? w.available); } catch {}
                  const addUsd = dcaSizeFromFirst(notionalUsd, w.available);

                  await placeAuto(contract, side, addUsd, finalLeverage, tpPercent, slPercent, p);
                  logDecision(contract, `🧩 DCA add executed at ${p.toFixed(5)} for $${addUsd.toFixed(2)} (trigger ${triggerPx.toFixed(5)})`);
                  try {
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('poseidon:signal', {
                        detail: { event: 'dca-executed', symbol: contract, side: side === 'BUY' ? 'buy' : 'sell', price: p, notional: addUsd }
                      }));
                    }
                  } catch {}
                  break;
                }
              }
            } catch (e) {
              logDecision(contract, `DCA plan watcher error: ${e?.message || e}`);
            }
          })();
        }
        // --------------------------------------

        touchCooldown(contract);
        return { success: true, executed: true, tx, side, confidence: confAdj, reasons: confBreakdown, traceId };
      } catch (e) {
        logDecision(contract, `❌ Auto placement failed: ${e?.message || e}`);
        const key = '__poseidon_auto_failures__';
        global[key] = (global[key] || 0) + 1;
        if (global[key] >= 3) { suggestAutoShutdown('3 consecutive placement failures'); global[key] = 0; }
        return { success: false, executed: false, error: String(e?.message || 'execution_failed'), traceId };
      }
    }

    touchCooldown(contract);
    return { success: true, executed: false, reason: 'passed_no_conditions', side, confidence: confAdj, reasons: confBreakdown, traceId };

  } catch (err) {
    console.error(`❌ Fatal evaluator error for ${contract}:`, err?.message || err);
    return { success: false, executed: false, error: String(err?.message || 'fatal') };
  }
}
function onExit(symbol) {
  return markTradeExited(symbol);
}

module.exports = {
  evaluatePoseidonDecision,
  updateMemoryFromResult,
  getMemory: getLearningMemory
};
