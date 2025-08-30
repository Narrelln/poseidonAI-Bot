/* eslint-disable no-console */
// handlers/rescueManager.js
// ARES: Adaptive Rescue Manager — autonomous drawdown handling for Poseidon.
// Patch focus: ROI correctness
// - Prefer exchange-provided ROI (unrealisedRoePcnt / roi / roiPercent)
// - Only fall back to a safe computation if exchange ROI is missing
// - Keep actions conservative unless danger/momentum/structure/context align

const S = new Map(); // symbol -> state

let CFG = {
  enabled: true,
  // thresholds
  hardCutDanger: 85,     // >= -> closeAll
  escapeDanger: 65,      // >= + weak bounce -> partial escape
  minEscapeFrac: 0.35,   // 35% trim
  maxEscapeFrac: 0.55,   // 55% trim
  dcaMaxX: 2.0,          // <= 2x of base notional (guardrail)
  dcaTpPct: 1.6,         // TP after rescue add (+1.6%)
  dcaTrailDrop: 0.012,   // 1.2% trailing from local peak after add
  improveTimeoutMs: 5 * 60 * 1000, // if no ROI improvement in 5m -> trim more
  emitThrottleMs: 2000,
};

let EXEC = {
  partialClose: async () => {},  // (symbol, qtyContracts)
  closeAll: async () => {},      // (symbol)
  openAdd: async () => {},       // ({symbol, side, notionalUsd, leverage, tag})
  emitFeed: () => {},            // ({kind, symbol, msg, ts})
  getTA: async () => null,       // (symbol) -> taClient.fetchTA result
  getPatternProfile: async () => ({ emPct: 1.2, realizedVsEM: 1 }),
  getRails: async () => null,    // optional { '12h':{atl,ath} }
};

function setConfig(partial = {}) { CFG = { ...CFG, ...partial }; }
function registerExecutors(e = {}) { EXEC = { ...EXEC, ...(e || {}) }; }

const now = () => Date.now();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const fmt = (n, d = 6) => (Number.isFinite(+n) ? (+n).toFixed(d) : '--');

function emitOnce(symbol, msg) {
  const st = S.get(symbol) || {};
  const t = now();
  if ((t - (st.lastEmitAt || 0)) >= CFG.emitThrottleMs) {
    EXEC.emitFeed?.({ kind: 'rescue', symbol, msg, ts: t });
    st.lastEmitAt = t;
    S.set(symbol, st);
  }
}

/* -------------------- ROI helpers (patched) -------------------- */
// 1) Prefer exchange-provided ROE/ROI if present.
//    - KuCoin `unrealisedRoePcnt` is a decimal (e.g. 0.1234 => 12.34%)
//    - Some paths expose `roi` like "-0.25" (already %) or "-0.25%"
//    - Some expose `roiPercent` as number (already %)
function parseRoiFromExchange(pos = {}) {
  // A) unrealisedRoePcnt (decimal -> percent)
  if (pos.unrealisedRoePcnt !== undefined && pos.unrealisedRoePcnt !== null) {
    const dec = Number(pos.unrealisedRoePcnt);
    if (Number.isFinite(dec)) return dec * 100;
  }
  // B) roiPercent as number (%)
  if (pos.roiPercent !== undefined && pos.roiPercent !== null) {
    const n = Number(pos.roiPercent);
    if (Number.isFinite(n)) return n;
  }
  // C) roi as string/number, maybe with '%' suffix
  if (pos.roi !== undefined && pos.roi !== null) {
    if (typeof pos.roi === 'string') {
      const s = pos.roi.trim();
      if (s.endsWith('%')) {
        const n = Number(s.slice(0, -1));
        if (Number.isFinite(n)) return n;
      }
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    } else {
      const n = Number(pos.roi);
      if (Number.isFinite(n)) return n;
    }
  }
  // D) pnl / margin if both present
  if (pos.unrealisedPnl !== undefined && (pos.initialMargin !== undefined || pos.margin !== undefined)) {
    const pnl = Number(pos.unrealisedPnl);
    const base = Number.isFinite(Number(pos.initialMargin)) ? Number(pos.initialMargin)
               : Number.isFinite(Number(pos.margin))        ? Number(pos.margin)
               : NaN;
    if (Number.isFinite(pnl) && Number.isFinite(base) && base > 0) {
      return (pnl / base) * 100;
    }
  }
  return null;
}

// 2) Safe fallback only if exchange ROI missing AND we have solid price/specs
function roiFallbackCompute({ side, entryPrice, price, size, leverage = 10, multiplier = 1, initialMargin }) {
  const e = Number(entryPrice), p = Number(price), sz = Number(size), lev = Number(leverage), mul = Number(multiplier);
  if (!(p > 0) || !(e > 0) || !(sz > 0) || !(lev > 0) || !(mul > 0)) return 0;
  const pnl = side === 'long' ? (p - e) * sz * mul : (e - p) * sz * mul;
  const base = Number.isFinite(initialMargin) && initialMargin > 0
    ? initialMargin
    : (e * sz * mul) / lev;
  return (pnl / base) * 100;
}

