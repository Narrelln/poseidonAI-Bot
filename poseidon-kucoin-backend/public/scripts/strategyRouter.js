// /public/scripts/strategyRouter.js
// Decide which micro‑strategy fits a symbol right now.
// Works in the browser (ESM), with Node/CommonJS, and also exposes window.chooseStrategy.

const MAJORS = ['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC'];
const MEMES  = ['WIF','TRUMP','MYRO','PEPE','FLOKI','BONK','SHIB'];

function chooseStrategy(base, ctx = {}) {
  const isMajor = MAJORS.includes(base);
  const isMeme  = MEMES.includes(base);

  const vol24 = Math.abs(Number(ctx.delta24h ?? 0)); // 24h % move from scanner
  const rsi   = Number(ctx.rsi ?? 50);
  const spike = !!ctx.volumeSpike;
  const sig   = String(ctx.taSignal || 'neutral');

  // Majors → your 24–48h cycle (trail + reverse on exhaustion)
  if (isMajor) return 'cycle';

  // Memes → breakout if momentum/spike; otherwise range
  if (isMeme) {
    if (vol24 >= 10 || spike || (sig === 'bullish' && rsi < 40) || (sig === 'bearish' && rsi > 60)) {
      return 'breakout';
    }
    return 'range';
  }

  // Others → breakout if momentum; otherwise range
  if (vol24 >= 8 || spike) return 'breakout';
  return 'range';
}

/* ---------- Exports (multiformat) ---------- */

// ES Module (used by futuresSignalModule.js)
export { chooseStrategy };

// CommonJS (Node / older bundlers)
if (typeof module === 'object' && module.exports) {
  module.exports = { chooseStrategy };
}

// Browser global (optional convenience)
if (typeof window !== 'undefined') {
  window.chooseStrategy = chooseStrategy;
}