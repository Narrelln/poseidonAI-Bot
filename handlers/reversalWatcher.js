// handlers/reversalWatcher.js
/* eslint-disable no-console */
/**
 * ReversalWatcher (server)
 * - Focuses on HIGH-VOL non-majors (CycleWatcher keeps majors/whitelist).
 * - Detects pivot → pullback → break → RETEST, then delegates to evaluator (entry).
 * - After entry, LOCK_* state trails to peak and triggers exit on weakness.
 * - NEW: Mirror follow‑back — after exit, flip and ride back to origin (breakout/pivot),
 *        then force-close on target-band hit.
 * - Polls TA: GET /api/ta/:spot
 * - Optional rails streaming: handlers/extremaRails.pushTick(spot, price)
 *
 * Public API:
 *  - startReversalWatcherServer(symbols?)  // array of bases or contracts; optional
 *  - stopReversalWatcher()
 *  - getReversalWatcherStatus()
 */

const axios = require('axios');
const { evaluatePoseidonDecision } = require('./decisionHelper'); // safe server wrapper
const { chooseHighVolSymbols } = require('../services/volatilityClassifier');

let pushTick = null;
try { ({ pushTick } = require('./extremaRails')); } catch {}
try { if (!pushTick) ({ pushTick } = require('../handlers/extremaRails')); } catch {}

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

// ---- Tunables (env) ----
const FIRE_COOLDOWN_MS     = Number(process.env.REV_FIRE_COOLDOWN_MS || 8000); // confirm debounce (pre-lock)
const TICK_INTERVAL_MS     = Number(process.env.REV_TICK_INTERVAL_MS || 5000);
const MAX_SAMPLES          = Number(process.env.REV_MAX_SAMPLES || 80);
const PIVOT_LOOKBACK       = Number(process.env.REV_PIVOT_LOOKBACK || 4);
const MIN_BOUNCE_PCT       = Number(process.env.REV_MIN_BOUNCE_PCT || 0.5);
const CONFIRM_BUFFER       = Number(process.env.REV_CONFIRM_BUFFER || 0.0005); // 0.05%

// Anti-chase (retest) before entry
const RETEST_TOL           = Number(process.env.REV_RETEST_TOL ?? 0.001);   // ±0.10% band
const MIN_REBOUND          = Number(process.env.REV_MIN_REBOUND ?? 0.0003); // 0.03% from retest extreme
const USE_STRICT_75        = String(process.env.REV_STRICT_75 || 'false') === 'true';

// Lock/trailing (post-entry)
const TRAIL_DROP_PCT       = Number(process.env.REV_TRAIL_DROP_PCT || 0.007); // 0.7% from peak -> exit
const REFIRE_COOLDOWN_MS   = Number(process.env.REV_REFIRE_COOLDOWN_MS || 2000); // quick re-entries allowed

// ===== NEW: Mirror follow-back (ride it home) =====
const MIRROR_ENABLE            = String(process.env.REV_ENABLE_MIRROR || 'true') === 'true';
const MIRROR_ARM_MS            = Number(process.env.REV_MIRROR_ARM_MS || 10 * 60 * 1000); // 10m window to arm/enter
const MIRROR_TRIGGER_DROP      = Number(process.env.REV_MIRROR_TRIGGER_DROP || 0.006); // 0.6% from exit-peak to arm SHORT
const MIRROR_TRIGGER_REBOUND   = Number(process.env.REV_MIRROR_TRIGGER_REBOUND || 0.006); // 0.6% from exit-trough to arm LONG
const MIRROR_TARGET_BAND       = Number(process.env.REV_MIRROR_TARGET_BAND || 0.0015); // ±0.15% around origin = "home"
const MIRROR_TRAIL_PCT         = Number(process.env.REV_MIRROR_TRAIL_PCT || 0.006); // 0.6% trailing for mirror leg
const MIRROR_MIN_QV            = Number(process.env.REV_MIRROR_MIN_QV || 50_000); // skip illiquid spikes
const MIRROR_MAX_QV            = Number(process.env.REV_MIRROR_MAX_QV || 1_500_000_000);

// Majors/Memes → handled by CycleWatcher, excluded here
const MAJORS = new Set(['BTC','XBT','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','LINK','LTC','TRX','TON','DOT','NEAR','ARB','OP']);
const MEMES  = new Set(['DOGE','SHIB','PEPE','WIF','FLOKI','BONK','MYRO','BOME','MEW','MOG','BRETT','SATS','1000RATS','DOGS','TRUMP']);

