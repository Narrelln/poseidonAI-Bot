/**
 * File #LM-03: routes/learningMemoryRoutes.js
 * REST endpoints for Poseidon learning memory.
 * - GET /api/learning-memory           -> full memory
 * - GET /api/learning-memory/:symbol   -> single symbol
 * - POST /api/learning-memory          -> partial upsert (object of {SYM: data})
 * - PUT /api/learning-memory           -> full overwrite
 * Last Updated: 2025-08-11
 */

const express = require('express');
const router = express.Router();

const {
  getFullMemory,
  getLearningMemory,
  saveLearningMemory,
  overwriteMemory
} = require('../handlers/learningMemory');

// GET all memory
router.get('/', (_req, res) => {
  try {
    return res.json(getFullMemory());
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to load memory' });
  }
});

// GET single symbol memory
router.get('/:symbol', (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, error: 'Symbol is required' });
    return res.json(getLearningMemory(symbol));
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to load symbol memory' });
  }
});

// POST partial update (upsert multiple symbols)
// Body shape: { "BTCUSDT": {...}, "ETH-USDTM": {...} }
router.post('/', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : null;
    if (!body) return res.status(400).json({ success: false, error: 'Body must be an object' });

    let count = 0;
    for (const [symbolRaw, data] of Object.entries(body)) {
      const symbol = String(symbolRaw || '').trim().toUpperCase();
      if (!symbol) continue;
      if (data && typeof data === 'object') {
        saveLearningMemory(symbol, data);
        count++;
      }
    }
    return res.json({ success: true, updated: count });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to update memory' });
  }
});

// PUT full overwrite
router.put('/', (req, res) => {
  try {
    const newMemory = req.body && typeof req.body === 'object' ? req.body : null;
    if (!newMemory) return res.status(400).json({ success: false, error: 'Body must be an object' });
    overwriteMemory(newMemory);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to overwrite memory' });
  }
});

module.exports = router;