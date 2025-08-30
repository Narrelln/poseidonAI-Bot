// routes/newScanTokens.js  (7‑day LOCKED set • whitelist + bands • 40 movers + 10 memes)
/* eslint-disable no-console */
const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const { getTA } = require('../handlers/taHandler');
const ObservedMover = require('../models/ObservedMover');
const WHITELIST = require('../config/tokenWhitelist.json'); // { top:[], memes:[] }

// ========================= Config =========================
// Movers band — calmer liquidity discovery
const VOLUME_MIN          = 100_000;        // ≥ 100k
const VOLUME_MAX          = 20_000_000;     // ≤ 20m

// Meme band — hyper‑active names
const MEME_VOL_MIN        = 25_000_000;     // ≥ 25m
const MEME_VOL_MAX        = 1_500_000_000;  // ≤ 1.5b

// Fallback meme band (used only if we can't reach 10 with the primary band)
const MEME_FALLBACK_MIN   = 20_000_000;     // 20m → 25m (fallback only)

// Persistence / cadence
const PERSIST_MS          = 7 * 24 * 60 * 60 * 1000;  // 7 days (selection lifetime)
const REFRESH_INTERVAL_MS = PERSIST_MS;               // refresh exactly every 7 days

// Sizing
const MAX_MOVERS          = 40; // non‑memes (normal band)
const MAX_MEMES           = 10; // memes (meme band)
const MAX_GAINERS_FROM    = 40; // derive from movers
const MAX_LOSERS_FROM     = 40; // derive from movers

// Optional: low‑vol “moonshots” (visibility only)
const LOW_VOL_FLOOR       = 50_000;
const MAX_MOONSHOTS       = 5;

// Aliases (Bybit uses BTC; KuCoin sometimes uses XBT)
const BASE_ALIASES = new Map([
  ['BTC', 'XBT'],
  ['XBT', 'XBT'], // KuCoin futures often use XBT
]);
const kucoinAlias = (b) => BASE_ALIASES.get(String(b || '').toUpperCase()) || String(b || '').toUpperCase();
const bybitAlias  = (b) => (String(b || '').toUpperCase() === 'XBT' ? 'BTC' : String(b || '').toUpperCase());

// Whitelist sets (fold aliases so membership is robust)
const RAW_TOP   = (WHITELIST.top   || []).map(s => String(s || '').toUpperCase());
const RAW_MEMES = (WHITELIST.memes || []).map(s => String(s || '').toUpperCase());
const WL_TOP    = new Set([...RAW_TOP,   ...RAW_TOP.map(kucoinAlias),   ...RAW_TOP.map(bybitAlias)]);
const WL_MEMES  = new Set([...RAW_MEMES, ...RAW_MEMES.map(kucoinAlias), ...RAW_MEMES.map(bybitAlias)]);
const WL_ANY    = new Set([...WL_TOP, ...WL_MEMES]);

// ========================= In‑memory cache =========================
let kucoinBases = new Set(); // KuCoin futures bases (KuCoin alias space)
let _refreshTimer = null;

let cachedScannerData = {
  locked: true,            // FE hint: this set is frozen until nextRefreshAt
  top50: [],
  movers: [],
  memes: [],
  gainers: [],
  losers: [],
  observed: [],
  moonshots: [],
  persistWindowMs: PERSIST_MS,
  lastUpdated: 0,
  nextRefreshAt: 0
};

// ========================= Helpers =========================
const baseFromAny = (sym = '') =>
  String(sym).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/USDTM?$/, '');

const toFuturesContract = (base) => `${base}-USDTM`;
const toSpotForTA = (base) => `${bybitAlias(base)}USDT`;

