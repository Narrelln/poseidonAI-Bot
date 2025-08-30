// server/feedBus.js
/* Robust feed event bus with backward-compat exports */
const { EventEmitter } = require('events');
const { normalizeFeed } = require('../core/feedTypes');

const FEED_MAX = Math.max(200, Number(process.env.FEED_MAX || 2000)); // cap lower bound to avoid tiny buffers

// Single shared bus for the whole process
const bus = new EventEmitter();
// Avoid MaxListeners warnings in dashboards with many SSE clients
if (typeof bus.setMaxListeners === 'function') bus.setMaxListeners(0);

// Ring buffer (newest at the end)
const ring = [];

/**
 * publish(rawFeedLike) -> normalizedItem
 * rawFeedLike may have { ts, type, level, symbol, msg, data, tags }
 */
function publish(raw = {}) {
  const item = normalizeFeed(raw);

  ring.push(item);
  if (ring.length > FEED_MAX) {
    // trim oldest in one splice to keep memory churn low
    ring.splice(0, ring.length - FEED_MAX);
  }

  bus.emit('feed', item);
  return item;
}

/**
 * history({ limit=200, since, type, symbol }) -> array
 * - since: ms timestamp; returns items strictly newer than this
 * - type: filter by normalized type (e.g. 'trade','decision',...)
 * - symbol: uppercased symbol (e.g. 'BTC-USDTM')
 */
function history({ limit = 200, since, type, symbol } = {}) {
  let items = ring;

  if (Number.isFinite(+since)) {
    const s = +since;
    items = items.filter(x => x.ts > s);
  }

  if (type) {
    const t = String(type).toLowerCase();
    items = items.filter(x => x.type === t);
  }

  if (symbol) {
    const s = String(symbol).toUpperCase();
    items = items.filter(x => String(x.symbol || '').toUpperCase() === s);
  }

  const lim = Math.max(1, Math.min(Number(limit) || 200, FEED_MAX));
  return items.slice(-lim);
}

/**
 * subscribe(fn) -> unsubscribe()
 * Subscribes to live 'feed' events. Returns an unsubscribe function.
 */
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  bus.on('feed', fn);
  return () => bus.off('feed', fn);
}

/** clear(): empties the ring buffer (does not affect subscribers) */
function clear() {
  ring.length = 0;
}

/* ---------- Backward-compat helpers (used by existing routes) ---------- */
/** getBuffer({ since }) matches older route usage */
function getBuffer({ since } = {}) {
  return history({ since, limit: FEED_MAX });
}

module.exports = {
  // primary API
  publish,
  history,
  subscribe,
  clear,

  // compat exports expected elsewhere
  bus,
  getBuffer,
};