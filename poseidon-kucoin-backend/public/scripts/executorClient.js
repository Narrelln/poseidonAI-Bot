// /public/scripts/executorClient.js
function withTimeout(ms, signal) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const combined = signal
      ? new AbortSignal.any([signal, ctl.signal])
      : ctl.signal;
    return { signal: combined, cancel: () => clearTimeout(t) };
  }
  
  function jsonFetch(url, { method='GET', headers={}, body, timeout=10000, idempotencyKey } = {}) {
    const hdrs = { 'Content-Type':'application/json', ...headers };
    if (idempotencyKey) hdrs['Idempotency-Key'] = idempotencyKey;
    const { signal, cancel } = withTimeout(timeout);
    return fetch(url, { method, headers: hdrs, body: body ? JSON.stringify(body) : undefined, signal })
      .then(async r => {
        cancel();
        const text = await r.text();
        let data = null;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} — ${data?.error || text || ''}`.trim());
        return data;
      });
  }
  
  function randomKey() {
    return ('poseidon_' + Math.random().toString(36).slice(2) + Date.now());
  }
  
  /**
   * Place a trade via backend route.
   * payload: { symbol, side:'BUY'|'SELL', leverage, notionalUsd, manual?, note?, confidence? }
   */
  export async function placeTrade(payload, opts={}) {
    const idk = opts.idempotencyKey || randomKey();
    return jsonFetch('/api/place-trade', {
      method:'POST',
      body: payload,
      timeout: 15000,
      idempotencyKey: idk
    });
  }
  
  /**
   * Close a position by contract
   * payload: { contract: 'BTC-USDTM' }
   */
  export async function closeTrade(payload, opts={}) {
    const idk = opts.idempotencyKey || randomKey();
    return jsonFetch('/api/close-trade', {
      method:'POST',
      body: payload,
      timeout: 12000,
      idempotencyKey: idk
    });
  }