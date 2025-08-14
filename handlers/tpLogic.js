// === handlers/tpLogic.js ===
// Lightweight helpers for adaptive TP targeting & moon-mode decisions

function determineTP(confidence = 70, regime = 'normal') {
  // returns a *target ROI percent* for guidance logs (tracker fires at 100% for TP1)
  // use this for pre-TP1 messaging only
  if (regime === 'highVol') {
    if (confidence >= 90) return 60;
    if (confidence >= 80) return 45;
    return 30;
  }
  if (confidence >= 90) return 50;
  if (confidence >= 85) return 40;
  if (confidence >= 75) return 30;
  return 20; // default guidance
}

function shouldEnterMoonMode(deltaRoi, tp1Hit) {
  // We “moon” only after TP1 is taken in tracker; this helper is for UI text
  return tp1Hit && deltaRoi >= 120; // purely cosmetic guidance
}

function shouldExitMoonMode(trendPhase, confidence = 0) {
  const isReversal = ['reversal', 'peak'].includes(trendPhase);
  const weakConviction = confidence < 60;
  return isReversal && weakConviction;
}

function logTPStatus(symbol, state, roi) {
  if (state.tookTP1 && state.trailActive) {
    return `🚀 ${symbol} — TP1 banked • trailing (ROI ${roi.toFixed(2)}%)`;
  }
  return `🎯 ${symbol} — targeting TP1 (ROI ${roi.toFixed(2)}%)`;
}

module.exports = {
  determineTP,
  shouldEnterMoonMode,
  shouldExitMoonMode,
  logTPStatus
};