function roiFromPosition(pos = {}) {
  // Normalize side
  const side = (String(pos.side || pos.positionSide || '').toLowerCase().includes('sell')) ? 'short' : 'long';
  // Try exchange fields first
  const ex = parseRoiFromExchange(pos);
  if (Number.isFinite(ex)) return ex;

  // Fallback computation
  const entry = Number(pos.entryPrice || pos.avgEntryPrice || pos.entry || 0);
  const price = Number(pos.markPrice || pos.price || 0);
  const size  = Number(pos.size || pos.contracts || pos.quantity || 0);
  const lev   = Number(pos.leverage || 10);
  const mult  = Number(pos.multiplier || 1);
  const initM = Number(pos.initialMargin || pos.margin || 0);
  return roiFallbackCompute({ side, entryPrice: entry, price, size, leverage: lev, multiplier: mult, initialMargin: initM });
}

/* -------------------- Scores -------------------- */
function dangerScore({ roi, liqDistPct }) {
  // roi negative -> danger; liqDist small -> danger
  const dd = clamp((-roi) / 1.2, 0, 100);              // ~1.2% ROI down -> +1 danger point
  const ld = Number.isFinite(liqDistPct)
    ? clamp((2 - liqDistPct) * 40, 0, 100)             // <2% to liq ramps quickly
    : 0;
  return clamp(0.6 * dd + 0.4 * ld, 0, 100);
}
function structureScore({ price, range12h, fib, side }) {
  if (!(price > 0) || !range12h) return 40;
  const { low, high } = range12h;
  if (!(Number.isFinite(low) && Number.isFinite(high) && high > low)) return 40;
  const nearLow = clamp((Math.max(0, (price - low) / low) <= 0.004) ? 85 : 0, 0, 85); // within 0.4% of 12h low
  const nearHigh = clamp((Math.max(0, (high - price) / high) <= 0.004) ? 85 : 0, 0, 85);
  let fibOk = 0;
  if (fib?.F382 && fib?.F618) {
    if (side === 'long' && price >= fib.F382) fibOk = 15;
    if (side === 'short' && price <= fib.F618) fibOk = 15;
  }
  return clamp((side === 'long' ? nearLow : nearHigh) + fibOk, 0, 100);
}
function momentumScore({ ta }) {
  if (!ta) return 45;
  let s = 50;
  if (ta.signal === 'bullish') s += 12;
  if (ta.macdSignal === 'buy') s += 8;
  if (ta.bbSignal === 'upper') s += 4;
  if (ta.volumeSpike) s += 6;
  if (ta.signal === 'bearish') s -= 10;
  if (ta.macdSignal === 'sell') s -= 8;
  if (Number.isFinite(ta.rsi)) {
    if (ta.rsi < 35) s -= 8;
    if (ta.rsi >= 55 && ta.rsi <= 68) s += 5;
  }
  return clamp(s, 0, 100);
}
function contextScore({ emPct, realizedVsEM }) {
  // If move already exceeded EM, mean-revert more likely
  if (!(emPct > 0)) return 50;
  const r = Number(realizedVsEM) || 1;
  if (r >= 1.4) return 80;
  if (r >= 1.2) return 70;
  if (r >= 1.0) return 60;
  return 45;
}

function liqDistancePct({ side, price, liqPrice }) {
  if (!(price > 0) || !(liqPrice > 0)) return null;
  return side === 'long'
    ? ((price - liqPrice) / price) * 100
    : ((liqPrice - price) / price) * 100;
}

