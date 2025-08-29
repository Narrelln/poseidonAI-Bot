// /public/scripts/cycleWatcherClient.js
async function api(method, path, body=null, timeout=8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(path, {
      method,
      headers: { 'Content-Type':'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${data?.error || r.statusText}`);
    return data;
  }
  
  export async function startCycleWatcherServer(contracts=[]) {
    return api('POST', '/api/cycle-watcher/start', { contracts });
  }
  export async function stopCycleWatcherServer() {
    return api('POST', '/api/cycle-watcher/stop');
  }
  export async function getCycleWatcherStatus() {
    return api('GET', '/api/cycle-watcher/status');
  }