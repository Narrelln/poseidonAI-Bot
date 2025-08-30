// patternStats.js
import { toKuCoinContractSymbol, toSpotSymbol } from './futuresApiClient.js';

// Basic guard: accept only BASEUSDT (no dashes), 3–15 letters
const SPOT_RX = /^[A-Z]{2,15}USDT$/;

function toValidSpot(input) {
  if (!input) return null;

  // Accept: ADA, ADA-USDTM, ADAUSDT, ada-usdt
  // 1) normalize to KuCoin contract, then 2) convert to spot
  let contract = toKuCoinContractSymbol(String(input).toUpperCase()); // e.g., ADA → ADA-USDTM
  if (!contract) return null;

  // robust: if helper not available, do a local normalize
  // contract should now be like ABC- USDTM
  const base = contract.replace(/-USDTM$/,'');
  const spot = `${base}USDT`;

  // final sanity
  return SPOT_RX.test(spot) ? spot : null;
}

// ---- single-flight + backoff to avoid spam on 400/502 ----
const inflight = new Map();   // key -> Promise
const backoff  = new Map();   // key -> timestamp until allowed

function underBackoff(key, ms = 8000) {
  const t = backoff.get(key) || 0;
  if (Date.now() < t) return true;
  return false;
}
function setBackoff(key, ms = 8000) {
  backoff.set(key, Date.now() + ms);
}

// Main entry used by patternStats
export async function fetchCandlesSafe(symbolLike, interval = '1m', limit = 500) {
    if (!symbolLike || typeof symbolLike !== 'string' || symbolLike.length < 2) {
      console.warn('[patternStats] invalid input symbolLike:', symbolLike);
      return [];
    }
  
    const spot = toValidSpot(symbolLike.trim());
    if (!spot) {
      console.warn('[patternStats] blocked bad symbol:', symbolLike);
      return [];
    }
  
    const key = `${spot}:${interval}:${limit}`;
    if (underBackoff(key)) {
      if (Math.random() < 0.05) console.log(`[patternStats] still under backoff: ${key}`);
      return [];
    }
  
    if (inflight.has(key)) return inflight.get(key);
  
    const p = (async () => {
      try {
        const r = await fetch(`/api/ohlcv?symbol=${encodeURIComponent(spot)}&interval=${encodeURIComponent(interval)}&limit=${limit}`, { cache:'no-store' });
        if (!r.ok) {
          const body = await r.text().catch(()=> '');
          let backoffMs = 8000;
          if (r.status === 400) backoffMs = 15000;
          else if (r.status === 502 || r.status === 503) backoffMs = 20000;
          setBackoff(key, backoffMs);
          console.warn('[patternStats] ohlcv error', r.status, body.slice(0,180));
          return [];
        }
        const arr = await r.json();
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        setBackoff(key, 8000);
        console.warn('[patternStats] ohlcv fetch failed:', e.message);
        return [];
      } finally {
        inflight.delete(key);
      }
    })();
  
    inflight.set(key, p);
    return p;
  }