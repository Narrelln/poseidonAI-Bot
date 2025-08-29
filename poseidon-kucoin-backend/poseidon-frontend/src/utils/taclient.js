// src/utils/taClient.js

/**
 * Normalize a symbol to TA backend format:
 *  - "BTC-USDTM" → "BTCUSDT"
 *  - "BTCUSDTM"  → "BTCUSDT"
 *  - "btc/usdt"  → "BTCUSDT"
 *  - "BTCUSDT"   → "BTCUSDT" (unchanged)
 */
export function toTaSymbol(input) {
    if (!input) return '';
    let s = String(input).trim().toUpperCase().replace(/[-_/]/g, '');
    if (s.endsWith('USDTM')) s = s.slice(0, -1); // strip trailing 'M'
    if (!s.endsWith('USDT')) s += 'USDT';
    return s;
  }
  
  /**
   * Fetch TA for a symbol (spot-format).
   * Ensures consistent numeric fields:
   *   - price (number, fallback 0)
   *   - volumeBase (coins, fallback 0)
   *   - quoteVolume (USDT, computed if absent, fallback 0)
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
        return {
          ok: false,
          nodata: true,
          error: `HTTP ${res.status} ${text}`.trim()
        };
      }
  
      const raw = await res.json();
  
      if (raw?.nodata) {
        return {
          ok: false,
          nodata: true,
          error: raw?.error || 'No data',
          volumeBase: Number(raw?.volumeBase ?? 0),
          quoteVolume: Number(raw?.quoteVolume ?? 0)
        };
      }
  
      // --- normalize numbers ---
      const price = Number(raw.price ?? 0);
      const volumeBase = Number(
        raw.volumeBase ?? raw.volume ?? raw.baseVolume ?? 0
      );
      const quoteVolume = Number(
        raw.quoteVolume ??
        (Number.isFinite(price) && Number.isFinite(volumeBase)
          ? price * volumeBase
          : 0)
      );
  
      return {
        ok: true,
        nodata: false,
        ...raw,
        price,
        volumeBase,
        quoteVolume
      };
  
    } catch (err) {
      return {
        ok: false,
        nodata: true,
        error: err.message || 'Network error',
        price: 0,
        volumeBase: 0,
        quoteVolume: 0
      };
    }
  }