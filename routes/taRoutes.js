// routes/taRoutes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');

const { getTA } = require('../handlers/taHandler');
const { parseToKucoinContractSymbol } = require('../kucoinHelper');
const WHITELIST = require('../config/tokenWhitelist.json'); // { top:[], memes:[] }

// Build a robust whitelist set that includes raw symbols and their common aliases
const RAW_WHITELIST_ARRAY = [...(WHITELIST.top || []), ...(WHITELIST.memes || [])]
  .map(s => String(s || '').toUpperCase());

// ---- Base aliasing (KuCoin uses XBT; Bybit uses BTC, etc.) ----
const BASE_ALIASES = new Map([
  ['BTC','XBT'],
  ['XBT','XBT']
]);

function aliasForKucoin(base) {
  const b = String(base || '').toUpperCase();
  return BASE_ALIASES.get(b) || b;
}
function aliasForBybit(base) {
  // Bybit prefers BTC (not XBT)
  const b = String(base || '').toUpperCase();
  return b === 'XBT' ? 'BTC' : b;
}

// Final whitelist set: include raw values + kucoin aliases + bybit aliases
const WHITELIST_SET = new Set([
  ...RAW_WHITELIST_ARRAY,
  ...RAW_WHITELIST_ARRAY.map(aliasForKucoin),
  ...RAW_WHITELIST_ARRAY.map(aliasForBybit),
]);

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

// === Volume thresholds (USDT - quote volume)
const MIN_QUOTE_VOL     = 100_000;
const MAX_QUOTE_VOL     = 20_000_000;
const LOW_VOL_FLOOR     = 50_000;
const MOONSHOT_MIN_CHG  = 12;

