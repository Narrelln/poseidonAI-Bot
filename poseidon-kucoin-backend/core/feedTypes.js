// /core/feedTypes.js
const FEED_TYPES = Object.freeze({
  SCANNER:  'scanner',
  TA:       'ta',
  DECISION: 'decision',
  TRADE:    'trade',
  TP:       'tp',        // ✅ added: dedicated TP channel (used by TP manager/UI)
  ERROR:    'error',
  SYSTEM:   'system',
});

function makeFeed({
  type,
  level = 'info',
  symbol = 'SYSTEM',
  msg = '',
  data = {},
  tags = [],
  corr = null,
  ts = Date.now(),
}) {
  const t = String(type || '').toLowerCase();
  const valid = new Set(Object.values(FEED_TYPES));
  const finalType = valid.has(t) ? t : FEED_TYPES.SYSTEM;

  return {
    ts: Number.isFinite(+ts) ? +ts : Date.now(),
    type: finalType,
    level: String(level || 'info').toLowerCase(),
    symbol,
    msg,
    data,
    tags,
    corr,
  };
}

/**
 * Normalize an arbitrary feed-like object into a consistent shape
 * (used by frontend liveFeedRenderer & scannerPanel).
 */
function normalizeFeed(e = {}) {
  const ts = Number.isFinite(+e.ts) ? +e.ts : Date.now();
  const type = String(e.type || e.category || 'system').toLowerCase();
  const level = String(e.level || 'info').toLowerCase();
  const symbol = (e.symbol || e.sym || 'SYSTEM').toUpperCase();
  const tags = Array.isArray(e.tags) ? e.tags : [];
  const data = e.data || {};
  const msg  = e.msg || e.message || data.signal || '';
  return { ts, type, level, symbol, tags, data, msg };
}

// CommonJS for backend
module.exports = { FEED_TYPES, makeFeed, normalizeFeed };
// ESM for frontend (in /public/scripts/feedTypes.js, use export instead)