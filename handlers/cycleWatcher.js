/**
 * handlers/cycleWatcher.js — CYCLE (anchor) + PREDATOR (scalp)
 * Uses ONE unified TA/rails adapter so both engines read identical inputs,
 * then each applies its own logic and places trades via evaluatePoseidonDecision(..., { allowExecute:true }).
 *
 * Collision safety (config via env):
 *  - BLOCK_OPPOSITE_ENTRIES=true
 *  - BLOCK_PREDATOR_IF_CYCLE_LIVE=true
 *  - PREDATOR_ALLOW_SAME_SIDE=false
 *  - STRATEGY_MIN_GAP_MS=900000 (15m)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const CycleState = require('../models/CycleState');
const { evaluatePoseidonDecision } = require('./decisionHelper');

// ---- optional helpers (soft)
let buildEntryReasons = () => [];
let buildExitReasons  = () => [];
try { ({ buildEntryReasons, buildExitReasons } = require('./strategyReasons')); } catch {}
let buildProEntryNote = null;
try { ({ buildProEntryNote } = require('./proTradeNote')); } catch {}
let pushTick = null, getRailsSnapshot = null;
try { ({ pushTick, getSnapshot: getRailsSnapshot } = require('../handlers/extremaRails')); } catch {}
try { if (!pushTick || !getRailsSnapshot) ({ pushTick, getSnapshot: getRailsSnapshot } = require('./extremaRails')); } catch {}

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

// ---- feature flags / tunables
const USE_MEMORY = String(process.env.USE_MEMORY || 'true') === 'true';
const ENTER_COOLDOWN_MS = Number(process.env.CYCLE_ENTER_COOLDOWN_MS || 12_000);
const EXIT_COOLDOWN_MS  = Number(process.env.CYCLE_EXIT_COOLDOWN_MS  || 8_000);

// strategy collision guards
const BLOCK_OPPOSITE_ENTRIES          = String(process.env.BLOCK_OPPOSITE_ENTRIES || 'true') === 'true';
const BLOCK_PREDATOR_IF_CYCLE_LIVE    = String(process.env.BLOCK_PREDATOR_IF_CYCLE_LIVE || 'true') === 'true';
const PREDATOR_ALLOW_SAME_SIDE        = String(process.env.PREDATOR_ALLOW_SAME_SIDE || 'false') === 'true';
const STRATEGY_MIN_GAP_MS             = Number(process.env.STRATEGY_MIN_GAP_MS || 15 * 60 * 1000); // 15m min spacing

// predator thresholds / throttles
const PREDATOR_MIN_SCORE_LONG  = Number(process.env.PREDATOR_MIN_SCORE_LONG  ?? 75);
const PREDATOR_MIN_SCORE_SHORT = Number(process.env.PREDATOR_MIN_SCORE_SHORT ?? 77);
const PREDATOR_EXIT_SCORE      = Number(process.env.PREDATOR_EXIT_SCORE      ?? 48);
const PREDATOR_COOLDOWN_MS     = Number(process.env.PREDATOR_COOLDOWN_MS     ?? 20 * 60 * 1000);
const STRICT_NEAR_ATL          = String(process.env.STRICT_NEAR_ATL || 'true').toLowerCase() === 'true';
const STRICT_NEAR_ATH          = String(process.env.STRICT_NEAR_ATH || 'true').toLowerCase() === 'true';

// cycle tunables
const NEAR_24H_LOW_BAND_PCT = Number(process.env.CYCLE_NEAR_24H_LOW_BAND_PCT || 0.9);
const MIN_MOMENTUM_TO_ENTER = Number(process.env.CYCLE_MIN_MOMENTUM_TO_ENTER || 0.10);
const PEAK_PULLBACK_TO_FLIP = Number(process.env.CYCLE_PEAK_PULLBACK_TO_FLIP || 1.1);
const HOME_PROXIMITY_PCT    = Number(process.env.CYCLE_HOME_PROXIMITY_PCT || 0.6);
const MAX_RIDE_MINUTES_UP   = Number(process.env.CYCLE_MAX_RIDE_MIN_UP || 120);
const MAX_RIDE_MINUTES_DN   = Number(process.env.CYCLE_MAX_RIDE_MIN_DN || 180);

// ---- universe (majors/memes/whitelist) — still used by entry guards, not by watchlist
const MAJORS = new Set(['BTC','XBT','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','LINK','LTC','TRX','TON','DOT','NEAR','ARB','OP']);
const MEMES  = new Set(['DOGE','SHIB','PEPE','WIF','FLOKI','BONK','MYRO','BOME','MEW','MOG','BRETT','SATS','1000RATS','DOGS','TRUMP']);

let WHITELIST = new Set();
(function loadWhitelist(){
  try {
    const fp = path.resolve(__dirname, '../config/tokenWhitelist.json');
    const raw = fs.readFileSync(fp, 'utf-8');
    const json = JSON.parse(raw);
    const arr = Array.isArray(json) ? json : Array.isArray(json?.tokens) ? json.tokens : [];
    const toBase = (v) => String((typeof v==='string'? v : (v?.base||v?.symbol||''))).toUpperCase()
      .replace(/[-_]/g,'').replace(/USDTM?$/,'').replace(/USDT$/,'').replace(/^XBT$/,'BTC');
    WHITELIST = new Set(arr.map(toBase).filter(Boolean));
  } catch { WHITELIST = new Set(); }
})();
const isMajorOrMeme = (b) => {
  const x = String(b||'').toUpperCase(); const n = x === 'XBT' ? 'BTC' : x;
  return MAJORS.has(n) || MEMES.has(n);
};

// ---- service + utils
let TRADE_COUNT = 0;
let LAST_TICK_MS = 0;
let RUNNING = false;
let WATCHING = [];

function toKey(s){ return String(s||'').toUpperCase().replace(/-/g,''); }
function toSpot(contract){ return String(contract||'').toUpperCase().replace(/-USDTM$/,'USDT'); }
function normalizeBase(sym=''){ return String(sym).toUpperCase().replace(/[-_]/g,'').replace(/USDTM?$/,'').replace(/USDT$/,'').replace(/^XBT$/,'BTC'); }
function parseToKucoinContractSymbol(s) {
  if (!s) return '';
  let x = String(s).toUpperCase().replace(/[-_]/g,'');
  if (x.endsWith('USDTM')) x = x.slice(0,-1);
  if (!x.endsWith('USDT')) x += 'USDT';
  // KuCoin uses XBT for BTC futures
  x = x.replace(/^BTCUSDT$/, 'XBTUSDT');
  return `${x.replace(/USDT$/,'')}-USDTM`;
}
function toContractSymbol(anySym){ try { return parseToKucoinContractSymbol(anySym); } catch { return parseToKucoinContractSymbol(anySym); } }
function n(v){ const x = Number(v); return Number.isFinite(x) ? x : NaN; }
function pctDiff(a,b){ const A=Number(a),B=Number(b); if(!(A>0&&B>0)) return Infinity; return Math.abs((A-B)/B)*100; }
function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }
function newTraceId(contract, suf){ const b = normalizeBase(contract)||'SYM'; return `${b}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}${suf?'-'+suf:''}`; }

// ---- rails scoring (structure ≤40, shared)
const STRUCT_NEAR_BAND = 1.2; // %
const H_WEIGHTS = { '12h':0.06,'24h':0.08,'36h':0.08,'48h':0.10,'7d':0.22,'14d':0.22,'30d':0.24 };
const H_ORDER   = ['12h','24h','36h','48h','7d','14d','30d'];
function closeness01(price, ref){
  if (!Number.isFinite(ref) || !(price > 0)) return 0;
  const d = pctDiff(price, ref);
  return d <= STRUCT_NEAR_BAND ? clamp(1 - (d / STRUCT_NEAR_BAND), 0, 1) : 0;
}
function structurePointsFromRails(price, railsByH = {}) {
  let buyAccum = 0, sellAccum = 0;
  for (const h of H_ORDER) {
    const r = railsByH[h]; if (!r) continue;
    const w = H_WEIGHTS[h] || 0;
    const nearATL = closeness01(price, r.atl);
    const nearATH = closeness01(price, r.ath);
    if (nearATL > 0) buyAccum  += w * nearATL;
    if (nearATH > 0) sellAccum += w * nearATH;
  }
  const pts = Math.round(40 * clamp(Math.max(buyAccum, sellAccum), 0, 1));
  const sidePref = buyAccum > sellAccum + 0.03 ? 'BUY' : (sellAccum > buyAccum + 0.03 ? 'SELL' : null);
  const arrivedTag = sidePref === 'BUY' ? 'nearATL' : sidePref === 'SELL' ? 'nearATH' : '';
  return { pts, sidePref, arrivedTag };
}

// ---- unified TA & rails adapter (single truth)
async function getTA(spot) {
  try { const { data } = await axios.get(`${BASE}/api/ta/${spot}`, { timeout: 6000 }); return data||{}; }
  catch { return {}; }
}
async function getPositions() {
  try { const { data } = await axios.get(`${BASE}/api/positions`, { timeout: 8000 }); return data?.positions || []; }
  catch { return []; }
}
async function getMemorySnapshot(spot) {
  if (!USE_MEMORY) return null;
  try {
    const { data } = await axios.get(`${BASE}/api/learning-memory/${spot}/snapshot`, { timeout: 3000 });
    const snap = data?.snapshot || null;
    try {
      const t = snap?.updatedAt ? new Date(snap.updatedAt).getTime() : null;
      if (t && Date.now() - t > 120000) return null;
    } catch {}
    return snap;
  } catch { return null; }
}
async function sendTickToMemory(spot, price) {
  if (!USE_MEMORY || !Number.isFinite(Number(price))) return;
  try { await axios.post(`${BASE}/api/learning-memory/tick`, { symbol: spot, price: Number(price) }, { timeout: 2000 }); } catch {}
}

async function getUnifiedContext(spot, st, memSnap) {
  const ta = await getTA(spot);

  const price    = n(ta.price ?? ta.markPrice ?? 0);
  const momentum = clamp(n(ta.momentumScore ?? ta.momentum ?? ta.momo ?? 0), 0, 1);
  const signal   = String(ta.signal || '').toLowerCase();
  const qv       = n(ta.quoteVolume ?? ta.qv ?? ta.quoteVolume24h ?? 0);

  const todayLow  = n(memSnap?.todayLow  ?? ta?.range24h?.low  ?? NaN);
  const todayHigh = n(memSnap?.todayHigh ?? ta?.range24h?.high ?? NaN);

  const fallbackAtl30 = n(memSnap?.atl30 ?? st?.atl30 ?? ta?.rails?.atl30 ?? ta?.range30D?.low  ?? NaN);
  const fallbackAth30 = n(memSnap?.ath30 ?? st?.ath30 ?? ta?.rails?.ath30 ?? ta?.range30D?.high ?? NaN);

  let railsByH = {};
  if (typeof getRailsSnapshot === 'function') {
    try {
      const snap = getRailsSnapshot(spot);
      const rails = snap?.rails || {};
      for (const h of H_ORDER) {
        const r = rails[h];
        if (r && (Number.isFinite(r.atl) || Number.isFinite(r.ath))) {
          railsByH[h] = { atl: n(r.atl), ath: n(r.ath) };
        }
      }
    } catch {}
  }

  return {
    price, momentum, signal, qv,
    todayLow, todayHigh,
    fallbackAtl30: Number.isFinite(fallbackAtl30) ? fallbackAtl30 : undefined,
    fallbackAth30: Number.isFinite(fallbackAth30) ? fallbackAth30 : undefined,
    railsByH
  };
}

// ---- confidence (Cycle) using shared inputs
function computeConfidenceFromContext({ price, railsByH, fallbackAtl30, fallbackAth30, taSignal, momentum, action, quoteVolume, nearestSupport, nearestResistance }) {
  let structPts = 0, arrivedTag = '', sidePref = null;
  if (railsByH && Object.keys(railsByH).length) {
    const s = structurePointsFromRails(price, railsByH);
    structPts = s.pts; arrivedTag = s.arrivedTag; sidePref = s.sidePref;
  } else if (Number.isFinite(fallbackAtl30) || Number.isFinite(fallbackAth30)) {
    const nearATL = closeness01(price, fallbackAtl30);
    const nearATH = closeness01(price, fallbackAth30);
    const buyPts  = Math.round(40 * nearATL);
    const sellPts = Math.round(40 * nearATH);
    structPts   = Math.max(buyPts, sellPts);
    sidePref    = buyPts > sellPts ? 'BUY' : (sellPts > buyPts ? 'SELL' : null);
    arrivedTag  = sidePref === 'BUY' ? 'nearATL' : sidePref === 'SELL' ? 'nearATH' : '';
  }

  const m = clamp(Number(momentum)||0, 0, 1);
  let confMomentum = Math.round(m * 30);
  const isBull = String(taSignal||'') === 'bullish';
  const isBear = String(taSignal||'') === 'bearish';
  if ((arrivedTag === 'nearATL' && isBull) || (arrivedTag === 'nearATH' && isBear)) confMomentum = Math.min(30, confMomentum + 4);

  const confPhase = action === 'ENTER_REVERSAL' ? 18 : action === 'ENTER_IMPULSE' ? 14 : 0;

  let confLiq = 0;
  const qv = Number(quoteVolume);
  if (Number.isFinite(qv)) {
    if (qv >= 100_000 && qv <= 20_000_000) confLiq = 10;
    else if (qv > 20_000_000 && qv <= 1_500_000_000) confLiq = 6;
    else if (qv >= 50_000 && qv < 100_000) confLiq = 4;
  }

  let confSR = 0;
  if (Number.isFinite(price)) {
    const sup = Number(nearestSupport);
    const res = Number(nearestResistance);
    const near = (a) => Number.isFinite(a) ? Math.min(1, Math.abs((price - a) / Math.max(1e-9, price)) / 0.006) : 1; // ~0.6%
    if (Number.isFinite(sup) && price >= sup) confSR += Math.max(0, 3 * (1 - near(sup)));
    if (Number.isFinite(res) && price <= res) confSR -= Math.max(0, 3 * (1 - near(res)));
  }
  confSR = Math.max(-6, Math.min(6, Math.round(confSR * 2)));

  return { conf: clamp(structPts + confMomentum + confPhase + confLiq + confSR, 0, 100), arrivedTag, sidePref };
}

// ---- Predator scorer (soft import or fallback) using shared inputs too
let computePredatorScore;
try { ({ computePredatorScore } = require('../services/predatorScorer')); } catch {
  computePredatorScore = function ({ price, railsByH, momentum, signal, qv, fallbackAtl30, fallbackAth30 }) {
    const closeness = (p,ref)=> (p>0 && Number.isFinite(ref)) ? (Math.abs((p-ref)/ref)*100<=STRUCT_NEAR_BAND? 1-(Math.abs((p-ref)/ref)*100/STRUCT_NEAR_BAND):0) : 0;
    let buy=0,sell=0;
    for (const h of H_ORDER){
      const r=railsByH?.[h]; if(!r) continue;
      const w=H_WEIGHTS[h]||0;
      buy  += w * closeness(price, Number(r.atl));
      sell += w * closeness(price, Number(r.ath));
    }
    if (!Object.keys(railsByH||{}).length) {
      buy+=0.24*closeness(price,Number(fallbackAtl30));
      sell+=0.24*closeness(price,Number(fallbackAth30));
    }
    const structPts = Math.round(40*Math.max(buy,sell));
    const sidePref = buy>sell+0.03?'BUY':(sell>buy+0.03?'SELL':null);
    const arrivedTag = sidePref==='BUY'?'nearATL':sidePref==='SELL'?'nearATH':'';
    const m = clamp(Number(momentum)||0,0,1);
    let mom = Math.round(30*m);
    if((arrivedTag==='nearATL'&&signal==='bullish')||(arrivedTag==='nearATH'&&signal==='bearish')) mom=Math.min(30,mom+4);
    let liq=0; const vol=+qv||0;
    if (vol>=100_000 && vol<=20_000_000) liq=10; else if (vol>20_000_000 && vol<=1_500_000_000) liq=6; else if (vol>=50_000 && vol<100_000) liq=4;
    const score = Math.max(0, Math.min(100, structPts+mom+liq));
    return { score, sidePref, arrivedTag, reasons: [`mom:${m.toFixed(2)}+${mom}`, `liq:${vol}+${liq}`, `struct:${structPts}`] };
  };
}

// ---- cooldowns + spacing
const inFlight = new Set();
const lastEnterAt = new Map();    // any entry (either strategy)
const lastExitAt  = new Map();
const lastStrategyEnterAt = new Map(); // `${contract}|CYCLE` / `${contract}|PREDATOR`
function isCooling(contract, kind) {
  const now = Date.now();
  if (kind === 'enter') return now - (lastEnterAt.get(contract)||0) < ENTER_COOLDOWN_MS;
  return now - (lastExitAt.get(contract)||0) < EXIT_COOLDOWN_MS;
}
function markAction(contract, kind, strategy){
  const now = Date.now();
  if (kind === 'enter') {
    lastEnterAt.set(contract, now);
    lastStrategyEnterAt.set(`${contract}|${strategy}`, now);
  } else if (kind === 'exit') {
    lastExitAt.set(contract, now);
  }
}
function strategySpacingOk(contract, strategy){
  const now = Date.now();
  const other = strategy === 'CYCLE' ? 'PREDATOR' : 'CYCLE';
  const t = lastStrategyEnterAt.get(`${contract}|${other}`) || 0;
  return now - t >= STRATEGY_MIN_GAP_MS;
}

// ---- RoundTrip (Cycle) state
const rtState = new Map(); // contract -> { leg, originPrice, originLow, rollingHigh, rollingLow, enteredAt }
function getRT(contract){ if (!rtState.has(contract)) rtState.set(contract, { leg:'IDLE', originPrice:null, originLow:null, rollingHigh:null, rollingLow:null, enteredAt:null }); return rtState.get(contract); }
function setRT(contract, patch){ const cur = getRT(contract); rtState.set(contract, { ...cur, ...patch }); }

// ---- core tick
async function tickOne(contract){
  LAST_TICK_MS = Date.now();
  if (!contract || inFlight.has(contract)) return;
  inFlight.add(contract);
  try {
    const now = Date.now();
    const spot = toSpot(contract);
    const [st, positions, memSnap] = await Promise.all([
      CycleState.findOne({ symbol: contract }).lean(),
      getPositions(),
      getMemorySnapshot(spot)
    ]);
    const live = positions.find(p => toKey(p.contract||p.symbol) === toKey(contract));
    const liveSide = live?.side ? String(live.side).toUpperCase() : null; // 'BUY'|'SELL' (if your positions API sets it)

    const U = await getUnifiedContext(spot, st, memSnap);
    const { price, momentum, signal: taSignal, qv, todayLow, todayHigh, fallbackAtl30, fallbackAth30, railsByH } = U;
    if (!(price > 0)) return;

    if (USE_MEMORY) sendTickToMemory(spot, price);
    if (typeof pushTick === 'function') { try { pushTick(spot, price, now); } catch {} }

    // ---------- PREDATOR (scalp) ----------
    try {
      const { score, sidePref, arrivedTag, reasons } = computePredatorScore({ price, railsByH, momentum, signal: taSignal, qv, fallbackAtl30, fallbackAth30 });
      const wantLong  = sidePref === 'BUY'  && score >= PREDATOR_MIN_SCORE_LONG;
      const wantShort = sidePref === 'SELL' && score >= PREDATOR_MIN_SCORE_SHORT;

      const predatorWants = wantLong ? 'BUY' : wantShort ? 'SELL' : null;
      const blockedOpposite = BLOCK_OPPOSITE_ENTRIES && predatorWants && liveSide && predatorWants !== liveSide;
      const blockedCycleLive = BLOCK_PREDATOR_IF_CYCLE_LIVE && (getRT(contract).leg !== 'IDLE' && getRT(contract).leg !== 'COMPLETE');
      const blockedSameSide = !PREDATOR_ALLOW_SAME_SIDE && predatorWants && liveSide && predatorWants === liveSide;
      const spaced = strategySpacingOk(contract, 'PREDATOR');

      const lastPredKey = `${contract}|PREDATOR_LAST`;
      const lastPredAt = lastStrategyEnterAt.get(lastPredKey) || 0;
      const predatorCooldownOk = (Date.now() - lastPredAt) >= PREDATOR_COOLDOWN_MS;

      // strict reclaim/reject near 24h
      let atlGate = true, athGate = true;
      if (STRICT_NEAR_ATL && predatorWants === 'BUY' && arrivedTag === 'nearATL') {
        atlGate = Number.isFinite(todayLow) ? price >= todayLow * 1.004 : false;
      }
      if (STRICT_NEAR_ATH && predatorWants === 'SELL' && arrivedTag === 'nearATH') {
        athGate = Number.isFinite(todayHigh) ? price <= todayHigh * 0.996 : false;
      }

      const allowPredatorEnter = predatorWants && !isCooling(contract,'enter') && !blockedOpposite && !blockedCycleLive && !blockedSameSide && spaced && predatorCooldownOk && atlGate && athGate;

      if (allowPredatorEnter) {
        await predatorEnter(predatorWants, { score, arrivedTag, reasons });
        lastStrategyEnterAt.set(lastPredKey, Date.now());
        return; // handled this tick
      }

      // safety exit (rare)
      if (live && !isCooling(contract,'exit')) {
        const danger = score <= PREDATOR_EXIT_SCORE && (taSignal === 'bearish'); // keep simple
        if (danger) {
          await closeTrade({ contract, note: `PREDATOR_EXIT_ASSIST • score=${score} • reasons=${reasons.join(' | ')}` });
          await CycleState.updateOne(
            { symbol: contract },
            { $set: { phase: 'EXHAUST', lastHint: 'predator_exit_assist', lastReasons: reasons, lastExitAt: new Date() } },
            { upsert: true }
          );
          markAction(contract,'exit','PREDATOR');
          return;
        }
      }

      async function predatorEnter(side, { score, arrivedTag, reasons }) {
        const traceId = newTraceId(contract, 'P');
        const note = `PREDATOR_ENTER • score=${score} • ${arrivedTag} • ${reasons.join(' | ')}`;
        await evaluatePoseidonDecision(contract, {
          source: 'PREDATOR_SCALP',
          strategyTag: 'PREDATOR',
          allowExecute: true,
          confidence: score,
          phase: arrivedTag === 'nearATH' ? 'reversal' : 'impulse',
          sideHint: side === 'BUY' ? 'long' : 'short',
          price, quoteVolume: qv, note, reasons, traceId
        });
        await CycleState.updateOne(
          { symbol: contract },
          { $set: { lastHint: 'predator_enter', lastReasons: reasons, lastTraceId: traceId } },
          { upsert: true }
        );
        markAction(contract,'enter','PREDATOR');
        TRADE_COUNT += 1;
        console.log(`[predator] ${contract} ${side} • score=${score} • ${arrivedTag}`);
      }
    } catch (e) { console.warn('[predator] block error:', e?.message || e); }

    // ---------- CYCLE (RoundTrip) ----------
    const rt = getRT(contract);
    const minsSinceEnter = rt.enteredAt ? (Date.now() - rt.enteredAt) / 60000 : null;

    const nearTodayLow = Number.isFinite(todayLow) && Number.isFinite(price)
      ? pctDiff(price, todayLow) <= NEAR_24H_LOW_BAND_PCT : false;

    // keep rolling extremes
    if (rt.leg === 'LONG_UP')  if (!Number.isFinite(rt.rollingHigh) || price > rt.rollingHigh) setRT(contract, { rollingHigh: price });
    if (rt.leg === 'SHORT_DOWN') if (!Number.isFinite(rt.rollingLow) || price < rt.rollingLow) setRT(contract, { rollingLow: price });

    function composedConfidence(phaseTag){
      const { conf } = computeConfidenceFromContext({
        price, railsByH, fallbackAtl30, fallbackAth30, taSignal, momentum, action: phaseTag, quoteVolume: qv,
        nearestSupport: memSnap?.nearestSupport, nearestResistance: memSnap?.nearestResistance
      });
      return Math.round(conf);
    }

    // ENTER LONG (Cycle) — honor spacing & collision rules
    if (rt.leg === 'IDLE' || rt.leg === 'COMPLETE' || !rt.leg) {
      const spaced = strategySpacingOk(contract, 'CYCLE');
      const oppositeBlocked = BLOCK_OPPOSITE_ENTRIES && liveSide && liveSide !== 'BUY';
      if (!isCooling(contract,'enter') && spaced && !oppositeBlocked && nearTodayLow && momentum >= MIN_MOMENTUM_TO_ENTER && taSignal !== 'bearish') {
        const conf = composedConfidence('ENTER_IMPULSE');
        const reasons = buildEntryReasons({ phase:{phase:'impulse'}, confidence: conf, quoteVolume:qv, minQV:100_000, maxQV:20_000_000, manual:false, arrivedTag:'near24hLow' });
        const note = buildProEntryNote
          ? buildProEntryNote({ symbol: contract, side:'BUY', price, leverage:5, context:{ reasons, phase:'impulse', confidence: conf, volumeUSDT:qv, arrivedTag:'near24hLow' } })
          : (reasons.length ? `ENTER_IMPULSE • ${reasons.join(' • ')} • near24hLow` : 'ENTER_IMPULSE');

        const traceId = newTraceId(contract, 'C-L');
        await evaluatePoseidonDecision(contract, {
          source:'CYCLE_WATCHER',
          strategyTag:'CYCLE',
          allowExecute:true,
          confidence: conf,
          phase:'impulse',
          sideHint:'long',
          price, quoteVolume:qv, note, reasons, traceId
        });

        setRT(contract, { leg:'LONG_UP', originPrice:price, originLow:Number.isFinite(todayLow)?todayLow:price, rollingHigh:price, rollingLow:null, enteredAt:Date.now() });
        await CycleState.updateOne(
          { symbol: contract },
          { $set:{ phase:'IMPULSE', impulseBeganAt:new Date(), lastHint:'rt_enter_long', lastReasons:reasons, arrivedTag:'near24hLow', lastTraceId:traceId } },
          { upsert:true }
        );
        markAction(contract,'enter','CYCLE'); TRADE_COUNT += 1;
        console.log(`[cycle:rt] ${contract} BUY → ENTER_IMPULSE (C≈${conf})`);
        return;
      }
    }

    // FLIP SHORT (Cycle)
    if (rt.leg === 'LONG_UP' && Number.isFinite(rt.rollingHigh) && Number.isFinite(price)) {
      const dropFromHighPct = ((rt.rollingHigh - price) / rt.rollingHigh) * 100;
      const timeCapHit = minsSinceEnter != null && minsSinceEnter >= MAX_RIDE_MINUTES_UP;
      const bearishTurn = taSignal === 'bearish';
      const peakDetected = dropFromHighPct >= PEAK_PULLBACK_TO_FLIP || timeCapHit || bearishTurn;

      const oppositeBlocked = BLOCK_OPPOSITE_ENTRIES && liveSide && liveSide !== 'SELL';
      const spaced = strategySpacingOk(contract, 'CYCLE');
      if (!isCooling(contract,'enter') && !oppositeBlocked && spaced && peakDetected) {
        const conf = composedConfidence('ENTER_REVERSAL');
        const reasons = buildEntryReasons({ phase:{phase:'reversal'}, confidence: conf, quoteVolume:qv, minQV:100_000, maxQV:20_000_000, manual:false, arrivedTag:'peak_pullback' });
        const note = buildProEntryNote
          ? buildProEntryNote({ symbol: contract, side:'SELL', price, leverage:5, context:{ reasons, phase:'reversal', confidence:conf, volumeUSDT:qv, arrivedTag:'peak_pullback' } })
          : (reasons.length ? `ENTER_REVERSAL • ${reasons.join(' • ')} • peak_pullback` : 'ENTER_REVERSAL');

        const traceId = newTraceId(contract, 'C-S');
        await evaluatePoseidonDecision(contract, {
          source:'CYCLE_WATCHER',
          strategyTag:'CYCLE',
          allowExecute:true,
          confidence: conf,
          phase:'reversal',
          sideHint:'short',
          price, quoteVolume:qv, note, reasons, traceId
        });

        setRT(contract, { leg:'SHORT_DOWN', rollingLow:price });
        await CycleState.updateOne(
          { symbol: contract },
          { $set:{ phase:'REVERSAL', lastHint:'rt_flip_short', lastReasons:reasons, arrivedTag:'peak_pullback', lastTraceId:traceId } },
          { upsert:true }
        );
        markAction(contract,'enter','CYCLE'); TRADE_COUNT += 1;
        console.log(`[cycle:rt] ${contract} SELL → ENTER_REVERSAL (C≈${conf})`);
        return;
      }
    }

    // EXIT (Cycle) when home or total time-cap
    if (rt.leg === 'SHORT_DOWN' && Number.isFinite(rt.originPrice) && Number.isFinite(price)) {
      const homePrice = Number.isFinite(todayLow) ? todayLow : rt.originPrice; // prefer actual origin low if we saved it
      const nearHome = Number.isFinite(homePrice) ? pctDiff(price, homePrice) <= HOME_PROXIMITY_PCT : false;
      const timeCapHit = minsSinceEnter != null && minsSinceEnter >= (MAX_RIDE_MINUTES_UP + MAX_RIDE_MINUTES_DN);

      if (!isCooling(contract,'exit') && (nearHome || timeCapHit)) {
        const live2 = positions.find(p => toKey(p.contract||p.symbol) === toKey(contract));
        if (live2) {
          const reasons = buildExitReasons({ hitTP:false, phase:{phase:'home'}, weakening:false, trailing:false, capitalGuard:false });
          const note = reasons.length ? `EXIT_HOME • ${reasons.join(' • ')} • homeBand` : 'EXIT_HOME';
          await closeTrade({ contract, note });
          await CycleState.updateOne(
            { symbol: contract },
            { $set:{ phase:'EXHAUST', lastExitAt:new Date(), lastHint:'rt_exit_home', lastReasons:reasons } },
            { upsert:true }
          );
          markAction(contract,'exit','CYCLE');
          setRT(contract, { leg:'COMPLETE', originPrice:null, originLow:null, rollingHigh:null, rollingLow:null, enteredAt:null });
          console.log(`[cycle:rt] ${contract} closed → EXIT_HOME (cycle complete)`);
          return;
        } else {
          setRT(contract, { leg:'COMPLETE', originPrice:null, originLow:null, rollingHigh:null, rollingLow:null, enteredAt:null });
        }
      }
    }

  } finally {
    inFlight.delete(contract);
  }
}

// ---- Close helper
async function closeTrade({ contract, note }) {
  try { const { data } = await axios.post(`${BASE}/api/close-trade`, { contract, note }, { timeout: 15000 }); return data; }
  catch (e) { try { const { data } = await axios.post(`${BASE}/api/close-trade`, { contract, note }, { timeout: 15000 }); return data; } catch (e2){ throw e2; } }
}

/**
 * ---- auto watchlist (ALL scanner Top50) ----
 * We take EVERY symbol from /api/scan-tokens top50, normalize to KuCoin futures,
 * de-dupe, and return the full set. Entry gates still enforce whitelist/volume.
 */
