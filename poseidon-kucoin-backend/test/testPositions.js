// testPositions.js

const { getOpenFuturesPositions } = require('../kucoinHelper');

(async () => {
  try {
    const positions = await getOpenFuturesPositions();
    console.log('[POSITIONS]', positions);
  } catch (err) {
    console.error('[ERROR]', err.message || err);
  }
})();