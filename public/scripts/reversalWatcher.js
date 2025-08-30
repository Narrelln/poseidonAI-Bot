// /public/scripts/reversalWatcher.js
// Pivot → pullback → break → RETEST → entry (be part of momentum, not chase)
//
// Focus:
//  - ONLY high-volatility NON-MAJORS (majors+memes excluded).
//  - Auto-picks from /api/scan-tokens when none passed (24h vol% filter).
//  - Entry after RETEST to the breakout level.
//  - Delegates to evaluator with {source:'REVERSAL_WATCHER', allowExecute:true}.
//  - Confidence seed configurable (strict 75 vs lenient 82).
//
// Runtime knobs (set anytime before start):
//   window.__POSEIDON_REV_VOL_MIN = 8          // % min 24h span/price (default 6)
//   window.__POSEIDON_REV_MAX_AUTO = 12        // cap auto-picked contracts (default 15)
//   window.__POSEIDON_REV_STRICT_75 = true     // baseline confidence 75 (else 82)

// ---------------------- Tuned Presets ----------------------
const PRESETS = {
  CYCLE_CHASER: { MAX_SAMPLES: 120, PIVOT_LOOKBACK: 7, MIN_BOUNCE_PCT: 0.8, CONFIRM_BUFFER: 0.001 },
  REVERSAL_WATCHER: { MAX_SAMPLES: 80, PIVOT_LOOKBACK: 4, MIN_BOUNCE_PCT: 0.5, CONFIRM_BUFFER: 0.0005 }
};

// ---------------------- Symbol Buckets ----------------------
const MAJORS = new Set(['BTC','XBT','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','LINK','LTC','TRX','TON','DOT','NEAR','ARB','OP']);
const MEMES  = new Set(['DOGE','SHIB','PEPE','WIF','FLOKI','BONK','MYRO','BOME','MEW','MOG','BRETT','SATS','1000RATS','DOGS','TRUMP']);

// ---------------------- Helpers ----------------------
function baseOf(sym=''){ return String(sym).toUpperCase().replace(/[-_]/g,'').replace(/USDTM?$/,''); }
function isMajorOrMeme(symbol){ const b=baseOf(symbol); const bb=b==='XBT'?'BTC':b; return MAJORS.has(bb)||MEMES.has(bb); }
function pct(a,b){ return b===0?0:((a-b)/b)*100; }
function clamp(x,lo,hi){ return Math.max(lo, Math.min(hi,x)); }

function localMin(arr,i,w){ const s=Math.max(0,i-w),e=Math.min(arr.length-1,i+w),p=arr[i].price; for(let k=s;k<=e;k++) if(arr[k].price<p) return false; return true; }
function localMax(arr,i,w){ const s=Math.max(0,i-w),e=Math.min(arr.length-1,i+w),p=arr[i].price; for(let k=s;k<=e;k++) if(arr[k].price>p) return false; return true; }

function toContract(sym){ const b=baseOf(sym); return b?`${b}-USDTM`:''; }
function toSpot(sym){ let b=baseOf(sym); if(!b) return ''; if(b==='XBT') b='BTC'; return `${b}USDT`; }

// -------- runtime config helpers --------
function getVolMin(){ try { return Number(window.__POSEIDON_REV_VOL_MIN)||6; } catch { return 6; } }
function getMaxAuto(){ try { return Number(window.__POSEIDON_REV_MAX_AUTO)||15; } catch { return 15; } }
function useStrict75(){ try { return Boolean(window.__POSEIDON_REV_STRICT_75); } catch { return false; } }

// -------- anti-chase parameters (retest) --------
const RETEST_TOL   = 0.001;   // ±0.10% band around breakout level
const MIN_REBOUND  = 0.0003;  // 0.03% rebound from retest extreme to fire

// ---------------------- State ----------------------
const book = new Map(); // symbol -> { hist, state, lastLow, lastHigh, interimHigh, interimLow, breakoutLevel, retestLow, retestHigh, cfg }
function getPreset(symbol){ return isMajorOrMeme(symbol) ? PRESETS.CYCLE_CHASER : PRESETS.REVERSAL_WATCHER; }

// executor state
let REV_TIMER = null;
let REV_SYMBOLS = []; // contracts like "BASE-USDTM"
let LAST_FIRE_AT = new Map(); // per-symbol debounce
const FIRE_COOLDOWN_MS = 8000;

// runtime stats
let LAST_TICK_MS = 0;
let RUNNING = false;

// live feed helper (optional)
function logToFeed(payload){ try{ if(window.logToLiveFeed) window.logToLiveFeed(payload);}catch{} }
function emit(name, detail){ try{ window.dispatchEvent(new CustomEvent(name,{ detail })); }catch{} }

