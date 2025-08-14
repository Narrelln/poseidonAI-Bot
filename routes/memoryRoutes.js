// routes/memoryRoutes.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const MEMORY_PATH = path.join(__dirname, '..', 'utils', 'data', 'poseidonMemory.json');

// === Load memory from disk ===
function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_PATH)) return {};
    return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
  } catch (e) {
    console.error('[MEMORY] Load failed:', e.message);
    return {};
  }
}

// === Save memory to disk ===
function saveMemory(mem) {
  try {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2));
    return true;
  } catch (e) {
    console.error('[MEMORY] Save failed:', e.message);
    return false;
  }
}

// === GET /api/memory ===
router.get('/memory', (req, res) => {
  res.json(loadMemory());
});

// === POST /api/memory === (merge update)
router.post('/memory', (req, res) => {
  const update = req.body || {};
  if (!update || typeof update !== 'object') {
    return res.status(400).json({ error: "Bad memory update" });
  }
  const mem = Object.assign({}, loadMemory(), update);
  saveMemory(mem);
  res.json({ success: true, memory: mem });
});

// === PUT /api/memory === (overwrite)
router.put('/memory', (req, res) => {
  const update = req.body || {};
  if (!update || typeof update !== 'object') {
    return res.status(400).json({ error: "Bad memory update" });
  }
  saveMemory(update);
  res.json({ success: true, memory: update });
});

module.exports = router;