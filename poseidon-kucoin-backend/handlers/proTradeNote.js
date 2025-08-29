// handlers/proTradeNote.js
// Builds a professional, single-string trade plan note for feeds/receipts.

function fmtNum(n, d = 0) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
  }
  function pctStr(p) { return `${(+p).toFixed(2)}%`; }
  
  function computeTpLadder(entry, tpPercents = [1, 2.25, 3.3], lev = 5) {
    const e = Number(entry);
    return tpPercents.map(p => {
      const gross = e * (1 + p / 100);
      const levRoi = p * lev;
      return { p, price: gross, levRoi };
    });
  }
  
  function buildWhyLine({ reasons = [], phase, volumeUSDT }) {
    const parts = [];
    if (reasons.length) parts.push(reasons.join(' + '));
    if (phase) parts.push(`Trend phase: ${phase}`);
    if (Number.isFinite(volumeUSDT)) parts.push(`Turnover ${fmtNum(volumeUSDT, 0)} USDT`);
    return parts.length ? `Why: ${parts.join('; ')}` : '';
  }
  
  /**
   * Build a pro entry note.
   * @param {object} args
   *  - symbol, side ('BUY'|'SELL'), price, leverage, tpPercents[], slPercent
   *  - context: { reasons[], phase, confidence, volumeUSDT }
   */
  function buildProEntryNote({
    symbol, side, price, leverage = 5, tpPercents = [1, 2.25, 3.3], slPercent = 8,
    context = {}
  }) {
    const dir = String(side).toUpperCase() === 'SELL' ? 'SHORT' : 'LONG';
    const entry = Number(price);
    const lev = Number(leverage) || 1;
  
    const tps = computeTpLadder(entry, tpPercents, lev);
    const tpLine = tps
      .map((t, i) => `TP${i + 1} ${fmtNum(t.price, 0)} (${pctStr(t.p)} ≈ ${pctStr(t.levRoi)} @ ${lev}x)`)
      .join(' · ');
  
    // Simple protective stop: % off entry in opposite direction
    const slPrice = dir === 'LONG' ? entry * (1 - slPercent / 100) : entry * (1 + slPercent / 100);
  
    const why = buildWhyLine({
      reasons: context.reasons || [],
      phase: context.phase,
      volumeUSDT: context.volumeUSDT
    });
  
    return [
      `🤖 ${String(symbol).toUpperCase()} — ${dir} @ ${fmtNum(entry, 0)}`,
      why,
      `Leverage: ${lev}x`,
      `Plan: ${tpLine}`,
      `SL: ${fmtNum(slPrice, 0)} (${slPercent}%)`
    ].filter(Boolean).join(' | ');
  }
  
  module.exports = { buildProEntryNote };