// ---------------- helpers ----------------
function up(s=''){ return String(s).toUpperCase(); }
function baseOf(sym = '') { return up(sym).replace(/[-_]/g,'').replace(/USDTM?$/,'').replace(/USDT$/,''); }
function isMajorOrMeme(any){
  const b = baseOf(any);
  const bb = b === 'XBT' ? 'BTC' : b;
  return MAJORS.has(bb) || MEMES.has(bb);
}
function toContract(any) { const b = baseOf(any); return b ? `${b}-USDTM` : ''; }
function toSpot(any)     { let b = baseOf(any); if (b==='XBT') b='BTC'; return b ? `${b}USDT` : ''; }
function pct(a, b) { return b === 0 ? 0 : ((a - b) / b) * 100; }
function n(v){ const x = Number(v); return Number.isFinite(x) ? x : NaN; }

// Local extrema checks (pivot finders)
function localMin(arr, i, w) { const s=Math.max(0,i-w), e=Math.min(arr.length-1,i+w), p=arr[i].price; for(let k=s;k<=e;k++) if(arr[k].price<p) return false; return true; }
function localMax(arr, i, w) { const s=Math.max(0,i-w), e=Math.min(arr.length-1,i+w), p=arr[i].price; for(let k=s;k<=e;k++) if(arr[k].price>p) return false; return true; }

// ---------------- state ----------------
/**
 * contract -> {
 *   hist, state, lastLow, lastHigh, interimHigh, interimLow,
 *   breakoutLevel, retestLow, retestHigh,
 *   lock: {
 *     mode: 'LONG'|'SHORT'|null,
 *     entryPrice: number|null,
 *     trailHigh: number|null,  // highest since lock (LONG)
 *     trailLow: number|null,   // lowest since lock (SHORT)
 *     lastExitAt: number|null
 *   },
 *   // NEW: mirror follow-back state
 *   mirror: {
 *     armedUntil: number|null,
 *     dir: 'SHORT'|'LONG'|null,      // direction to ride home
 *     target: number|null,           // breakout/last pivot (home)
 *     ref: number|null,              // peak (for SHORT) or trough (for LONG) at exit
 *     opened: boolean,               // mirror position opened
 *     trailHigh: number|null,        // trailing for LONG mirror
 *     trailLow: number|null          // trailing for SHORT mirror
 *   }
 * }
 *
 * States:
 *   OBSERVE → WATCH_* → BREAKED_* → RETEST_* → CONFIRM_*
 *   After CONFIRM_* we set lock.mode and remain in OBSERVE (pattern engine keeps running)
 *   Lock logic (trailing) runs on every tick when lock.mode != null
 *   NEW: After a lock exit, mirror is armed to flip and ride back to origin.
 */
const book = new Map();
let REV_SYMBOLS = [];   // contracts
let REV_TIMER = null;
let LAST_TICK_MS = 0;
let RUNNING = false;
const LAST_FIRE_AT = new Map();    // pre-lock confirm debounce
const LAST_REFIRE_AT = new Map();  // post-exit quick refire debounce

function stateOf(contract) {
  if (!book.has(contract)) {
    book.set(contract, {
      hist: [],
      state: 'OBSERVE',
      lastLow: null, lastHigh: null, interimHigh: null, interimLow: null,
      breakoutLevel: null, retestLow: null, retestHigh: null,
      lock: { mode: null, entryPrice: null, trailHigh: null, trailLow: null, lastExitAt: null },
      mirror: { armedUntil: null, dir: null, target: null, ref: null, opened: false, trailHigh: null, trailLow: null }
    });
  }
  return book.get(contract);
}

