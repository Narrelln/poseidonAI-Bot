// verifyRails.js — Rails verifier/watcher that works without Mongo
/* eslint-disable no-console/* verifyRails.js
 * Verify extremaRails ⇄ Mongo LearningMemory wiring.
 *
 * Usage:
 *   node verifyRails.js BTCUSDT
 *   node verifyRails.js BTCUSDT --watch=10
 *   MONGO_URI="mongodb://127.0.0.1:27017/poseidon" node verifyRails.js ETHUSDT --watch
 */

// verifyRails.js — tolerant connection (won’t crash if Mongo is down)
const axios = require('axios');
const mongoose = require('mongoose');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

const argv = process.argv.slice(2);
const SYMBOL = String(argv.find(a => !a.startsWith('-')) || process.env.SYMBOL || 'BTCUSDT').toUpperCase();
const WATCH  = argv.includes('--watch') || String(process.env.WATCH || '').toLowerCase() === 'true';
const NO_DB  = argv.includes('--no-db') || argv.includes('--skip-db') ||
              String(process.env.SKIP_VERIFY_RAILS || '').toLowerCase() === 'true';

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/poseidon';
const TIMEOUT_MS = Number(process.env.MONGO_CONN_TIMEOUT_MS || 3500);

// soft import extremaRails
let pushTick = null, getSnapshot = null;
try {
  ({ pushTick, getSnapshot } = require('./handlers/extremaRails'));
} catch {
  try { ({ pushTick, getSnapshot } = require('./handlers/extremaRails.js')); } catch {}
}

function toSpot(symbolOrContract = '') {
  const s = String(symbolOrContract).toUpperCase();
  if (s.endsWith('-USDTM')) return s.replace('-USDTM', 'USDT');
  if (s.endsWith('USDT')) return s;
  return s + 'USDT';
}

async function safeMongoConnect() {
  if (NO_DB) {
    console.log('[verifyRails] DB skipped by flag.');
    return false;
  }
  try {
    await mongoose.connect(URI, {
      serverSelectionTimeoutMS: TIMEOUT_MS,
      socketTimeoutMS: TIMEOUT_MS,
      family: 4,
    });
    console.log('[verifyRails] Connected to Mongo.');
    return true;
  } catch (err) {
    const code = err?.code || err?.cause?.code;
    console.warn(`[verifyRails] Mongo connect failed (${code || err.name}): ${err.message}`);
    console.warn('[verifyRails] Proceeding WITHOUT DB (in-memory rails only).');
    return false;
  }
}

async function fetchTA(spot) {
  try {
    const { data } = await axios.get(`${BASE}/api/ta/${spot}`, { timeout: 5000 });
    return data || {};
  } catch (e) {
    console.warn('[verifyRails] TA fetch failed:', e?.message || e);
    return {};
  }
}

function printRails(spot) {
  if (typeof getSnapshot !== 'function') {
    console.log('[verifyRails] extremaRails not available in this build.');
    return;
  }
  const snap = getSnapshot(spot);
  const rails = snap?.rails || {};
  const order = ['12h','24h','36h','48h','7d','14d','30d'];
  const line = order
    .map(h => {
      const r = rails[h];
      if (!r) return `${h}: —`;
      const a = n => (Number.isFinite(n) ? Number(n) : NaN);
      const atl = a(r.atl), ath = a(r.ath);
      return `${h}: ATL=${fmt(atl)} ATH=${fmt(ath)}`;
    })
    .join(' | ');
  console.log(`[verifyRails] ${spot} ${line}`);
}

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 100) return n.toFixed(2);
  if (n >= 1)   return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(6);
}

async function watchSymbol(spot) {
  if (typeof pushTick !== 'function') {
    console.log('[verifyRails] pushTick() not available; nothing to watch.');
    return;
  }
  console.log(`[verifyRails] Watching ${spot} — streaming price to extremaRails every 3s.`);
  setInterval(async () => {
    const ta = await fetchTA(spot);
    const price = Number(ta?.price ?? ta?.markPrice);
    if (Number.isFinite(price) && price > 0) {
      try { pushTick(spot, price, Date.now()); } catch {}
      printRails(spot);
    } else {
      console.log('[verifyRails] price not available');
    }
  }, 3000);
}

async function main() {
  const spot = toSpot(SYMBOL);
  await safeMongoConnect(); // optional; continues even if false

  // one-shot print right away
  printRails(spot);

  if (WATCH) {
    await watchSymbol(spot);
  } else {
    console.log('[verifyRails] Done (use --watch to stream).');
    try { await mongoose.disconnect(); } catch {}
  }
}

main().catch(e => {
  console.error('[verifyRails] fatal:', e?.message || e);
  process.exit(0);
});