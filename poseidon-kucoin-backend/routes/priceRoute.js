// /routes/priceRoute.js
const express = require('express');
const router = express.Router();

// Normalizes "BTC-USDTM" → "BTCUSDT", "XBT" → "BTC"
function normalize(symRaw='') {
  const s = String(symRaw).toUpperCase();
  let norm = s.replace(/[-_]/g, '').replace(/USDTM$/, 'USDT');
  if (norm === 'XBTUSDT') norm = 'BTCUSDT';
  return norm;
}

router.get('/price', async (req, res) => {
  try {
    const q = String(req.query.symbol || '');
    if (!q) return res.status(400).json({ error: 'symbol required' });

    const symbol = normalize(q);

    // 1) Try scanner cache (if exposed)
    try {
      const mod = require('./newScanTokens');
      const getLatestScanBuffer = mod?.getLatestScanBuffer;
      if (typeof getLatestScanBuffer === 'function') {
        const list = getLatestScanBuffer() || [];
        const base = symbol.replace(/USDT$/, '');
        const row = list.find(r =>
          String(r.symbol || '').toUpperCase().replace(/[-_]/g,'').startsWith(base)
        );
        const price = Number(row?.price ?? row?.lastPrice);
        if (Number.isFinite(price)) return res.json({ symbol, price });
      }
    } catch {}

    // 2) Try unified TA analyzer
    try {
      const { analyzeSymbol } = require('../handlers/taClient.js');
      const ta = await analyzeSymbol(symbol);
      const price = Number(ta?.price);
      if (Number.isFinite(price)) return res.json({ symbol, price });
    } catch {}

    return res.status(404).json({ error: 'price unavailable', symbol });
  } catch (e) {
    console.error('/api/price error:', e.message);
    res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;