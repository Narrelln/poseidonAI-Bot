// === handlers/tpTracker.js ===
// Smart Take Profit Tracker for Poseidon
// TP1: take 40% at ROI >= 100%, then trail the remaining until momentum fades or trail hit.

const tpMemory = new Map();

/** Defaults (can be overridden via setTPConfig) */
let CONFIG = {
  // Ladder mode (default): take 25% of remaining every +50% ROI
  // You can instead pass steps: [{roi:50,take:0.25},{roi:100,take:0.25}, ...]
  ladder: { stepPct: 50, takeFraction: 0.25, maxSteps: 12 },

  // If provided, overrides the generated ladder:
  // steps: [{ roi: 50, take: 0.25 }, { roi: 100, take: 0.25 }, ...],

  // Base trailing drop after first partial; tightens per step (see effectiveTrailDrop below)
  trailDropPct: 0.25,

  // Optional safety exit when reversal + low conf
  minExitConfidence: 60,

  // Throttle feed emissions
  emitThrottleMs: 1500,

  // Won't keep nibbling below this remainder (contracts)
  minRemainderContracts: 0
};
// executors are injected by the app (to keep this file pure/portable)
let EXEC = {
  /** async (symbol, qty) => void  (reduce-only partial close) */
  partialClose: async () => {},
  /** async (symbol) => void  (close remainder) */
  closeAll: async () => {},
  /** (payload) => void  (log to feed/socket) */
  emitFeed: () => {}
};

// quick rounding helper for contracts
function roundQty(qty, lotSize = 1, minSize = 0) {
  if (!(qty > 0)) return 0;
  const stepped = lotSize > 0 ? Math.floor(qty / lotSize) * lotSize : qty;
  const rounded = Number(stepped.toFixed(10));
  return Math.max(minSize || 0, rounded);
}

function setTPConfig(partial) {
  CONFIG = { ...CONFIG, ...(partial || {}) };
}

function registerExecutors(execs) {
  EXEC = { ...EXEC, ...(execs || {}) };
}

function now() { return Date.now(); }

/**
 * Initialize per-position state
 * @param {Object} p
 * @param {string} p.symbol
 * @param {'long'|'short'} p.side
 * @param {number} p.entryPrice
 * @param {number} p.size                // contracts
 * @param {number} [p.initialMargin]     // if missing, ROI will be estimated when update is called
 * @param {number} [p.lotSize]           // exchange lot size step
 * @param {number} [p.minSize]           // exchange min order size
 * @param {number} [p.confidence]        // 0..100
 */
function initTPTracker(p = {}) {
  const { symbol, side, entryPrice, size, initialMargin, lotSize = 1, minSize = 0, confidence = 70 } = p;
  if (!symbol || !entryPrice || !size) return;

  if (!tpMemory.has(symbol)) {
    tpMemory.set(symbol, {
      symbol,
      side: (side || 'long').toLowerCase().includes('short') ? 'short' : 'long',
      entryPrice: Number(entryPrice),
      size: Number(size),
      lotSize: Number(lotSize || 1),
      minSize: Number(minSize || 0),
      initialMargin: initialMargin != null ? Number(initialMargin) : null,

     // ladder state
      firedSteps: 0,
      trailActive: false,
      peakPrice: Number(entryPrice),
      trailStop: null,

      maxRoi: 0,
      lastEmitAt: 0,
      exited: false,
      notes: '🟢 Tracking initialized',
      confidenceTrend: [Number(confidence)]
    });
  }
}

function genStepsFromLadder(ladder) {
  const step = Math.max(1, Number(ladder?.stepPct ?? 50));
  const take = Math.max(0, Math.min(1, Number(ladder?.takeFraction ?? 0.25)));
  const maxS = Math.max(1, Number(ladder?.maxSteps ?? 12));
  const arr = [];
  for (let k = 1; k <= maxS; k++) arr.push({ roi: k * step, take });
  return arr;
}

