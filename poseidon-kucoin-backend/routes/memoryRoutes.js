const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const MEMORY_PATH = path.join(__dirname, '..', 'utils', 'data', 'poseidonMemory.json');

function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_PATH)) return {};
    return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
  } catch (e) {
    console.error('[MEMORY] Load failed:', e.message);
    return {};
  }
}

function saveMemory(mem) {
  try {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2));
    return true;
  } catch (e) {
    console.error('[MEMORY] Save failed:', e.message);
    return false;
  }
}

router.get('/memory', (req, res) => res.json(loadMemory()));

router.post('/memory', (req, res) => {
  const update = req.body || {};
  if (!update || typeof update !== 'object') return res.status(400).json({ error: "Bad memory update" });
  const mem = Object.assign({}, loadMemory(), update);
  saveMemory(mem);
  res.json({ success: true, memory: mem });
});

router.put('/memory', (req, res) => {
  const update = req.body || {};
  if (!update || typeof update !== 'object') return res.status(400).json({ error: "Bad memory update" });
  saveMemory(update);
  res.json({ success: true, memory: update });
});

module.exports = router;