function pushSample(contract, { price, t = Date.now() }) {
  const s = stateOf(contract);
  s.hist.push({ t, price: Number(price) });
  if (s.hist.length > MAX_SAMPLES) s.hist.shift();

  const h = s.hist;
  const i = h.length - 1;
  if (i < PIVOT_LOOKBACK + 1) return s;
  const cur = h[i];

  // 1) detect pivots (only when NOT locked — entries are driven by pattern)
  if (!s.lock.mode) {
    if (localMin(h, i - 1, PIVOT_LOOKBACK)) {
      s.lastLow = h[i - 1];
      s.interimHigh = s.breakoutLevel = s.retestLow = null;
      s.state = 'WATCH_LONG';
    }
    if (localMax(h, i - 1, PIVOT_LOOKBACK)) {
      s.lastHigh = h[i - 1];
      s.interimLow = s.breakoutLevel = s.retestHigh = null;
      s.state = 'WATCH_SHORT';
    }

    // 2) build interim swings + break detection
    if (s.state === 'WATCH_LONG' && s.lastLow) {
      const seg = h.filter(x => x.t >= s.lastLow.t);
      const high = seg.reduce((a, x) => (x.price > a.price ? x : a), seg[0]);
      const bounce = pct(high.price, s.lastLow.price);
      if (!s.interimHigh || high.price > s.interimHigh.price) {
        if (bounce >= MIN_BOUNCE_PCT) s.interimHigh = high;
      }
      if (cur.price < s.lastLow.price) { // reset if low breaks
        s.lastLow = { price: cur.price, t: cur.t };
        s.interimHigh = s.breakoutLevel = s.retestLow = null;
      }
      // break → store level and wait RETEST (anti-chase)
      if (s.interimHigh && cur.price > s.interimHigh.price * (1 + CONFIRM_BUFFER)) {
        s.breakoutLevel = s.interimHigh.price;
        s.retestLow = null;
        s.state = 'BREAKED_LONG';
      }
    }

    if (s.state === 'WATCH_SHORT' && s.lastHigh) {
      const seg = h.filter(x => x.t >= s.lastHigh.t);
      const low = seg.reduce((a, x) => (x.price < a.price ? x : a), seg[0]);
      const drop = -pct(low.price, s.lastHigh.price);
      if (!s.interimLow || low.price < s.interimLow.price) {
        if (drop >= MIN_BOUNCE_PCT) s.interimLow = low;
      }
      if (cur.price > s.lastHigh.price) { // reset if high breaks
        s.lastHigh = { price: cur.price, t: cur.t };
        s.interimLow = s.breakoutLevel = s.retestHigh = null;
      }
      // break → store level and wait RETEST (anti-chase)
      if (s.interimLow && cur.price < s.interimLow.price * (1 - CONFIRM_BUFFER)) {
        s.breakoutLevel = s.interimLow.price;
        s.retestHigh = null;
        s.state = 'BREAKED_SHORT';
      }
    }

    // 3) RETEST logic → CONFIRM_* (entry signal)
    if (s.state === 'BREAKED_LONG' && s.breakoutLevel) {
      const tolLo = s.breakoutLevel * (1 - RETEST_TOL);
      const tolHi = s.breakoutLevel * (1 + RETEST_TOL);
      if (cur.price <= tolHi && cur.price >= tolLo) {
        if (!s.retestLow || cur.price < s.retestLow.price) s.retestLow = { price: cur.price, t: cur.t };
      }
      if (s.retestLow && cur.price >= s.retestLow.price * (1 + MIN_REBOUND)) {
        s.state = 'CONFIRM_LONG';
      }
      if (cur.price < s.breakoutLevel * (1 - 2 * RETEST_TOL)) {
        s.state = 'OBSERVE'; s.breakoutLevel = s.retestLow = null;
      }
    }

    if (s.state === 'BREAKED_SHORT' && s.breakoutLevel) {
      const tolLo = s.breakoutLevel * (1 - RETEST_TOL);
      const tolHi = s.breakoutLevel * (1 + RETEST_TOL);
      if (cur.price >= tolLo && cur.price <= tolHi) {
        if (!s.retestHigh || cur.price > s.retestHigh.price) s.retestHigh = { price: cur.price, t: cur.t };
      }
      if (s.retestHigh && cur.price <= s.retestHigh.price * (1 - MIN_REBOUND)) {
        s.state = 'CONFIRM_SHORT';
      }
      if (cur.price > s.breakoutLevel * (1 + 2 * RETEST_TOL)) {
        s.state = 'OBSERVE'; s.breakoutLevel = s.retestHigh = null;
      }
    }
  }

  // 4) TRAILING logic when locked (ride momentum, exit on weakness)
  if (s.lock.mode === 'LONG') {
    s.lock.trailHigh = (s.lock.trailHigh == null) ? cur.price : Math.max(s.lock.trailHigh, cur.price);
    const drop = (s.lock.trailHigh - cur.price) / s.lock.trailHigh;
    if (drop >= TRAIL_DROP_PCT) {
      s._exitSignal = 'EXIT_LONG_TRAIL';
    }
  } else if (s.lock.mode === 'SHORT') {
    s.lock.trailLow = (s.lock.trailLow == null) ? cur.price : Math.min(s.lock.trailLow, cur.price);
    const rebound = (cur.price - s.lock.trailLow) / s.lock.trailLow;
    if (rebound >= TRAIL_DROP_PCT) {
      s._exitSignal = 'EXIT_SHORT_TRAIL';
    }
  }

  // 5) MIRROR trailing (if mirror position is open)
  if (MIRROR_ENABLE && s.mirror.opened) {
    if (s.mirror.dir === 'LONG') {
      s.mirror.trailHigh = (s.mirror.trailHigh == null) ? cur.price : Math.max(s.mirror.trailHigh, cur.price);
      const dropM = (s.mirror.trailHigh - cur.price) / s.mirror.trailHigh;
      if (dropM >= MIRROR_TRAIL_PCT) s._mirrorExit = 'MIRROR_LONG_TRAIL';
    } else if (s.mirror.dir === 'SHORT') {
      s.mirror.trailLow = (s.mirror.trailLow == null) ? cur.price : Math.min(s.mirror.trailLow, cur.price);
      const reboundM = (cur.price - s.mirror.trailLow) / s.mirror.trailLow;
      if (reboundM >= MIRROR_TRAIL_PCT) s._mirrorExit = 'MIRROR_SHORT_TRAIL';
    }
  }

  return s;
}

