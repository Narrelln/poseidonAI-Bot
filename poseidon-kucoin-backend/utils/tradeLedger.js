// utils/tradeLedger.js
// Schema v1 – robust, single-writer trade ledger for Poseidon

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { getOpenFuturesPositions } = require('../kucoinHelper'); // live snapshot
require('dotenv').config();

const DATA_DIR = path.join(__dirname, 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'tradeHistory.json'); // keep same path for UI
const TMP_FILE = LEDGER_FILE + '.tmp';

const LOCAL_API_BASE = process.env.LOCAL_API_BASE || 'http://localhost:3000';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LEDGER_FILE)) fs.writeFileSync(LEDGER_FILE, JSON.stringify({ schema: 1, rows: [] }, null, 2));

// ---------- Small helpers ----------
const up = s => String(s || '').toUpperCase();
const low = s => String(s || '').toLowerCase();
const nowISO = () => new Date().toISOString();
const fmt = (n, d=4) => Number.isFinite(+n) ? (+n).toFixed(d) : '';
const prettyDate = (iso) => {
  const d = new Date(iso); if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const atomicWrite = (obj) => {
  fs.writeFileSync(TMP_FILE, JSON.stringify(obj, null, 2));
  fs.renameSync(TMP_FILE, LEDGER_FILE);
};

// ---------- Domain math ----------
function hyphenFut(sym) {
  const S = up(sym).replace(/[^A-Z0-9-]/g, '');
  if (S.includes('-')) return S;
  if (S.endsWith('USDTM')) return S.slice(0,-5) + '-USDTM';
  return S;
}
function computePnL({ entry, exit, side, size, multiplier }) {
  const e = +entry, x = +exit, s = Math.abs(+size||0), m = +multiplier || 1;
  if (!(e>0 && x>0 && s>0)) return NaN;
  const diff = x - e;
  const signed = (low(side)==='sell') ? -diff : diff;
  return signed * s * m;
}
function computeROI({ pnl, entry, size, multiplier, leverage }) {
  const e=+entry, s=Math.abs(+size||0), m=+multiplier||1, L=Math.max(1, +leverage||1);
  const cost = e>0 ? (e*s*m)/L : NaN;
  if (!Number.isFinite(cost) || cost<=0 || !Number.isFinite(+pnl)) return '';
  return ((+pnl / cost)*100).toFixed(2)+'%';
}
function priceMovePct({ entry, exit, side }) {
  const e=+entry, x=+exit; if (!(e>0 && x>0)) return '';
  const mv = ((x-e)/e)*100; const sgn = (low(side)==='sell') ? -mv : mv;
  return sgn.toFixed(2)+'%';
}

// ---------- Exit resolvers (authoritative) ----------
async function fetchTA(symbolOrContract) {
  const raw = String(symbolOrContract||'');
  const U = up(raw), L = low(raw);
  const variants = [
    U, L, U.replace(/-/g,''), L.replace(/-/g,''),
    U.replace(/-?USDTM?$/,''),
    L.replace(/-?usdtm?$/,''),
    U.replace(/USDTM$/,'USDT'),
    L.replace(/usdtm$/,'usdt')
  ];
  const pick = o => Number(
    o?.markPrice ?? o?.price ?? o?.lastPrice ??
    o?.ta?.markPrice ?? o?.ta?.price ?? o?.ta?.lastPrice ??
    o?.data?.markPrice ?? o?.data?.price ?? o?.data?.lastPrice
  );
  for (const s of variants) {
    try {
      const { data } = await axios.get(`${LOCAL_API_BASE}/api/ta/${encodeURIComponent(s)}`, { timeout: 3500 });
      const px = pick(data);
      if (Number.isFinite(px) && px>0) return px;
    } catch(_) {}
  }
  return NaN;
}
async function fetchLiveMark(symbol) {
  try {
    const open = await getOpenFuturesPositions();
    const keyH = hyphenFut(symbol);
    const hit = open.find(p => up(hyphenFut(p.contract||p.symbol)) === keyH);
    const px = Number(hit?.markPrice ?? hit?.lastPrice);
    return (Number.isFinite(px) && px>0) ? px : NaN;
  } catch(_) { return NaN; }
}

/** Resolve exit price: TA → live mark → entry (last resort) */
async function resolveExit({ symbol, entry }) {
  const x2 = await fetchTA(symbol);
  if (Number.isFinite(x2) && x2>0) return x2;
  const x3 = await fetchLiveMark(symbol);
  if (Number.isFinite(x3) && x3>0) return x3;
  const e = Number(entry);
  return (Number.isFinite(e) && e>0) ? e : 0;
}

// ---------- Storage (load/migrate/read) ----------
function load() {
  try {
    const json = JSON.parse(fs.readFileSync(LEDGER_FILE,'utf8'));
    if (json && json.schema === 1 && Array.isArray(json.rows)) return json;
    if (Array.isArray(json)) { // migrate legacy array → schema 1
      return { schema: 1, rows: json };
    }
    return { schema: 1, rows: [] };
  } catch {
    return { schema: 1, rows: [] };
  }
}
function saveRows(rows) { atomicWrite({ schema: 1, rows }); }

// ---------- Public API ----------

/** recordOpen: persist a brand-new OPEN trade once */
function recordOpen({ symbol, side, entry, size=1, leverage=5, multiplier=1, orderId='' , tpPercent='', slPercent='' }) {
  const S = load();
  const sym = hyphenFut(symbol);
  const sd  = low(side);
  const exists = S.rows.find(t => up(t.symbol)===sym && up(t.status)==='OPEN' && low(t.side)===sd && (!orderId || t.orderId===orderId));
  if (exists) return exists;

  const ts = nowISO();

  const row = {
    symbol: sym,
    side: sd,
    entry: fmt(entry, 4),
    exit: '',
    pnl: '',
    pnlPercent: '',
    roi: '',
    size: Number(size)||1,
    multiplier: Number(multiplier)||1,
    baseQty: (Number(size)||1)*(Number(multiplier)||1),
    leverage: Number(leverage)||5,
    orderId: orderId||'',
    status: 'OPEN',
    timestamp: ts,
    date: prettyDate(ts),
    tpPercent: (tpPercent!=='' && tpPercent!=null) ? Number(tpPercent) : '',
    slPercent: (slPercent!=='' && slPercent!=null) ? Number(slPercent) : ''
  };
  S.rows.unshift(row);
  if (S.rows.length>1000) S.rows = S.rows.slice(0,1000);
  saveRows(S.rows);
  return row;
}

/**
 * closePosition: ONLY writer for CLOSED rows.
 * Prefers KuCoin hints (exitHint/pnlHint/roiHint). Falls back to TA/mark/entry.
 */
async function closePosition({ symbol, side, exitHint, pnlHint, roiHint }) {
  const S = load();
  const sym = hyphenFut(symbol);
  const sd  = low(side||'');

  let idx = S.rows.findIndex(t => up(t.symbol)===sym && up(t.status)==='OPEN' && (!sd || low(t.side)===sd));
  if (idx===-1) idx = S.rows.findIndex(t => up(t.symbol)===sym && up(t.status)==='OPEN');
  if (idx===-1) return null;

  const t = S.rows[idx];
  const entry = Number(t.entry)||0;

  // 1) Prefer KuCoin exitHint; else resolve via TA/mark/entry
  let exitPx = Number(exitHint);
  if (!Number.isFinite(exitPx) || exitPx <= 0) {
    exitPx = await resolveExit({ symbol: sym, entry });
  }

  // 2) Prefer pnlHint; else compute
  let pnlVal = Number(pnlHint);
  if (!Number.isFinite(pnlVal)) {
    pnlVal = computePnL({ entry, exit: exitPx, side: t.side, size: t.size, multiplier: t.multiplier });
  }

  // 3) Prefer roiHint if it looks like a percent; else compute
  let roiStr = (typeof roiHint === 'string' && roiHint.trim().endsWith('%')) ? roiHint.trim() : '';
  if (!roiStr) {
    roiStr = computeROI({ pnl: pnlVal, entry, size: t.size, multiplier: t.multiplier, leverage: t.leverage });
  }

  const move   = priceMovePct({ entry, exit: exitPx, side: t.side });

  t.exit       = fmt(exitPx, 4);
  t.pnl        = Number.isFinite(pnlVal) ? fmt(pnlVal, 4) : '';
  t.pnlPercent = move || t.pnlPercent || '';
  t.roi        = roiStr || t.roi || '';
  t.status     = 'CLOSED';
  t.closedAt   = nowISO();
  t.date       = prettyDate(t.closedAt);
  t._writer    = 'ledger-v1';

  saveRows(S.rows);
  return t;
}

/** reconcileAgainst(openContractsSet): close any local OPEN not on exchange */
async function reconcileAgainst(openContractsSet = new Set()) {
  const S = load();
  const live = new Set([...openContractsSet].map(x => up(hyphenFut(x))));
  let n = 0;

  for (const t of S.rows) {
    if (up(t.status)!=='OPEN') continue;
    if (live.has(up(t.symbol))) continue;
    await closePosition({ symbol: t.symbol, side: t.side });
    n++;
  }
  return n;
}

/** list(limit): latest trades, enrich OPENs with live mark/pnl for display only */
async function list(limit=50) {
  const S = load();
  const out = S.rows.slice(0, limit).map(r => ({ ...r }));

  // enrich OPEN with live
  let liveMap = new Map();
  try {
    const live = await getOpenFuturesPositions();
    liveMap = new Map(live.map(p => [ up(hyphenFut(p.contract||p.symbol)), p ]));
  } catch (_) {}

  for (const t of out) {
    if (up(t.status)!=='OPEN') continue;
    const hit = liveMap.get(up(hyphenFut(t.symbol)));
    if (!hit) continue;
    const mark = Number(hit.markPrice || hit.lastPrice);
    if (!Number.isFinite(mark)) continue;

    const pnlVal = computePnL({ entry: t.entry, exit: mark, side: t.side, size: t.size, multiplier: t.multiplier });
    const roiStr = computeROI({ pnl: pnlVal, entry: t.entry, size: t.size, multiplier: t.multiplier, leverage: t.leverage });

    t.exitLive = fmt(mark, 4);
    t.pnlLive  = Number.isFinite(pnlVal) ? fmt(pnlVal, 4) : '';
    t.roiLive  = roiStr || '';
  }

  return out;
}

/** ✅ Adapter: returns OPEN trades that have TP or SL configured */
async function getOpenTradesWithTPSL(limit = 200) {
  const rows = await list(limit);
  return rows.filter(t =>
    String(t.status).toUpperCase() === 'OPEN' &&
    (t.tpPercent !== '' || t.slPercent !== '')
  );
}

module.exports = {
  // writers
  recordOpen,
  closePosition,
  reconcileAgainst,
  // readers
  list,
  getOpenTradesWithTPSL,   // ✅ new adapter
  // low-level access
  _load: load,
  _saveRows: saveRows,
  _resolveExit: resolveExit
};