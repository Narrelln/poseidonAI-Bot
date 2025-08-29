// === scannerPanel.js — Failsafe: dynamic imports, sticky filters, robust rendering + volume-band badges ===

// Soft stubs; real funcs are wired by dynamic import at runtime
let Bot = {
  setBotActive: () => {},
  isBotActive: () => false,
  startPoseidonAutonomousLoop: () => {},
  stopPoseidonAutonomousLoop: () => {},
  initBot: null,
  bindBotToggleUI: null,
};
let logSignalToFeed = () => {};
let logDetailedAnalysisFeed = () => {};
let renderAutoStatus = () => {};
let startReversalWatcherFn = null;

// ---------- persistence keys ----------
const LS_PAGE_KEY   = 'poseidon_scanner_page';
const LS_FILTER_KEY = 'poseidon_scanner_filter';
const FILTERS = ['ALL','MAJORS','MEMES','GAINERS','LOSERS'];

// ---------- state ----------
const persistedFilter = String(localStorage.getItem(LS_FILTER_KEY) || '').toUpperCase();
const SCANNER_STATE = {
  page: Math.max(1, parseInt(localStorage.getItem(LS_PAGE_KEY) || '1', 10)),
  filter: FILTERS.includes(persistedFilter) ? persistedFilter : 'ALL',
  timerId: null,
};

let REVERSAL_WATCHER_STARTED = false;

// ---------- category sets ----------
const MAJORS = new Set(['BTC','ETH','SOL','BNB','XRP','ADA','DOGE','LINK','LTC','TRX','TON','DOT','AVAX','NEAR','ARB','OP']);
const MEMES  = new Set(['DOGE','SHIB','PEPE','WIF','FLOKI','BONK','MYRO','BOME','MEW','MOG','BRETT','SATS','1000RATS','DOGS']);

// ---------- your volume band (USDT quote volume) ----------
const VOL_MIN = 100_000;     // 100k
const VOL_MAX = 20_000_000;  // 20m

// ---------- utils ----------
function n(v){ const x = Number(v); return Number.isFinite(x) ? x : NaN; }
function baseOf(sym=''){
  let s = String(sym).toUpperCase();
  s = s.replace(/[-_]/g,'').replace(/USDTM?$/,'');
  if (s === 'XBT') s = 'BTC';
  return s;
}
function formatCompactNumber(x){
  const n = Number(x); if (!Number.isFinite(n)) return '—';
  if (n >= 1e12) return (n/1e12).toFixed(2)+'T';
  if (n >= 1e9)  return (n/1e9 ).toFixed(2)+'B';
  if (n >= 1e6)  return (n/1e6 ).toFixed(2)+'M';
  if (n >= 1e3)  return (n/1e3 ).toFixed(1)+'K';
  return n.toFixed(2);
}
function formatPrice(v){
  const x = Number(v);
  if (!Number.isFinite(x)) return '0.000000';
  if (x >= 100)   return x.toFixed(2);
  if (x >= 1)     return x.toFixed(4);
  if (x >= 0.01)  return x.toFixed(5);
  return x.toFixed(6);
}
function formatChangePct(v){
  let x = Number(v);
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 1 && Math.abs(x) > 0.0001) x *= 100;
  return x;
}

function resolveQuoteVolume(token){
  const qv24 = n(token?.quoteVolume24h); if (Number.isFinite(qv24)) return qv24;
  const price = n(token?.price ?? token?.lastPrice);
  const volumeBase = n(token?.volumeBase ?? token?.volume ?? token?.baseVolume);
  const providerQV = n(token?.quoteVolume ?? token?.turnover);
  if (Number.isFinite(providerQV)) return providerQV;
  if (Number.isFinite(price) && Number.isFinite(volumeBase)) return price * volumeBase;
  return NaN;
}
function categoryOf(token){
  const base = String(token.base || baseOf(token.symbol || ''));
  if (MAJORS.has(base)) return 'major';
  if (MEMES.has(base))  return 'meme';
  const chg = formatChangePct(token.priceChgPct ?? token.change ?? 0);
  if (Number.isFinite(chg) && Math.abs(chg) >= 5) return chg >= 0 ? 'gainer' : 'loser';
  return 'mover';
}
function badgeHtml(cat){
  const color = cat==='major'?'badge-major':cat==='meme'?'badge-meme':cat==='gainer'?'badge-gainer':cat==='loser'?'badge-loser':'badge-mover';
  const label = cat==='major'?'MAJORS':cat==='meme'?'MEMES':cat==='gainer'?'GAINER':cat==='loser'?'LOSER':'MOVER';
  return `<span class="badge ${color}">${label}</span>`;
}