function consumeConfirm(contract) {
  const s = stateOf(contract);
  if (s.state === 'CONFIRM_LONG' || s.state === 'CONFIRM_SHORT') {
    s.state = 'OBSERVE';
    return true;
  }
  return false;
}

// ---------------- data fetchers ----------------
async function fetchTA(spot){
  try {
    const { data } = await axios.get(`${BASE}/api/ta/${spot}`, { timeout: 6000 });
    return data || {};
  } catch { return {}; }
}

// Close API (mirrors cycleWatcher close path)
async function closeTrade({ contract, note }) {
  try {
    const { data } = await axios.post(`${BASE}/api/close-trade`, { contract, note }, { timeout: 15000 });
    return data;
  } catch (e) {
    try {
      const { data } = await axios.post(`${BASE}/api/close-trade`, { contract, note }, { timeout: 15000 });
      return data;
    } catch (e2) { throw e2; }
  }
}

// ---------------- tick loop ----------------
async function tickOne(contract){
  LAST_TICK_MS = Date.now();

  const spot = toSpot(contract);
  const ta = await fetchTA(spot);
  const price = n(ta?.price ?? ta?.markPrice ?? 0);
  const qv    = n(ta?.quoteVolume ?? ta?.quoteVolume24h ?? ta?.qv ?? 0);
  const taSignal = String(ta?.signal || '').toLowerCase();

  if (!(price > 0)) return;

  if (typeof pushTick === 'function') { try { pushTick(spot, price, Date.now()); } catch {} }

  const s = pushSample(contract, { price });

  // === ENTRY (CONFIRM states) with pre-lock debounce ===
  if (!s.lock.mode && (s.state === 'CONFIRM_LONG' || s.state === 'CONFIRM_SHORT')) {
    const now = Date.now();
    const last = LAST_FIRE_AT.get(contract) || 0;
    if (now - last >= FIRE_COOLDOWN_MS) {
      LAST_FIRE_AT.set(contract, now);

      const sideHint = s.state === 'CONFIRM_LONG' ? 'long' : 'short';
      const payload = {
        source: 'REVERSAL_WATCHER',
        allowExecute: true,
        confidence: USE_STRICT_75 ? 75 : 82,  // evaluator recomputes anyway
        phase: 'reversal',
        sideHint,
        price,
        quoteVolume: Number.isFinite(qv) ? qv : undefined,
        signal: taSignal,
        reasons: ['pivot→pullback→break→retest','reversal-lock']
      };

      try {
        await evaluatePoseidonDecision(contract, payload);
        // lock on success (lock regardless; evaluator may skip but we want trailing intent)
        s.lock.mode = sideHint.toUpperCase(); // LONG / SHORT
        s.lock.entryPrice = price;
        s.lock.trailHigh = sideHint === 'long' ? price : null;
        s.lock.trailLow  = sideHint === 'short' ? price : null;
      } catch (e) {
        console.warn(`[ReversalWatcher] evaluate failed for ${contract}:`, e?.response?.data || e.message);
      }

      consumeConfirm(contract);
    }
  }

  // === EXIT via trailing (when locked) with quick refire ===
  if (s.lock.mode && s._exitSignal) {
    const now = Date.now();
    const last = LAST_REFIRE_AT.get(contract) || 0;
    if (now - last >= REFIRE_COOLDOWN_MS) {
      LAST_REFIRE_AT.set(contract, now);

      const exitingLong = s.lock.mode === 'LONG';
      const refAtExit   = exitingLong ? s.lock.trailHigh : s.lock.trailLow;

      const note = `${s._exitSignal} • drop=${(TRAIL_DROP_PCT*100).toFixed(2)}%`;
      try {
        await closeTrade({ contract, note });
      } catch (e) {
        console.warn(`[ReversalWatcher] closeTrade failed for ${contract}:`, e?.response?.data || e.message);
      }

      // unlock
      s.lock.lastExitAt = now;
      s.lock.mode = null;
      s.lock.entryPrice = null;
      s.lock.trailHigh = null;
      s.lock.trailLow = null;
      s._exitSignal = null;

      // === NEW: arm mirror follow‑back to "ride it home"
      if (MIRROR_ENABLE) {
        const targetHome =
          exitingLong
            ? (s.lastLow?.price ?? s.breakoutLevel ?? null)
            : (s.lastHigh?.price ?? s.breakoutLevel ?? null);

        if (Number.isFinite(targetHome)) {
          s.mirror.armedUntil = now + MIRROR_ARM_MS;
          s.mirror.dir   = exitingLong ? 'SHORT' : 'LONG';
          s.mirror.target= targetHome;
          s.mirror.ref   = Number(refAtExit) || price; // peak for SHORT, trough for LONG
          s.mirror.opened= false;
          s.mirror.trailHigh = null;
          s.mirror.trailLow  = null;

          console.log(`[ReversalWatcher] ${contract} mirror armed → ${s.mirror.dir} to ${targetHome}`);
        }
      }
    }
  }

  // === NEW: handle mirror entry/exit ===
  if (MIRROR_ENABLE && s.mirror.armedUntil && Date.now() <= s.mirror.armedUntil) {
    // entry condition only if not already opened and lock is free
    if (!s.lock.mode && !s.mirror.opened && Number.isFinite(qv) && qv >= MIRROR_MIN_QV && qv <= MIRROR_MAX_QV) {
      if (s.mirror.dir === 'SHORT' && Number.isFinite(s.mirror.ref)) {
        // enter SHORT after sufficient drop from exit-peak
        const drop = (s.mirror.ref - price) / s.mirror.ref;
        if (drop >= MIRROR_TRIGGER_DROP) {
          try {
            await evaluatePoseidonDecision(contract, {
              source: 'REVERSAL_WATCHER',
              allowExecute: true,
              confidence: 78,
              phase: 'mirror',
              sideHint: 'short',
              price,
              quoteVolume: qv,
              reasons: ['mirror-follow-back','ride-home']
            });
            s.mirror.opened = true;
            s.mirror.trailLow = price;
            console.log(`[ReversalWatcher] ${contract} MIRROR SHORT opened @ ${price}`);
          } catch (e) {
            console.warn(`[ReversalWatcher] mirror-short evaluate failed for ${contract}:`, e?.response?.data || e.message);
          }
        }
      } else if (s.mirror.dir === 'LONG' && Number.isFinite(s.mirror.ref)) {
        // enter LONG after sufficient rebound from exit-trough
        const rebound = (price - s.mirror.ref) / s.mirror.ref;
        if (rebound >= MIRROR_TRIGGER_REBOUND) {
          try {
            await evaluatePoseidonDecision(contract, {
              source: 'REVERSAL_WATCHER',
              allowExecute: true,
              confidence: 78,
              phase: 'mirror',
              sideHint: 'long',
              price,
              quoteVolume: qv,
              reasons: ['mirror-follow-back','ride-home']
            });
            s.mirror.opened = true;
            s.mirror.trailHigh = price;
            console.log(`[ReversalWatcher] ${contract} MIRROR LONG opened @ ${price}`);
          } catch (e) {
            console.warn(`[ReversalWatcher] mirror-long evaluate failed for ${contract}:`, e?.response?.data || e.message);
          }
        }
      }
    }

    // target‑band forced close (home reached)
    if (s.mirror.opened && Number.isFinite(s.mirror.target)) {
      const band = MIRROR_TARGET_BAND;
      const lo = s.mirror.target * (1 - band);
      const hi = s.mirror.target * (1 + band);
      const hit = price >= lo && price <= hi;
      if (hit) {
        try {
          await closeTrade({ contract, note: 'MIRROR_TARGET_HIT • home reached' });
        } catch (e) {
          console.warn(`[ReversalWatcher] mirror target close failed for ${contract}:`, e?.response?.data || e.message);
        }
        // clear mirror
        s.mirror = { armedUntil: null, dir: null, target: null, ref: null, opened: false, trailHigh: null, trailLow: null };
        console.log(`[ReversalWatcher] ${contract} mirror completed (home)`);
      }
    }

    // mirror trailing exit (protect profit), then allow re‑arm later by new main pattern
    if (s.mirror.opened && s._mirrorExit) {
      try {
        await closeTrade({ contract, note: `${s._mirrorExit} • mirror trail` });
      } catch (e) {
        console.warn(`[ReversalWatcher] mirror trail close failed for ${contract}:`, e?.response?.data || e.message);
      }
      s._mirrorExit = null;
      s.mirror = { armedUntil: null, dir: null, target: null, ref: null, opened: false, trailHigh: null, trailLow: null };
    }
  } else {
    // disarm stale mirror if window elapsed
    if (s.mirror.armedUntil && Date.now() > s.mirror.armedUntil && !s.mirror.opened) {
      s.mirror = { armedUntil: null, dir: null, target: null, ref: null, opened: false, trailHigh: null, trailLow: null };
    }
  }
}

