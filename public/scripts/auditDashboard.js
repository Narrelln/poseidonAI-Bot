// /public/scripts/auditDashboard.js
// Lightweight modal: fetches /api/signal-audit/summary on open / Apply, CSV export via /export.csv

const API_BASE = '/api/signal-audit';

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

function fmtPct(v, p=2){ const n = Number(v); return Number.isFinite(n) ? n.toFixed(p)+'%' : '—'; }
function fmt(n, p=2){ const x = Number(n); return Number.isFinite(x) ? x.toFixed(p) : '—'; }
function fmtH(ms){
  const m = Math.round(Number(ms)/60000);
  if (!Number.isFinite(m)) return String(ms);
  if (m < 60) return `${m}m`;
  const h = (m/60).toFixed(1).replace(/\.0$/,'');
  return `${h}h`;
}
// === [ADD NEAR TOP] lightweight helpers for the floating badge ===
let _badgeEl = null;
let _badgeTimer = null;

function ensureBadge() {
  if (_badgeEl) return _badgeEl;
  _badgeEl = document.createElement('div');
  _badgeEl.id = 'audit-fab';
  _badgeEl.innerHTML = `
    <div class="fab-pill">
      <span class="fab-title">Win‑rate</span>
      <span class="fab-value" id="audit-fab-value">—</span>
    </div>
  `;
  document.body.appendChild(_badgeEl);

  // Optional: click to open dashboard quickly
  _badgeEl.addEventListener('click', () => {
    const m = ensureModal();
    m.style.display = 'flex';
    fetchAndRender(); // reuse the same fetch
  });

  // Clean up on unload
  window.addEventListener('beforeunload', () => {
    if (_badgeTimer) clearInterval(_badgeTimer);
  });

  return _badgeEl;
}

function updateBadgeFromSummary(json) {
  if (!json?.ok) return;
  const wr = Number(json?.totals?.winRatePct);
  const el = document.getElementById('audit-fab-value');
  if (!el) return;
  if (Number.isFinite(wr)) {
    el.textContent = wr.toFixed(1) + '%';
    el.classList.toggle('ok', wr >= 60);
    el.classList.toggle('mid', wr >= 45 && wr < 60);
    el.classList.toggle('bad', wr < 45);
  } else {
    el.textContent = '—';
    el.classList.remove('ok','mid','bad');
  }
}


let modal;
function ensureModal() {
  if (modal) return modal;

  modal = el('div', { class: 'audit-modal', id: 'audit-modal' }, [
    el('div', { class: 'audit-card' }, [
      el('header', {}, [
        el('h3', {}, 'Poseidon — Audit Dashboard'),
        el('div', {}, [
          el('button', { class: 'audit-export', id: 'audit-export' }, 'Export CSV'),
          el('button', { class: 'audit-close', id: 'audit-close', title: 'Close' }, '✕'),
        ])
      ]),
      el('div', { class: 'audit-body' }, [
        el('div', { class: 'audit-filters' }, [
          el('div', {}, [
            el('label', {}, 'Since'),
            el('input', { id: 'audit-since', type: 'datetime-local' })
          ]),
          el('div', {}, [
            el('label', {}, 'Until'),
            el('input', { id: 'audit-until', type: 'datetime-local' })
          ]),
          el('div', {}, [
            el('label', {}, 'Min Confidence'),
            el('input', { id: 'audit-minconf', type: 'number', min: '0', max: '100', step: '1', value: '70' })
          ]),
          el('div', {}, [
            el('label', {}, 'Symbol (optional)'),
            el('input', { id: 'audit-symbol', type: 'text', placeholder: 'e.g. BTC-USDTM' })
          ]),
          el('div', {}, [
            el('label', {}, 'Event'),
            el('select', { id: 'audit-event' }, [
              el('option', { value: '' }, 'All'),
              el('option', { value: 'analysis' }, 'analysis'),
              el('option', { value: 'decision' }, 'decision'),
              el('option', { value: 'skipped' }, 'skipped'),
            ])
          ]),
          el('div', {}, [
            el('button', { class: 'audit-apply', id: 'audit-apply' }, 'Apply')
          ])
        ]),
        el('div', { class: 'audit-grid' }, [
          el('div', { class: 'audit-block', id: 'audit-kpis' }, [
            el('h4', {}, 'Totals'),
            el('div', { class: 'audit-kpi', id: 'audit-kpi-wrap' })
          ]),
          el('div', { class: 'audit-block', id: 'audit-horizons' }, [
            el('h4', {}, 'Per Horizon'),
            el('table', { class: 'audit-table', id: 'audit-horizon-table' }, [
              el('thead', { html: `
                <tr>
                  <th>Horizon</th><th>Samples</th><th>Win‑rate</th>
                  <th>Avg ROI</th><th>Median ROI</th><th>P95 ROI</th>
                </tr>` }),
              el('tbody', { id: 'audit-horizon-tbody' })
            ])
          ]),
          el('div', { class: 'audit-block', id: 'audit-side' }, [
            el('h4', {}, 'By Side'),
            el('table', { class: 'audit-table', id: 'audit-side-table' }, [
              el('thead', { html: `<tr><th>Side</th><th>Samples</th><th>Win‑rate</th><th>Avg ROI</th></tr>` }),
              el('tbody', { id: 'audit-side-tbody' })
            ])
          ]),
          el('div', { class: 'audit-block', id: 'audit-sym' }, [
            el('h4', {}, 'Top Symbols'),
            el('table', { class: 'audit-table', id: 'audit-sym-table' }, [
              el('thead', { html: `<tr><th>Symbol</th><th>Samples</th><th>Win‑rate</th><th>Avg ROI</th></tr>` }),
              el('tbody', { id: 'audit-sym-tbody' })
            ])
          ]),
        ])
      ])
    ])
  ]);

  document.body.appendChild(modal);

  document.getElementById('audit-close').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  document.getElementById('audit-apply').addEventListener('click', () => {
    fetchAndRender();
  });

  document.getElementById('audit-export').addEventListener('click', () => {
    const { qs } = getFilters();
    const url = `${API_BASE}/export.csv${qs}`;
    window.open(url, '_blank');
  });

  const since = new Date(Date.now() - 24*3600*1000);
  document.getElementById('audit-since').value = toLocalDT(since);
  document.getElementById('audit-until').value = '';
  return modal;
}