function getSteps() {
  if (Array.isArray(CONFIG.steps) && CONFIG.steps.length) {
    return CONFIG.steps
      .map(s => ({ roi: Number(s.roi), take: Number(s.take) }))
      .filter(s => Number.isFinite(s.roi) && Number.isFinite(s.take) && s.take > 0)
      .sort((a,b) => a.roi - b.roi);
  }
  return genStepsFromLadder(CONFIG.ladder);
}

// tighten trail a bit after each step, floor at 10%
function effectiveTrailDrop(stepCount) {
  const base = Math.max(0, Math.min(1, Number(CONFIG.trailDropPct || 0.25)));
  const tighten = Math.max(0, stepCount - 1) * 0.05; // −5pp per additional step
  const eff = Math.max(0.10, base - tighten);
  return eff;
}

/**
 * Update per-tick with fresh pricing + TA context
 * Will call EXEC.partialClose / EXEC.closeAll when needed (idempotent).
 * @param {Object} p
 * @param {string} p.symbol
 * @param {number} p.currentPrice
 * @param {number} p.confidence           // 0..100
 * @param {'uptrend'|'peak'|'reversal'} p.trendPhase
 * @param {number} [p.initialMargin]      // if tracker didn't know at init, we can set it here
 */
async function updateTPStatus(p = {}) {
  const { symbol, currentPrice, trendPhase = 'uptrend', confidence = 70 } = p;
  const st = tpMemory.get(symbol);
  if (!st || st.exited) return;

  // update known margin if provided now
  if (st.initialMargin == null && p.initialMargin != null) {
    st.initialMargin = Number(p.initialMargin);
  }

  const price = Number(currentPrice);
  if (!(price > 0)) return;

  // --- ROI math in exchange terms ---
  // pnl: long=(price-entry)*size, short=(entry-price)*size
  const pnl = st.side === 'long'
    ? (price - st.entryPrice) * st.size
    : (st.entryPrice - price) * st.size;

  const baseMargin = st.initialMargin != null
    ? st.initialMargin
    : Math.max(1e-9, st.entryPrice * st.size * 0.2); // fallback guess (avoid div-by-zero)

  const roi = (pnl / baseMargin) * 100;

  st.maxRoi = Math.max(st.maxRoi, roi);
  st.confidenceTrend.push(Number(confidence));

// --- Ladder partials: take X% at each ROI step (50%, 100%, 150% ...) ---
{
  const steps = getSteps();
  let didAny = false;

  // process all steps crossed since last tick
  while (st.firedSteps < steps.length && roi >= steps[st.firedSteps].roi) {
    // stop if we’re at or below min remainder
    if (CONFIG.minRemainderContracts > 0 && st.size <= CONFIG.minRemainderContracts) break;

    const { take } = steps[st.firedSteps];
    const qtyRaw = st.size * Math.max(0, Math.min(1, take));
    const qty = roundQty(qtyRaw, st.lotSize, st.minSize);
    if (!(qty > 0) || qty >= st.size) break;

    try {
      await EXEC.partialClose(symbol, qty);
      st.size = Number((st.size - qty).toFixed(10));
      st.firedSteps += 1;
      didAny = true;

      // (re)arm trailing after first partial, tighten per step
      st.trailActive = true;
      st.peakPrice = price;
      const drop = effectiveTrailDrop(st.firedSteps);
      st.trailStop = computeTrailStop(st.side, price, drop);

      emitOnce(
        symbol,
        `🎯 TP step #${st.firedSteps} — banked ${(take*100).toFixed(0)}% • new size=${st.size} • ROI ${roi.toFixed(2)}% • trail ${Math.round(drop*100)}%`
      );
    } catch (e) {
      emitOnce(symbol, `⚠️ TP step failed: ${e?.message || e}`);
      break;
    }
  }

  // If price made a new peak afterwards, bump the trail accordingly
  if (st.trailActive && st.size > 0) {
    const madeNewPeak = (
      (st.side === 'long'  && price > st.peakPrice) ||
      (st.side === 'short' && price < st.peakPrice)
    );
    if (madeNewPeak) {
      st.peakPrice = price;
      const drop = effectiveTrailDrop(st.firedSteps || 1);
      st.trailStop = computeTrailStop(st.side, price, drop);
      emitThrottled(symbol, `🚀 New peak • tightened trail to ${fmt(st.trailStop, 6)} (${Math.round(drop*100)}%)`);
    }
  }
}

  // --- Trailing logic (only after TP1) ---
  if (st.trailActive && st.size > 0) {
    const madeNewPeak = (
      (st.side === 'long'  && price > st.peakPrice) ||
      (st.side === 'short' && price < st.peakPrice)
    );
    if (madeNewPeak) {
      st.peakPrice = price;
      st.trailStop = computeTrailStop(st.side, price, CONFIG.trailDropPct);
      emitThrottled(symbol, `🚀 New peak • trail moved to ${fmt(st.trailStop, 6)}`);
    }

    const hitTrail = (
      (st.side === 'long'  && price <= st.trailStop) ||
      (st.side === 'short' && price >= st.trailStop)
    );

    // optional: confidence-based exit if reversal
    const shouldExitOnReversal = (trendPhase === 'reversal' || trendPhase === 'peak') && confidence < CONFIG.minExitConfidence;

    if (hitTrail || shouldExitOnReversal) {
      try {
        await EXEC.closeAll(symbol);
        st.exited = true;
        st.trailActive = false;
        st.notes = hitTrail
          ? `✅ Trailing stop hit at ${fmt(price, 6)}`
          : `✅ Exited on reversal (conf ${confidence}%)`;
        emitOnce(symbol, st.notes);
      } catch (e) {
        emitOnce(symbol, `⚠️ Exit failed: ${e?.message || e}`);
      }
    }
  }

  // general status (when nothing else emitted)
  if (!st.exited) {
    st.notes = statusLine(st, roi, trendPhase, confidence);
  }

  tpMemory.set(symbol, st);
}

