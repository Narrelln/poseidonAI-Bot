/**
 * services/cycleEngine.js  (patched)
 * Pure state machine for: IDLE → IMPULSE → EXHAUST → REVERSAL → RESET.
 * Memory‑aware gates (ATH/ATL + Support/Resistance) and light hysteresis.
 *
 * Inputs:
 *  - phase: "IDLE" | "IMPULSE" | "EXHAUST" | "REVERSAL"
 *  - now, impulseBeganAt (ms)
 *  - momentum ∈ [0,1], conf ∈ [0,100], price
 *  - optional memory: ath30, atl30, supports[], resistances[]
 *  - optional bias: 'up' | 'down'
 *
 * Output: { action, hint? }
 *   action ∈ 'ENTER_IMPULSE' | 'EXIT_FOR_EXHAUST' | 'ENTER_REVERSAL' | 'RESET' | 'HOLD' | 'WAIT_REVERSAL' | 'NONE'
 */

// ------- base thresholds (tuned) -------
const H = {
  // Keep your nominal window, but exits can also be driven by structure (see below)
  IMPULSE_MIN_HOURS: 24,
  IMPULSE_MAX_HOURS: 48,
  MOMENTUM_OK: 0.60,     // ↓ from 0.65 to be a bit more permissive
  MOMENTUM_WEAK: 0.42,   // ↓ from 0.45 for smoother holds
};

// ------- memory gates (kept, tweakable) -------
const M = {
  PROX_ATH_PCT: 1.0,      // if within 1.0% of ATH, avoid fresh long impulse
  PROX_ATL_PCT: 1.0,      // if within 1.0% of ATL, avoid fresh short impulse
  SR_CONFIRM_BOUNCE: 0.3, // ≥0.3% above nearest support qualifies as “bounce”
  SR_CONFIRM_BREAK: 0.3,  // ≥0.3% above nearest resistance qualifies as “breakout”
};

// ------- hardening / helpers -------
const EPS = 1e-9;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pctDiff = (a, b) => {
  const A = Number(a), B = Number(b);
  if (!(A > 0) || !(B > 0)) return Infinity;
  return Math.abs((A - B) / B) * 100;
};
const near = (p, lvl, pct = 2.5) =>
  Math.abs((p - lvl) / (lvl || (p + EPS))) * 100 <= pct; // within pct%

function nearestLevel(price, arr = []) {
  if (!Array.isArray(arr) || !arr.length) return null;
  let best = null, bestAbs = Infinity;
  for (const v of arr) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const d = Math.abs(price - n);
    if (d < bestAbs) { bestAbs = d; best = n; }
  }
  return best;
}

// ---------- NEW: structure arrival boost (helps entries near ATL/ATH/SR) ----------
const STRUCT_NEAR_BAND = 1.2; // % window treated as “arrived” to rail
function closeness01(price, ref) {
  if (!Number.isFinite(ref) || !(price > 0)) return 0;
  const d = pctDiff(price, ref);
  return d <= STRUCT_NEAR_BAND ? clamp(1 - (d / STRUCT_NEAR_BAND), 0, 1) : 0;
}
/**
 * Returns { bonus, arrived } where:
 *  - bonus: small confidence lift (0..10) if close to ATL/ATH or SR cluster
 *  - arrived: 'nearATL' | 'nearATH' | ''  (hint for callers if needed)
 */
function structureBoost({ price, ath30, atl30, supports, resistances }) {
  const P = Number(price);
  let bonus = 0;
  let arrived = '';

  const cATL = closeness01(P, Number(atl30));
  const cATH = closeness01(P, Number(ath30));
  if (cATL > 0 && cATL >= cATH) { bonus += Math.round(10 * cATL); arrived = 'nearATL'; }
  else if (cATH > 0)            { bonus += Math.round(10 * cATH); arrived = 'nearATH'; }

  const s = nearestLevel(P, supports);
  const r = nearestLevel(P, resistances);
  if (Number.isFinite(s) && near(P, s, STRUCT_NEAR_BAND)) bonus += 2; // soft add
  if (Number.isFinite(r) && near(P, r, STRUCT_NEAR_BAND)) bonus += 2;

  return { bonus: clamp(bonus, 0, 10), arrived };
}

