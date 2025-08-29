// handlers/futuresPositionTracker.js — Ledger-first Futures Position Tracker
// Syncs exchange positions -> utils/tradeLedger (recordOpen / closePosition)

const { recordOpen, closePosition, list } = require('../utils/tradeLedger');
const { getOpenFuturesPositions } = require('../kucoinHelper'); // live snapshot

// --- small helpers ----------------------------------------------------------
const up  = s => String(s || '').toUpperCase();
const low = s => String(s || '').toLowerCase();
function hyphenFut(sym) {
  const S = up(sym).replace(/[^A-Z0-9-]/g, '');
  if (S.includes('-')) return S;
  if (S.endsWith('USDTM')) return S.slice(0, -5) + '-USDTM';
  return S;
}

// Keep minimal tracker cache (optional; not required by ledger)
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
  const key = hyphenFut(symbol);
  if (trackers.has(key)) return;
  trackers.set(key, {
    wasOpen: false,
    lastSide: null,
    lastEntry: null,
    lastExit: null,
    lastLeverage: null,
  });
}

// --- core sync: reconcile exchange vs ledger --------------------------------
async function syncOnce() {
  // 1) Pull live positions from exchange
  let live = [];
  try {
    live = await getOpenFuturesPositions(); // [{contract, side, entryPrice, size, leverage, markPrice, ...}]
  } catch (err) {
    console.warn('[posTracker] live fetch error:', err?.message || err);
    live = [];
  }

  // Build live set keyed by contract
  const liveBySymbol = new Map();
  for (const p of live || []) {
    const sym = hyphenFut(p.contract || p.symbol);
    if (!sym) continue;
    if (Number(p.size) > 0) liveBySymbol.set(sym, p);
  }

  // 2) Ensure every live position exists as OPEN in the ledger (record once)
  for (const [sym, p] of liveBySymbol) {
    initFuturesPositionTracker(sym);
    const side = low(p.side) === 'sell' ? 'sell' : 'buy';
    const entry = Number(p.entryPrice) || Number(p.avgEntryPrice) || Number(p.markPrice) || 0;
    const size = Number(p.size) || 0;
    const leverage = Number(p.leverage) || 5;

    // recordOpen is single-writer safe: it will no-op if that OPEN already exists
    if (entry > 0 && size > 0) {
      recordOpen({
        symbol: sym,
        side,
        entry,
        size,
        leverage,
        // multiplier not known here, defaults to 1 in ledger (OK)
        // carry TP/SL if your position object exposes them (optional)
        tpPercent: p.tpPercent ?? '',
        slPercent: p.slPercent ?? '',
        orderId: p.orderId || ''
      });
    }
  }

  // 3) Close any ledger OPEN rows no longer present on exchange
  //    (let ledger resolve exit via TA/mark fallback)
  let recent = [];
  try {
    // We only need OPENs; the list() helper is cheap and returns newest first
    recent = await list(500);
  } catch (_) {
    recent = [];
  }

  for (const row of recent) {
    if (up(row.status) !== 'OPEN') continue;
    const sym = hyphenFut(row.symbol);
    if (liveBySymbol.has(sym)) continue; // still live → leave OPEN

    // Not live anymore → close in ledger
    try {
      const closed = await closePosition({ symbol: sym, side: row.side });
      if (closed) {
        lastClosedTrade = {
          symbol: closed.symbol,
          side: up(closed.side) === 'SELL' ? 'SHORT' : 'LONG',
          entry: closed.entry,
          exit: closed.exit,
          pnlValue: closed.pnl,
          roi: closed.roi,
          date: closed.closedAt || new Date().toISOString()
        };
      }
    } catch (e) {
      console.warn('[posTracker] closePosition error:', e?.message || e);
    }
  }
}

// --- public API --------------------------------------------------------------
function fetchAllPositions() {
  // Kept for backward compatibility: perform one sync pass
  return syncOnce();
}

function resetAllTrackers() {
  trackers.clear();
}

function initPositionTrackingModule(intervalMs = 10_000) {
  // kick once, then interval
  syncOnce().catch(()=>{});
  if (globalThis.__POSEIDON_POS_TRACK_TIMER__) {
    clearInterval(globalThis.__POSEIDON_POS_TRACK_TIMER__);
  }
  globalThis.__POSEIDON_POS_TRACK_TIMER__ = setInterval(() => {
    syncOnce().catch(()=>{});
  }, Math.max(5_000, Number(intervalMs) || 10_000));
  console.log('📡 PositionTracker (ledger-first) started — interval', Math.max(5_000, Number(intervalMs) || 10_000), 'ms');
}

function getLastClosedTrade() {
  return { ...lastClosedTrade };
}

module.exports = {
  initFuturesPositionTracker,
  // updateTracker removed — ledger is the single writer
  fetchAllPositions,           // one-shot sync (kept name)
  resetAllTrackers,
  initPositionTrackingModule,  // start interval sync
  getLastClosedTrade,
};