/* -------------------- Main tick -------------------- */
async function onTick(pos = {}) {
  if (!CFG.enabled) return { action: 'off' };

  // normalize
  const symbol = String(pos.symbol || pos.contract || '').toUpperCase();
  if (!symbol) return { action: 'skip' };
  const side   = (String(pos.side || '').toLowerCase().includes('sell')) ? 'short' : 'long';
  const entry  = Number(pos.entryPrice || pos.avgEntryPrice || pos.entry || 0);
  const price  = Number(pos.markPrice || pos.price || 0);
  const size   = Number(pos.size || pos.contracts || pos.quantity || 0);
  const lev    = Number(pos.leverage || 10);
  const mult   = Number(pos.multiplier || 1);
  const initM  = Number(pos.initialMargin || pos.margin || 0);
  const liqPx  = Number(pos.liqPrice || pos.liquidationPrice || 0);

  if (!(entry > 0) || !(price > 0) || !(size > 0)) return { action: 'skip' };

  // state
  const st = S.get(symbol) || { openedAt: now(), lastImproveAt: now(), bestRoi: -Infinity };

  // ROI (patched): prefer exchange-provided, fallback if needed
  const roi = roiFromPosition({
    ...pos,
    side,
    entryPrice: entry,
    markPrice: price,
    size,
    leverage: lev,
    multiplier: mult,
    initialMargin: initM,
  });

  // Track best improvement
  if (!Number.isFinite(st.bestRoi)) st.bestRoi = roi;
  st.bestRoi = Math.max(st.bestRoi, roi);

  // TA + context
  let ta = null, em = { emPct: 1.2, realizedVsEM: 1 }, rails = null;
  try { ta = await EXEC.getTA?.(symbol.replace('-USDTM','USDT')); } catch {}
  try { em = await EXEC.getPatternProfile?.(symbol); } catch {}
  try { rails = await EXEC.getRails?.(symbol); } catch {}

  const fib = ta?.range12h
    ? computeFib(ta.range12h.low, ta.range12h.high)
    : (ta?.range24h ? computeFib(ta.range24h.low, ta.range24h.high) : null);

  const liqDist = liqDistancePct({ side, price, liqPrice: liqPx });

  // scores
  const danger    = dangerScore({ roi, liqDistPct: liqDist });
  const structure = structureScore({ price, range12h: ta?.range12h, fib, side });
  const momentum  = momentumScore({ ta });
  const context   = contextScore({ emPct: em.emPct, realizedVsEM: em.realizedVsEM });

  const rescueScore = Math.round(
    0.40 * danger +
    0.30 * Math.max(momentum, structure) +
    0.30 * context
  );

  // decisions
  let action = 'hold';

  // 1) Hard cut
  if (danger >= CFG.hardCutDanger) {
    await EXEC.closeAll?.(symbol);
    emitOnce(symbol, `🛑 Hard cut • danger=${danger} roi=${roi.toFixed(2)}% liqDist=${Number.isFinite(liqDist)?liqDist.toFixed(2):'--'}%`);
    S.set(symbol, { ...st, lastAct: 'hard_cut', lastActAt: now() });
    return { action: 'hard_cut', roi, danger, rescueScore };
  }

  // 2) Smart escape (partial trim)
  if (danger >= CFG.escapeDanger && momentum < 55 && structure < 55) {
    const frac = clamp(CFG.minEscapeFrac + (danger - CFG.escapeDanger) / 200, CFG.minEscapeFrac, CFG.maxEscapeFrac);
    const qty = Math.floor(size * frac); // rounded; your close route rounds anyway
    if (qty > 0 && qty < size) {
      await EXEC.partialClose?.(symbol, qty);
      emitOnce(symbol, `✂️ Smart escape • trimmed ${qty} (${Math.round(frac*100)}%) • roi=${roi.toFixed(2)}%`);
      S.set(symbol, { ...st, lastAct: 'escape', lastActAt: now(), lastImproveAt: now() });
      return { action: 'escape', qty, roi, danger, rescueScore };
    }
  }

  // 3) Selective DCA (only on strong reclaim: high momentum & structure)
  if (momentum >= 70 && structure >= 65) {
    // cap add by notional; if you have notional from API, use it; else approximate with price*size
    const baseNotional = price * size * mult / lev; // conservative (cost basis)
    const addNotional  = Math.min(baseNotional * (CFG.dcaMaxX - 1), baseNotional); // don't exceed 2x total
    if (addNotional > 5) {
      await EXEC.openAdd?.({
        symbol, side,
        notionalUsd: addNotional,
        leverage: lev,
        tag: `rescue:dca tp=${CFG.dcaTpPct}% trail=${Math.round(CFG.dcaTrailDrop*10000)/100}%`
      });
      emitOnce(symbol, `➕ Rescue DCA • ~$${addNotional.toFixed(2)} • momentum=${momentum} structure=${structure}`);
      S.set(symbol, { ...st, lastAct: 'dca', lastActAt: now(), lastImproveAt: now() });
      return { action: 'dca', addNotional, roi, rescueScore };
    }
  }

  // 4) Time-stop partial if no improvement
  if (now() - (st.lastImproveAt || st.openedAt) > CFG.improveTimeoutMs && roi <= st.bestRoi + 0.5) {
    const qty = Math.max(1, Math.floor(size * 0.25));
    if (qty < size) {
      await EXEC.partialClose?.(symbol, qty);
      emitOnce(symbol, `⏳ Time-stop trim • ${qty} (25%) • no improvement`);
      S.set(symbol, { ...st, lastAct: 'time_trim', lastActAt: now(), lastImproveAt: now() });
      return { action: 'time_trim', qty, roi, rescueScore };
    }
  }

  // nothing to do
  S.set(symbol, st);
  return { action: 'hold', roi, rescueScore };
}

function computeFib(low, high) {
  const L = Number(low), H = Number(high);
  if (!(H > L)) return null;
  const R = H - L, fx = (r) => +(L + R * r).toFixed(6);
  return { F382: fx(0.382), F500: fx(0.5), F618: fx(0.618) };
}

function getState(symbol) { return S.get(String(symbol || '').toUpperCase()) || null; }

module.exports = { setConfig, registerExecutors, onTick, getState };