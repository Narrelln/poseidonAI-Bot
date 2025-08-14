// /public/scripts/utils/logger.js
const lastSeen = new Map();

export const LOG = {
  level: 'info', // 'debug' | 'info' | 'warn' | 'error'

  // suppress identical messages within a window per key
  dedupe(key, windowMs = 10000) {
    const now = Date.now();
    const last = lastSeen.get(key) || 0;
    if (now - last < windowMs) return true;
    lastSeen.set(key, now);
    return false;
  },

  debug(...a){ if (this.level === 'debug') console.debug(...a); },
  info (...a){ if (['debug','info'].includes(this.level)) console.log(...a); },
  warn (...a){ if (['debug','info','warn'].includes(this.level)) console.warn(...a); },
  error(...a){ console.error(...a); }
};