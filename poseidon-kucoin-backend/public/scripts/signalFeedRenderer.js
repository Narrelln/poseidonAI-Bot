// /public/scripts/signalFeedRenderer.js
// Fills the "Signal Analysis" table (Time | Symbol | Signal | Confidence | Δ | Vol | Price)
// Caps at 50 rows, listens to the core feed bus (scanner/decision/ta).
// PATCH: block 'scanner' when bot is ON + cross-source de-duplication.

import { feed } from '/scripts/core/feeder.js';
import { percent24h } from '/scripts/core/percent.js';

const MAX_ROWS = 50;
let TBODY = null;

// --- bot state (listen to global event fired elsewhere e.g. scanner/bot module) ---
let BOT_ACTIVE = false;
window.addEventListener('poseidon:bot-state', (ev) => {
  BOT_ACTIVE = !!ev?.detail?.active;
});
// optional: seed from a global if you already expose one
if (typeof window.__poseidonBotActive === 'boolean') {
  BOT_ACTIVE = window.__poseidonBotActive;
}

function ensureTbody() {
  if (TBODY) return TBODY;
  const host = document.querySelector('#futures-signal-feed table');
  TBODY = host?.querySelector('tbody') || null;
  return TBODY;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function fmt(x, d = 4) {
  const n = num(x);
  return Number.isFinite(n) ? n.toFixed(d) : '--';
}
function fmtPct(x) {
  const n = num(x);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : '--';
}

function normalize(ev = {}) {
  // carry everything we might display
  const ts   = Number.isFinite(+ev.ts) ? +ev.ts : Date.now();
  const sym  = (ev.symbol || ev.sym || '--').toUpperCase();
  const msg  = ev.msg || ev.message || ev.data?.signal || '';
  const conf = ev.data?.confidence ?? ev.confidence ?? '';
  const price= ev.data?.price ?? ev.price ?? '';
  const vol  = ev.data?.volume ?? ev.volume ?? '';
  // allow delta to be injected by caller; otherwise compute if a ticker was attached
  let delta  = ev.data?.delta ?? ev.delta;
  if (!Number.isFinite(+delta) && ev.data?.ticker) {
    delta = percent24h(ev.data.ticker);
  }
  return { ts, sym, msg, conf, delta, vol, price };
}

// --- de-duplication across sources (scanner/decision/ta/sse) ---
const SEEN = new Map(); // key -> lastTs
const GC_EVERY = 200;   // run GC every N inserts
let seenCount = 0;

function makeKey(source, n) {
  const bucket = Math.floor(n.ts / 60000); // minute bucket
  return `${source}|${n.sym}|${String(n.msg).toUpperCase()}|${bucket}`;
}
function acceptOnce(source, n) {
  const k = makeKey(source, n);
  const last = SEEN.get(k);
  SEEN.set(k, n.ts);
  if (++seenCount % GC_EVERY === 0) {
    // simple GC: drop entries older than 5 minutes
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [key, ts] of SEEN) if (ts < cutoff) SEEN.delete(key);
  }
  return !last; // accept only the first in the current minute bucket
}

function addRow(n) {
  const body = ensureTbody();
  if (!body) return;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${new Date(n.ts).toLocaleTimeString()}</td>
    <td>${n.sym}</td>
    <td>${String(n.msg || '').toUpperCase()}</td>
    <td>${n.conf !== '' ? n.conf : '--'}</td>
    <td>${fmtPct(n.delta)}</td>
    <td>${fmt(n.vol, 2)}</td>
    <td>${fmt(n.price, 6)}</td>
  `;
  body.prepend(tr);
  while (body.rows.length > MAX_ROWS) body.deleteRow(body.rows.length - 1);
}

function makeHandler(source) {
  return (e) => {
    // When bot is ON, ignore scanner-originated events (bot/decision will own the feed)
    if (source === 'scanner' && BOT_ACTIVE) return;
    try {
      const n = normalize(e);
      if (!acceptOnce(source, n)) return; // de-dupe cross-source
      addRow(n);
    } catch {}
  };
}

// subscribe to bus with source-tagged handlers
feed.on?.('scanner',  makeHandler('scanner'));
feed.on?.('decision', makeHandler('decision'));
feed.on?.('ta',       makeHandler('ta'));
// keep catch-all but tag as '*'
feed.on?.('*',        makeHandler('*'));

// also accept SSE fallback if you have it (tag as 'sse')
try {
  const es = new EventSource('/api/feed/stream');
  es.addEventListener('feed', ev => {
    try { makeHandler('sse')(JSON.parse(ev.data)); } catch {}
  });
} catch {}