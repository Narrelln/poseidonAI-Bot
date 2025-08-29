// /public/scripts/liveFeedRenderer.js
// Unified Live Feed with modes: fun | serious | classic(table)
// - Throttle + de‑dupe so floods don’t overwhelm
/* eslint-disable no-console */

// ===== Config =====
const MODE_KEY     = 'poseidon_feed_mode';
const MAX_BUFFER   = 300;   // memory buffer for re-render on mode switch
const MAX_VISIBLE  = 50;    // hard cap requested
const LINES_PER_SEC= 6;     // throttle to ~6 lines/second
const DEDUPE_MS    = 5000;  // merge identical lines inside this window (ms)
const MIN_LEVEL    = 'info';// drop super‑noisy logs by level: 'debug'|'info'|'warn'|'success'|'error'

// ===== Level gating =====
const LEVEL_RANK = { debug:0, info:1, warn:2, success:3, error:4 };
const allowLevel = (lvl) => LEVEL_RANK[(lvl||'info')] >= LEVEL_RANK[MIN_LEVEL];

// ===== State =====
let MODE   = 'serious'; // fun | serious | classic
let BUFFER = [];        // newest at end [{ts,type,level,symbol,msg,tags,data}]
let HOST   = null;      // #futures-log-feed
let STORY  = null;      // .story-feed (div)
let TABLE  = null;      // <table> element
let TBODY  = null;      // table tbody

// throttle state
let QUEUE = [];                  // pending paints
let drainTimer = null;           // setInterval handle
const SEEN = new Map();          // key -> { ts, count, lastDom }

// ===== DOM helpers =====
function host() {
  if (!HOST) HOST = document.getElementById('futures-log-feed');
  return HOST;
}
function ensureStoryHost() {
  const h = host();
  if (!h) return null;
  if (TABLE) TABLE.style.display = 'none';
  let wrap = h.querySelector('.story-feed');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'story-feed';
    h.appendChild(wrap);
  }
  wrap.style.display = '';
  STORY = wrap;
  return STORY;
}
function ensureClassicTable() {
  const h = host();
  if (!h) return null;
  const existingStory = h.querySelector('.story-feed');
  if (existingStory) existingStory.style.display = 'none';
  let table = h.querySelector('table.feed-table');
  if (!table) {
    h.innerHTML = `
      <table class="feed-table">
        <thead>
          <tr>
            <th style="width:120px">Time</th>
            <th style="width:110px">Type</th>
            <th style="width:90px">Level</th>
            <th style="width:140px">Symbol</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>`;
    table = h.querySelector('table.feed-table');
  }
  table.style.display = '';
  TABLE = table;
  TBODY = table.querySelector('tbody');
  return TBODY;
}

// ===== Normalization + filter =====
function normalize(e = {}) {
  const ts = Number.isFinite(+e.ts) ? +e.ts : Date.now();
  const type = String(e.type || e.category || 'misc').toLowerCase();
  const level = String(e.level || 'info').toLowerCase();
  const symbol = (e.symbol || e.sym || 'SYSTEM').toUpperCase();
  const tags = Array.isArray(e.tags) ? e.tags : [];
  const data = e.data || {};
  const msg = e.msg || e.message || data.signal || '';
  return { ts, type, level, symbol, tags, data, msg };
}
function passFilter(e) {
  const sel = document.getElementById('feed-filter');
  if (!sel) return true;
  const v = sel.value;
  if (v === 'all') return true;
  if (v === 'decision') return e.type === 'decision';
  if (v === 'analysis') return e.type === 'ta' || e.type === 'decision';
  if (v === 'memory') return e.tags.includes('memory');
  if (v === 'ppda') return e.tags.includes('ppda');
  if (v === 'hot') return e.tags.includes('hot') || e.level === 'success';
  return true;
}

