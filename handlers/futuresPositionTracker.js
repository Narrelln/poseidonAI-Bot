// handlers/futuresPositionTracker.js — Backend-Safe Futures Position Tracker

const { recordTradeResult } = require('./strategyMemory.js');
const { applyTradeOutcome } = require('./capitalRiskEngine');
const { updateMemoryFromResult } = require('./updateMemoryFromResult');
const { getOpenPositions } = require('./futuresApi');

const trackers = new Map();
let lastClosedTrade = {
  symbol: null,
  side: null,
  entry: null,
  exit: null,
  pnlValue: null,
  roi: null,
  date: null,
};

function initFuturesPositionTracker(symbol) {
  if (trackers.has(symbol)) return;
  trackers.set(symbol, {
    lastSide: null,
    lastPnL: null,
    lastEntry: null,
    lastLeverage: null,
    wasOpen: false,
    lastExit: null,
  });
}

function updateTracker(symbol, data) {
  const tracker = trackers.get(symbol);
  if (!tracker) return;

  if (data && data.size && parseFloat(data.size) > 0) {
    const side = data.side || 'N/A';
    const entryPrice = parseFloat(data.entryPrice || 0);
    const leverage = data.leverage ? parseInt(data.leverage) : 5;

    const pnlPercent = data.pnlPercent || '0.00%';
    const pnlValue = data.pnlValue || '0.00';

    tracker.lastSide = side;
    tracker.lastPnL = parseFloat(pnlPercent);
    tracker.lastEntry = entryPrice;
    tracker.lastLeverage = leverage;
    tracker.wasOpen = true;
  } else {
    if (tracker.wasOpen && tracker.lastSide && tracker.lastPnL !== null) {
      const result = tracker.lastPnL > 0 ? 'win' : 'loss';

      let memSide = tracker.lastSide.toUpperCase();
      if (memSide === 'BUY') memSide = 'LONG';
      else if (memSide === 'SELL') memSide = 'SHORT';

      recordTradeResult(symbol, memSide, result);
      applyTradeOutcome(tracker.lastPnL);

      lastClosedTrade = {
        symbol,
        side: memSide,
        entry: tracker.lastEntry,
        exit: tracker.lastExit || '-',
        pnlValue: tracker.lastPnL,
        roi: (typeof tracker.lastPnL === "number") ? (tracker.lastPnL.toFixed(2) + "%") : "-",
        date: new Date().toISOString(),
      };

      updateMemoryFromResult(
        symbol,
        memSide,
        result,
        tracker.lastPnL
      );
    }

    tracker.lastSide = null;
    tracker.lastPnL = null;
    tracker.lastEntry = null;
    tracker.lastLeverage = null;
    tracker.lastExit = null;
    tracker.wasOpen = false;
  }
}

async function fetchAllPositions() {
  try {
    const positions = await getOpenPositions();
    if (!Array.isArray(positions)) throw new Error("Invalid positions array");

    positions.forEach(pos => {
      const symbol = (pos.symbol || '').toUpperCase();
      if (!trackers.has(symbol)) {
        initFuturesPositionTracker(symbol);
      }
      updateTracker(symbol, pos);
    });

  } catch (err) {
    console.warn('⚠️ Backend position fetch error:', err.message);
  }
}

function resetAllTrackers() {
  trackers.clear();
}

function initPositionTrackingModule(intervalMs = 10000) {
  fetchAllPositions();
  setInterval(fetchAllPositions, intervalMs);
}

function getLastClosedTrade() {
  return { ...lastClosedTrade };
}

module.exports = {
  initFuturesPositionTracker,
  updateTracker,
  fetchAllPositions,
  resetAllTrackers,
  initPositionTrackingModule,
  getLastClosedTrade,
};