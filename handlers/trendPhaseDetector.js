// handlers/trendPhaseDetector.js — CommonJS Compatible

const { fetchFuturesPrice } = require('./futuresApi');
const { getMACD, getBB } = require('./taHandler'); // Make sure taHandler exports these as CommonJS too

async function detectTrendPhase(symbol) {
  try {
    const { price, history } = await fetchFuturesPrice(symbol);
    if (!history || history.length < 3) return { phase: 'unknown', reason: 'Insufficient history' };

    const macd = await getMACD(symbol);
    const bb = await getBB(symbol);

    const change1h = ((price - history[0]) / history[0]) * 100;
    const velocity = ((price - history[1]) / history[1]) * 100;
    const slopeMACD = macd && typeof macd.histogram !== 'undefined' ? macd.histogram : 0;

    let phase = 'neutral';
    let reasons = [];

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

module.exports = {
  detectTrendPhase
};