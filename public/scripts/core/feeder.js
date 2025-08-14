// /public/scripts/core/feeder.js
// Tiny event bus + structured feed helpers

// ---- mini emitter ----
const _listeners = new Map(); // type => Set<fn>

function _emit(type, entry) {
  // wildcard first
  const any = _listeners.get('*');
  if (any) for (const fn of any) try { fn(entry); } catch {}
  // typed listeners
  const set = _listeners.get(type);
  if (set) for (const fn of set) try { fn(entry); } catch {}
}

function on(type, fn) {
  if (!_listeners.has(type)) _listeners.set(type, new Set());
  _listeners.get(type).add(fn);
}
function off(type, fn) {
  _listeners.get(type)?.delete(fn);
}

// ---- utils ----
function mk(sym, type, msg, data = {}, level = 'info', tags = [], corrId = '') {
  return {
    ts: Date.now(),
    symbol: sym || 'SYSTEM',
    type,           // 'scanner' | 'ta' | 'decision' | 'trade' | 'error'
    level,          // 'debug' | 'info' | 'warn' | 'success' | 'error'
    message: msg || '',
    data,
    tags: Array.isArray(tags) ? tags : [],
    corrId: String(corrId || '')
  };
}

// ---- API ----
export const feed = {
  on, off,

  scanner(sym, msg, data = {}, level = 'info', tags = [], corrId = '') {
    const e = mk(sym, 'scanner', msg, data, level, tags, corrId);
    _emit('scanner', e); _emit('*', e);
    if (level !== 'debug') console.log(`[FEED][scanner][${level}] ${sym}${corrId ? ' ('+corrId+')' : ''} → ${msg}`, data, tags);
  },

  ta(sym, msg, data = {}, level = 'info', tags = [], corrId = '') {
    const e = mk(sym, 'ta', msg, data, level, tags, corrId);
    _emit('ta', e); _emit('*', e);
    if (level !== 'debug') console.log(`[FEED][ta][${level}] ${sym}${corrId ? ' ('+corrId+')' : ''} → ${msg}`, data, tags);
  },

  decision(sym, msg, data = {}, level = 'info', tags = [], corrId = '') {
    const e = mk(sym, 'decision', msg, data, level, tags, corrId);
    _emit('decision', e); _emit('*', e);
    if (level !== 'debug') console.log(`[FEED][decision][${level}] ${sym}${corrId ? ' ('+corrId+')' : ''} → ${msg}`, data, tags);
  },

  trade(sym, msg, data = {}, level = 'success', tags = [], corrId = '') {
    const e = mk(sym, 'trade', msg, data, level, tags, corrId);
    _emit('trade', e); _emit('*', e);
    console.log(`[FEED][trade][${level}] ${sym}${corrId ? ' ('+corrId+')' : ''} → ${msg}`, data, tags);
  },

  error(sym, msg, data = {}, tags = [], corrId = '') {
    const e = mk(sym, 'error', msg, data, 'error', tags, corrId);
    _emit('error', e); _emit('*', e);
    console.error(`[FEED][error] ${sym}${corrId ? ' ('+corrId+')' : ''} → ${msg}`, data, tags);
  },
};