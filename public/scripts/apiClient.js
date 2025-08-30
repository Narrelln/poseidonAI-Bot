// /public/scripts/apiClient.js
export async function fetchTradeHistory({ limit = 100 } = {}) {
    const url = `/api/trade-history?limit=${encodeURIComponent(limit)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error || 'Failed to load trade history');
    return json; // { ok, source: 'ledger-v1', trades, count }
  }