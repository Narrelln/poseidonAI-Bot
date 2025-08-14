// /public/scripts/taClient.js (patched)

/**
 * Normalize any of:
 *  - "BTC-USDTM" → "BTCUSDT"
 *  - "BTCUSDTM"  → "BTCUSDT"
 *  - "btc/usdt"  → "BTCUSDT"
 *  - "BTCUSDT"   → "BTCUSDT" (unchanged)
 */
function toTaSymbol(input) {
  if (!input) return '';
  let s = String(input).trim().toUpperCase().replace(/[-_/]/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -1); // strip trailing M
  if (!s.endsWith('USDT')) s += 'USDT';
  return s;
}

/**
 * Fetch TA for a symbol (spot-format).
 * Returns an object like:
 *   { ok: true, nodata: false, price, signal, confidence, volume, ... }
 * or
 *   { ok: false, nodata: true, error }
 */
export async function fetchTA(symbol) {
  const taSymbol = toTaSymbol(symbol);
  if (!taSymbol) {
    return { ok: false, nodata: true, error: 'Empty symbol' };
  }

  try {
    const res = await fetch(`/api/ta/${taSymbol}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, nodata: true, error: `HTTP ${res.status} ${text}`.trim() };
    }

    const data = await res.json();

    // Your TA route already returns { nodata: boolean, ...fields }
    if (data?.nodata) {
      return { ok: false, nodata: true, error: data?.error || 'No data', volume: data?.volume };
    }

    // Happy path
    return { ok: true, nodata: false, ...data };

  } catch (err) {
    return { ok: false, nodata: true, error: err.message || 'Network error' };
  }
}