// ---------------------- Core logic: anti-chase with RETEST ----------------------
export function pushSample(symbol, sample){
  const now = Date.now();
  const cfg = getPreset(symbol);

  const s = book.get(symbol) || {
    hist: [],
    // OBSERVE → WATCH_* → BREAKED_* → RETEST_* → CONFIRM_*
    state: 'OBSERVE',
    lastLow: null, lastHigh: null,
    interimHigh: null, interimLow: null,
    breakoutLevel: null,
    retestLow: null, retestHigh: null,
    cfg
  };

  if (!s.cfg || s.cfg !== cfg) s.cfg = cfg;

  s.hist.push({ t: now, ...sample });
  if (s.hist.length > s.cfg.MAX_SAMPLES) s.hist.shift();

  const h = s.hist, i = h.length - 1;
  if (i < s.cfg.PIVOT_LOOKBACK + 1) { book.set(symbol, s); return s; }
  const cur = h[i];

  // 1) pivots
  if (localMin(h, i - 1, s.cfg.PIVOT_LOOKBACK)) {
    s.lastLow = h[i - 1];
    s.interimHigh = s.breakoutLevel = s.retestLow = null;
    s.state = 'WATCH_LONG';
  }
  if (localMax(h, i - 1, s.cfg.PIVOT_LOOKBACK)) {
    s.lastHigh = h[i - 1];
    s.interimLow = s.breakoutLevel = s.retestHigh = null;
    s.state = 'WATCH_SHORT';
  }

  // 2) interim swings
  if (s.state === 'WATCH_LONG' && s.lastLow) {
    const seg = h.filter(x=>x.t>=s.lastLow.t);
    const high = seg.reduce((a,x)=>(x.price>a.price?x:a), seg[0]);
    const bounce = pct(high.price, s.lastLow.price);
    if (!s.interimHigh || high.price > s.interimHigh.price) {
      if (bounce >= s.cfg.MIN_BOUNCE_PCT) s.interimHigh = high;
    }
    if (cur.price < s.lastLow.price) {
      s.lastLow = { price: cur.price, t: cur.t };
      s.interimHigh = s.breakoutLevel = s.retestLow = null;
    }
    if (s.interimHigh && cur.price > s.interimHigh.price * (1 + s.cfg.CONFIRM_BUFFER)) {
      s.breakoutLevel = s.interimHigh.price;
      s.retestLow = null;
      s.state = 'BREAKED_LONG';
    }
  }

  if (s.state === 'WATCH_SHORT' && s.lastHigh) {
    const seg = h.filter(x=>x.t>=s.lastHigh.t);
    const low = seg.reduce((a,x)=>(x.price<a.price?x:a), seg[0]);
    const drop = -pct(low.price, s.lastHigh.price);
    if (!s.interimLow || low.price < s.interimLow.price) {
      if (drop >= s.cfg.MIN_BOUNCE_PCT) s.interimLow = low;
    }
    if (cur.price > s.lastHigh.price) {
      s.lastHigh = { price: cur.price, t: cur.t };
      s.interimLow = s.breakoutLevel = s.retestHigh = null;
    }
    if (s.interimLow && cur.price < s.interimLow.price * (1 - s.cfg.CONFIRM_BUFFER)) {
      s.breakoutLevel = s.interimLow.price;
      s.retestHigh = null;
      s.state = 'BREAKED_SHORT';
    }
  }

  // 3) RETEST phase (join momentum, don't chase)
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

  book.set(symbol, s);
  return s;
}

export function readyLong(symbol){ return book.get(symbol)?.state === 'CONFIRM_LONG'; }
export function readyShort(symbol){ return book.get(symbol)?.state === 'CONFIRM_SHORT'; }
export function consume(symbol){ const s=book.get(symbol); if(!s) return false; if (s.state==='CONFIRM_LONG'||s.state==='CONFIRM_SHORT'){ s.state='OBSERVE'; book.set(symbol,s); return true; } return false; }
export function getWatcher(symbol){ return book.get(symbol)||null; }

// ===================== TA + Volatility helpers ======================
async function fetchTA(spot){
  try {
    const res = await fetch(`/api/ta/${spot}`, { cache: 'no-store' });
    return await res.json();
  } catch { return {}; }
}
function volPctFromTA(ta){
  const price = Number(ta?.price ?? ta?.markPrice ?? 0);
  const hi = Number(ta?.range24h?.high ?? NaN);
  const lo = Number(ta?.range24h?.low  ?? NaN);
  if (!(price>0) || !Number.isFinite(hi) || !Number.isFinite(lo) || !(hi>lo)) return 0;
  return ((hi - lo) / price) * 100;
}