// ---------- volume band helpers (visual only here) ----------
function inBand(qv){ return Number.isFinite(qv) && qv >= VOL_MIN && qv <= VOL_MAX; }
function bandBadge(qv){
  const ok = inBand(qv);
  const cls = ok ? 'band-ok' : 'band-off';
  const txt = ok ? 'IN-BAND' : 'OUT-OF-BAND';
  return `<span class="band ${cls}" title="USDT quote volume ${VOL_MIN.toLocaleString()}–${VOL_MAX.toLocaleString()}">${txt}</span>`;
}

// Limit feed spam: 1 log / symbol / 60s from this panel
const _feedLastAt = new Map();
function feedGuardedLog(symbol, fn){
  const now = Date.now();
  const last = _feedLastAt.get(symbol) || 0;
  if (now - last < 60_000) return;
  _feedLastAt.set(symbol, now);
  try { fn(); } catch {}
}

/* ===== PATCH: ReversalWatcher disablement gates =====
   You can disable it via ANY of:
   1) server-injected flag:  window.__POSEIDON_FLAGS__.DISABLE_REVERSAL_WATCHER = true
   2) localStorage key:      localStorage.setItem('DISABLE_REVERSAL_WATCHER','true')
   3) URL param:             ?reversal=off
*/
function isReversalDisabled(){
  try {
    const flags = (window && window.__POSEIDON_FLAGS__) || {};
    if (flags.DISABLE_REVERSAL_WATCHER === true) return true;
  } catch {}
  try {
    const ls = String(localStorage.getItem('DISABLE_REVERSAL_WATCHER') || '').toLowerCase();
    if (ls === 'true' || ls === '1' || ls === 'yes') return true;
  } catch {}
  try {
    const q = new URLSearchParams(location.search);
    const v = String(q.get('reversal') || '').toLowerCase();
    if (v === 'off' || v === 'false' || v === '0') return true;
  } catch {}
  return false;
}

function maybeStartReversalWatcher(tokens){
  if (REVERSAL_WATCHER_STARTED || !startReversalWatcherFn) return;

  // PATCH: respect disablement gates
  if (isReversalDisabled()) {
    console.log('[ReversalWatcher] disabled by flag; not starting.');
    return;
  }

  const syms = (Array.isArray(tokens)?tokens:[])
    .map(t => String(t?.symbol || t?.base || '').toUpperCase())
    .filter(Boolean);
  if (!syms.length) return;
  try {
    startReversalWatcherFn(syms);
    REVERSAL_WATCHER_STARTED = true;
    console.log(`[ReversalWatcher] started on ${syms.length} symbols`);
  } catch (e) {
    console.warn('[ReversalWatcher] failed to start:', e?.message || e);
  }
}

// ---------- global cache publisher ----------
function publishScannerCache(allTokens){
  const ts = Date.now();
  const payload = { top50: allTokens, ts, count: allTokens.length };
  // Make it easy for any consumer (module or legacy) to read
  window.__POSEIDON_SCANNER_CACHE__ = payload;          // legacy/global
  window.__scannerCache = payload;                      // alt name some modules used
  window.__top50Cache = { list: allTokens, ts };        // very old name
  // Signal cache update
  try { window.dispatchEvent(new CustomEvent('poseidon:scanner-cache', { detail: { count: allTokens.length, ts } })); } catch {}
}

