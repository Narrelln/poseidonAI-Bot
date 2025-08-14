import { recordTradeResult } from './strategyMemory.js';
import { applyTradeOutcome } from './capitalRiskEngine.js';
// 🩹 Patch: Stub updateMemoryFromResult for frontend safety
const updateMemoryFromResult = () => {};

const trackers = new Map();
const POSITIONS_STORAGE_KEY = 'poseidonFuturesPositions';

let lastClosedTrade = {
  symbol: null,
  side: null,
  entry: null,
  exit: null,
  pnlValue: null,
  roi: null,
  date: null,
};

const GLOBAL_REFRESH_INTERVAL = 10000;

function savePositionsToStorage(positions) {
  localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions));
}

function loadPositionsFromStorage() {
  const json = localStorage.getItem(POSITIONS_STORAGE_KEY);
  return json ? JSON.parse(json) : [];
}

export function initFuturesPositionTracker(symbol) {
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

export function updateTracker(symbol, data) {
  const tracker = trackers.get(symbol);
  if (!tracker) return;

  const container = document.getElementById("futures-positions");

  let panel = document.getElementById(`panel-${symbol}`);
  if (!panel && container) {
    panel = document.createElement("div");
    panel.id = `panel-${symbol}`;
    panel.className = "position-panel";
    container.appendChild(panel);
  }

  if (data && data.size && parseFloat(data.size) > 0) {
    const side = data.side || 'N/A';
    const entryPrice = parseFloat(data.entryPrice || 0);
    const markPrice = parseFloat(data.markPrice || 0);
    const leverage = data.leverage ? parseInt(data.leverage) : 5;

    const pnlPercent = data.pnlPercent || '0.00%';
    const pnlValue = data.pnlValue || '0.00';

    tracker.lastSide = side;
    tracker.lastPnL = parseFloat(pnlPercent);
    tracker.lastEntry = entryPrice;
    tracker.lastLeverage = leverage;
    tracker.wasOpen = true;

    const pnlColor = parseFloat(pnlPercent) > 0 ? '#00ff99' : '#ff3366';
    const cleanSide = side.charAt(0).toUpperCase() + side.slice(1);

    if (panel) {
      panel.innerHTML = `
        <div><strong>${symbol}</strong> â ${cleanSide} (${leverage}x)</div>
        <div>Entry: $${entryPrice.toFixed(4)}</div>
        <div>Unreal. PNL: <span style="color:${pnlColor}">${pnlPercent} (${pnlValue} USDT)</span></div>
        <hr style="border-color:#00f7ff33;">
      `;
    }
  } else {
    if (tracker.wasOpen && tracker.lastSide && tracker.lastPnL !== null) {
      const result = tracker.lastPnL > 0 ? 'win' : 'loss';

      let memSide = tracker.lastSide.toUpperCase();
      if (memSide === 'BUY' || memSide === 'LONG') memSide = 'LONG';
      else if (memSide === 'SELL' || memSide === 'SHORT') memSide = 'SHORT';
      else memSide = tracker.lastSide.toUpperCase();

      recordTradeResult(symbol, memSide, result);
      applyTradeOutcome(tracker.lastPnL);

      lastClosedTrade = {
        symbol,
        side: memSide,
        entry: tracker.lastEntry,
        exit: tracker.lastExit || '-',
        pnlValue: tracker.lastPnL,
        roi: (typeof tracker.lastPnL === "number") ? (tracker.lastPnL.toFixed(2) + "%") : "-",
        date: new Date().toLocaleString(),
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

    if (panel) {
      panel.innerHTML = `<div><strong>${symbol}</strong>: <em>No active position</em></div>`;
    }
  }
}

export async function fetchAllPositions() {
  try {
    const res = await fetch('/api/positions');
    if (!res.ok) throw new Error(`Backend error ${res.status}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.positions)) {
      savePositionsToStorage(data.positions);

      data.positions.forEach(pos => {
        const cleanSymbol = (pos.symbol || '').toUpperCase().replace(/[^A-Z0-9\-]/g, '');

        console.log(`[TRACKER] Symbol: ${pos.symbol} â ${cleanSymbol} | Side: ${pos.side} | Entry: ${pos.entryPrice} | PNL: ${pos.pnlPercent}`);

        if (!trackers.has(cleanSymbol)) {
          initFuturesPositionTracker(cleanSymbol);
        }
        updateTracker(cleanSymbol, pos);
      });
    } else {
      console.warn('â Invalid positions data from backend', data);
    }
  } catch (err) {
    if (!fetchAllPositions.lastErrorTime || Date.now() - fetchAllPositions.lastErrorTime > 60000) {
      fetchAllPositions.lastErrorTime = Date.now();
      console.error('â Failed to fetch all positions:', err);
    }
  }
}

export function resetAllTrackers() {
  trackers.clear();
  const container = document.getElementById("futures-positions");
  if (container) container.innerHTML = '';
}

export function initPositionTrackingModule() {
  const cachedPositions = loadPositionsFromStorage();
  cachedPositions.forEach(pos => {
    initFuturesPositionTracker(pos.symbol);
    updateTracker(pos.symbol, pos);
  });

  fetchAllPositions();
  setInterval(fetchAllPositions, GLOBAL_REFRESH_INTERVAL);
}

export function getLastClosedTrade() {
  return { ...lastClosedTrade };
}