// ---------------- public control ----------------
async function startReversalWatcherServer(symbols = []) {
  if (REV_TIMER) return getReversalWatcherStatus();

  // If no symbols → auto-pick high-volatility non-majors
  let list = Array.isArray(symbols) ? symbols.slice() : [];
  if (!list.length) {
    try {
      const { picked } = await chooseHighVolSymbols();
      list = picked;
    } catch (e) {
      console.warn('[ReversalWatcher] auto-pick failed:', e?.message || e);
      list = [];
    }
  }

  // normalize to contracts, de-dup, and HARD-EXCLUDE majors/memes
  const set = new Set(
    list
      .map(toContract)
      .filter(Boolean)
      .filter(sym => !isMajorOrMeme(sym))
  );
  REV_SYMBOLS = Array.from(set);

  if (!REV_SYMBOLS.length) {
    console.warn('[ReversalWatcher] nothing to watch (high-vol non-majors set empty)');
    RUNNING = false;
    return getReversalWatcherStatus();
  }

  REV_TIMER = setInterval(() => {
    REV_SYMBOLS.forEach(c => tickOne(c).catch(()=>{}));
  }, TICK_INTERVAL_MS);

  RUNNING = true;
  console.log(`🚀 ReversalWatcher started for ${REV_SYMBOLS.length} high-vol NON-MAJORS (retest+lock+mirror)`);
  return getReversalWatcherStatus();
}

