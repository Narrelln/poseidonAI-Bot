// Helper: escape HTML to avoid injection
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, s =>
    ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[s]));
}

// Helper: ensure table exists with given class and headers, return tbody
function ensureTable(container, tableClass, headersHtml) {
  let table = container.querySelector('table');
  if (!table) {
    container.innerHTML = `<table class="${tableClass}"><thead>${headersHtml}</thead><tbody></tbody></table>`;
    table = container.querySelector('table');
  }
  return table.querySelector('tbody');
}

export function logToLiveFeed({ symbol = 'SYSTEM', message = '', type = 'info' }) {
  const container = document.getElementById('futures-log-feed');
  if (!container) return;

  const tbody = ensureTable(container, 'log-table', `
    <tr><th>Time</th><th>Symbol</th><th>Message</th></tr>
  `);
  if (!tbody) return;

  const time = new Date().toLocaleTimeString();
  const row = document.createElement('tr');
  row.className = `log-entry log-${escapeHtml(type)}`;
  row.innerHTML = `
    <td>${escapeHtml(time)}</td>
    <td>${escapeHtml(symbol)}</td>
    <td>${escapeHtml(message)}</td>
  `;
  tbody.prepend(row);

  if (tbody.children.length > 50) tbody.removeChild(tbody.lastChild);
}

export function logSignalToFeed({ symbol = '--', confidence = '--', signal = '', delta = '', volume = '', price = '' }) {
  const container = document.getElementById('futures-signal-feed');
  if (!container) return;

  const tbody = ensureTable(container, 'signal-table', `
    <tr>
      <th>Time</th><th>Symbol</th><th>Signal</th><th>Confidence</th><th>Δ</th><th>Vol</th><th>Price</th>
    </tr>
  `);
  if (!tbody) return;

  const time = new Date().toLocaleTimeString();
  const safeSignal = typeof signal === 'string' ? signal.toLowerCase() : 'neutral';

  const row = document.createElement('tr');
  row.classList.add(safeSignal);

  row.innerHTML = `
    <td>${escapeHtml(time)}</td>
    <td>${escapeHtml(symbol)}</td>
    <td class="signal-${safeSignal}">${escapeHtml(signal.toUpperCase())}</td>
    <td class="${parseInt(confidence) >= 45 ? 'high-confidence' : ''}">${escapeHtml(confidence)}%</td>
    <td class="${parseFloat(delta) > 0 ? 'delta-positive' : 'delta-negative'}">${escapeHtml(delta)}</td>
    <td>$${escapeHtml(volume)}</td>
    <td>$${escapeHtml(price)}</td>
  `;

  tbody.prepend(row);

  if (tbody.children.length > 50) {
    [...tbody.children].slice(50).forEach(r => r.remove());
  }
}

export function logDetailedAnalysisFeed(result = {}) {
  const container = document.getElementById('futures-log-feed');
  if (!container) return;

  const tbody = ensureTable(container, 'log-table', `
    <tr>
      <th>Symbol</th><th>Signal</th><th>RSI</th><th>MACD</th><th>BB</th><th>Confidence</th><th>Notes</th>
    </tr>
  `);
  if (!tbody) return;

  const {
    symbol = '--',
    signal = '--',
    rsi = '--',
    macd = {},
    bb = {},
    confidence = '--',
    volumeSpike = false,
    trapWarning = false
  } = result;

  const macdValue = macd && typeof macd.MACD === 'number' ? macd.MACD.toFixed(2) : '--';
  const bbStatus = bb?.breakout ? 'Breakout' : '--';
  const rsiValue = rsi !== undefined ? rsi : '--';
  const confValue = confidence !== undefined ? `${confidence}%` : '--';

  const notes = [];
  if (volumeSpike) notes.push('🔊 Vol Spike');
  if (trapWarning) notes.push('⚠️ Trap');

  const trendClass = signal?.toLowerCase() === 'bullish' ? 'log-green' :
                     signal?.toLowerCase() === 'bearish' ? 'log-red' : 'log-gray';

  const row = document.createElement('tr');
  row.className = `log-entry log-analysis ${trendClass}`;

  const cells = [
    symbol,
    signal?.toUpperCase(),
    rsiValue,
    macdValue,
    bbStatus,
    confValue,
    notes.join(' ')
  ];

  row.innerHTML = cells.map(val => `<td>${escapeHtml(val)}</td>`).join('');
  tbody.prepend(row);

  if (tbody.children.length > 50) {
    [...tbody.children].slice(50).forEach(r => r.remove());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const filter = document.getElementById('feed-filter');
  if (filter) {
    filter.addEventListener('change', () => {
      const value = filter.value;
      document.querySelectorAll('#futures-log-feed .log-entry').forEach(row => {
        row.style.display = value === 'all' || row.classList.contains(`log-${value}`) ? '' : 'none';
      });
    });
  }
});