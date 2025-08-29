// === handlers/futuresApi.js — scanner cache + KuCoin signer ===================
// - Caches scanner tokens and exposes helpers for symbol normalization.
// - Adds KuCoin Futures request signer (ms timestamp, key-version 2 passphrase).
// Last updated: 2025-08-27

const axios  = require('axios');
const crypto = require('crypto');

// ---------- Local API (scanner) ------------------------------------------------
const PORT = process.env.PORT || 3000;
const LOCAL_BASE = process.env.LOCAL_API_BASE || `http://localhost:${PORT}`;
const SCAN_ENDPOINT = `${LOCAL_BASE}/api/scan-tokens`;

let cachedTokens = [];
let lastUpdated = 0;
let isRefreshing = false;

// How long before we consider the cache stale (ms)
const STALE_MS = Number(process.env.SCAN_STALE_MS || 30_000);

// ── utils ──────────────────────────────────────────────────────────────────
function normalizeSymbol(symbol) {
  return String(symbol || '')
    .trim()
    .replace(/[-_]/g, '')
    .replace(/USDTM?$/i, '')
    .toUpperCase();
}

function baseFromAny(symbol = '') {
  return String(symbol || '')
    .trim()
    .toUpperCase()
    .replace(/[-_]/g, '')
    .replace(/USDTM?$/, '');
}

function isEmpty(v) {
  return v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Prefer 24h quote volume (USDT notional) when available, with safe fallbacks.
 * Accepts raw rows from /api/scan-tokens (Bybit-derived fields).
 */
function getQuoteVolume(row = {}) {
  const qv24 = toNum(row.quoteVolume24h);
  if (Number.isFinite(qv24) && qv24 > 0) return qv24;

  const qv = toNum(row.quoteVolume ?? row.turnover);
  if (Number.isFinite(qv) && qv > 0) return qv;

  const price = toNum(row.price ?? row.lastPrice);
  const volBase = toNum(row.volumeBase ?? row.volume ?? row.baseVolume);
  if (Number.isFinite(price) && price > 0 && Number.isFinite(volBase) && volBase > 0) {
    return price * volBase;
  }
  return NaN;
}

/**
 * Convert many common inputs to KuCoin futures contract symbol.
 * Examples:
 *  - "BTCUSDT"   -> "XBT-USDTM"
 *  - "BTC-USDT"  -> "XBT-USDTM"
 *  - "BTCUSDTM"  -> "XBT-USDTM"
 *  - "XBTUSDT"   -> "XBT-USDTM"
 *  - "MYROUSDT"  -> "MYRO-USDTM"
 *  - "WIF-USDTM" -> "WIF-USDTM" (idempotent)
 *  - "PERP", "PERPUSDT" -> "" (no contract)
 */
function toKuCoinContractSymbol(symbol) {
  if (!symbol) return '';
  let s = String(symbol).trim().toUpperCase();

  // Reject generic perpetual placeholders
  if (s === 'PERP' || s === 'PERPUSDT') return '';

  // Normalize noise then apply BTC/XBT special-cases
  s = s.replace(/[-\/]/g, '').replace(/PERP/gi, '');

  // BTC special-case (KuCoin uses XBT)
  if (['BTCUSDT', 'BTCUSDTM', 'XBTUSDT', 'BTC-USDT', 'XBT-USDT', 'XBTUSDTM'].includes(s)) {
    return 'XBT-USDTM';
  }

  // Already futures with M suffix?
  if (s.endsWith('USDTM')) return `${s.slice(0, -5)}-USDTM`;
  if (s.endsWith('USDT'))  return `${s.slice(0, -4)}-USDTM`;

  return `${s}-USDTM`;
}

// ── scanner cache ──────────────────────────────────────────────────────────
async function refreshScanTokens() {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    const res = await axios.get(SCAN_ENDPOINT, { timeout: 12000 });
    const json = res.data;

    if (json?.top50 && Array.isArray(json.top50) && json.top50.length) {
      cachedTokens = json.top50;
      lastUpdated = Date.now();
      console.log(`✅ Scanner token cache updated (${cachedTokens.length})`);
    } else {
      console.warn('⚠️ Invalid scanner data shape from /api/scan-tokens');
    }
  } catch (err) {
    console.error('❌ Scanner refresh error:', err?.response?.data || err.message);
  } finally {
    isRefreshing = false;
  }
}

async function getCachedTokens(force = false) {
  const stale = Date.now() - lastUpdated > STALE_MS;
  if (force || stale || !cachedTokens.length) {
    await refreshScanTokens();
  }
  return cachedTokens;
}

