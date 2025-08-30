// ESM for the browser
export const FEED_TYPES = Object.freeze({
    SCANNER:  'scanner',
    TA:       'ta',
    DECISION: 'decision',
    TRADE:    'trade',
    ERROR:    'error',
    SYSTEM:   'system', // fallback
  });
  
  export function makeFeed({
    type,
    level  = 'info',
    symbol = 'SYSTEM',
    msg    = '',
    data   = {},
    tags   = [],
    corr   = null,
    ts     = Date.now(),
  } = {}) {
    const valid = new Set(Object.values(FEED_TYPES));
    const t = String(type || '').toLowerCase();
    const finalType = valid.has(t) ? t : FEED_TYPES.SYSTEM;
  
    return {
      ts: Number.isFinite(+ts) ? +ts : Date.now(),
      type:  finalType,
      level: String(level || 'info').toLowerCase(),
      symbol,
      msg,
      data,
      tags,
      corr,
    };
  }
  
  /**
   * Normalize any feed-like object to a consistent shape used by the UI.
   */
  export function normalizeFeed(e = {}) {
    const ts     = Number.isFinite(+e.ts) ? +e.ts : Date.now();
    const type   = String(e.type || e.category || 'system').toLowerCase();
    const level  = String(e.level || 'info').toLowerCase();
    const symbol = (e.symbol || e.sym || 'SYSTEM').toUpperCase();
    const tags   = Array.isArray(e.tags) ? e.tags : [];
    const data   = e.data || {};
    const msg    = e.msg || e.message || data.signal || '';
    return { ts, type, level, symbol, tags, data, msg };
  }