// handlers/strategyReasons.js
// Shared concise reason builders for feeds / logs (backend copy)

function formatVolBand(qv, minQV, maxQV) {
    if (!(qv > 0)) return 'turnover unknown';
    if (qv < minQV) return `thin turnover (${(qv/1e3).toFixed(0)}K)`;
    if (qv > maxQV) return `overheated turnover (${(qv/1e6).toFixed(1)}M)`;
    return `healthy turnover ${(qv >= 1e6 ? (qv/1e6).toFixed(1)+'M' : (qv/1e3).toFixed(0)+'K')} USDT`;
  }
  
  function buildEntryReasons({ phase, confidence, quoteVolume, minQV=100_000, maxQV=20_000_000, manual=false } = {}) {
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
    r.push(formatVolBand(Number(quoteVolume), minQV, maxQV));
    return r;
  }
  
  function buildExitReasons({ hitTP=false, phase=null, weakening=false, trailing=false, capitalGuard=false } = {}) {
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
  
  module.exports = { buildEntryReasons, buildExitReasons };