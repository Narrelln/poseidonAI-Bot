/**
 * File #X: repairhistory.js
 * Purpose:
 *   One-time cleanup for utils/data/tradeHistory.json:
 *   - Normalize symbols: "ABCUSDTM" -> "ABC-USDTM"
 *   - Normalize case: status UPPER, side lower
 *   - Deduplicate OPEN trades (latest by timestamp per symbol+side)
 *   - (NEW) Optional backfill: fix CLOSED rows where exit==entry or pnl/roi missing
 *       using KuCoin fills via getRecentTradesFromKucoin()
 *
 * Usage:
 *   node repairhistory.js --dry
 *   node repairhistory.js
 *   node repairhistory.js --file=path/to/tradeHistory.json --dry
 *   node repairhistory.js --backfill --windowDays=30
 *
 * Last Updated: 2025-08-16
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const DO_BACKFILL = args.includes('--backfill');
const fileArg = args.find(a => a.startsWith('--file='));
const winArg  = args.find(a => a.startsWith('--windowDays='));
const WINDOW_DAYS = winArg ? Math.max(1, parseInt(winArg.split('=')[1], 10) || 30) : 30;

// Default: this backend’s real history file
const DEFAULT_HISTORY = path.join(__dirname, 'utils', 'data', 'tradeHistory.json');
const HISTORY_FILE = fileArg ? path.resolve(process.cwd(), fileArg.split('=')[1]) : DEFAULT_HISTORY;

// ————— helpers —————
function ensureFileExists(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, '[]');
}

function toHyphenFutures(sym) {
  if (!sym) return '';
  const s = String(sym).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (s.includes('-')) return s;
  if (s.endsWith('USDTM')) return `${s.slice(0, -5)}-USDTM`;
  return s;
}

function safeNum(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}
function parseTime(iso) {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}
function fmt(n, d = 4) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : '';
}

function normalizeRow(row) {
  const out = { ...row };

  // symbol form
  out.symbol = toHyphenFutures(out.symbol);

  // casing
  if (out.status) out.status = String(out.status).toUpperCase();
  if (out.side)   out.side   = String(out.side).toLowerCase();

  // numeric strings (keep '' if intentionally blank)
  if (out.entry !== '' && out.entry != null) out.entry = fmt(out.entry, 4);
  if (out.exit  !== '' && out.exit  != null) out.exit  = fmt(out.exit, 4);
  if (out.pnl   !== '' && out.pnl   != null) out.pnl   = fmt(out.pnl, 4);

  // leverage/size numeric
  if (out.leverage !== '' && out.leverage != null) out.leverage = safeNum(out.leverage);
  if (out.size     !== '' && out.size     != null) out.size     = safeNum(out.size);

  // sanitize bad timestamps
  if (out.timestamp && Number.isNaN(parseTime(out.timestamp))) delete out.timestamp;
  if (out.closedAt  && Number.isNaN(parseTime(out.closedAt ))) delete out.closedAt;

  return out;
}

function dedupeOpenTrades(rows) {
  // Keep latest OPEN by (symbol, side)
  const latest = new Map(); // key: symbol|side -> index
  rows.forEach((r, idx) => {
    if (r.status !== 'OPEN') return;
    const key = `${r.symbol}|${r.side}`;
    const nowT = parseTime(r.timestamp) || 0;
    if (!latest.has(key)) latest.set(key, idx);
    else {
      const prevIdx = latest.get(key);
      const prevT = parseTime(rows[prevIdx].timestamp) || 0;
      if (nowT >= prevT) latest.set(key, idx);
    }
  });

  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, idx) => { if (r.status === 'CLOSED') keep[idx] = true; });
  latest.forEach(idx => { keep[idx] = true; });

  return rows.filter((_, i) => keep[i]);
}

// ——— NEW: lightweight backfill from KuCoin fills ———
async function kuBackfill(rows) {
  // Pull recent closed legs from exchange
  let recent = [];
  try {
    const { getRecentTradesFromKucoin } = require('./utils/tradeHistory');
    recent = await getRecentTradesFromKucoin(1000, WINDOW_DAYS * 24 * 60 * 60 * 1000);
  } catch (e) {
    console.warn('[repair] backfill disabled (fetch error):', e.message);
    return rows;
  }

  // index recent by symbol
  const bySym = new Map();
  for (const r of recent) {
    const sym = toHyphenFutures(r.symbol);
    if (!bySym.has(sym)) bySym.set(sym, []);
    bySym.get(sym).push(r);
  }
  for (const list of bySym.values()) list.sort((a,b) => (parseTime(b.closedAt) || 0) - (parseTime(a.closedAt) || 0));

  const needFix = (t) => {
    const exitEqEntry = (t.exit && t.entry && Number(t.exit) === Number(t.entry));
    const noRoi = !t.roi || t.roi === '0.00%' || t.roi === '';
    const zeroPnl = !t.pnl || Number(t.pnl) === 0;
    return String(t.status) === 'CLOSED' && (exitEqEntry || noRoi || zeroPnl);
  };

  const tolMs = 6 * 60 * 60 * 1000; // ±6h window match
  const nearTime = (a, b) => {
    const ta = parseTime(a) || NaN;
    const tb = parseTime(b) || NaN;
    if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
    return Math.abs(ta - tb) <= tolMs;
  };

  let fixed = 0;

  const out = rows.map(t => {
    if (!needFix(t)) return t;

    const sym = toHyphenFutures(t.symbol);
    const bucket = bySym.get(sym);
    if (!bucket || !bucket.length) return t;

    // choose best candidate by time proximity and size closeness
    const sizeNum = Number(t.size) || NaN;
    let best = null, bestScore = Infinity;

    for (const r of bucket) {
      // recent rows from KuCoin builder have: side, entry, exit, size, pnl, roi, openedAt, closedAt
      const when = r.closedAt || r.openedAt;
      const dt = parseTime(when);
      const tt = parseTime(t.closedAt || t.timestamp);
      const timeScore = (Number.isFinite(dt) && Number.isFinite(tt)) ? Math.abs(dt - tt) : 1e15;
      if (timeScore > tolMs) continue;

      const rSize = Number(r.size);
      const sizeScore = (Number.isFinite(sizeNum) && Number.isFinite(rSize)) ? Math.abs(rSize - sizeNum) : 0.5;
      const score = timeScore / (1000 * 60) + sizeScore * 10; // minutes + size weight

      if (score < bestScore) { best = r; bestScore = score; }
    }

    if (!best) return t;

    const patched = { ...t };
    patched.exit = fmt(best.exit, 6);
    patched.pnl  = fmt(best.pnl, 6);
    patched.roi  = best.roi || t.roi || '';
    if (!patched.closedAt && best.closedAt) patched.closedAt = best.closedAt;
    if (!patched.timestamp && best.openedAt) patched.timestamp = best.openedAt;
    fixed++;
    return patched;
  });

  console.log(`[*] Backfill matched & fixed ${fixed} row(s) using KuCoin fills (window ${WINDOW_DAYS}d).`);
  return out;
}

// ————— main —————
(async function main() {
  ensureFileExists(HISTORY_FILE);

  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to read/parse history:', e.message);
    process.exit(1);
  }

  console.log(`Loaded ${raw.length} rows from ${HISTORY_FILE}`);

  // normalize + dedupe
  let rows = raw.map(normalizeRow);
  rows = dedupeOpenTrades(rows);

  // optional backfill step
  if (DO_BACKFILL) {
    rows = await kuBackfill(rows);
  }

  const openCount   = rows.filter(r => r.status === 'OPEN').length;
  const closedCount = rows.filter(r => r.status === 'CLOSED').length;

  if (DRY) {
    console.log('[DRY RUN] No backup/write will be performed.');
    console.log(`Would write ${rows.length} rows back to ${HISTORY_FILE}`);
    console.log(`Stats → OPEN: ${openCount} | CLOSED: ${closedCount}`);
    return;
  }

  const backupPath = `${HISTORY_FILE}.${Date.now()}.bak`;
  try { fs.copyFileSync(HISTORY_FILE, backupPath); console.log(`Backup saved: ${backupPath}`); }
  catch (e) { console.warn('Backup failed (continuing):', e.message); }

  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(rows, null, 2));
    console.log(`✅ Wrote ${rows.length} rows to ${HISTORY_FILE}`);
    console.log(`Stats → OPEN: ${openCount} | CLOSED: ${closedCount}`);
  } catch (e) {
    console.error('Write failed:', e.message);
    process.exit(1);
  }
})();