// === Helpers ===
function up(s) { return String(s || '').toUpperCase(); }
function normalizeSymbol(symbol) {
  return up(String(symbol || '').replace(/[-_]/g, ''));
}
// Convert anything (BTC, XBT, BTCUSDT, BTC-USDTM) → Bybit-spot form (e.g., BTCUSDT)
function normalizeForTA(rawSymbol) {
  let sym = normalizeSymbol(rawSymbol); // strips -, _
  // peel suffix to get base
  let base = sym;
  if (base.endsWith('USDTM')) base = base.slice(0, -5);
  else if (base.endsWith('USDT')) base = base.slice(0, -4);
  // map to Bybit alias (BTC not XBT) then add USDT
  const bybitBase = aliasForBybit(base);
  return `${bybitBase}USDT`;
}
function isWhitelistedByBase(baseLike) {
  const b = up(baseLike);
  return WHITELIST_SET.has(b);
}
function isWhitelisted(taSymbol) {
  // Accept either “BASEUSDT” or raw base
  const base = up(taSymbol.replace(/USDT$/i, ''));
  return isWhitelistedByBase(base);
}
function toNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function pickChange(obj) {
  const fields = ['priceChgPct', 'priceChangePct', 'delta', 'change', 'chgPct', 'percent'];
  for (const k of fields) {
    const n = toNumber(obj?.[k]);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

router.get('/ta/:symbol', async (req, res) => {
  const debug = String(req.query.debug || '') === '1';
  const rawBypass = String(req.query.raw || '') === '1'; // ← allow TA payload even when volume-gated

  try {
    const raw = req.params.symbol || '';
    const baseSymbol = normalizeSymbol(raw);
    const taSymbol   = normalizeForTA(baseSymbol);              // e.g., BTCUSDT (Bybit alias)
    const kucoinSym  = parseToKucoinContractSymbol(baseSymbol); // e.g., XBT-USDTM if BTC/XBT

    console.log(`\n[TA ROUTE] 🔍 Incoming request: ${raw}`);
    console.log(`  baseSymbol       = ${baseSymbol}`);
    console.log(`  taSymbol (Bybit) = ${taSymbol}`);
    console.log(`  kucoinSymbol     = ${kucoinSym}`);

    if (!kucoinSym.endsWith('-USDTM')) {
      console.warn(`[TA ROUTE] ❌ Rejected malformed symbol: ${kucoinSym}`);
      return res.status(400).json({ nodata: true, error: 'Invalid or malformed symbol' });
    }

    const result = await getTA(taSymbol);
    if (!result || result.success === false) {
      return res.json({ nodata: true, error: result?.error || 'TA fetch failed' });
    }

    // Volume gating (same policy as scanner)
    const price = toNumber(result.price) || toNumber(result.markPrice) || NaN;
    const volumeBase = toNumber(result.volumeBase ?? result.volume);
    const providerQV = toNumber(result.quoteVolume);

    let quoteVolume = providerQV;
    if (!Number.isFinite(quoteVolume)) {
      quoteVolume = (Number.isFinite(price) && price > 0 && Number.isFinite(volumeBase))
        ? volumeBase * price
        : NaN;
    }
    if (!Number.isFinite(quoteVolume)) quoteVolume = 0;

    const changePct = pickChange(result);
    const absChg    = Number.isFinite(changePct) ? Math.abs(changePct) : NaN;

    // Whitelist by base (alias-aware)
    const wlBase = up(taSymbol.replace(/USDT$/i, '')); // e.g., BTC
    const whitelisted = isWhitelistedByBase(wlBase);

    let gatedOut = false;
    let reason   = '';
    if (!whitelisted) {
      const withinNormal = quoteVolume >= MIN_QUOTE_VOL && quoteVolume <= MAX_QUOTE_VOL;
      if (!withinNormal) {
        const eligibleMoonshot =
          quoteVolume >= LOW_VOL_FLOOR &&
          quoteVolume < MIN_QUOTE_VOL &&
          Number.isFinite(absChg) &&
          absChg >= MOONSHOT_MIN_CHG;

        if (!eligibleMoonshot) {
          gatedOut = true;
          reason = 'Volume out of bounds';
        } else {
          reason = 'Moonshot exception';
        }
      } else {
        reason = 'Normal volume';
      }
    } else {
      reason = 'Whitelist';
    }

    // If gated and no raw bypass: return nodata but with diagnostics
    if (gatedOut && !rawBypass) {
      const payload = {
        nodata: true,
        error: 'Volume out of bounds',
        quoteVolume
      };
      if (debug) {
        payload.inputs = {
          price,
          volumeBase,
          providerQV,
          changePct,
          thresholds: {
            MIN_QUOTE_VOL,
            MAX_QUOTE_VOL,
            LOW_VOL_FLOOR,
            MOONSHOT_MIN_CHG
          },
          whitelisted,
          wlBase
        };
      }
      console.warn(
        `[TA ROUTE] ⚠️ Rejected (quote vol) for ${taSymbol}: ${quoteVolume}` +
        (debug ? ` | inputs: ${JSON.stringify(payload.inputs)}` : '')
      );
      return res.json(payload);
    }

    // ✅ Ingest into Learning Memory (fire-and-forget; don’t block TA)
    (async () => {
      try {
        const payload = {
          symbol: taSymbol,
          result: {
            price: result.price,
            confidence: result.confidence,
            trapWarning: !!result.trapWarning,
            rsiChange: Number.isFinite(Number(result.rsiChange)) ? Number(result.rsiChange) : undefined,
            macdChange: Number.isFinite(Number(result.macdChange)) ? Number(result.macdChange) : undefined,
            // ranges for today/30d scaffolding
            ath: Number.isFinite(Number(result.range30D?.high)) ? Number(result.range30D.high) : undefined,
            atl: Number.isFinite(Number(result.range30D?.low))  ? Number(result.range30D.low)  : undefined,
            volatilityTag: result.bbSignal === 'breakout' ? 'volatile' : 'normal',
          }
        };
        await axios.post(`${BASE}/api/learning-memory/ingest`, payload, { timeout: 5000 });
      } catch (_) {}
    })();

    if (debug) {
      console.log(`[TA ROUTE] ✅ Accepted ${taSymbol} — reason: ${reason} | qVol=${quoteVolume}`);
    } else {
      console.log(`[TA ROUTE] ✅ TA result for ${taSymbol}:`, {
        signal: result.signal,
        confidence: result.confidence,
        quoteVolume,
        price: result.price,
        reason
      });
    }

    return res.json({
      nodata: false,
      ...result,
      volumeBase: Number.isFinite(volumeBase) ? volumeBase : undefined,
      quoteVolume,
      valid: !gatedOut,                 // ← tradable under volume policy
      _reason: debug ? reason : undefined
    });

  } catch (err) {
    console.error('[TA ROUTE] ❌ Unhandled error:', err.message);
    return res.status(500).json({ nodata: true, error: 'Internal server error' });
  }
});

module.exports = router;