// ---------- hysteresis thresholds (tuned) ----------
const TH = {
  ENTER_MOMENTUM: H.MOMENTUM_OK + 0.00,  // 0.60
  EXIT_MOMENTUM:  H.MOMENTUM_WEAK - 0.00,// 0.42
  ENTER_CONF: 68,   // ↓ from 75
  REV_CONF:   72,   // ↓ from 80
  EXIT_CONF:  55,   // ↓ from 60
};

/**
 * Memory gate for LONG:
 *  - Reject if too close to ATH30 (chase risk)
 *  - Prefer confirmation only if level is *near* (<= ~2.5%)
 *    - over support by SR_CONFIRM_BOUNCE
 *    - over resistance by SR_CONFIRM_BREAK
 */
function memoryAllowsLong({ price, ath30, atl30, supports, resistances }) {
  const P = Number(price);
  if (!(P > 0)) return true;

  if (Number.isFinite(ath30) && pctDiff(P, ath30) <= M.PROX_ATH_PCT) return false;

  const s = nearestLevel(P, supports);
  const r = nearestLevel(P, resistances);

  let okSR = true;
  if (Number.isFinite(s) && near(P, s, 2.5)) {
    if (P < s * (1 + M.SR_CONFIRM_BOUNCE / 100)) okSR = false;
  }
  if (Number.isFinite(r) && near(P, r, 2.5)) {
    if (P < r * (1 + M.SR_CONFIRM_BREAK / 100)) okSR = false;
  }
  return okSR;
}

/**
 * Memory gate for SHORT:
 *  - Reject if too close to ATL30 (knife risk)
 *  - Prefer confirmation only if level is *near* (<= ~2.5%)
 *    - under resistance by SR_CONFIRM_BOUNCE
 *    - under support by SR_CONFIRM_BREAK
 */
function memoryAllowsShort({ price, ath30, atl30, supports, resistances }) {
  const P = Number(price);
  if (!(P > 0)) return true;

  if (Number.isFinite(atl30) && pctDiff(P, atl30) <= M.PROX_ATL_PCT) return false;

  const r = nearestLevel(P, resistances);
  const s = nearestLevel(P, supports);

  let okSR = true;
  if (Number.isFinite(r) && near(P, r, 2.5)) {
    if (P > r * (1 - M.SR_CONFIRM_BOUNCE / 100)) okSR = false;
  }
  if (Number.isFinite(s) && near(P, s, 2.5)) {
    if (P > s * (1 - M.SR_CONFIRM_BREAK / 100)) okSR = false;
  }
  return okSR;
}

/**
 * Decide next action.
 * NOTE: Side is still chosen by your caller (CycleWatcher uses TA.signal to pick BUY/SELL).
 * We only gate entries using memory if available, and add a structure-based confidence bonus.
 */
