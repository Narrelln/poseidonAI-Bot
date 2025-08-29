// === routes/positionNoteRoutes.js ===

const express = require('express');
const router = express.Router();
const PositionNote = require('../models/PositionNote');

// Save or update note
router.post('/position-note', async (req, res) => {
  const { contract, note } = req.body;
  if (!contract) return res.status(400).json({ success: false, error: 'Missing contract' });

  try {
    await PositionNote.findOneAndUpdate(
      { contract },
      { note, updatedAt: new Date() },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get note by contract
router.get('/position-note/:contract', async (req, res) => {
  const { contract } = req.params;
  try {
    const entry = await PositionNote.findOne({ contract });
    res.json({ success: true, note: entry?.note || '' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;