function toLocalDT(d) {
  const pad = (n) => String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function getFilters() {
  const since = document.getElementById('audit-since').value;
  const until = document.getElementById('audit-until').value;
  const minConf = document.getElementById('audit-minconf').value;
  const symbol = document.getElementById('audit-symbol').value.trim().toUpperCase();
  const event  = document.getElementById('audit-event').value;

  const params = new URLSearchParams();
  if (since)   params.set('since', new Date(since).toISOString());
  if (until)   params.set('until', new Date(until).toISOString());
  if (minConf) params.set('minConf', Number(minConf));
  if (symbol)  params.set('symbol', symbol);
  if (event)   params.set('event', event);

  return { since, until, minConf, symbol, event, qs: params.toString() ? `?${params.toString()}` : '' };
}

async function fetchAndRender() {
    const { qs } = getFilters();
    const url = `${API_BASE}/summary${qs}`;
    const card = document.querySelector('.audit-card');
    card.style.opacity = '0.7';
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      renderSummary(data);
  
      // === [ADD] ensure + update badge whenever user pulls summary
      ensureBadge();
      updateBadgeFromSummary(data);
  
      // === [OPTIONAL LIGHT REFRESH] re-fetch every 5 minutes with *no* filters (24h default)
      if (!_badgeTimer) {
        _badgeTimer = setInterval(async () => {
          try {
            const r = await fetch(`${API_BASE}/summary`, { cache: 'no-store' });
            const j = await r.json();
            updateBadgeFromSummary(j);
          } catch {}
        }, 300000); // 5 min
        // Pause refresh when tab not visible
        document.addEventListener('visibilitychange', () => {
          if (document.hidden && _badgeTimer) { clearInterval(_badgeTimer); _badgeTimer = null; }
          else if (!_badgeTimer) {
            _badgeTimer = setInterval(async () => {
              try {
                const r = await fetch(`${API_BASE}/summary`, { cache: 'no-store' });
                const j = await r.json();
                updateBadgeFromSummary(j);
              } catch {}
            }, 300000);
          }
        });
      }
    } catch (e) {
      console.error('[Audit] fetch failed:', e?.message || e);
    } finally {
      card.style.opacity = '1';
    }
  }

function renderSummary(json) {
  if (!json?.ok) return;

  const k = json.totals || {};
  const kwrap = document.getElementById('audit-kpi-wrap');
  kwrap.innerHTML = '';
  const kpi = (v, l, cls='') => {
    const box = el('div', { class:'k' }, [
      el('div', { class:`v ${cls}` }, v),
      el('div', { class:'l' }, l)
    ]);
    kwrap.appendChild(box);
  };
  kpi(String(k.samples ?? 0), 'Samples');
  kpi(String(k.wins ?? 0), 'Wins');
  kpi(fmtPct(k.winRatePct ?? 0), 'Win‑rate', (k.winRatePct >= 60 ? 'text-green' : 'text-faint'));
  kpi(fmt(k.avgRoiPct ?? 0, 3)+'%', 'Avg ROI', (k.avgRoiPct >= 0 ? 'text-green' : 'text-red'));
  kpi(fmt(k.avgAbsRoiPct ?? 0, 3)+'%', 'Avg Abs ROI');

  const hbody = document.getElementById('audit-horizon-tbody');
  hbody.innerHTML = '';
  (json.perHorizon || []).forEach(h => {
    const tr = el('tr', {}, [
      el('td', {}, fmtH(h.horizonMs)),
      el('td', {}, String(h.samples)),
      el('td', {}, fmtPct(h.winRatePct)),
      el('td', {}, fmt(h.avgRoiPct,3)+'%'),
      el('td', {}, fmt(h.medianRoiPct,3)+'%'),
      el('td', {}, fmt(h.p95RoiPct,3)+'%')
    ]);
    hbody.appendChild(tr);
  });

  const sbody = document.getElementById('audit-side-tbody');
  sbody.innerHTML = '';
  (json.bySide || []).forEach(s => {
    const tr = el('tr', {}, [
      el('td', {}, s.side),
      el('td', {}, String(s.samples)),
      el('td', {}, fmtPct(s.winRatePct)),
      el('td', {}, fmt(s.avgRoiPct,3)+'%')
    ]);
    sbody.appendChild(tr);
  });

  const symBody = document.getElementById('audit-sym-tbody');
  symBody.innerHTML = '';
  (json.bySymbol || []).forEach(s => {
    const tr = el('tr', {}, [
      el('td', {}, [
        el('span', { class:'audit-chip' }, s.symbol)
      ]),
      el('td', {}, String(s.samples)),
      el('td', {}, fmtPct(s.winRatePct)),
      el('td', {}, fmt(s.avgRoiPct,3)+'%')
    ]);
    symBody.appendChild(tr);
  });
}

(function init() {
  const btn = document.getElementById('open-audit-dashboard');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const m = ensureModal();
    m.style.display = 'flex';
    fetchAndRender();
  });
})();