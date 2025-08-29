// server/feedBus.js
const { EventEmitter } = require('events');

const bus = new EventEmitter();
const MAX_ITEMS = 1000;
const buffer = [];
let _id = 0;

function makeId() {
  _id = (_id + 1) >>> 0;
  return `${Date.now()}-${_id}`;
}

/**
 * publish({ type, level, symbol, msg, data, tags, corr, ts? })
 */
function publish(feed) {
  const item = {
    id: feed.id || makeId(),
    ts: Number.isFinite(feed.ts) ? feed.ts : Date.now(),
    type: String(feed.type || 'misc').toLowerCase(),
    level: String(feed.level || 'info').toLowerCase(),
    symbol: feed.symbol || 'SYSTEM',
    msg: feed.msg || feed.message || '',
    data: feed.data || {},
    tags: feed.tags || [],
    corr: feed.corr || null
  };
  buffer.push(item);
  if (buffer.length > MAX_ITEMS) buffer.shift();
  bus.emit('feed', item);
}

function getBuffer({ since } = {}) {
  if (!since) return buffer.slice();
  return buffer.filter(i => i.ts > since);
}

module.exports = { bus, publish, getBuffer };