// ---------- "ready" signal (fires once) ----------
let __scannerReadySignaled = false;
function signalScannerReadyOnce(){
  if (__scannerReadySignaled) return;
  __scannerReadySignaled = true;
  window.__scannerReadyOnce = true;
  try { window.dispatchEvent(new CustomEvent('poseidon:scanner-ready')); } catch {}
  console.log('[ScannerPanel] ✅ scanner-ready signaled');
}

// ---------- render ----------
async function renderScanner(page = SCANNER_STATE.page){
  const ITEMS_PER_PAGE = 10;

  try {
    const res = await fetch('/api/scan-tokens', { cache: 'no-store' });
    const raw = await res.json().catch(() => ({}));
    const allTokens =
      Array.isArray(raw?.top50) ? raw.top50 :
      Array.isArray(raw?.data)  ? raw.data  :
      Array.isArray(raw?.rows)  ? raw.rows  :
      Array.isArray(raw)        ? raw       : [];

    // Always publish the FULL, UNFILTERED list for the engine
    publishScannerCache(allTokens);
    if (allTokens.length > 0) signalScannerReadyOnce();

    maybeStartReversalWatcher(allTokens);

    if (!window.__scannerShapeLogged) {
      window.__scannerShapeLogged = true;
      console.log('[ScannerPanel] payload shape:', {
        hasTop50: !!raw?.top50, hasData: !!raw?.data, hasRows: !!raw?.rows,
        isArray: Array.isArray(raw), count: allTokens.length
      });
    }

    // Find or create container; unhide if needed
    let container =
      document.getElementById('scanner-panel') ||
      document.getElementById('poseidon-top50');
    if (!container) {
      console.warn('[ScannerPanel] container missing — creating #scanner-panel');
      container = document.createElement('div');
      container.id = 'scanner-panel';
      document.body.appendChild(container);
    }
    container.style.display = '';
    container.style.visibility = '';

    // Filtering (UI only — cache stays full)
    const applyFilter = (t) => {
      const cat = categoryOf(t);
      switch (SCANNER_STATE.filter) {
        case 'MAJORS':  return cat === 'major';
        case 'MEMES':   return cat === 'meme';
        case 'GAINERS': return cat === 'gainer';
        case 'LOSERS':  return cat === 'loser';
        default:        return true;
      }
    };
    const filtered = allTokens.filter(applyFilter);
    const tokensForRender = filtered.length ? filtered : allTokens.slice();

    // Pagination
    const totalPages = Math.max(1, Math.ceil(tokensForRender.length / ITEMS_PER_PAGE));
    const clamp = (v,min,max)=>Math.min(Math.max(v,min),max);
    const currentPage = clamp(page, 1, totalPages);
    SCANNER_STATE.page = currentPage;
    localStorage.setItem(LS_PAGE_KEY, String(SCANNER_STATE.page));
    localStorage.setItem(LS_FILTER_KEY, SCANNER_STATE.filter);

    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const currentPageTokens = tokensForRender.slice(start, end);

    // UI
    container.innerHTML = `
      <h3 class="scanner-title">📊 Poseidon Top 50 <small class="band-legend">Band: ${VOL_MIN.toLocaleString()}–${VOL_MAX.toLocaleString()} USDT</small></h3>

      <div class="scanner-filters">
        ${FILTERS.map(f => `<button class="scanner-filter-btn ${SCANNER_STATE.filter===f?'active':''}" data-filter="${f}">${f}</button>`).join('')}
      </div>

      <div class="scanner-scroll-wrapper">
        <table class="scanner-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Tag</th>
              <th>Band</th>
              <th>Price</th>
              <th>% Change</th>
              <th>Quote Vol (USDT)</th>
            </tr>
          </thead>
          <tbody id="scanner-table-body"></tbody>
        </table>
      </div>

      <div class="scanner-pagination">
        ${Array.from({length: totalPages}, (_,i)=>`<button class="scanner-page-btn ${i+1===SCANNER_STATE.page?'active':''}" data-page="${i+1}">${i+1}</button>`).join('')}
      </div>
    `;

    const tbody = container.querySelector('#scanner-table-body');
    currentPageTokens.forEach(token => {
      const base = baseOf(token.symbol || token.base || '');
      const symbol = base;
      const priceNum = n(token.price ?? token.lastPrice);
      const priceStr = formatPrice(priceNum);
      const changePctNum = formatChangePct(token.priceChgPct ?? token.change ?? 0);
      const qvNum = resolveQuoteVolume(token);
      const volumeStr = formatCompactNumber(qvNum);
      const cat = categoryOf(token);
      const band = bandBadge(qvNum);

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${symbol}</td>
        <td>${badgeHtml(cat)}</td>
        <td>${band}</td>
        <td>$${priceStr}</td>
        <td class="${Number.isFinite(changePctNum)&&changePctNum>=0?'change-positive':'change-negative'}">
          ${Number.isFinite(changePctNum)?changePctNum.toFixed(2):'—'}%
        </td>
        <td class="${inBand(qvNum)?'qv-ok':'qv-bad'}">${volumeStr}</td>
      `;
      tbody.appendChild(row);

      if (typeof logSignalToFeed === 'function' && typeof logDetailedAnalysisFeed === 'function') {
        const feedCommon = {
          symbol,
          confidence: Number(token.confidence) || 0,
          signal: token.signal || 'neutral',
          delta: Number.isFinite(changePctNum) ? changePctNum : 0,
          volume: Number.isFinite(qvNum) ? qvNum : 0,
          price: Number.isFinite(priceNum) ? priceNum : 0,
          isMover: true,
          category: cat
        };
        if (Number(token.confidence) >= 35) {
          feedGuardedLog(symbol, () => {
            logSignalToFeed(feedCommon);
            logDetailedAnalysisFeed({
              ...feedCommon,
              rsi: token.rsi ?? '-',
              macdSignal: token.macdSignal ?? token.macd ?? '-',
              bbSignal: token.bbSignal ?? token.bb ?? '-',
              notes: token.notes || ''
            });
          });
        }
      }
    });

    // pagination
    container.querySelectorAll('.scanner-page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pageNum = parseInt(btn.dataset.page, 10);
        SCANNER_STATE.page = pageNum;
        localStorage.setItem(LS_PAGE_KEY, String(SCANNER_STATE.page));
        renderScanner(SCANNER_STATE.page);
      });
    });

    // filters (UI only)
    container.querySelectorAll('.scanner-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = String(btn.dataset.filter || 'ALL').toUpperCase();
        SCANNER_STATE.filter = FILTERS.includes(f) ? f : 'ALL';
        SCANNER_STATE.page = 1;
        localStorage.setItem(LS_FILTER_KEY, SCANNER_STATE.filter);
        localStorage.setItem(LS_PAGE_KEY, String(SCANNER_STATE.page));
        renderScanner(SCANNER_STATE.page);
      });
    });

    // Ready after render as well (guarded)
    if (currentPageTokens.length > 0) signalScannerReadyOnce();

  } catch (err) {
    console.error('[ScannerPanel] fetch/render failed:', err);
  }
}

// ---------- bot toggle ----------
let _localToggleBound = false;
function bindLocalToggleFallback(){
  if (_localToggleBound) return;
  _localToggleBound = true;

  const botPanel  = document.getElementById('poseidon-bot');
  const toggleBtn = document.getElementById('poseidon-toggle');
  const target = botPanel || toggleBtn;
  if (!target) {
    console.warn('[ScannerPanel] bot toggle not found (#poseidon-bot / #poseidon-toggle)');
    return;
  }

  target.addEventListener('click', async () => {
    const currentlyOn = !!(Bot.isBotActive && Bot.isBotActive());
    Bot.setBotActive && Bot.setBotActive(!currentlyOn);

    if (!currentlyOn) {
      Bot.startPoseidonAutonomousLoop && Bot.startPoseidonAutonomousLoop();
      botPanel?.classList.add('glow');
      toggleBtn?.classList.add('active');
    } else {
      Bot.stopPoseidonAutonomousLoop && Bot.stopPoseidonAutonomousLoop();
      botPanel?.classList.remove('glow');
      toggleBtn?.classList.remove('active');
    }

    renderAutoStatus && (await renderAutoStatus());
  });

  window.addEventListener('poseidon:bot-state', (ev) => {
    const on = !!ev.detail?.active;
    botPanel?.classList.toggle('glow', on);
    toggleBtn?.classList.toggle('active', on);
  });

  renderAutoStatus && renderAutoStatus();
}

// ---------- dynamic import wiring (non-blocking) ----------
(async () => {
  try {
    const mod = await import('./poseidonBotModule.js');
    Bot = {
      setBotActive: mod.setBotActive || Bot.setBotActive,
      isBotActive: mod.isBotActive || Bot.isBotActive,
      startPoseidonAutonomousLoop: mod.startPoseidonAutonomousLoop || Bot.startPoseidonAutonomousLoop,
      stopPoseidonAutonomousLoop: mod.stopPoseidonAutonomousLoop || Bot.stopPoseidonAutonomousLoop,
      initBot: mod.initBot || null,
      bindBotToggleUI: mod.bindBotToggleUI || null,
    };
    if (Bot.initBot) Bot.initBot();
    if (Bot.bindBotToggleUI) Bot.bindBotToggleUI();
    else bindLocalToggleFallback();
    console.log('[ScannerPanel] poseidonBotModule loaded');
  } catch (e) {
    console.warn('[ScannerPanel] poseidonBotModule failed, using local toggle fallback:', e?.message || e);
    bindLocalToggleFallback();
  }

  try {
    const feed = await import('./liveFeedRenderer.js');
    logSignalToFeed = feed.logSignalToFeed || logSignalToFeed;
    logDetailedAnalysisFeed = feed.logDetailedAnalysisFeed || logDetailedAnalysisFeed;
    console.log('[ScannerPanel] liveFeedRenderer loaded');
  } catch (e) {
    console.warn('[ScannerPanel] liveFeedRenderer not available:', e?.message || e);
  }

  try {
    const auto = await import('./autoStatusModule.js');
    renderAutoStatus = auto.renderAutoStatus || renderAutoStatus;
    console.log('[ScannerPanel] autoStatusModule loaded');
  } catch (e) {
    console.warn('[ScannerPanel] autoStatusModule not available:', e?.message || e);
  }

  try {
    const rev = await import('./reversalDriver.js');
    startReversalWatcherFn = rev.startReversalWatcher || null;
    console.log('[ScannerPanel] reversalDriver loaded');
  } catch (e) {
    console.warn('[ScannerPanel] reversalDriver not available (scanner will still render):', e?.message || e);
  }
})();

// ---------- boot ----------
function waitForDOMAndInit(){
  try { import('./strategyStatus.js').then(mod => { mod?.StrategyStatus?.mount && mod.StrategyStatus.mount(); }).catch(()=>{}); } catch {}
  renderScanner(SCANNER_STATE.page);
  if (SCANNER_STATE.timerId) clearInterval(SCANNER_STATE.timerId);
  SCANNER_STATE.timerId = setInterval(() => renderScanner(SCANNER_STATE.page), 3000);
}

document.addEventListener('DOMContentLoaded', waitForDOMAndInit);

// CSS note: add styles:
// .band { padding:2px 6px; border-radius:4px; font-size:12px; }
// .band-ok { background:#063; color:#b7ffcf; }
// .band-off { background:#330; color:#ffd5b7; }
// .qv-ok { color:#b7ffcf; }
// .qv-bad { color:#ffd5b7; }
// .band-legend { margin-left:8px; font-weight:400; opacity:.75; font-size:12px; }