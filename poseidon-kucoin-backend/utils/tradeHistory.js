// utils/tradeHistory.js

const fs = require('fs');
const path = require('path');
const HISTORY_FILE = path.join(__dirname, 'data', 'tradeHistory.json');

const dataDir = path.dirname(HISTORY_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]');

// Helper: always return "" for any undefined, null, or dash
function safeField(val) {
  if (!val || val === '-' || val === 'null' || val === 'undefined') return '';
  if (typeof val === 'string' && val.trim() === '-') return '';
  return val;
}

// Cleans ALL '-' from loaded history
function safeReadHistory() {
  try {
    const text = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const arr = JSON.parse(text) || [];
    return arr.map(obj => {
      Object.keys(obj).forEach(k => {
        if (!obj[k] || obj[k] === '-' || obj[k] === 'null' || obj[k] === 'undefined' || (typeof obj[k] === 'string' && obj[k].trim() === '-')) {
          obj[k] = '';
        }
      });
      return obj;
    });
  } catch (err) {
    console.error("⚠️ Trade history read error:", err);
    return [];
  }
}

function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function computeROI(pnl, entry, size, leverage) {
  if (!entry || !size || isNaN(pnl) || isNaN(entry) || isNaN(size) || entry === 0 || size === 0) return '';
  if (typeof pnl === 'string') pnl = parseFloat(pnl);
  if (typeof entry === 'string') entry = parseFloat(entry);
  if (typeof size === 'string') size = parseFloat(size);
  if (typeof leverage === 'string') leverage = parseFloat(leverage);
  if (!isFinite(pnl) || !isFinite(entry) || !isFinite(size) || !isFinite(leverage)) return '';
  const roiVal = ((pnl / (entry * size)) * leverage * 100);
  if (Math.abs(roiVal) > 200) return '';
  return roiVal.toFixed(2) + '%';
}

function recordTrade({
  symbol,
  side,
  entry,
  exit = null,
  pnl = null,
  pnlPercent = null,
  status = 'open',
  timestamp,
  orderId = null,
  size = 1,
  leverage = 5
}) {
  let history = safeReadHistory();
  const time = timestamp ? new Date(timestamp) : new Date();

  // Clean fields
  symbol = safeField(typeof symbol === 'string' ? symbol.trim().toUpperCase() : symbol);
  side = safeField(typeof side === 'string' ? side.trim().toLowerCase() : side);

  if ((status || 'open').toUpperCase() === 'OPEN') {
    if (history.find(t => t.symbol === symbol && t.side === side && t.status === 'OPEN')) {
      console.warn(`⚠️ Trade for ${symbol} (${side}) already open, not recording duplicate.`);
      return;
    }
  }

  const parsedEntry = (!isNaN(parseFloat(entry))) ? parseFloat(entry) : 0;
  const parsedExit = (!isNaN(parseFloat(exit))) ? parseFloat(exit) : 0;
  const safeSize = (!isNaN(size)) ? parseFloat(size) : 1;
  const safeLeverage = (!isNaN(leverage)) ? parseInt(leverage) : 5;

  // If exit is missing or zero, fallback to entry (break-even)
  const trueExit = (exit && !isNaN(parsedExit) && parsedExit !== 0) ? parsedExit : parsedEntry;

  // --- Calculate PNL based on direction ---
  let computedPnl = 0;
  if (side === 'sell') {
    computedPnl = (parsedEntry - trueExit) * safeSize;
  } else {
    computedPnl = (trueExit - parsedEntry) * safeSize;
  }
  const computedPnlPercent = parsedEntry > 0 ? ((computedPnl / parsedEntry) * 100).toFixed(2) + '%' : '';
  const roi = computeROI(computedPnl, parsedEntry, safeSize, safeLeverage);

  const trade = {
    symbol: safeField(symbol),
    side: safeField(side),
    entry: parsedEntry ? parsedEntry.toFixed(4) : '',
    exit: trueExit ? trueExit.toFixed(4) : '',
    pnl: (!isNaN(pnl) && pnl !== null && pnl !== undefined && pnl !== '' && pnl !== '-') ? parseFloat(pnl).toFixed(4) : (computedPnl !== undefined ? computedPnl.toFixed(4) : ''),
    pnlPercent: pnlPercent || computedPnlPercent,
    roi: roi || '',
    size: safeSize ? safeSize : '',
    leverage: safeLeverage ? safeLeverage : '',
    orderId: orderId || '',
    status: (status || 'open').toUpperCase(),
    timestamp: time.toISOString(),
    date: prettyDate(time),
  };
  // Final sanitize ALL fields in the trade object
  Object.keys(trade).forEach(k => {
    trade[k] = safeField(trade[k]);
  });

  history.unshift(trade);
  if (history.length > 100) history = history.slice(0, 100);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log("📩 Trade recorded:", trade);
}

