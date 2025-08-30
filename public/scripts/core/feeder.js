// /public/scripts/core/feeder.js
import { FEED_TYPES, normalizeFeed } from './feedTypes.js';

const _listeners = new Map();
function _emit(type, entry) {
  const any = _listeners.get('*'); if (any) for (const fn of any) try { fn(entry); } catch {}
  const set = _listeners.get(type); if (set) for (const fn of set) try { fn(entry); } catch {}
}
export function on(type, fn){ if(!_listeners.has(type)) _listeners.set(type,new Set()); _listeners.get(type).add(fn); }
export function off(type, fn){ _listeners.get(type)?.delete(fn); }

export const feed = {
  on, off,
  scanner(sym, msg, data = {}, level = 'info', tags = [], corrId = '') {
    const e = normalizeFeed({ type: FEED_TYPES.SCANNER, symbol: sym, level, message: msg, data, tags, corr: corrId });
    _emit('scanner', e); _emit('*', e);
  },
  ta(sym, msg, data = {}, level = 'info', tags = [], corrId = '') {
    const e = normalizeFeed({ type: FEED_TYPES.TA, symbol: sym, level, message: msg, data, tags, corr: corrId });
    _emit('ta', e); _emit('*', e);
  },
  decision(sym, msg, data = {}, level = 'info', tags = [], corrId = '') {
    const e = normalizeFeed({ type: FEED_TYPES.DECISION, symbol: sym, level, message: msg, data, tags, corr: corrId });
    _emit('decision', e); _emit('*', e);
  },
  trade(sym, msg, data = {}, level = 'success', tags = [], corrId = '') {
    const e = normalizeFeed({ type: FEED_TYPES.TRADE, symbol: sym, level, message: msg, data, tags, corr: corrId });
    _emit('trade', e); _emit('*', e);
  },
  error(sym, msg, data = {}, tags = [], corrId = '') {
    const e = normalizeFeed({ type: FEED_TYPES.ERROR, symbol: sym, level: 'error', message: msg, data, tags, corr: corrId });
    _emit('error', e); _emit('*', e);
  },
};