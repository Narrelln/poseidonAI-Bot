// routes/tokenWhitelistRoute.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const router = express.Router();

const FILE = path.join(__dirname, '..', 'config', 'tokenWhitelist.json');

// Optional: in-memory cache
let cache = null;
let mtime = 0;

// ---- Alias helpers (keep in sync with other modules) ----
const BASE_ALIASES = new Map([
  ['BTC', 'XBT'],
  ['XBT', 'XBT'], // canonical for KuCoin
]);

function up(s) {
  return String(s || '').trim().toUpperCase();
}
function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

/**
 * Build normalized + alias-expanded views:
 * - topNorm/memesNorm      : UPPERCASED, de-duped
 * - topAliases/memesAliases: include alias (e.g., BTC→XBT), de-duped
 * - flat / flatAliases     : single arrays useful for fast set membership
 */
function buildViews(raw = {}) {
  const topRaw   = Array.isArray(raw.top)   ? raw.top   : [];
  const memesRaw = Array.isArray(raw.memes) ? raw.memes : [];

  const topNorm   = uniq(topRaw.map(up));
  const memesNorm = uniq(memesRaw.map(up));

  const addAlias = (arr) => uniq(
    arr.flatMap(b => {
      const alias = BASE_ALIASES.get(b);
      return alias && alias !== b ? [b, alias] : [b];
    })
  );

  const topAliases   = addAlias(topNorm);
  const memesAliases = addAlias(memesNorm);

  const flat        = uniq([...topNorm, ...memesNorm]);
  const flatAliases = uniq([...topAliases, ...memesAliases]);

  return {
    top: topNorm,
    memes: memesNorm,
    aliases: {
      top: topAliases,
      memes: memesAliases,
    },
    flat,
    flatAliases, // preferred for membership checks across Bybit/KuCoin
  };
}

router.get('/token-whitelist', (_req, res) => {
  try {
    const stat = fs.statSync(FILE);
    if (!cache || stat.mtimeMs !== mtime) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      cache = buildViews(raw || {});
      mtime = stat.mtimeMs;
    }

    // Basic HTTP caching
    res.set('Cache-Control', 'public, max-age=300'); // 5 min
    res.set('Last-Modified', new Date(mtime).toUTCString());

    // Shape:
    // {
    //   top: [...], memes: [...],
    //   aliases: { top:[...], memes:[...] },
    //   flat: [...], flatAliases: [...]
    // }
    res.json(cache);
  } catch (err) {
    console.error('[token-whitelist] read error:', err.message);
    // Always return a consistent shape
    res.status(500).json({
      top: [],
      memes: [],
      aliases: { top: [], memes: [] },
      flat: [],
      flatAliases: []
    });
  }
});

module.exports = router;