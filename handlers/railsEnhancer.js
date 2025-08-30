/* eslint-disable no-console */
// handlers/railsEnhancer.js
// Lightweight enhancer that blends multi-horizon ATL/ATH rails into TA.
// Primary horizon = 12h, with graceful fallback to 24h → 36h → 48h → 7d → 14d → 30d.
// Produces small, bounded confidence boosts + structure tags without hijacking core logic.

const { getSnapshot } = require('./extremaRails');

// Tunables (conservative defaults)
const PRIMARY_ORDER   = ['12h','24h','36h','48h','7d','14d','30d'];
const NEAR_BAND_PCT   = 1.2;   // within ±1.2% counts as “near”
const SUPPORT_BOOST   = 10;    // max confidence pts when near support
const RESIST_PENALTY  = -6;    // small caution if sitting at resistance
const BREAKOUT_BONUS  = 6;     // confidence bump if price reclaims resistance after sitting under it
const OVEREXT_PENALTY = -4;    // trim when RSI is hot and price is near ATH
const MAX_TOTAL_DELTA = 14;    // total clamp for enhancer contribution

function pct(a, b) {
  const A = +a, B = +b;
  if (!(A > 0) || !(B > 0)) return Infinity;
  return ((A - B) / B) * 100;
}
function absPct(a, b) {
  const A = +a, B = +b;
  if (!(A > 0) || !(B > 0)) return Infinity;
  return Math.abs((A - B) / B) * 100;
}

// Pick first horizon that actually has rails populated
function chooseHorizon(rails) {
  for (const h of PRIMARY_ORDER) {
    const r = rails?.[h];
    if (r && (Number.isFinite(r.atl) || Number.isFinite(r.ath))) return h;
  }
  return null;
}

function analyzeStructure({ price, rails, rsi, fibNext, taSignal }) {
  const out = {
    horizon: null,
    near: null,                 // 'support' | 'resistance' | null
    sidePref: null,             // 'BUY' | 'SELL' | null
    delta: 0,                   // confidence delta (bounded later)
    reasons: [],                // strings for audit log
    targets: {},                // { breakoutAbove, bounceFrom, headroomTo }
    invalidation: null          // suggested invalidation price
  };

  if (!(price > 0) || !rails) { out.reasons.push('rails:missing'); return out; }

  const h = chooseHorizon(rails);
  if (!h) { out.reasons.push('rails:none'); return out; }
  out.horizon = h;

  const { atl, ath } = rails[h] || {};
  const nearATL = Number.isFinite(atl) ? absPct(price, atl) <= NEAR_BAND_PCT : false;
  const nearATH = Number.isFinite(ath) ? absPct(price, ath) <= NEAR_BAND_PCT : false;

  // Near bands → small, interpretable nudges
  if (nearATL) {
    out.near = 'support';
    out.sidePref = 'BUY';
    // Scale support boost by closeness: closer → bigger
    const closeness = Math.max(0, 1 - (absPct(price, atl) / NEAR_BAND_PCT)); // 0..1
    out.delta += Math.round(SUPPORT_BOOST * closeness);
    out.reasons.push(`rails:${h}:nearATL(${absPct(price, atl).toFixed(2)}%)→+${out.delta}`);
    out.targets.bounceFrom = atl;
    // invalidation slightly below ATL (0.4–0.7% buffer)
    const buf = Math.max(0.004, NEAR_BAND_PCT / 300); // ~0.4% default
    out.invalidation = atl * (1 - buf);
  }

  if (nearATH) {
    out.near = out.near || 'resistance';
    out.sidePref = out.sidePref || 'SELL';
    out.delta += RESIST_PENALTY;
    out.reasons.push(`rails:${h}:nearATH(${absPct(price, ath).toFixed(2)}%)→${RESIST_PENALTY}`);
    out.targets.breakoutAbove = ath;
    // curb enthusiasm if momentum is already hot
    if (Number(rsi) >= 75) {
      out.delta += OVEREXT_PENALTY;
      out.reasons.push(`overextended:rsi=${rsi}→${OVEREXT_PENALTY}`);
    }
  }

  // Breakout readiness: if we were near resistance and fib/TA suggest continuation
  // grant a small bonus when price > resistance or fib next level is just above.
  if (Number.isFinite(ath)) {
    const above = price > ath;
    const fibAhead = Number.isFinite(fibNext) ? fibNext > ath : false;
    const taBullish = String(taSignal || '').toLowerCase() === 'bullish';
    if (above && (fibAhead || taBullish)) {
      out.delta += BREAKOUT_BONUS;
      out.reasons.push(`breakout:${h}:price>${ath}→+${BREAKOUT_BONUS}`);
      out.targets.headroomTo = fibAhead ? fibNext : (ath * 1.012); // tiny default headroom
    }
  }

  // Bound total enhancer influence
  out.delta = Math.max(-MAX_TOTAL_DELTA, Math.min(MAX_TOTAL_DELTA, out.delta));
  return out;
}

async function enhanceWithRails(symbol, { price, rsi, fibNextLevel, taSignal } = {}) {
  try {
    const snap = getSnapshot(symbol);
    const rails = snap?.rails || null;

    const analysis = analyzeStructure({
      price: Number(price),
      rails,
      rsi: Number(rsi),
      fibNext: Number(fibNextLevel),
      taSignal
    });

    return {
      ok: true,
      symbol,
      horizon: analysis.horizon,
      delta: analysis.delta,
      sidePref: analysis.sidePref,  // hint only — core can ignore if it already chose a side
      reasons: analysis.reasons,
      near: analysis.near,
      targets: analysis.targets,
      invalidation: analysis.invalidation,
      railsSample: rails ? {
        [analysis.horizon]: rails[analysis.horizon]
      } : null
    };
  } catch (e) {
    console.warn('[railsEnhancer] failed:', e?.message || e);
    return { ok: false, symbol, delta: 0, reasons: ['rails:error'] };
  }
}

module.exports = { enhanceWithRails };