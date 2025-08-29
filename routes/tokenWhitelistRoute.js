// routes/tokenWhitelistRoute.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const router = express.Router();

const FILE = path.join(__dirname, '..', 'config', 'tokenWhitelist.json');

// optional: in‑memory cache
let cache = null;
let mtime = 0;

router.get('/token-whitelist', (_req, res) => {
  try {
    const stat = fs.statSync(FILE);
    if (!cache || stat.mtimeMs !== mtime) {
      cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      mtime = stat.mtimeMs;
    }
    // allow simple caching in the browser
    res.set('Cache-Control', 'public, max-age=300'); // 5 min
    res.json(cache);
  } catch (err) {
    console.error('[token-whitelist] read error:', err.message);
    res.status(500).json({ top: [], memes: [] });
  }
});

module.exports = router;