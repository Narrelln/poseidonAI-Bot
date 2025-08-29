// /public/scripts/strategyReasons.js  (ESM for the browser)

// small helper only for FE use
function formatVolBand(qv, minQV = 100_000, maxQV = 20_000_000) {
    const x = Number(qv);
    if (!(x > 0)) return 'turnover unknown';
    if (x < minQV) return `thin turnover (${(x / 1e3).toFixed(0)}K)`;
    if (x > maxQV) return `overheated turnover (${(x / 1e6).toFixed(1)}M)`;
    const human = x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : `${(x / 1e3).toFixed(0)}K`;
    return `healthy turnover ${human} USDT`;
  }
  
  export function buildEntryReasons({
    phase,
    confidence,
    quoteVolume,
    minQV = 100_000,
    maxQV = 20_000_000,
    manual = false
  } = {}) {
    const r = [];
    if (manual) r.push('manual entry');
  
    const c = Number(confidence);
    if (Number.isFinite(c)) {
      if (c >= 90) r.push('high conviction');
      else if (c >= 80) r.push('strong setup');
      else if (c >= 70) r.push('favorable setup');
    }
  
    if (phase?.phase) {
      if (phase.phase === 'reversal') r.push('momentum flip (reversal)');
      else if (phase.phase === 'impulse') r.push('fresh impulse');
      else r.push(`phase: ${phase.phase}`);
    }
  
    r.push(formatVolBand(quoteVolume, minQV, maxQV));
    return r;
  }
  
  export function buildExitReasons({
    hitTP = false,
    phase = null,
    weakening = false,
    trailing = false,
    capitalGuard = false
  } = {}) {
    const r = [];
    if (hitTP) r.push('target reached');
    if (weakening) r.push('momentum weakening');
    if (phase?.phase === 'reversal') r.push('reversal signal');
    if (phase?.phase === 'peak') r.push('peak tagged');
    if (trailing) r.push('trailing stop');
    if (capitalGuard) r.push('protect capital');
    if (r.length === 0) r.push('protect capital');
    return r;
  }