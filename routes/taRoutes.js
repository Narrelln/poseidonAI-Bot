// routes/taRoutes.js
const express = require('express');
const router = express.Router();
const { getTA } = require('../handlers/taHandler');
const { toKuCoinContractSymbol } = require('../handlers/futuresApi');

// === Volume thresholds (USDT - quote volume)
const MIN_QUOTE_VOL = 100_000;
const MAX_QUOTE_VOL = 20_000_000;

// === Whitelisted tokens (you can externalize this if needed)
const WHITELIST = [
  'BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'DOGEUSDT',
  'SOLUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT'
];

// === Normalize KuCoin-style symbols
function normalizeSymbol(symbol) {
  return String(symbol || '').replace(/[-_]/g, '').toUpperCase();
}

// === Normalize for Bybit TA usage (e.g., BTCUSDT)
function normalizeForTA(rawSymbol) {
  let sym = normalizeSymbol(rawSymbol);
  if (sym.endsWith('USDTM')) sym = sym.slice(0, -1); // Remove trailing M
  if (!sym.endsWith('USDT')) sym += 'USDT';
  return sym;
}

router.get('/ta/:symbol', async (req, res) => {
  try {
    const raw = req.params.symbol || '';
    const baseSymbol = normalizeSymbol(raw);                  // e.g., DOGEUSDTM
    const taSymbol = normalizeForTA(baseSymbol);              // e.g., DOGEUSDT
    const kucoinSymbol = toKuCoinContractSymbol(baseSymbol);  // e.g., DOGE-USDTM

    console.log(`\n[TA ROUTE] 🔍 Incoming request: ${raw}`);
    console.log(`  baseSymbol       = ${baseSymbol}`);
    console.log(`  taSymbol (Bybit) = ${taSymbol}`);
    console.log(`  kucoinSymbol     = ${kucoinSymbol}`);

    if (!kucoinSymbol.endsWith('USDTM')) {
      console.warn(`[TA ROUTE] ❌ Rejected malformed symbol: ${kucoinSymbol}`);
      return res.status(400).json({ nodata: true, error: 'Invalid or malformed symbol' });
    }

    const result = await getTA(taSymbol); // Uses normalized Bybit symbol

    if (!result || result.success === false) {
      return res.json({ nodata: true, error: result?.error || 'TA fetch failed' });
    }

    // --- Volume gating: use QUOTE volume (USDT) ---
    // taHandler returns: { volumeBase, quoteVolume, ... }
    // Fallbacks:
    //  - if quoteVolume missing, try `result.volume` (legacy base units) * price
    //  - if price missing, just skip gating (treat as 0 to be conservative)
    const price = Number(result.price) || 0;
    const volumeBase = Number(result.volumeBase ?? result.volume) || 0; // legacy `volume` was base units
    let quoteVolume = Number(result.quoteVolume);

    if (!Number.isFinite(quoteVolume)) {
      quoteVolume = Number.isFinite(price) && price > 0 ? volumeBase * price : 0;
    }

    const isWhitelisted = WHITELIST.includes(taSymbol);

    if (!isWhitelisted && (quoteVolume < MIN_QUOTE_VOL || quoteVolume > MAX_QUOTE_VOL)) {
      console.warn(`[TA ROUTE] ⚠️ Rejected (quote vol) for ${taSymbol}: ${quoteVolume}`);
      return res.json({ nodata: true, error: 'Volume out of bounds', quoteVolume });
    }

    console.log(`[TA ROUTE] ✅ TA result for ${taSymbol}:`, {
      signal: result.signal,
      confidence: result.confidence,
      quoteVolume,
      price: result.price
    });

    // Return both volumes so the frontend can display/debug
    return res.json({
      nodata: false,
      ...result,
      volumeBase,   // base units
      quoteVolume   // USDT
    });

  } catch (err) {
    console.error('[TA ROUTE] ❌ Unhandled error:', err.message);
    return res.status(500).json({ nodata: true, error: 'Internal server error' });
  }
});

module.exports = router;