function getScanTokenBySymbol(symbol) {
  const norm = normalizeSymbol(symbol);
  return cachedTokens.find(t => normalizeSymbol(t.symbol) === norm) || null;
}

// Convenience: returns a shallow-safe number (NaN if not numeric)
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : NaN; }

// Optional: expose a quick “get enriched row” helper used by some UIs
function getEnrichedBySymbol(symbol) {
  const row = getScanTokenBySymbol(symbol);
  if (!row) return null;

  const price = n(row.price ?? row.lastPrice);
  const qv = getQuoteVolume(row);
  const changePct = n(row.priceChgPct ?? row.change);

  return {
    symbol: String(row.symbol || '').toUpperCase(),
    price,
    quoteVolume: Number.isFinite(qv) ? qv : NaN,
    changePct,
    raw: row
  };
}

// ============================================================================
//                         KuCoin Futures API signer
// ============================================================================

const KUCOIN_HOST = process.env.KC_FUTURES_BASE || 'https://api-futures.kucoin.com';

const KC_API_KEY        = process.env.KC_API_KEY || process.env.KUCOIN_API_KEY;
const KC_API_SECRET     = process.env.KC_API_SECRET || process.env.KUCOIN_API_SECRET;
const KC_API_PASSPHRASE = process.env.KC_API_PASSPHRASE || process.env.KUCOIN_API_PASSPHRASE;
const KC_KEY_VERSION    = process.env.KC_API_KEY_VERSION || '2';

/**
 * Build KuCoin Futures auth headers.
 * - timestamp: **milliseconds** (Date.now().toString())
 * - prehash:   ts + method + path + query + body
 * - sign:      base64(HMAC_SHA256(secret, prehash))
 * - passphrase (v2): base64(HMAC_SHA256(secret, rawPassphrase))
 */
function signKucoinRequest({ method, path, query = '', body = '' }) {
  if (!KC_API_KEY || !KC_API_SECRET || !KC_API_PASSPHRASE) {
    throw new Error('KuCoin API credentials are missing (KC_API_KEY/SECRET/PASSPHRASE)');
  }

  const ts = Date.now().toString();                      // <-- milliseconds
  const q  = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  const prehash = `${ts}${String(method).toUpperCase()}${path}${q}${body}`;

  const sign = crypto.createHmac('sha256', KC_API_SECRET)
    .update(prehash)
    .digest('base64');

  const passphrase = crypto.createHmac('sha256', KC_API_SECRET)
    .update(KC_API_PASSPHRASE)
    .digest('base64');

  return {
    ts,
    headers: {
      'KC-API-KEY': KC_API_KEY,
      'KC-API-SIGN': sign,
      'KC-API-TIMESTAMP': ts,
      'KC-API-PASSPHRASE': passphrase,
      'KC-API-KEY-VERSION': KC_KEY_VERSION,
      'Content-Type': 'application/json'
    }
  };
}

async function kucoinGet(path, query = '', { timeout = 10000 } = {}) {
  const { headers } = signKucoinRequest({ method: 'GET', path, query });
  const url = `${KUCOIN_HOST}${path}${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`;
  return axios.get(url, { headers, timeout });
}

async function kucoinPost(path, bodyObj = {}, { timeout = 10000 } = {}) {
  const body = JSON.stringify(bodyObj);
  const { headers } = signKucoinRequest({ method: 'POST', path, body });
  const url = `${KUCOIN_HOST}${path}`;
  return axios.post(url, bodyObj, { headers, timeout });
}

// Example convenience: fetch open positions (you can use this or your existing helper)
async function getOpenFuturesPositionsKucoin() {
  try {
    const { data } = await kucoinGet('/api/v1/positions'); // KuCoin Futures endpoint
    return data?.data || data?.positions || [];
  } catch (e) {
    // surface KuCoin’s message for faster debugging
    const msg = e?.response?.data?.msg || e?.message || 'unknown';
    console.warn('Fetching positions failed:', msg);
    throw e;
  }
}

// ============================================================================

module.exports = {
  // scanner cache
  getCachedTokens,
  refreshScanTokens,
  getScanTokenBySymbol,
  getEnrichedBySymbol,

  // symbols / helpers
  normalizeSymbol,
  toKuCoinContractSymbol,
  getQuoteVolume,

  // kucoin signer + helpers
  signKucoinRequest,
  kucoinGet,
  kucoinPost,
  getOpenFuturesPositionsKucoin
};