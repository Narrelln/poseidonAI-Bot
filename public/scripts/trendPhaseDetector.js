import { getCachedScannerData } from './scannerCache.js';
import { fetchTA } from './taHandler.js';

function normalize(symbol) {
  return symbol.replace(/[-_]/g, '').replace(/USDTM?$/, '').toUpperCase();
}

function getScannerToken(symbol, top50) {
  const norm = normalize(symbol);
  return top50.find(t => normalize(t.symbol) === norm);
}

export async function detectTrendPhase(symbol) {
  try {
    const { top50 } = await getCachedScannerData();
    const token = getScannerToken(symbol, top50);

    const price = parseFloat(token?.price);
    const history = token?.history || [];

    if (!price || !history?.length || history.length < 3) {
      return { phase: 'unknown', reason: 'Insufficient history' };
    }

    const ta = await fetchTA(symbol);
    const slopeMACD = ta?.macd?.histogram ?? 0;

    const change1h = ((price - history[0]) / history[0]) * 100;
    const velocity = ((price - history[1]) / history[1]) * 100;

    let phase = 'neutral';
    const reasons = [];

    if (change1h > 30 && velocity < 3 && slopeMACD < 0) {
      phase = 'peak';
      reasons.push('Price up >30% but slowing down');
      if (slopeMACD < 0) reasons.push('MACD histogram turning down');
    } else if (change1h > 12 && slopeMACD > 0) {
      phase = 'pumping';
      reasons.push('Upward trend and MACD positive');
    } else if (slopeMACD < 0 && velocity < 0 && change1h > 15) {
      phase = 'reversal';
      reasons.push('MACD down, price decelerating, possible top');
    }

    return {
      phase,
      velocity: velocity.toFixed(2),
      change1h: change1h.toFixed(2),
      macdHistogram: slopeMACD.toFixed(4),
      reasons
    };
  } catch (err) {
    return { phase: 'error', reason: err.message };
  }
}
