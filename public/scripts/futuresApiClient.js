// /public/scripts/futuresApiClient.js  (clean + aligned with server)
// - Normalizes symbols consistently
// - Uses /api/place-futures-trade with { margin } (not notionalUsd)
// - Enforces leverage bands: majors 20–50x, others 10–20x
// - Keeps scanner/volume helpers and wallet endpoints

const BASE_URL = '/api';
const MAX_VOLUME_CAP = 20_000_000;
const MIN_VOLUME_THRESHOLD = 100_000;

let cachedSymbols = [];

// ---- categories for leverage rules ----
const MAJORS = new Set(['BTC','XBT','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC']);
const MEMES  = new Set(['WIF','TRUMP','MYRO','PEPE','FLOKI','BONK','SHIB']);

export function toKuCoinContractSymbol(symbol) {
  if (!symbol) return '';
  let s = symbol.trim().toUpperCase();

  if (s === 'PERP' || s === 'PERPUSDT') return '';

  // BTC alias normalization (KuCoin futures uses XBT for BTC perp)
  if (['BTCUSDT', 'BTC-USDT', 'BTCUSDTM', 'XBTUSDT', 'XBT-USDT'].includes(s)) return 'XBT-USDTM';

  s = s.replace(/[-\/]/g, '').replace(/PERP/i, '');
  if (s.endsWith('USDTM')) return s.replace(/(.*)(USDTM)$/, '$1-$2');
  if (s.endsWith('USDT'))  return (s + 'M').replace(/(.*)(USDTM)$/, '$1-$2');
  return (s + 'USDTM').replace(/(.*)(USDTM)$/, '$1-$2');
}

function normalizeSymbol(symbol) {
  return String(symbol || '').replace(/[-_]/g, '').toUpperCase();
}

function baseOf(symbol) {
  let b = normalizeSymbol(symbol);
  b = b.replace(/USDTM?$/, '');
  if (b === 'XBT') b = 'BTC';
  return b;
}

function isMajor(base) {
  return MAJORS.has(base);
}

function clampLeverageFor(base, lev) {
  const n = Math.max(1, Number(lev) || 1);
  if (isMajor(base)) {
    // majors: 20–50x
    return Math.max(20, Math.min(50, n));
  }
  // others (incl. memes): 10–20x
  return Math.max(10, Math.min(20, n));
}

function isValidVolume(entry) {
  const vol = parseFloat(entry?.quoteVolume24h ?? entry?.quoteVolume ?? entry?.volume ?? '0');
  return !isNaN(vol) && vol >= MIN_VOLUME_THRESHOLD && vol <= MAX_VOLUME_CAP;
}

function isValidSymbolFormat(symbol) {
  return symbol &&
    typeof symbol === 'string' &&
    symbol.endsWith('-USDTM') &&
    !symbol.includes('..') &&
    symbol.length <= 20 &&
    /^[A-Z0-9\-]+$/.test(symbol);
}

function getScanTokenBySymbol(symbol) {
  const norm = normalizeSymbol(symbol);
  return cachedSymbols.find(s => normalizeSymbol(s.symbol) === norm);
}

// ------------- API: positions / symbols / wallet -------------
export async function getOpenPositions(symbol = null) {
  try {
    const res = await window.axios.get(`${BASE_URL}/positions`);
    const json = res.data;
    const all = json.positions || [];

    if (!symbol) return all;

    const filtered = {};
    const upper = String(symbol).toUpperCase();
    for (const p of all) {
      const lhs = String(p.contract || p.symbol || '').toUpperCase();
      if (lhs === toKuCoinContractSymbol(upper) || lhs === upper) {
        const side = (p.side || '').toUpperCase();
        if (side === 'BUY' || side === 'SELL') filtered[side] = p;
      }
    }
    return filtered;
  } catch {
    return symbol ? {} : [];
  }
}

export async function fetchKuCoinFuturesSymbols() {
  try {
    const res = await window.axios.get(`${BASE_URL}/futures-symbols`);
    return res.data.symbols || [];
  } catch {
    return [];
  }
}

// Use scanner route for tradable list (has volume)
export async function fetchTradableSymbols() {
  try {
    const res = await window.axios.get(`${BASE_URL}/scan-tokens`);
    const data = res.data || {};
    const list = Array.isArray(data.top50) ? data.top50 : [];
    const valid = list
      .filter(t => isValidSymbolFormat(t.symbol))
      .filter(isValidVolume)
      .slice(0, 50)
      .map(t => ({ ...t, symbol: toKuCoinContractSymbol(t.symbol) }));

    cachedSymbols = valid;
    return valid;
  } catch {
    cachedSymbols = [];
    return [];
  }
}

export async function getWalletBalance() {
  try {
    const res = await window.axios.get(`${BASE_URL}/wallet-balance`);
    const json = res.data;
    if (json.success && json.balance) {
      const total = Number(json.balance.total);
      return Number.isFinite(total) ? total : null;
    } else {
      throw new Error(json.error || 'Failed to fetch balance');
    }
  } catch {
    return null;
  }
}

// ------------- Helpers for sizing -------------
export async function calculateTradeAmountUSD({ percentage = 0.05, symbol = 'DOGEUSDTM' } = {}) {
  // Returns USD (margin) to send to the route, not contracts.
  try {
    const balance = await getWalletBalance();
    if (!Number.isFinite(balance)) return 1;
    const usdAmount = balance * Number(percentage || 0.05);
    return Math.max(1, Math.round(usdAmount));
  } catch {
    return 1;
  }
}

// Backwards-compat alias (previously returned "contracts"; now returns USD)
export const calculateTradeAmount = calculateTradeAmountUSD;

export async function fetchTradeHistory() {
  try {
    const res = await window.axios.get(`${BASE_URL}/trade-history`);
    return res.data.trades || [];
  } catch {
    return [];
  }
}

// ------------- Placement (aligned with server route) -------------
export async function placeTrade(symbol, side, marginUsd, leverage = 10, opts = {}) {
  // Normalize to KuCoin futures contract
  const contract = toKuCoinContractSymbol(symbol);
  const base = baseOf(contract);

  // Enforce leverage policy client-side
  const lev = clampLeverageFor(base, leverage);

  // Optional price passthrough (server will fetch TA if omitted)
  let price = Number(opts.price);
  if (!Number.isFinite(price) || price <= 0) {
    try {
      const spot = contract.replace('-USDTM', 'USDT');
      const { data } = await window.axios.get(`${BASE_URL.replace('/api','')}/api/ta/${encodeURIComponent(spot)}`);
      const p = Number(data?.price ?? data?.markPrice);
      if (Number.isFinite(p) && p > 0) price = p;
    } catch { /* optional */ }
  }

  const payload = {
    symbol: contract,            // route normalizes; hyphenated FUT is ideal
    side: String(side || 'buy').toLowerCase(), // 'buy' | 'sell'
    margin: Number(marginUsd) || 1,            // ✅ server expects "margin" (USDT)
    leverage: lev,
    confidence: 90,
    ...(Number.isFinite(price) && price > 0 ? { price } : {}),
    note: opts.note || 'Client placement',
    // optional TP/SL passthroughs if provided
    ...(Number.isFinite(opts.tpPercent) ? { tpPercent: Number(opts.tpPercent) } : {}),
    ...(Number.isFinite(opts.slPercent) ? { slPercent: Number(opts.slPercent) } : {}),
  };

  const res = await window.axios.post(`${BASE_URL}/place-futures-trade`, payload);
  return res.data;
}

window.toKuCoinContractSymbol = toKuCoinContractSymbol;