function computeTrailStop(side, refPrice, dropPct) {
  const k = Math.max(0, Math.min(1, Number(dropPct || 0.25)));
  if (side === 'long')  return refPrice * (1 - k);
  if (side === 'short') return refPrice * (1 + k);
  return refPrice;
}

function statusLine(st, roi, trendPhase, confidence) {
  if (!st.trailActive && st.firedSteps === 0) {
    return `🟡 Holding — ROI ${roi.toFixed(2)}% • trend: ${trendPhase} • conf: ${confidence}%`;
  }
  return `🧭 Trailing — steps ${st.firedSteps} • ROI ${roi.toFixed(2)}% • peak ${fmt(st.peakPrice, 6)} • stop ${fmt(st.trailStop, 6)}`;
}

function emitOnce(symbol, msg) {
  EXEC.emitFeed?.({ kind: 'tp', symbol, msg, ts: now() });
  const st = tpMemory.get(symbol);
  if (st) st.lastEmitAt = now();
}

function emitThrottled(symbol, msg) {
  const st = tpMemory.get(symbol);
  if (!st) return;
  const t = now();
  if (t - st.lastEmitAt >= CONFIG.emitThrottleMs) {
    EXEC.emitFeed?.({ kind: 'tp', symbol, msg, ts: t });
    st.lastEmitAt = t;
  }
}

function getTPStatus(symbol) {
  return tpMemory.get(symbol) || null;
}
function markTradeExited(symbol) {
  const st = tpMemory.get(symbol);
  if (st) {
    st.exited = true;
    st.trailActive = false;
    st.notes = '✅ Trade exited';
    tpMemory.set(symbol, st);
  }
}

function resetTP(symbol) {
  if (symbol) tpMemory.delete(symbol);
}

function fmt(n, d = 2) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : '--';
}
function onExit(symbol) {
  return markTradeExited(symbol);
}

module.exports = {
  setTPConfig,
  registerExecutors,
  initTPTracker,
  updateTPStatus,
  getTPStatus,
  markTradeExited,
  onExit,            // ← added
  resetTP
};