function isFakeToken(symbol) {
  return /TEST|ALTCOIN|ZEUS|TROLL|MIXIE|DADDY|WEN|PORT|DOOD|NOBODY|GOR/i.test(symbol);
}
function pctFromBybit(p) {
  const x = Number(p);
  return Number.isFinite(x) ? (x * 100) : 0; // price24hPcnt: 0.023 → 2.3%
}
function dedupeByBase(arr) {
  const seen = new Set();
  return arr.filter(t => {
    const k = String(t.base || '').toUpperCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function isInBand(qv, lo, hi) {
  return Number.isFinite(Number(qv)) && Number(qv) >= lo && Number(qv) <= hi;
}
function withTAFieldDefaults(t) {
  // ensure signal/confidence fields always exist to simplify FE logic
  if (!('signal' in t)) t.signal = 'neutral';
  if (!('confidence' in t)) t.confidence = 0;
  return t;
}

// Enrich tokens with TA (signal/confidence)
async function enrichWithTA(tokens) {
  const out = [];
  for (const t of tokens) {
    const taSymbol = toSpotForTA(t.base);
    try {
      const ta = await getTA(taSymbol);
      if (ta?.success) {
        out.push(withTAFieldDefaults({ ...t, signal: ta.signal, confidence: ta.confidence, rsi: ta.rsi, macdSignal: ta.macdSignal, bbSignal: t.bbSignal }));
      } else {
        out.push(withTAFieldDefaults({ ...t }));
      }
    } catch {
      out.push(withTAFieldDefaults({ ...t }));
    }
  }
  return out;
}

// ========================= Upstreams =========================
async function fetchKucoinContracts() {
  try {
    const res = await axios.get('https://api-futures.kucoin.com/api/v1/contracts/active');
    const contracts = res.data?.data || [];
    kucoinBases = new Set(
      contracts.map(c => kucoinAlias(baseFromAny(c.symbol))).filter(Boolean)
    );
    console.log(`[Scanner] KuCoin bases: ${kucoinBases.size}`);
  } catch (err) {
    console.error('❌ KuCoin contracts fetch failed:', err.message);
  }
}
async function fetchBybitTickers() {
  const res = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
  return res.data?.result?.list || [];
}
function attachFromRaw(symbol, rawList) {
  const raw = rawList.find(t => String(t.symbol).toUpperCase() === String(symbol).toUpperCase());
  if (!raw) return { price: 0, quoteVolume: 0, priceChgPct: 0 };
  const price       = Number(raw.lastPrice || 0);
  const quoteVolume = Number(raw.turnover24h || 0);      // notional USDT
  const priceChgPct = pctFromBybit(raw.price24hPcnt);    // %
  if (!(price > 0) || !(quoteVolume > 0)) {
    console.warn(`[Scanner] invalid ticker for ${symbol}`, { lastPrice: raw.lastPrice, turnover24h: raw.turnover24h });
  }
  return { price, quoteVolume, quoteVolume24h: quoteVolume, priceChgPct };
}

// ========================= Persistence (optional visibility) =========================
async function loadObservedFromDB() {
  const now = new Date();
  const docs = await ObservedMover.find({ expiresAt: { $gt: now } })
    .select('base bybitBase whitelisted lastSnapshot')
    .lean();
  return docs.map(d => ({
    base: d.base,
    bybitBase: d.bybitBase,
    symbol: toFuturesContract(d.base),
    price: Number(d.lastSnapshot?.price) || 0,
    quoteVolume: Number(d.lastSnapshot?.quoteVolume) || 0,
    quoteVolume24h: Number(d.lastSnapshot?.quoteVolume) || 0,
    priceChgPct: Number(d.lastSnapshot?.priceChgPct) || 0,
    category: d.lastSnapshot?.category || '',
    source: d.lastSnapshot?.source || 'Bybit',
    fromObserved: true
  }));
}

async function upsertObserved(batch) {
  const now = Date.now();
  const ops = [];
  for (const t of batch) {
    const expiresAt = new Date(now + PERSIST_MS);
    ops.push({
      updateOne: {
        filter: { base: t.base },
        update: {
          $setOnInsert: {
            base: t.base,
            bybitBase: t.bybitBase || bybitAlias(t.base),
            firstSeen: new Date()
          },
          $set: {
            lastSeen: new Date(),
            expiresAt,
            whitelisted: WL_ANY.has(t.base) || WL_ANY.has(bybitAlias(t.base)),
            lastSnapshot: {
              price: Number(t.price) || 0,
              quoteVolume: Number(t.quoteVolume) || 0,
              priceChgPct: Number(t.priceChgPct) || 0,
              category: t.priceChgPct > 0 ? 'gainer' : (t.priceChgPct < 0 ? 'loser' : ''),
              source: String(t.source || 'Bybit')
            }
          }
        },
        upsert: true
      }
    });
  }
  if (ops.length) await ObservedMover.bulkWrite(ops, { ordered: false });
}

// ========================= Core Refresh (7‑day cadence) =========================
function scheduleNextRefresh() {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
  _refreshTimer = setTimeout(refreshScannerCache, REFRESH_INTERVAL_MS);
  const when = Date.now() + REFRESH_INTERVAL_MS;
  cachedScannerData.nextRefreshAt = when;
  console.log(`[Scanner] ⏳ Next refresh at ${new Date(when).toISOString()} (in ${(REFRESH_INTERVAL_MS/1000/60/60).toFixed(1)}h)`);
}

async function refreshScannerCache() {
  try {
    if (kucoinBases.size === 0) await fetchKucoinContracts();
    const bybitRaw = await fetchBybitTickers();

    // Universe: Bybit linear USDT → KuCoin alias → restrict to KuCoin USDT‑M
    const tokensRaw = bybitRaw
      .filter(t => String(t.symbol).endsWith('USDT'))
      .filter(t => {
        const base = baseFromAny(t.symbol);
        return !!base && base.length >= 2 && !/^(USDT|M|BTCBTC)$/i.test(base);
      })
      .map(t => {
        const byB = baseFromAny(t.symbol);
        const { price, quoteVolume, priceChgPct } = attachFromRaw(t.symbol, bybitRaw);
        const kuB = kucoinAlias(byB);
        return {
          base: kuB, bybitBase: byB, symbol: toFuturesContract(kuB),
          price, quoteVolume, quoteVolume24h: quoteVolume, priceChgPct,
          source: 'Bybit'
        };
      })
      .filter(t => kucoinBases.has(t.base))
      .filter(t => !isFakeToken(t.base));

    // 1) Whitelist: include all present in universe, regardless of band
    const wlPresent = tokensRaw.filter(t => WL_ANY.has(t.base) || WL_ANY.has(bybitAlias(t.base)));

    // 2) Movers (band 100k→20m), rank by |%|, fill to 40 excluding WL already added
    const moversPool = tokensRaw.filter(t =>
      isInBand(t.quoteVolume, VOLUME_MIN, VOLUME_MAX) &&
      !wlPresent.some(w => w.base === t.base)
    );
    const moversPicked = dedupeByBase(
      [...moversPool].sort((a, b) => Math.abs(b.priceChgPct) - Math.abs(a.priceChgPct))
    ).slice(0, MAX_MOVERS);

    // 3) Memes: primary band 25m→1.5b, rank by |%|, fill to 10
    let memesPicked = dedupeByBase(
      tokensRaw
        .filter(t => isInBand(t.quoteVolume, MEME_VOL_MIN, MEME_VOL_MAX))
        .sort((a, b) => Math.abs(b.priceChgPct) - Math.abs(a.priceChgPct))
    ).slice(0, MAX_MEMES);

    // If short, fallback fill 20m→25m
    if (memesPicked.length < MAX_MEMES) {
      const need = MAX_MEMES - memesPicked.length;
      const fallback = tokensRaw
        .filter(t =>
          !memesPicked.some(m => m.base === t.base) &&
          isInBand(t.quoteVolume, MEME_FALLBACK_MIN, MEME_VOL_MIN - 1)
        )
        .sort((a, b) => Math.abs(b.priceChgPct) - Math.abs(a.priceChgPct))
        .slice(0, need);
      memesPicked = dedupeByBase([...memesPicked, ...fallback]).slice(0, MAX_MEMES);
    }

    // 4) Merge whitelist with bands, then dedupe
    const combinedMovers = dedupeByBase([...wlPresent.filter(t => WL_TOP.has(t.base) || WL_TOP.has(bybitAlias(t.base))), ...moversPicked]).slice(0, MAX_MOVERS);
    const combinedMemes  = dedupeByBase([...wlPresent.filter(t => WL_MEMES.has(t.base) || WL_MEMES.has(bybitAlias(t.base))), ...memesPicked]).slice(0, MAX_MEMES);

    // 5) Gainers/Losers derived strictly from Movers
    const gainers = [...combinedMovers].sort((a, b) => b.priceChgPct - a.priceChgPct).slice(0, Math.min(MAX_GAINERS_FROM, combinedMovers.length));
    const losers  = [...combinedMovers].sort((a, b) => a.priceChgPct - b.priceChgPct).slice(0, Math.min(MAX_LOSERS_FROM, combinedMovers.length));

    // 6) Optional moonshots for visibility (low‑vol fast moves)
    const moonshots = tokensRaw
      .filter(t => t.quoteVolume >= LOW_VOL_FLOOR && t.quoteVolume < VOLUME_MIN && Math.abs(t.priceChgPct) >= 12)
      .sort((a, b) => Math.abs(b.priceChgPct) - Math.abs(a.priceChgPct))
      .slice(0, MAX_MOONSHOTS);

    // 7) Persist selected sets for 7 days (observability/debug)
    await upsertObserved([...combinedMovers, ...combinedMemes, ...moonshots]);

    // 8) Enrich with TA (spot symbol uses Bybit alias)
    const [moversEn, memesEn, gainersEn, losersEn, moonshotsEn] = await Promise.all([
      enrichWithTA(combinedMovers),
      enrichWithTA(combinedMemes),
      enrichWithTA(gainers),
      enrichWithTA(losers),
      enrichWithTA(moonshots)
    ]);

    // 9) Build final frozen Top50 (40 movers + 10 memes)
    const top50Combined = dedupeByBase([...moversEn, ...memesEn]).slice(0, MAX_MOVERS + MAX_MEMES);

    cachedScannerData = {
      locked: true,
      top50: top50Combined,
      movers: moversEn,
      memes: memesEn,
      gainers: gainersEn,
      losers: losersEn,
      observed: [],             // hide DB echo from FE during locked window
      moonshots: moonshotsEn,
      persistWindowMs: PERSIST_MS,
      lastUpdated: Date.now(),
      nextRefreshAt: Date.now() + REFRESH_INTERVAL_MS
    };

    const c = (arr) => (Array.isArray(arr) ? arr.length : 0);
    console.log(`[Scanner/LOCKED] ✅ Frozen for 7d
      Movers: ${c(moversEn)} (band ${VOLUME_MIN.toLocaleString()}–${VOLUME_MAX.toLocaleString()})
      Memes : ${c(memesEn)}  (primary ${MEME_VOL_MIN.toLocaleString()}–${MEME_VOL_MAX.toLocaleString()}, fallback 20–25m if needed)
      Top50 : ${c(top50Combined)}
    `);
  } catch (err) {
    console.error('❌ Scanner refresh error:', err.message);
  } finally {
    scheduleNextRefresh();
  }
}

// Kick once at boot, then wait 7 days for the next run
refreshScannerCache();

// ========================= Routes =========================
router.get('/scan-tokens', (_req, res) => {
  res.json({ success: true, ...cachedScannerData });
});

router.get('/scan-tokens/status', (_req, res) => {
  res.json({
    locked: cachedScannerData.locked,
    lastUpdated: cachedScannerData.lastUpdated,
    nextRefreshAt: cachedScannerData.nextRefreshAt,
    persistWindowMs: cachedScannerData.persistWindowMs,
    movers: cachedScannerData.movers.length,
    memes: cachedScannerData.memes.length
  });
});

// Manual refresh (use rarely; maintains 7‑day cadence afterward)
router.post('/scan-tokens/refresh-now', async (_req, res) => {
  try {
    await refreshScannerCache();
    res.json({ ok: true, lastUpdated: cachedScannerData.lastUpdated, nextRefreshAt: cachedScannerData.nextRefreshAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'refresh failed' });
  }
});

// ========================= Exports =========================
function getCachedScannerData() {
  return cachedScannerData;
}
function getActiveSymbols() {
  return cachedScannerData.top50.map(t => t.symbol);
}
module.exports = { router, getCachedScannerData, getActiveSymbols };