function decide({
  phase,
  now,
  impulseBeganAt,
  momentum,
  conf,
  price,
  roi,          // reserved for future use
  atl30,
  ath30,
  supports,     // array of numeric levels
  resistances,  // array of numeric levels
  bias,         // 'up' | 'down' (optional directional intent from TA)
} = {}) {
  const m = clamp(Number(momentum || 0), 0, 1);
  const cRaw = clamp(Number(conf || 0), 0, 100);
  const P = Number(price) || 0;

  // confidence lift if we’re hugging rails (lets the “24h low + bounce” idea actually fire)
  const { bonus: structBonus, arrived } = structureBoost({ price: P, ath30, atl30, supports, resistances });
  const c = clamp(cRaw + structBonus, 0, 100);

  const hrs =
    (impulseBeganAt && now && now >= impulseBeganAt)
      ? (now - impulseBeganAt) / 3.6e6
      : 0;

  const hasMemory =
    Number.isFinite(ath30) || Number.isFinite(atl30) ||
    (Array.isArray(supports) && supports.length) ||
    (Array.isArray(resistances) && resistances.length);

  // ---- IDLE → ENTER_IMPULSE (momentum + (boosted) confidence + memory) ----
  if (phase === 'IDLE') {
    if (m >= TH.ENTER_MOMENTUM && c >= TH.ENTER_CONF) {
      if (hasMemory) {
        const upOk   = memoryAllowsLong({ price: P, ath30, atl30, supports, resistances });
        const downOk = memoryAllowsShort({ price: P, ath30, atl30, supports, resistances });
        if (bias === 'up'   && !upOk)   return { action: 'NONE', hint: 'mem_block_long' };
        if (bias === 'down' && !downOk) return { action: 'NONE', hint: 'mem_block_short' };
        if (!bias && !(upOk || downOk)) return { action: 'NONE', hint: 'mem_block_both' };
      }
      return { action: 'ENTER_IMPULSE', hint: arrived || undefined };
    }
    return { action: 'NONE' };
  }

  // ---- IMPULSE → EXIT_FOR_EXHAUST (time window + weakening OR proximity-to-ATH) ----
  if (phase === 'IMPULSE') {
    const timeExhaust   = hrs >= H.IMPULSE_MIN_HOURS && hrs <= H.IMPULSE_MAX_HOURS;
    const momentumLoss  = m < TH.EXIT_MOMENTUM || c < TH.EXIT_CONF;

    // NEW: if we’re very close to ATH and momentum is not strong, take profit (don’t “bail”, just complete leg)
    const nearATH = Number.isFinite(ath30) && pctDiff(P, ath30) <= Math.min(M.PROX_ATH_PCT, 0.8);
    if ((timeExhaust && momentumLoss) || (nearATH && m < 0.58)) {
      return { action: 'EXIT_FOR_EXHAUST', hint: nearATH ? 'ath_touch' : 'time_window' };
    }
    return { action: 'HOLD' };
  }

  // ---- EXHAUST → ENTER_REVERSAL (fresh impulse + memory) ----
  if (phase === 'EXHAUST') {
    // Be a bit more permissive if we just exited near ATH/ATL:
    const nearATL = Number.isFinite(atl30) && pctDiff(P, atl30) <= STRUCT_NEAR_BAND;
    const nearATH = Number.isFinite(ath30) && pctDiff(P, ath30) <= STRUCT_NEAR_BAND;

    // Allow reversal entry if either:
    //  - normal thresholds (m & c) OR
    //  - slightly lighter thresholds when we’re at the opposite rail (this enables the “ride back home”)
    const passNormal = (m >= TH.ENTER_MOMENTUM && c >= TH.REV_CONF);
    const passArrive = ((nearATH || nearATL) && m >= (TH.ENTER_MOMENTUM - 0.04) && c >= (TH.REV_CONF - 6));

    if (passNormal || passArrive) {
      if (hasMemory) {
        const upOk   = memoryAllowsLong({ price: P, ath30, atl30, supports, resistances });
        const downOk = memoryAllowsShort({ price: P, ath30, atl30, supports, resistances });

        // If bias is missing, allow either side as long as one gate is open; with bias, respect it.
        if (!bias && !(upOk || downOk)) return { action: 'WAIT_REVERSAL', hint: 'mem_block_both' };
        if (bias === 'up'   && !upOk)   return { action: 'WAIT_REVERSAL', hint: 'mem_block_long' };
        if (bias === 'down' && !downOk) return { action: 'WAIT_REVERSAL', hint: 'mem_block_short' };
      }
      return { action: 'ENTER_REVERSAL', hint: (nearATH && 'nearATH') || (nearATL && 'nearATL') || arrived || undefined };
    }
    return { action: 'WAIT_REVERSAL' };
  }

  // ---- REVERSAL → RESET (weakening) ----
  if (phase === 'REVERSAL') {
    // Allow a longer ride; only reset when we clearly lose momentum/confidence
    if (m < TH.EXIT_MOMENTUM || c < TH.EXIT_CONF) return { action: 'RESET' };
    return { action: 'HOLD' };
  }

  return { action: 'NONE' };
}

module.exports = { decide, H, M };