function closeTrade(symbol, closeSide, exit, pnl, pnlPercent) {
  let history = safeReadHistory();
  const normSide = (closeSide || '').toLowerCase();

  let idx = history.findIndex(t =>
    t.symbol === symbol &&
    t.status === 'OPEN' &&
    (t.side || '').toLowerCase() === normSide
  );
  if (idx === -1) {
    idx = history.findIndex(t =>
      t.symbol === symbol &&
      t.status === 'OPEN'
    );
  }

  if (idx !== -1) {
    const parsedEntry = (!isNaN(parseFloat(history[idx].entry))) ? parseFloat(history[idx].entry) : 0;
    const parsedExit = (!isNaN(parseFloat(exit))) ? parseFloat(exit) : parsedEntry;
    const safeSize = (!isNaN(history[idx].size)) ? parseFloat(history[idx].size) : 1;
    const safeLeverage = (!isNaN(history[idx].leverage)) ? parseInt(history[idx].leverage) : 5;
    const side = (history[idx].side || '').toLowerCase();

    // Always use real exit or fallback to entry
    const trueExit = (exit && !isNaN(parsedExit) && parsedExit !== 0) ? parsedExit : parsedEntry;

    // Correct PNL based on direction
    let truePnl = (!isNaN(pnl) && pnl !== null && pnl !== '' && pnl !== undefined && pnl !== '-') ? parseFloat(pnl) : 0;
    if (typeof pnl === 'undefined' || pnl === null || pnl === '' || pnl === '-' || isNaN(truePnl)) {
      truePnl = (side === 'sell')
        ? (parsedEntry - trueExit) * safeSize
        : (trueExit - parsedEntry) * safeSize;
    }
    const truePnlPercent = parsedEntry > 0 ? ((truePnl / parsedEntry) * 100).toFixed(2) + '%' : '';
    const roi = computeROI(truePnl, parsedEntry, safeSize, safeLeverage);

    history[idx].exit = trueExit ? trueExit.toFixed(4) : '';
    history[idx].pnl = truePnl !== undefined ? truePnl.toFixed(4) : '';
    history[idx].pnlPercent = pnlPercent || truePnlPercent;
    history[idx].roi = roi || '';
    history[idx].status = 'CLOSED';
    history[idx].closedAt = new Date().toISOString();
    history[idx].date = prettyDate(history[idx].closedAt);

    // Clean all fields
    Object.keys(history[idx]).forEach(k => {
      history[idx][k] = safeField(history[idx][k]);
    });

    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    console.log("✅ Trade closed:", history[idx]);
  } else {
    console.warn("❌ No matching open trade found for", symbol, "side:", closeSide);
  }
}

function getRecentTrades(limit = 10) {
  let history = safeReadHistory();
  return history.slice(0, limit).map(trade => {
    // Clean on output as well
    Object.keys(trade).forEach(k => {
      trade[k] = safeField(trade[k]);
    });
    return {
      ...trade,
      date: trade.date || prettyDate(trade.timestamp)
    };
  });
}

module.exports = {
  recordTrade,
  closeTrade,
  getRecentTrades,
  safeReadHistory
};