// ===== Painters =====
function addStoryLine(text, classes = []) {
  const wrap = ensureStoryHost();
  if (!wrap) return null;

  const div = document.createElement('div');
  div.className = `story-line ${classes.join(' ')}`.trim();

  // de-dupe badge container (hidden unless count > 1)
  const txt = document.createElement('span');
  txt.className = 'txt';
  txt.textContent = text;

  const count = document.createElement('span');
  count.className = 'count';
  count.hidden = true;

  div.appendChild(txt);
  div.appendChild(count);
  wrap.appendChild(div);

  while (wrap.children.length > MAX_VISIBLE) wrap.removeChild(wrap.firstChild);

  const h = host();
  if (h) h.scrollTop = h.scrollHeight;

  return div;
}
async function renderStoryLine(e) {
  try {
    const { renderByMode } = await import('/scripts/funTemplates.js');
    const line = renderByMode(MODE, e);
    const classes = [
      `t-${e.type}`,
      `lv-${e.level}`,
      (e.symbol.includes('BTC') || e.symbol.includes('ETH')) ? 'major' : ''
    ].filter(Boolean);
    return addStoryLine(line, classes);
  } catch (err) {
    const time = new Date(e.ts).toLocaleTimeString();
    return addStoryLine(`${time} ${e.symbol} ${e.type}: ${e.msg || ''}`);
  }
}
function rowHtml(e) {
  const time = new Date(e.ts).toLocaleTimeString();
  return `
    <tr class="log-entry log-${e.level} type-${e.type}">
      <td>${time}</td>
      <td>${e.type}</td>
      <td>${e.level}</td>
      <td>${e.symbol}</td>
      <td>${e.msg || ''}</td>
    </tr>`;
}
function addClassicRow(e) {
  const body = ensureClassicTable();
  if (!body) return;
  body.insertAdjacentHTML('afterbegin', rowHtml(e));
  while (body.rows.length > MAX_VISIBLE) body.deleteRow(body.rows.length - 1);
}

// ===== Throttle + de‑dupe =====
const keyOf = (e) => `${e.type}|${e.level}|${e.symbol}|${e.msg}`;

async function paintOne(e) {
  // de‑dupe within DEDUPE_MS
  const key = keyOf(e);
  const now = Date.now();
  const rec = SEEN.get(key);
  if (rec && now - rec.ts < DEDUPE_MS && rec.lastDom) {
    rec.ts = now;
    rec.count = (rec.count || 1) + 1;
    const badge = rec.lastDom.querySelector('.count');
    if (badge) { badge.hidden = false; badge.textContent = `×${rec.count}`; }
    SEEN.set(key, rec);
    return;
  }

  let dom = null;
  if (MODE === 'classic') {
    addClassicRow(e);
  } else {
    dom = await renderStoryLine(e);
  }
  SEEN.set(key, { ts: now, count: 1, lastDom: dom });
}

function startDrainer() {
  if (drainTimer) return;
  const perTick = Math.max(1, Math.round(LINES_PER_SEC / 5)); // 5 ticks/sec
  drainTimer = setInterval(async () => {
    for (let i = 0; i < perTick && QUEUE.length; i++) {
      await paintOne(QUEUE.shift());
    }
  }, 200);
}

// ===== Mode switching (your logic, with repaint via queue) =====
function setMode(mode) {
  const m = (mode === 'fun' || mode === 'classic') ? mode : 'serious';
  MODE = m;
  window.POSEIDON_FEED_MODE = MODE;
  try { localStorage.setItem(MODE_KEY, MODE); } catch {}
  const h = host();
  h?.classList.toggle('mode-fun', MODE === 'fun');
  h?.classList.toggle('mode-serious', MODE === 'serious');
  h?.classList.toggle('mode-classic', MODE === 'classic');
  const btn = document.getElementById('feed-mode-toggle');
  if (btn) btn.textContent =
    MODE === 'fun' ? '🎉 Fun' :
    MODE === 'classic' ? '📋 Classic' :
    '🧱 Serious';

  // clear and repaint last visible slice through the throttler
  if (MODE === 'classic') {
    ensureClassicTable();
    TBODY.innerHTML = '';
  } else {
    ensureStoryHost();
    STORY.innerHTML = '';
  }
  const slice = BUFFER.slice(-MAX_VISIBLE).filter(passFilter);
  QUEUE = [];
  slice.forEach(e => QUEUE.push(e));
  startDrainer();
}
function toggleMode() {
  setMode(MODE === 'fun' ? 'classic' : MODE === 'classic' ? 'serious' : 'fun');
}
window.setMode = setMode;
window.toggleMode = toggleMode;

