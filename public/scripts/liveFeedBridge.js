// Bridge: structured feed -> existing Live Futures Feed table (no layout change)
import { feed } from '/scripts/core/feeder.js';

const TBODY = document.querySelector('#futures-log-feed .signal-table tbody');
const MAX_ROWS = 120;

function addRow({symbol, msg, level, data}) {
  if (!TBODY) return;

  // prefer TA fields if present
  const rsi   = data?.rsi ?? '--';
  const macd  = data?.macd ?? (data?.macdSignal ?? '--');
  const bb    = data?.bb ?? (data?.bbSignal ?? '--');
  const conf  = data?.confidence ?? data?.confServer ?? '--';

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${new Date().toLocaleTimeString()}</td>
    <td>${symbol || '--'}</td>
    <td>${(data?.signal || msg || '--').toString().toUpperCase()}</td>
    <td>${rsi}</td>
    <td>${macd}</td>
    <td>${bb}</td>
    <td>${typeof conf === 'number' ? `${conf}%` : conf}</td>
  `;

  TBODY.prepend(tr);
  // cap rows
  while (TBODY.rows.length > MAX_ROWS) TBODY.deleteRow(TBODY.rows.length - 1);
}

// map all structured events into the table
function hook() {
  const handler = e => addRow(e);

  feed.on?.('*', handler);         // if your feed supports wildcard
  // Fallback if no wildcard:
  feed.scanner && feed.on?.('scanner', handler);
  feed.ta && feed.on?.('ta', handler);
  feed.decision && feed.on?.('decision', handler);
  feed.trade && feed.on?.('trade', handler);
  feed.error && feed.on?.('error', handler);
}

hook();