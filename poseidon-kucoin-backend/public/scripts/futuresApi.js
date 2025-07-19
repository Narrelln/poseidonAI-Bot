// === futuresApi.js — Patched KuCoin Futures API Module ===

const BASE_URL = 'http://localhost:3000';
const MAX_VOLUME_CAP = 20_000_000;
const MIN_VOLUME_THRESHOLD = 100_000;

let cachedSymbols = [];
let lastFetched = 0;

export function toKuCoinContractSymbol(symbol) {
  if (!symbol) return '';
  let s = symbol.trim().toUpperCase();
  if (s === 'BTCUSDT' || s === 'BTC-USDT' || s === 'BTCUSDTM' || s === 'XBTUSDT') return 'XBTUSDTM';
  s = s.replace(/-?USDTM$/i, '').replace(/-?USDT$/i, '');
  s = s.replace(/[^A-Z]/g, '');
  return s + '-USDTM';
}

function isValidSymbolFormat(symbol) {
  return symbol && typeof symbol === 'string' &&
    symbol.endsWith('-USDTM') &&
    !symbol.includes('..') &&
    symbol.length <= 15 &&
    /^[A-Z\-]+$/.test(symbol);
}

function isValidVolume(entry) {
  const vol = parseFloat(entry?.quoteVolume || entry?.volume || '0');
  return !isNaN(vol) && vol >= MIN_VOLUME_THRESHOLD && vol <= MAX_VOLUME_CAP;
}

export function initFuturesAPI() {
  console.log("📡 KuCoin Futures API initialized.");
}

export async function fetchFuturesPrice(symbol = "DOGEUSDTM") {
  try {
    const contractSymbol = toKuCoinContractSymbol(symbol);
    if (!isValidSymbolFormat(contractSymbol)) {
      console.warn(`[SKIP] Invalid contract symbol: ${contractSymbol}`);
      return { price: 0, history: [], failed: true };
    }

    const res = await fetch(`${BASE_URL}/api/futures-price/${contractSymbol}`);

    const contentType = res.headers.get("content-type");
    if (!res.ok || !contentType?.includes("application/json")) {
      throw new Error(`Invalid response: status ${res.status}, type ${contentType}`);
    }

    const json = await res.json();

    if (json && typeof json.price === 'number') {
      return {
        price: parseFloat(json.price),
        history: json.history || [],
        failed: false
      };
    } else {
      throw new Error(json.error || 'No price data');
    }
  } catch (err) {
    console.error("❌ Price fetch failed:", err.message);
    return { price: 0, history: [], failed: true };
  }
}

export async function fetchVolumeAndOI(symbol = "DOGEUSDTM") {
  try {
    const contractSymbol = toKuCoinContractSymbol(symbol);
    const res = await fetch(`${BASE_URL}/api/futures-symbols`);
    const json = await res.json();

    if (!res.ok || !json?.symbols?.length) {
      throw new Error(`Symbol list fetch failed: ${res.status}`);
    }

    const entry = json.symbols.find(s => s.symbol === contractSymbol);
    if (!entry) {
      console.warn(`⚠️ Symbol ${contractSymbol} not found in /api/futures-symbols`);
      return { volume: "0", openInterest: "0", notFound: true };
    }

    const volume = entry?.quoteVolume ?? entry?.volume ?? "0";
    return {
      volume: volume.toString(),
      openInterest: entry?.openInterest?.toString() || "N/A"
    };
  } catch (err) {
    console.error(`❌ Volume fetch failed for ${symbol}:`, err.message);
    return { volume: "0", openInterest: "0", error: err.message };
  }
}

export async function getOpenPositions(symbol = null) {
  try {
    const res = await fetch(`${BASE_URL}/api/positions`);
    if (!res.ok) throw new Error(`Backend error ${res.status}`);
    const json = await res.json();
    const all = json.positions || [];

    if (!symbol) return all;

    const filtered = {};
    const upper = symbol.toUpperCase();
    for (const p of all) {
      if (p.symbol === upper || p.contract === toKuCoinContractSymbol(symbol)) {
        const side = p.side?.toUpperCase();
        if (side === 'BUY' || side === 'SELL') {
          filtered[side] = p;
        }
      }
    }

    return filtered;
  } catch (err) {
    console.error("❌ Open position fetch failed:", err.message);
    return symbol ? {} : [];
  }
}

export async function fetchKuCoinFuturesSymbols() {
  try {
    const res = await fetch(`${BASE_URL}/api/futures-symbols`);
    const json = await res.json();
    return json.symbols || [];
  } catch (err) {
    console.error('❌ Failed to fetch KuCoin futures symbols:', err.message);
    return [];
  }
}

export async function fetchTradableSymbols() {
  try {
    const symbols = await fetchKuCoinFuturesSymbols();
    const valid = symbols
      .filter(s => isValidSymbolFormat(s.symbol) && isValidVolume(s))
      .slice(0, 30); // scanner limit

    cachedSymbols = valid;
    lastFetched = Date.now();
    return valid;
  } catch (err) {
    console.error("❌ Failed to fetch tradable symbols:", err.message);
    return [];
  }
}

export async function getWalletBalance() {
  try {
    const res = await fetch(`${BASE_URL}/api/balance`);
    const json = await res.json();
    if (json.success) return json.balance;
    else throw new Error(json.error || "Failed to fetch balance");
  } catch (err) {
    console.error("❌ Wallet balance fetch error:", err.message);
    return null;
  }
}

export async function calculateTradeAmount({ percentage = 0.1, symbol = "DOGEUSDTM" }) {
  try {
    const balance = await getWalletBalance();
    if (!balance || isNaN(balance)) return 1;

    const { price, failed } = await fetchFuturesPrice(symbol);
    if (failed || !price) return 1;

    const usdAmount = balance * percentage;
    const contracts = +(usdAmount / price).toFixed(3);
    return contracts || 1;
  } catch (err) {
    console.error("❌ Capital allocation failed:", err.message);
    return 1;
  }
}

export async function fetchTradeHistory() {
  try {
    const res = await fetch(`${BASE_URL}/api/trade-history`);
    const json = await res.json();
    return json.trades || [];
  } catch (err) {
    console.error("❌ Trade history fetch error:", err.message);
    return [];
  }
}