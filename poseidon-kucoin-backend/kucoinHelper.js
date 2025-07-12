const axios = require('axios');
const { signKucoinV3Request } = require('./utils/signRequest');
require('dotenv').config();

const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

const activeKucoinSymbols = new Set();

async function initializeActiveKucoinSymbols() {
  try {
    const res = await axios.get(`${BASE_URL}/api/v1/contracts/active`);
    const symbols = res.data?.data?.map(c => c.symbol);
    if (Array.isArray(symbols)) {
      symbols.forEach(sym => activeKucoinSymbols.add(sym));
      console.log(`[Kucoin] Loaded ${symbols.length} active symbols`);
    }
  } catch (err) {
    console.warn('[Kucoin] Failed to load active contract symbols:', err?.response?.data || err.message);
  }
}

function parseToKucoinContractSymbol(symbol) {
  if (!symbol) return '';
  let raw = symbol.trim().toUpperCase().replace(/[^A-Z]/g, '');

  if (raw === 'BTCUSDT' || raw === 'BTCUSDTM' || raw === 'BTC') return 'XBT-USDTM';
  if (raw === 'XBTUSDT' || raw === 'XBT') return 'XBT-USDTM';

  if (activeKucoinSymbols.has(raw)) return raw;

  raw = raw.replace(/(USDTM|USDT)$/, '');
  const dashFormat = `${raw}-USDTM`;
  return activeKucoinSymbols.has(dashFormat) ? dashFormat : raw + 'USDTM';
}

async function fetchKucoinTickerPrice(symbol) {
  const contract = parseToKucoinContractSymbol(symbol);
  try {
    const res = await axios.get(`${BASE_URL}/api/v1/ticker?symbol=${contract}`);
    const price = res.data?.data?.price;
    return price ? parseFloat(price) : null;
  } catch (err) {
    console.warn(`[Kucoin] Ticker fallback for ${contract}:`, err.message);
    try {
      const markRes = await axios.get(`${BASE_URL}/api/v1/mark-price/${contract}/current`);
      const markPrice = markRes.data?.data?.value;
      return markPrice ? parseFloat(markPrice) : null;
    } catch (fallbackErr) {
      console.error(`[Kucoin] Price fetch failed for ${contract}:`, fallbackErr?.message || fallbackErr);
      return null;
    }
  }
}

async function setLeverageForSymbol(contract, leverage) {
  const endpoint = '/api/v1/position/margin/leverage';
  const payload = {
    symbol: parseToKucoinContractSymbol(contract),
    leverage: leverage.toString(),
    marginType: 'isolated'
  };
  const headers = signKucoinV3Request('POST', endpoint, '', JSON.stringify(payload), API_KEY, API_SECRET, API_PASSPHRASE);

  try {
    console.log(`[Kucoin] SET Leverage: ${payload.symbol} → ${leverage}x`);
    const res = await axios.post(`${BASE_URL}${endpoint}`, payload, { headers });
    return res.data;
  } catch (err) {
    console.error(`❌ Leverage set failed for ${payload.symbol}:`, err?.response?.data || err.message);
    throw err;
  }
}

async function getOpenFuturesPositions() {
  const endpoint = '/api/v1/positions';
  const headers = signKucoinV3Request('GET', endpoint, '', '', API_KEY, API_SECRET, API_PASSPHRASE);

  try {
    const res = await axios.get(`${BASE_URL}${endpoint}`, { headers });
    const raw = res.data?.data || [];
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const positions = raw.filter(pos => Math.abs(Number(pos.currentQty)) > 0);

    const tickerPriceMap = {};
    await Promise.all(
      positions.map(async pos => {
        try {
          const tickerSymbol = parseToKucoinContractSymbol(pos.symbol);
          const price = await fetchKucoinTickerPrice(tickerSymbol);
          tickerPriceMap[pos.symbol] = price || parseFloat(pos.avgEntryPrice || 0);
        } catch {
          tickerPriceMap[pos.symbol] = parseFloat(pos.avgEntryPrice || 0);
        }
      })
    );

    return positions.map(pos => {
      const quantity = Number(pos.currentQty);
      const size = Math.abs(quantity);
      const isLong = quantity > 0;

      const entryPrice = parseFloat(pos.avgEntryPrice || 0);
      const markPrice = tickerPriceMap[pos.symbol] || entryPrice;

      const leverage = Number(pos.leverage) || 1;
      const value = size * entryPrice;
      const margin = leverage > 0 ? value / leverage : value;

      const pnl = isLong
        ? (markPrice - entryPrice) * size
        : (entryPrice - markPrice) * size;

      const roi = margin > 0 ? ((pnl / margin) * 100).toFixed(2) + '%' : '-';

      return {
        contract: pos.symbol,
        symbol: pos.symbol,
        side: isLong ? 'buy' : 'sell',
        entryPrice: entryPrice.toFixed(4),
        quantity,
        size,
        margin: margin.toFixed(2),
        value: value.toFixed(2),
        pnlValue: pnl.toFixed(2),
        roi,
        markPrice,
        liquidation: parseFloat(pos.liquidationPrice || 0).toFixed(4),
        leverage: leverage.toFixed(2)
      };
    });
  } catch (err) {
    console.error('❌ Error fetching positions:', err?.response?.data || err);
    if (err.response) throw new Error(JSON.stringify(err.response.data));
    throw err;
  }
}

async function getKucoinWalletBalance(currency = 'USDT') {
  const endpoint = '/api/v1/account-overview';
  const query = `currency=${currency}`;
  const headers = signKucoinV3Request('GET', endpoint, query, '', API_KEY, API_SECRET, API_PASSPHRASE);
  try {
    const res = await axios.get(`${BASE_URL}${endpoint}?${query}`, { headers });
    const data = res.data.data;
    return {
      total: parseFloat(data.accountEquity).toFixed(2),
      available: parseFloat(data.availableBalance).toFixed(2)
    };
  } catch (err) {
    console.error('❌ Wallet error:', err?.response?.data || err);
    return {
      total: '0.00',
      available: '0.00',
      error: 'Fetch failed'
    };
  }
}

async function getKucoinFuturesSymbols() {
  const endpoint = '/api/v1/contracts/active';
  try {
    const res = await axios.get(`${BASE_URL}${endpoint}`);
    return res.data.data
      .filter(c => /USDTM$/i.test(c.symbol) && /Open/i.test(c.status))
      .map(c => c.symbol)
      .sort();
  } catch (err) {
    console.error('❌ Fetching symbols failed:', err?.response?.data || err);
    return [];
  }
}

module.exports = {
  getKucoinWalletBalance,
  getKucoinFuturesSymbols,
  getOpenFuturesPositions,
  parseToKucoinContractSymbol,
  fetchKucoinTickerPrice,
  setLeverageForSymbol,
  initializeActiveKucoinSymbols
};