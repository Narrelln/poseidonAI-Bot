
// api.js – External API calls for Poseidon AI

const TENSOR_BASE = "https://api.tensor.trade";
const BIRDEYE_BASE = "https://public-api.birdeye.so";
const HELIUS_BASE = "https://api.helius.xyz/v0";

const BIRDEYE_KEY = 'cfcc5485796a4e85ac0444fac13dd9a2';
const HELIUS_KEY = '4f5e9d85-690a-4420-899d-4d9d5cac9171';

const cache = {};

async function fetchTokenData(ca) {
  if (cache[ca]?.tokenData) return cache[ca].tokenData;

  try {
    const response = await fetch(`${BIRDEYE_BASE}/public/token/${ca}`, {
      headers: { 'X-API-KEY': BIRDEYE_KEY }
    });
    const data = await response.json();
    const tokenData = data?.data || {};
    cache[ca] = { ...(cache[ca] || {}), tokenData };
    return tokenData;
  } catch (err) {
    console.warn(`Token data fetch error for ${ca}:`, err);
    return {};
  }
}

export async function fetchMarketCap(ca) {
  const data = await fetchTokenData(ca);
  return data.market_cap || 0;
}

export async function fetchBondingPercent(ca) {
  const data = await fetchTokenData(ca);
  return data.bonding_percentage || 0;
}

export async function fetchTrendingTokens() {
  try {
    const res = await fetch(`${TENSOR_BASE}/v1/projects/trending?limit=10`);
    const json = await res.json();
    return json?.projects || [];
  } catch (err) {
    console.warn('Trending fetch error:', err);
    return [];
  }
}

export async function fetchWalletTransactions(wallet) {
  try {
    const res = await fetch(`${HELIUS_BASE}/${wallet}/transactions?api-key=${HELIUS_KEY}&limit=5`);
    const json = await res.json();
    return json || [];
  } catch (err) {
    console.warn(`Helius fetch error for ${wallet}:`, err);
    return [];
  }
}

export function initAPI() {
  console.log("🌐 API module initialized.");
}
