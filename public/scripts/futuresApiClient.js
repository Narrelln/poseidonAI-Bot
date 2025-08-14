// === /public/scripts/futuresApiClient.js ===
// Frontend-safe version of futuresApi.js for browser usage
// Uses window.axios (included in Poseidon) for all requests

const BASE_URL = '/api';
const MAX_VOLUME_CAP = 20_000_000;
const MIN_VOLUME_THRESHOLD = 100_000;

let cachedSymbols = [];

export function toKuCoinContractSymbol(symbol) {
  if (!symbol) return '';
  let s = symbol.trim().toUpperCase();

  if (s === 'PERP' || s === 'PERPUSDT') return '';
  if (['BTCUSDT', 'BTC-USDT', 'BTCUSDTM', 'XBTUSDT'].includes(s)) return 'XBT-USDTM';

  s = s.replace(/[-\/]/g, '').replace(/PERP/i, '');
  if (s.endsWith('USDTM')) return insertDashBeforeUSDTM(s);
  if (s.endsWith('USDT')) return insertDashBeforeUSDTM(s + 'M');

  return insertDashBeforeUSDTM(s + 'USDTM');
}

function insertDashBeforeUSDTM(str) {
  return str.replace(/(.*)(USDTM)$/, '$1-USDTM');
}

function normalizeSymbol(symbol) {
  return symbol.replace(/[-_]/g, '').toUpperCase();
}

function isValidVolume(entry) {
  const vol = parseFloat(entry?.quoteVolume || entry?.volume || '0');
  return !isNaN(vol) && vol >= MIN_VOLUME_THRESHOLD && vol <= MAX_VOLUME_CAP;
}

function isValidSymbolFormat(symbol) {
  return symbol &&
    typeof symbol === 'string' &&
    symbol.endsWith('-USDTM') &&
    !symbol.includes('..') &&
    symbol.length <= 15 &&
    /^[A-Z\-]+$/.test(symbol);
}

function getScanTokenBySymbol(symbol) {
  const norm = normalizeSymbol(symbol);
  return cachedSymbols.find(s => normalizeSymbol(s.symbol) === norm);
}

export async function getOpenPositions(symbol = null) {
  try {
    const res = await window.axios.get(`${BASE_URL}/positions`);
    const json = res.data;
    const all = json.positions || [];

    if (!symbol) return all;

    const filtered = {};
    const upper = symbol.toUpperCase();
    for (const p of all) {
      if (p.symbol === upper || p.contract === toKuCoinContractSymbol(symbol)) {
        const side = p.side?.toUpperCase();
        if (side === 'BUY' || side === 'SELL') filtered[side] = p;
      }
    }

    return filtered;
  } catch (err) {
    return symbol ? {} : [];
  }
}

export async function fetchKuCoinFuturesSymbols() {
  try {
    const res = await window.axios.get(`/api/futures-symbols`);
    return res.data.symbols || [];
  } catch (err) {
    return [];
  }
}

export async function fetchTradableSymbols() {
  const symbols = await fetchKuCoinFuturesSymbols();
  const valid = symbols
    .filter(s => isValidSymbolFormat(s.symbol) && isValidVolume(s))
    .slice(0, 30)
    .map(s => ({
      ...s,
      symbol: toKuCoinContractSymbol(s.symbol)
    }));

  cachedSymbols = valid;
  return valid;
}

export async function getWalletBalance() {
  try {
    const res = await window.axios.get(`${BASE_URL}/wallet-balance`);
    const json = res.data;

    if (json.success && json.balance) {
      const total = Number(json.balance.total);
      return !isNaN(total) ? total : null;
    } else {
      throw new Error(json.error || "Failed to fetch balance");
    }
  } catch (err) {
    return null;
  }
}

export async function calculateTradeAmount({ percentage = 0.1, symbol = "DOGEUSDTM" }) {
  try {
    const balance = await getWalletBalance();
    if (!balance || isNaN(balance)) return 1;

    const token = getScanTokenBySymbol(symbol);
    const price = parseFloat(token?.price);
    if (!price || isNaN(price)) return 1;

    const usdAmount = balance * percentage;
    const contracts = +(usdAmount / price).toFixed(3);
    return contracts || 1;
  } catch (err) {
    return 1;
  }
}

export async function fetchTradeHistory() {
  try {
    const res = await window.axios.get(`${BASE_URL}/trade-history`);
    return res.data.trades || [];
  } catch (err) {
    return [];
  }
}

export async function placeTrade(symbol, side, notionalUsd, leverage = 10) {
  const payload = {
    contract: symbol.toUpperCase(),
    side,
    notionalUsd,
    leverage,
    type: 'market',
    reduceOnly: false
  };
  return await window.axios.post('/api/place-trade', payload).then(res => res.data);
}


// Debug helper
window.toKuCoinContractSymbol = toKuCoinContractSymbol;