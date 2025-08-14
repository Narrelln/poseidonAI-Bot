// === public/scripts/tpTracker.js ===
// Frontend Smart Take Profit Tracker for Poseidon

const tpMemory = new Map();
const DEFAULT_TP_PERCENT = 0.4; // 40%
const TRAIL_TP_THRESHOLD = 0.6; // 60% gain triggers moon mode
const MIN_EXIT_CONFIDENCE = 60;

const trendMap = new Map(); // symbol -> 'uptrend' | 'peak' | 'reversal'

export function initTPTracker({ symbol, entryPrice, confidence }) {
  if (!symbol || !entryPrice || !confidence) return;

  const baseTP = entryPrice * (1 + Math.max(confidence / 100, DEFAULT_TP_PERCENT));
  tpMemory.set(symbol, {
    entryPrice,
    baseTP,
    confidence,
    maxGain: 0,
    exitIntent: false,
    exited: false,
    notes: 'Tracking started'
  });
}

export function updateTPStatus({ symbol, currentPrice, trendPhase, confidence }) {
  const data = tpMemory.get(symbol);
  if (!data || data.exited) return;

  const { entryPrice, maxGain } = data;
  const gainPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

  data.maxGain = Math.max(maxGain, gainPercent);
  trendMap.set(symbol, trendPhase);

  if (trendPhase === 'reversal' && confidence < MIN_EXIT_CONFIDENCE) {
    data.exitIntent = true;
    data.notes = '🔻 Reversal confirmed — preparing exit';
  } else if (gainPercent >= TRAIL_TP_THRESHOLD * 100) {
    data.exitIntent = false;
    data.notes = '🚀 Moon mode — holding for extended TP';
  } else if (gainPercent >= DEFAULT_TP_PERCENT * 100) {
    data.exitIntent = false;
    data.notes = '✅ TP reached — monitoring trend';
  } else {
    data.notes = '📈 Holding — TP not yet reached';
  }

  tpMemory.set(symbol, data);
  logTPStatus(symbol);
}

export function shouldExitTrade(symbol) {
  const data = tpMemory.get(symbol);
  if (!data || data.exited) return false;
  return !!data.exitIntent;
}

export function getTPStatus(symbol) {
  return tpMemory.get(symbol) || null;
}

export function markTradeExited(symbol) {
  const data = tpMemory.get(symbol);
  if (data) {
    data.exited = true;
    data.notes = '💼 Trade exited';
    tpMemory.set(symbol, data);
    logTPStatus(symbol);
  }
}

export function logTPStatus(symbol) {
  const feed = document.getElementById('futures-log-feed');
  if (!feed) return;

  const data = tpMemory.get(symbol);
  if (!data) return;

  const div = document.createElement('div');
  div.className = 'log-entry log-blue';

  const note = data.notes || 'TP tracking...';
  const maxGain = data.maxGain?.toFixed(2) || '0.00';

  div.innerHTML = `
    <b>${symbol}</b> — ${note} | Max Gain: ${maxGain}%
  `.trim();

  feed.prepend(div);

  // Limit log size
  const entries = feed.querySelectorAll('.log-entry');
  if (entries.length > 12) {
    [...entries].slice(12).forEach(e => e.remove());
  }
}

// Export to window for debugging
window.tpTracker = {
  initTPTracker,
  updateTPStatus,
  shouldExitTrade,
  getTPStatus,
  markTradeExited
};