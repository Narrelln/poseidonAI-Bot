const BASE_URL = 'http://localhost:3000';
const MAX_VOLUME_CAP = 20_000_000;

let cachedSymbols = [];
let lastFetched = 0;

// --- SYMBOL HELPER ---
function toKuCoinContractSymbol(symbol) {
  if (!symbol) return '';
  let s = symbol.trim().toUpperCase();
  if (s === 'BTCUSDT' || s === 'BTC-USDT' || s === 'BTCUSDTM' || s === 'XBTUSDT') return 'XBTUSDTM';

  s = s.replace(/-?USDTM$/i, '').replace(/-?USDT$/i, '');
  s = s.replace(/[^A-Z]/g, '');
  return s + '-USDTM';
}

export function initFuturesAPI() {
  console.log("📡 KuCoin Futures API initialized.");
}

// === ✅ PATCHED: Robust price + history fetch ===
export async function fetchFuturesPrice(symbol = "DOGEUSDTM") {
  try {
    const contractSymbol = toKuCoinContractSymbol(symbol);
    const res = await fetch(`${BASE_URL}/api/futures-price/${contractSymbol}`);
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

// === ✅ PATCHED: Volume & OI with fallback on 429/500 ===
export async function fetchVolumeAndOI(symbol = "DOGEUSDTM") {
  try {
    const contractSymbol = toKuCoinContractSymbol(symbol);
    const res = await fetch(`${BASE_URL}/api/kucoin/market-stats?symbol=${contractSymbol}`);

    if (!res.ok) {
      if (res.status === 429) {
        console.warn(`⚠️ Rate limited while fetching volume for ${symbol}.`);
      } else {
        console.warn(`⚠️ Server error (${res.status}) for ${symbol}.`);
      }
      return { volume: "0", openInterest: "0" };
    }

    const json = await res.json();

    if (json?.code === '200000' && json.data?.vol !== undefined) {
      return {
        volume: json.data.vol,
        openInterest: "N/A"
      };
    } else if (json?.vol !== undefined) {
      return {
        volume: json.vol,
        openInterest: "N/A"
      };
    } else {
      throw new Error(json.error || 'No volume');
    }
  } catch (err) {
    console.error(`❌ Volume fetch failed for ${symbol}:`, err.message);
    return { volume: "0", openInterest: "0" };
  }
}

// === Get open positions from backend ===
export async function getOpenPositions() {
  try {
    const res = await fetch(`${BASE_URL}/api/positions`);
    if (!res.ok) throw new Error(`Backend error ${res.status}`);
    const json = await res.json();
    return json.positions || [];
  } catch (err) {
    console.error("❌ Open position fetch failed:", err);
    return [];
  }
}

// === Get list of tradable futures symbols (cached) ===
export async function fetchKuCoinFuturesSymbols() {
  try {
    const res = await fetch(`${BASE_URL}/api/futures-symbols`);
    const json = await res.json();
    return json.symbols || [];
  } catch (err) {
    console.error('❌ Failed to fetch KuCoin futures symbols:', err);
    return [];
  }
}

export async function fetchTradableSymbols() {
  try {
    const symbols = await fetchKuCoinFuturesSymbols();
    cachedSymbols = symbols;
    lastFetched = Date.now();
    return symbols;
  } catch (err) {
    console.error("❌ Failed to fetch tradable symbols:", err);
    return [];
  }
}

// === Wallet balance ===
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

// === Trade history ===
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

// === Gainers/Losers ===
export async function fetchTopGainers(limit = 21) {
  try {
    const res = await fetch(`${BASE_URL}/api/top-gainers`);
    const list = await res.json();
    return Array.isArray(list) ? list.slice(0, limit) : [];
  } catch (err) {
    console.error("❌ fetchTopGainers failed:", err.message);
    return [];
  }
}

export async function fetchTopLosers(limit = 9) {
  try {
    const res = await fetch(`${BASE_URL}/api/top-losers`);
    const list = await res.json();
    return Array.isArray(list) ? list.slice(0, limit) : [];
  } catch (err) {
    console.error("❌ fetchTopLosers failed:", err.message);
    return [];
  }
}