// ===================== Tick (per symbol) ======================
async function tickOne(contract){
  LAST_TICK_MS = Date.now();

  const spot = toSpot(contract);
  const ta = await fetchTA(spot);
  const price = Number(ta?.price ?? ta?.markPrice ?? 0);
  const qv    = Number(ta?.quoteVolume ?? ta?.quoteVolume24h ?? ta?.qv ?? 0);
  if (!(price > 0)) return;

  const s = pushSample(contract, { price });

  const now = Date.now();
  if (s?.state === 'CONFIRM_LONG' || s?.state === 'CONFIRM_SHORT') {
    const last = LAST_FIRE_AT.get(contract) || 0;
    if (now - last < FIRE_COOLDOWN_MS) return;
    LAST_FIRE_AT.set(contract, now);

    const sideHint = s.state === 'CONFIRM_LONG' ? 'long' : 'short';
    const payload = {
      source: 'REVERSAL_WATCHER',
      allowExecute: true,
      confidence: useStrict75() ? 75 : 82,  // baseline; evaluator recomputes final score
      phase: 'reversal',
      sideHint,
      price,
      quoteVolume: Number.isFinite(qv) ? qv : undefined,
      note: `reversal RETEST • ${sideHint.toUpperCase()}`,
      reasons: ['pivot→pullback→break→retest', 'reversal-watcher']
    };

    try {
      const bridge = window.__poseidonBridge;
      if (bridge && typeof bridge.evaluatePoseidonDecision === 'function') {
        await bridge.evaluatePoseidonDecision(toContract(contract), payload);
      } else {
        emit('poseidon:reversal-confirm', { contract: toContract(contract), ...payload });
      }
    } catch (e) {
      emit('poseidon:reversal-confirm', { contract: toContract(contract), ...payload, error: String(e?.message || e) });
    }

    logToFeed({ symbol: toContract(contract), message: `Reversal RETEST ${sideHint.toUpperCase()} @ ${price}`, detail: payload.reasons.join(' • '), type: 'analysis', tag: sideHint });
    consume(contract);
  }
}

// ===================== Auto-pick high-vol NON-MAJORS (parallel fetch) ======================
async function autoSelectHighVolFromScanner() {
  try {
    const res = await fetch('/api/scan-tokens', { cache: 'no-store' });
    const data = await res.json();
    const rows = Array.isArray(data?.top50) ? data.top50 : [];
    const bases = rows.map(r => baseOf(r?.symbol || r?.base || '')).filter(Boolean);

    const nonMajors = bases.filter(b => !isMajorOrMeme(b));
    const volMin = getVolMin();

    // fetch TA in parallel for speed
    const taResults = await Promise.allSettled(
      nonMajors.map(b => fetchTA(toSpot(b)).then(ta => ({ b, vol: volPctFromTA(ta) })))
    );

    const keep = [];
    for (const r of taResults) {
      if (r.status !== 'fulfilled') continue;
      const { b, vol } = r.value || {};
      if (typeof vol === 'number' && vol >= volMin) keep.push(`${b}-USDTM`);
    }
    return keep.slice(0, getMaxAuto());
  } catch (e) {
    console.warn('[ReversalWatcher] auto-select failed:', e?.message || e);
    return [];
  }
}

// ===================== Public API: start/stop/status ======================
export async function startReversalWatcher(symbols){
  if (REV_TIMER) return getReversalWatcherStatus();

  let list = Array.isArray(symbols) ? symbols.slice() : [];
  if (!list.length) list = await autoSelectHighVolFromScanner();

  list = list
    .map(s => toContract(s))
    .filter(Boolean)
    .filter(sym => !isMajorOrMeme(sym)); // hard separation from CycleWatcher

  if (!list.length) {
    console.warn('[ReversalWatcher] no high-volatility non-majors found (try lowering window.__POSEIDON_REV_VOL_MIN)');
    RUNNING = false;
    return getReversalWatcherStatus();
  }

  REV_SYMBOLS = list.slice();
  REV_TIMER = setInterval(() => { REV_SYMBOLS.forEach(c => { tickOne(c).catch(()=>{}); }); }, 5000);
  RUNNING = true;
  console.log(`[ReversalWatcher] started for ${REV_SYMBOLS.length} high-vol non-majors (volMin=${getVolMin()}%, maxAuto=${getMaxAuto()}, retest mode)`);
  return getReversalWatcherStatus();
}

export function stopReversalWatcher(){
  if (REV_TIMER) clearInterval(REV_TIMER);
  REV_TIMER = null;
  RUNNING = false;
  // clean up transient state
  LAST_FIRE_AT = new Map();
  return getReversalWatcherStatus();
}

export function getReversalWatcherStatus(){
  return {
    running: RUNNING,
    lastTickMs: LAST_TICK_MS,
    watching: REV_SYMBOLS.length,
    cooldownMs: FIRE_COOLDOWN_MS,
    volMinPct: getVolMin(),
    maxAuto: getMaxAuto(),
    strict75: useStrict75()
  };
}