// ===== Buffer + ingest =====
function pushToBuffer(e) {
  BUFFER.push(e);
  if (BUFFER.length > MAX_BUFFER) BUFFER.splice(0, BUFFER.length - MAX_BUFFER);
}
async function handleEvent(raw) {
  const e = normalize(raw);
  if (!allowLevel(e.level)) return;
  pushToBuffer(e);
  if (!passFilter(e)) return;

  // 🔕 Live Feed no longer mirrors into Signal Analysis
  // (Signal table is fully owned by /public/scripts/signalFeedRenderer.js)

  QUEUE.push(e);
  startDrainer();
}

// ===== Subscriptions =====
function subscribeBus() {
  import('/scripts/core/feeder.js').then(mod => {
    const bus = mod?.feed;
    if (!bus || !bus.on) return;
    const handler = (ev) => { try { handleEvent(ev); } catch {} };
    try { bus.on('*', handler); } catch {}
    ['scanner','signal','ta','decision','trade','analysis','error']
      .forEach(t => bus.on?.(t, handler));
  }).catch(()=>{});
}
function subscribeSSE() {
  try {
    const es = new EventSource('/api/feed/stream');
    es.addEventListener('feed', ev => { try { handleEvent(JSON.parse(ev.data)); } catch {} });
  } catch {}
}

// ===== Back‑compat publishers (unchanged) =====
function publishCompat(channel, payload) {
  import('/scripts/core/feeder.js').then(mod => {
    const f = mod?.feed; if (!f) return;
    const symbol = payload.symbol || 'SYSTEM';
    const msg = payload.message || payload.msg || '';
    const data = { ...payload };
    delete data.symbol; delete data.message; delete data.msg;
    switch ((channel || '').toLowerCase()) {
      case 'signal': case 'scanner': f.scanner(symbol, msg, data, 'info'); break;
      case 'decision': case 'analysis': f.decision(symbol, msg, data, 'info'); break;
      case 'trade': case 'success': f.trade(symbol, msg, data, 'success'); break;
      case 'error': case 'warn': f.error(symbol, msg, data); break;
      default: f.ta(symbol, msg, data, 'info'); break;
    }
  }).catch(()=>{});
}
export function logToLiveFeed({ symbol='SYSTEM', message='', type='info', level }) {
  publishCompat(level || type, { symbol, message });
}
export function logSignalToFeed({ symbol='--', confidence='--', signal='', delta='', volume='', price='' }) {
  // Keeping this for back-compat if other modules call it,
  // but it only publishes to the bus; Signal table is no longer updated here.
  publishCompat('scanner', {
    symbol, msg: String(signal||'').toUpperCase(),
    signal, confidence, delta, volume, price,
    data: { signal, confidence, delta, volume, price }
  });
}
export function logDetailedAnalysisFeed(result = {}) {
  const {
    symbol='--', signal='--', rsi='--',
    macd={}, macdSignal, bb={}, bbSignal, confidence='--',
    volumeSpike=false, trapWarning=false
  } = result;
  publishCompat('analysis', {
    symbol,
    message: String(signal||'').toUpperCase(),
    signal, rsi, macd, macdSignal, bb, bbSignal, confidence, volumeSpike, trapWarning,
    data: { signal, rsi, macd, macdSignal, bb, bbSignal, confidence, volumeSpike, trapWarning }
  });
}

// ===== Boot =====
function boot() {
  host();
  const saved = (localStorage.getItem(MODE_KEY) || 'serious');
  setMode(saved);
  const modeBtn = document.getElementById('feed-mode-toggle');
  if (modeBtn) modeBtn.addEventListener('click', toggleMode);
  document.getElementById('feed-filter')?.addEventListener('change', () => setMode(MODE));
  subscribeBus();
  subscribeSSE();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}