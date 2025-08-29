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
  const p = Number(pnl);
  const e = Number(entry);
  const q = Number(size);
  const lev = Number(leverage);

  // guards
  if (!isFinite(p) || !isFinite(e) || !isFinite(q) || !isFinite(lev) || e <= 0 || q <= 0 || lev <= 0) {
    return '';
  }

  // Cost (initial margin) = (entry * size) / leverage
  const cost = (e * q) / lev;
  if (!isFinite(cost) || cost <= 0) return '';

  const roiVal = (p / cost) * 100;
  if (!isFinite(roiVal)) return '';
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
  leverage = 5,
  tpPercent = null,
  slPercent = null
}) {
  let history = safeReadHistory();
  const time = timestamp ? new Date(timestamp) : new Date();

  // Clean fields
  symbol = safeField(typeof symbol === 'string' ? symbol.trim().toUpperCase() : symbol);
  side = safeField(typeof side === 'string' ? side.trim().toLowerCase() : side);

  if ((status || 'open').toUpperCase() === 'OPEN') {
    const exists = history.find(t =>
      t.symbol === symbol &&
      t.side === side &&
      t.status === 'OPEN' &&
      (!orderId || t.orderId === orderId)
    );
    if (exists) {
      console.warn(`⚠️ Duplicate OPEN trade for ${symbol} (${side}) with same orderId. Skipping record.`);
      return;
    }
  }

  const parsedEntry = (!isNaN(parseFloat(entry))) ? parseFloat(entry) : 0;
  const parsedExit = (!isNaN(parseFloat(exit))) ? parseFloat(exit) : 0;
  const safeSize = (!isNaN(size)) ? parseFloat(size) : 1;
  const safeLeverage = (!isNaN(leverage)) ? parseInt(leverage) : 5;

  const trueExit = (exit && !isNaN(parsedExit) && parsedExit !== 0) ? parsedExit : parsedEntry;

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
    tpPercent: (!isNaN(tpPercent) && tpPercent !== null) ? parseFloat(tpPercent) : '',
    slPercent: (!isNaN(slPercent) && slPercent !== null) ? parseFloat(slPercent) : ''
  };

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

    const trueExit = (exit && !isNaN(parsedExit) && parsedExit !== 0) ? parsedExit : parsedEntry;

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
    Object.keys(trade).forEach(k => {
      trade[k] = safeField(trade[k]);
    });
    return {
      ...trade,
      date: trade.date || prettyDate(trade.timestamp)
    };
  });
}

function getOpenTradesWithTPSL() {
  const history = safeReadHistory();

  return history
    .filter(t => String(t.status).toUpperCase() === 'OPEN')
    .map(t => {
      // accept both modern and legacy keys
      const tp = parseFloat(t.tpPercent ?? t.tp);
      const sl = parseFloat(t.slPercent ?? t.sl);

      // normalize numbers
      const entry = parseFloat(t.entry);
      const size  = parseFloat(t.size || 1);

      return {
        contract: t.symbol,                 // already stored in hyphen form
        side: String(t.side || '').toLowerCase(), // 'buy'|'sell' or 'long'|'short'
        entry: Number.isFinite(entry) ? entry : NaN,
        tpPercent: Number.isFinite(tp) ? tp : NaN,
        slPercent: Number.isFinite(sl) ? sl : NaN,
        size: Number.isFinite(size) ? size : 1
      };
    })
    // must have valid entry and both TP/SL > 0
    .filter(r =>
      Number.isFinite(r.entry) &&
      Number.isFinite(r.tpPercent) && r.tpPercent > 0 &&
      Number.isFinite(r.slPercent) && r.slPercent > 0 &&
      r.side
    );
}

module.exports = {
  recordTrade,
  closeTrade,
  getOpenTradesWithTPSL,
  getRecentTrades,
  safeReadHistory
};