function stopReversalWatcher() {
  if (REV_TIMER) clearInterval(REV_TIMER);
  REV_TIMER = null;
  RUNNING = false;
  return getReversalWatcherStatus();
}

function getReversalWatcherStatus() {
  // summarize lock distribution for quick health checks
  let locked = 0;
  for (const k of book.keys()) if (book.get(k)?.lock?.mode) locked++;
  return {
    running: RUNNING,
    lastTickMs: LAST_TICK_MS,
    watching: REV_SYMBOLS.length,
    cooldownMs: FIRE_COOLDOWN_MS,
    intervalMs: TICK_INTERVAL_MS,
    retestTol: RETEST_TOL,
    minRebound: MIN_REBOUND,
    strict75: USE_STRICT_75,
    trailDropPct: TRAIL_DROP_PCT,
    refireMs: REFIRE_COOLDOWN_MS,
    mirror: {
      enabled: MIRROR_ENABLE,
      armMs: MIRROR_ARM_MS,
      triggerDrop: MIRROR_TRIGGER_DROP,
      triggerRebound: MIRROR_TRIGGER_REBOUND,
      targetBand: MIRROR_TARGET_BAND,
      trailPct: MIRROR_TRAIL_PCT,
      qvMin: MIRROR_MIN_QV,
      qvMax: MIRROR_MAX_QV
    },
    locked
  };
}

module.exports = {
  startReversalWatcherServer,
  stopReversalWatcher,
  getReversalWatcherStatus,
  // exposed for tests
  pushSample,
  // simple predicates (kept for tests even though lock supersedes them)
  readyLong: (c)=>stateOf(c).state==='CONFIRM_LONG',
  readyShort:(c)=>stateOf(c).state==='CONFIRM_SHORT',
  consume: (c)=>consumeConfirm(c)
};