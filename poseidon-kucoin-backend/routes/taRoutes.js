const express = require('express');
const router = express.Router();
const { analyzeSymbol } = require('../utils/marketScanner');

router.get('/api/ta/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const result = await analyzeSymbol(symbol);

    if (!result.valid) {
      return res.json({
        nodata: true,
        error: result.reason || 'Invalid result',
        ...(result.volume && { volume: result.volume })
      });
    }

    res.json({
      nodata: false,
      ...result
    });
  } catch (err) {
    console.error('❌ TA route error:', err.message);
    res.status(500).json({ nodata: true, error: 'Internal server error' });
  }
});

module.exports = router;