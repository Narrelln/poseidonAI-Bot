// /public/scripts/core/percent.js

// Robust numeric parser: handles "1.23%", "+0.85", "1,234.5", numbers, etc.
export function toNum(v) {
    if (v == null) return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string') {
      // strip %, commas, whitespace; keep minus; drop leading plus
      const s = v.trim().replace(/[%\s,]/g, '').replace(/^\+/, '');
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  
  /**
   * Returns a single, correct 24h % change for any ticker shape.
   * Supports KuCoin, Binance, Bybit, and generic fallbacks.
   *
   * Heuristic: if |x| ∈ (0,1] we treat it as a FRACTION and multiply by 100.
   */
  export function percent24h(t = {}) {
    const normPct = (x) => {
      const n = toNum(x);
      if (!Number.isFinite(n)) return NaN;
      return (Math.abs(n) > 0 && Math.abs(n) <= 1) ? n * 100 : n;
    };
  
    // ── KuCoin-style ratio ─────────────────────────────────────────────
    if (t.changeRate !== undefined && t.changeRate !== null) {
      const r = toNum(t.changeRate);
      if (Number.isFinite(r)) return r * 100;
    }
  
    // ── Binance-style % aliases (may be strings or fractions) ─────────
    const pctAliases = [
      t.priceChangePercent, t.changePercent, t.change24hPercent,
      t.dayChangePercent, t.percent24h, t.percentChange,
      t.pct, t.pchange, t.changePct, t.variation24h, t.roc24h
    ];
    for (const cand of pctAliases) {
      const v = normPct(cand);
      if (Number.isFinite(v)) return v;
    }
  
    // ── Bybit-specific ─────────────────────────────────────────────────
    // ratio like 0.0123 → 1.23%
    if (t.price24hPcnt !== undefined && t.price24hPcnt !== null) {
      const r = toNum(t.price24hPcnt);
      if (Number.isFinite(r)) return r * 100;
    }
  
    // ── Absolute delta + reference (prev/ open) ───────────────────────
    const absDelta = toNum(t.priceChange ?? t.delta24h ?? t.change);
    if (Number.isFinite(absDelta)) {
      const ref = [
        t.prevPrice24h, t.prevClose, t.previousClose, t.prevPrice, t.previousPrice,
        t.open24h, t.openPrice, t.open, t.lastDayClosePrice
      ].map(toNum).find(Number.isFinite);
      if (Number.isFinite(ref) && ref !== 0) return (absDelta / ref) * 100;
    }
  
    // ── Generic last vs open (broad provider aliases) ─────────────────
    const last = [
      t.price, t.lastPrice, t.last, t.close, t.markPrice
    ].map(toNum).find(Number.isFinite);
    const open = [
      t.prevPrice24h,                // Bybit 24h reference
      t.open24h, t.openPrice, t.open,
      t.prevClose, t.previousClose, t.lastDayClosePrice
    ].map(toNum).find(Number.isFinite);
  
    if (Number.isFinite(last) && Number.isFinite(open) && open !== 0) {
      return ((last - open) / open) * 100;
    }
  
    return NaN;
  }