async function autoSelectContractsFromScanner() {
  try {
    const { data } = await axios.get(`${BASE}/api/scan-tokens`, { timeout: 8000 });
    const rows = Array.isArray(data?.top50) ? data.top50 : [];
    const set = new Set();
    for (const r of rows) {
      const base = normalizeBase(r?.symbol || r?.base || '');
      if (!base) continue;
      set.add(toContractSymbol(base + 'USDT')); // no majors/memes/whitelist filter here
    }
    return [...set];
  } catch { return []; }
}

// ---- service controls
async function startCycleWatcherServer(contracts = []) {
  let list = Array.isArray(contracts) && contracts.length ? contracts.slice() : await autoSelectContractsFromScanner();
  list = list.map(toContractSymbol).filter(Boolean);
  if (globalThis.__POSEIDON_CYCLE_TIMER__) {
    if (list.length > 0) WATCHING = list;
    RUNNING = true; return getCycleWatcherStatus();
  }
  if (list.length === 0) { console.warn('[cycleWatcher] nothing to watch'); RUNNING = false; return getCycleWatcherStatus(); }
  WATCHING = Array.from(new Set(list)); // de-dupe
  console.log('[cycle] WATCHING:', WATCHING.join(', '));
  globalThis.__POSEIDON_CYCLE_TIMER__ = setInterval(() => { WATCHING.forEach(c => tickOne(c).catch(()=>{})); }, 5000);
  RUNNING = true;
  console.log('🚀 Cycle+Predator started for', WATCHING.length, 'contracts');
  return getCycleWatcherStatus();
}
function startCycleWatcher(contracts){
  if (globalThis.__POSEIDON_CYCLE_TIMER__) return;
  if (!Array.isArray(contracts) || contracts.length === 0) { console.warn('[cycleWatcher] no contracts passed to start'); return; }
  WATCHING = Array.from(new Set(contracts.map(toContractSymbol)));
  globalThis.__POSEIDON_CYCLE_TIMER__ = setInterval(() => { WATCHING.forEach(c => tickOne(c).catch(()=>{})); }, 5000);
  RUNNING = true;
}
function stopCycleWatcher(){
  if (globalThis.__POSEIDON_CYCLE_TIMER__) { clearInterval(globalThis.__POSEIDON_CYCLE_TIMER__); globalThis.__POSEIDON_CYCLE_TIMER__ = null; }
  RUNNING = false; return getCycleWatcherStatus();
}
function getCycleWatcherStatus(){
  return {
    running: RUNNING,
    lastTickMs: LAST_TICK_MS,
    tradeCount: TRADE_COUNT,
    watching: Array.isArray(WATCHING) ? WATCHING.length : 0,
    watchlist: Array.isArray(WATCHING) ? WATCHING.slice() : []
  };
}

module.exports = {
  startCycleWatcher,
  startCycleWatcherServer,
  stopCycleWatcher,
  getCycleWatcherStatus
};