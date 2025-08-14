/**
 * Poseidon — Module M01: TP Brain (Partial 40% at 100% ROI + Trailing)
 * -------------------------------------------------------------------
 * Purpose
 *   Decide when to take partial profits and when to fully exit the remainder,
 *   using ROI, high-water tracking, and your tpTracker/tpLogic signals.
 *
 * Public API
 *   - tpBrain.onOpen(symbol)                       // initialize tracking
 *   - tpBrain.onTick({symbol, roi, confidence, trendPhase})
 *        -> returns { action: 'none'|'partial_40'|'exit_all', reason }
 *   - tpBrain.onExit(symbol)                       // finalize tracking
 *
 * Debug prefix
 *   [M01-TPBRAIN]
 */

const store = new Map(); // symbol -> { tp40Done, maxRoi, lastAction }

const PARTIAL_PCT = 0.40;        // 40%
const TP_TRIGGER_ROI = 100;      // 100% ROI
const TRAIL_DROP_PCT = 30;       // exit if ROI falls 30% from max (e.g., max=150 -> exit if <105)
const LOW_CONF = 60;             // confidence threshold to respect reversal signal

function log(...a){ console.log('[M01-TPBRAIN]', ...a); }

function onOpen(symbol) {
  const key = norm(symbol);
  if (!key) return;
  store.set(key, { tp40Done: false, maxRoi: 0, lastAction: 'none' });
}

function onExit(symbol) {
  const key = norm(symbol);
  if (!key) return;
  store.delete(key);
}

function onTick({ symbol, roi, confidence, trendPhase }) {
  const key = norm(symbol);
  if (!key || !Number.isFinite(roi)) return { action: 'none', reason: 'no-data' };

  const s = store.get(key) || { tp40Done: false, maxRoi: 0, lastAction: 'none' };

  // Track high-water ROI
  s.maxRoi = Math.max(s.maxRoi, roi);

  // 1) Partial TP at 100% ROI (only once)
  if (!s.tp40Done && roi >= TP_TRIGGER_ROI) {
    s.tp40Done = true;
    s.lastAction = 'partial_40';
    store.set(key, s);
    return { action: 'partial_40', reason: `ROI ${roi.toFixed(2)}% ≥ ${TP_TRIGGER_ROI}%` };
  }

  // 2) Trailing logic for remainder
  //    a) big pullback from max ROI
  const trailFloor = s.maxRoi - (s.maxRoi * (TRAIL_DROP_PCT / 100));
  const pulledBackTooMuch = roi < trailFloor;

  //    b) trend says reversal/peak and confidence is weak
  const reversing = (trendPhase === 'reversal' || trendPhase === 'peak') && (confidence < LOW_CONF);

  if (s.tp40Done && (pulledBackTooMuch || reversing)) {
    s.lastAction = 'exit_all';
    store.set(key, s);
    return { action: 'exit_all', reason: pulledBackTooMuch ? 'trail-pullback' : 'trend-reversal' };
  }

  store.set(key, s);
  return { action: 'none', reason: 'hold' };
}

function norm(s){ return String(s || '').trim().toUpperCase().replace(/[-_]/g,''); }

module.exports = { onOpen, onTick, onExit };