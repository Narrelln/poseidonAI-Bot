// /public/scripts/poseidonScheduler.js — symbol-aware session gating

let _cache = { plan:null, ts:0 };
const CACHE_MS = 5 * 60 * 1000;

function nowUTC() { return new Date(); }
function hourUTC(d) { return d.getUTCHours(); }
function baseFromSymbol(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[-_]/g, '')
    .replace(/USDTM?$/, '');
}

export async function getSessionPlan(force = false) {
  const fresh = _cache.plan && (Date.now() - _cache.ts < CACHE_MS);
  if (fresh && !force) return _cache.plan;
  try {
    const r = await fetch('/api/session-plan', { cache:'no-store' });
    const j = await r.json();
    if (j?.success) {
      _cache = { plan:j, ts:Date.now() };
      return j;
    }
  } catch {}
  return _cache.plan || {
    success:false, tz:'UTC',
    allowHoursGlobal:[], avoidHoursGlobal:[],
    perSymbol:{}, cooling:false
  };
}

/**
 * shouldTradeNow({ symbol, manual })
 * - If symbol-specific hours exist → use them
 * - else fallback to global hours
 * - manual=true bypasses the gate (you can change this)
 */
export async function shouldTradeNow({ symbol, manual = false } = {}) {
  if (manual) return true;

  const plan = await getSessionPlan();
  if (!plan || plan.cooling) return false;

  const h = hourUTC(nowUTC());
  const base = symbol ? baseFromSymbol(symbol) : null;

  // 1) Per-symbol rule (if learned)
  if (base && plan.perSymbol && plan.perSymbol[base]) {
    const ps = plan.perSymbol[base];
    if (Array.isArray(ps.allowHours) && ps.allowHours.length) {
      return ps.allowHours.includes(h);
    }
    if (Array.isArray(ps.avoidHours) && ps.avoidHours.length) {
      return !ps.avoidHours.includes(h);
    }
    // if we have the symbol but hours were not confidently learned → defer to global
  }

  // 2) Global fallback
  if (Array.isArray(plan.allowHoursGlobal) && plan.allowHoursGlobal.length) {
    return plan.allowHoursGlobal.includes(h);
  }
  if (Array.isArray(plan.avoidHoursGlobal) && plan.avoidHoursGlobal.length) {
    return !plan.avoidHoursGlobal.includes(h);
  }
  return true;
}

export function explainSessionNow(symbol) {
  const d = nowUTC();
  const h = hourUTC(d);
  const s = _cache.plan;
  const base = symbol ? baseFromSymbol(symbol) : null;
  const sym = base && s?.perSymbol ? s.perSymbol[base] : null;

  return {
    nowUTC: d.toISOString(),
    hour: h,
    cooling: !!s?.cooling,
    tz: s?.tz || 'UTC',
    global: {
      allow: s?.allowHoursGlobal || [],
      avoid: s?.avoidHoursGlobal || [],
    },
    symbol: base ? {
      base,
      allow: sym?.allowHours || [],
      avoid: sym?.avoidHours || [],
      trades: sym?.trades || 0
    } : null
  };
}

// DevTools helpers
window.poseidonPlan = async () => await getSessionPlan(true);
window.poseidonShouldTradeNow = async (s) => ({ ok: await shouldTradeNow({ symbol:s }), info: explainSessionNow(s) });