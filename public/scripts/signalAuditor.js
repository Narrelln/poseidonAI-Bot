// /public/scripts/signalAuditor.js

// ---------- horizons (real / test / long) ----------
const QA_PRESETS = {
    real: [300_000, 900_000, 3_600_000],       // 5m, 15m, 60m
    test: [5_000,   15_000,  60_000],          // 5s, 15s, 60s (smoke)
    long: [3_600_000, 14_400_000, 43_200_000], // 1h, 4h, 12h  ← NEW
  };
  
  // Accept either POSEIDON_QA_MODE or SIGNAL_QA_MODE at boot
  (function applyBootModeAlias(){
    if (typeof window.SIGNAL_QA_MODE !== 'undefined' && typeof window.POSEIDON_QA_MODE === 'undefined') {
      window.POSEIDON_QA_MODE = window.SIGNAL_QA_MODE;
    }
  })();
  
  const _saved = localStorage.getItem('POSEIDON_QA_MODE');
  const _bootMode = (window.POSEIDON_QA_MODE || (_saved || 'real')).toLowerCase();
  
  // IMPORTANT: Keep a live array so we can mutate horizons in-place on mode change
  const HORIZONS = [...(QA_PRESETS[_bootMode] || QA_PRESETS.real)];
  
  // ---------- perf knobs ----------
  const MAX_FEED_LINES = 200;       // cap feed lines to avoid DOM bloat
  const LOG_THROTTLE_MS = 250;      // batch log writes
  let _logBuffer = [];
  let _logScheduled = false;
  
  // ---------- small utils ----------
  const store = new Map(); // id -> record
  const now = () => Date.now();
  const uid = () => `${now()}_${Math.random().toString(36).slice(2,8)}`;
  
  const humanize = (ms) => {
    const s = Math.round(ms/1000);
    if (s < 60) return `${s}s`;
    const m = Math.round(s/60);
    if (m < 60) return `${m}m`;
    const h = Math.round(m/60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h/24);
    return `${d}d`;
  };
  
  // Normalize to spot price route and fetch latest price
  async function fetchPrice(symbol){
    const s = String(symbol || '').toUpperCase();
    let norm = s.replace(/[-_]/g,'').replace(/USDTM$/, 'USDT');
    if (norm === 'XBTUSDT') norm = 'BTCUSDT';
    const r = await fetch(`/api/price?symbol=${encodeURIComponent(norm)}`, { cache: 'no-store' });
    const j = await r.json();
    return Number(j?.price);
  }
  
  function gradeSignal(p0, pT, side){
    const dir = side === 'SELL' ? -1 : 1;             // BUY default
    const roi = (pT - p0) / p0 * 100 * dir;           // forward ROI in signaled direction
    return { forwardRoiPct: roi, correct: roi > 0 };
  }
  
  // ---------- UI (dynamic buckets for any preset) ----------
  const statsEl = document.getElementById('signal-qa-stats') || null;
  const feedEl  = document.getElementById('signal-qa-feed')  || null;
  
  const agg = {
    total: 0,
    buckets: HORIZONS.map(ms => ({ key: ms, label: humanize(ms), ok: 0, n: 0 }))
  };
  
  const fmtPct = (n, d) => d ? `${(n/d*100).toFixed(1)}%` : '—';
  
  function renderStats(){
    if (!statsEl) return;
    const bucketHtml = agg.buckets.map(b =>
      `<div class="mini-block"><h4>${b.label}</h4><p>${b.ok}/${b.n} (${fmtPct(b.ok,b.n)})</p></div>`
    ).join('');
    statsEl.innerHTML = `
      <div class="mini-block"><h4>Total</h4><p>${agg.total}</p></div>
      ${bucketHtml}
    `;
  }
  
  function pushLog(line, ok){
    if (!feedEl) return;
    _logBuffer.push({ line, ok });
    if (_logScheduled) return;
    _logScheduled = true;
    const flush = () => {
      const frag = document.createDocumentFragment();
      for (const { line, ok } of _logBuffer.splice(0)) {
        const d = document.createElement('div');
        d.className = 'log-entry' + (ok===true ? ' text-green' : ok===false ? ' text-red' : '');
        d.textContent = line;
        frag.prepend(d);
      }
      feedEl.prepend(frag);
      // Trim
      while (feedEl.childNodes.length > MAX_FEED_LINES) {
        feedEl.removeChild(feedEl.lastChild);
      }
      _logScheduled = false;
    };
    // Batch via rAF → timer to cooperate with rendering
    requestAnimationFrame(() => setTimeout(flush, LOG_THROTTLE_MS));
  }
  
  // ---------- evaluation path ----------
  async function evaluate(id, horizonMs){
    const rec = store.get(id);
    if (!rec) return;
    if (rec.side === 'HOLD') return; // do not score neutrals
  
    const pT = await fetchPrice(rec.symbol).catch(() => undefined);
    if (!Number.isFinite(pT)) return;
  
    const { forwardRoiPct, correct } = gradeSignal(rec.price, pT, rec.side || 'BUY');
    const atTs = now();
    const durationMs = atTs - rec.at;
  
    rec.results.push({ horizonMs, at: atTs, price: pT, forwardRoiPct, correct, durationMs });
  
    // bucket match (by horizon key)
    const bucket = agg.buckets.find(b => b.key === horizonMs);
    if (bucket) { bucket.n++; if (correct) bucket.ok++; }
  
    renderStats();
    pushLog(
      `Scored ${rec.symbol} ${rec.side||''} ${humanize(horizonMs)}: ${forwardRoiPct.toFixed(2)}% (from ${rec.price}→${pT}) in ${humanize(durationMs)}`,
      correct
    );
  
    // Persist to backend (includes durationMs)
    try {
      await fetch('/api/signal-audit', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id, ...rec, lastResult: rec.results.at(-1) })
      });
    } catch {}
  
    // cleanup once all horizons are scored
    if (rec.results.length >= HORIZONS.length) store.delete(id);
  }
  
  // ---------- subscribe to engine events ----------
  window.addEventListener('poseidon:signal', async (e) => {
    if (!window.POSEIDON_SIGNAL_AUDIT) return;
  
    const s = e.detail || {};
    const id = uid();
    let price = Number(s.price);
    if (!Number.isFinite(price)) price = await fetchPrice(s.symbol).catch(() => undefined);
    if (!Number.isFinite(price)) return;
  
    const rec = {
      id, at: now(), event: s.event, symbol: s.symbol, side: s.side,
      confidence: s.confidence, price, reason: s.reason || '', corr: s.corr,
      results: []
    };
    store.set(id, rec);
  
    agg.total++; renderStats();
    pushLog(
      `[${new Date().toLocaleTimeString()}] ${s.event} ${s.side||''} ${s.symbol} @ ${price} c=${s.confidence??'—'} — ${s.reason||''}`
    );
  
    // schedule grading at each horizon
    for (const h of HORIZONS) setTimeout(() => evaluate(id, h), h);
  });
  
  // ---------- mode switchers ----------
  window.setQaMode = function setQaMode(mode = 'real') {
    mode = String(mode || 'real').toLowerCase();
    if (!QA_PRESETS[mode]) {
      console.warn('[SignalQA] Unknown mode:', mode, '(use "real", "test", or "long")');
      return;
    }
    localStorage.setItem('POSEIDON_QA_MODE', mode);
    console.info(`[SignalQA] Switched to "${mode}" horizons:`, QA_PRESETS[mode]);
    location.reload(); // rebinding timers cleanly
  };
  
  // Live switch without reload:
  // window.dispatchEvent(new CustomEvent('poseidon:qa-mode', { detail: { mode: 'long' }}));
  window.addEventListener('poseidon:qa-mode', (e) => {
    const next = String(e?.detail?.mode || '').toLowerCase();
    if (!QA_PRESETS[next]) {
      console.warn('[SignalQA] Ignoring unknown qa-mode:', next);
      return;
    }
    // Replace contents of HORIZONS (keeps reference for existing code)
    const newHz = QA_PRESETS[next];
    HORIZONS.splice(0, HORIZONS.length, ...newHz);
  
    // Rebuild buckets & repaint stats (existing timers keep running; new signals use new horizons)
    agg.buckets = HORIZONS.map(ms => ({ key: ms, label: humanize(ms), ok: 0, n: 0 }));
    renderStats();
  
    localStorage.setItem('POSEIDON_QA_MODE', next);
    pushLog(`Signal QA live mode: ${next.toUpperCase()} (${newHz.map(humanize).join(', ')})`);
    console.info('[SignalQA] Live horizon switch →', next, newHz);
  });
  
  // ---------- first paint + banner ----------
  renderStats();
  pushLog(`Signal QA mode: ${_bootMode.toUpperCase()} (${HORIZONS.map(humanize).join(', ')})`);