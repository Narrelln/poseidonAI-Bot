// /public/scripts/orderPreviewClient.js
function jsonFetch(url, init={}) {
    const headers = { 'Content-Type':'application/json', ...(init.headers||{}) };
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), init.timeout || 8000);
    return fetch(url, { ...init, headers, signal: controller.signal })
      .then(async r => {
        clearTimeout(t);
        const text = await r.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }
        if (!r.ok) throw new Error(`HTTP ${r.status} ${data?.error || r.statusText}`);
        return data;
      });
  }
  
  /**
   * Preview position sizing using your backend preview (contracts, margin, exposure).
   * args: { symbol, notionalUsd, leverage, price?, tpPercent?, slPercent? }
   */
  export async function previewOrder(args) {
    return jsonFetch('/api/preview-order', {
      method:'POST',
      body: JSON.stringify(args),
      timeout: 9000
    });
  }