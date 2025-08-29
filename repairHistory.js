/**
 * File #X: repairhistory.js
 * Purpose:
 *   One-time cleanup for utils/data/tradeHistory.json:
 *   - Normalize symbols: "ABCUSDTM" -> "ABC-USDTM"
 *   - Normalize case: status UPPER, side lower
 *   - Deduplicate OPEN trades for same symbol+side (keep newest by timestamp)
 * Usage:
 *   node repairhistory.js --dry
 *   node repairhistory.js
 *   node repairhistory.js --file=path/to/tradeHistory.json --dry
 * Last Updated: 2025-08-11
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');

// allow --file=/path/to.json
const fileArg = args.find(a => a.startsWith('--file='));
const overridePath = fileArg ? fileArg.split('=')[1] : null;

// Default: this backend’s real history file
const DEFAULT_HISTORY = path.join(__dirname, 'utils', 'data', 'tradeHistory.json');

const HISTORY_FILE = overridePath
  ? path.resolve(process.cwd(), overridePath)
  : DEFAULT_HISTORY;

function ensureFileExists(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, '[]');
}

function toHyphenFutures(sym) {
  if (!sym) return '';
  const s = String(sym).toUpperCase().replace(/[^A-Z0-9]/g, ''); // strip non-alnum
  if (s.endsWith('USDTM')) {
    const base = s.slice(0, -5);
    return `${base}-USDTM`;
  }
  return s;
}

function safeNum(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

function parseTime(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function normalizeRow(row) {
  const out = { ...row };

  // symbol
  out.symbol = toHyphenFutures(out.symbol);

  // casing
  if (out.status) out.status = String(out.status).toUpperCase();
  if (out.side) out.side = String(out.side).toLowerCase();

  // numbers (keep strings if empty)
  if (out.entry !== '' && out.entry != null) out.entry = safeNum(out.entry).toFixed(4);
  if (out.exit  !== '' && out.exit  != null) out.exit  = safeNum(out.exit).toFixed(4);
  if (out.pnl   !== '' && out.pnl   != null) out.pnl   = safeNum(out.pnl).toFixed(4);

  // keep leverage/size numeric if present
  if (out.leverage !== '' && out.leverage != null) out.leverage = safeNum(out.leverage);
  if (out.size     !== '' && out.size     != null) out.size     = safeNum(out.size);

  // date / timestamp sanity (don’t generate if missing)
  if (out.timestamp && !Number.isFinite(Date.parse(out.timestamp))) {
    delete out.timestamp;
  }
  if (out.closedAt && !Number.isFinite(Date.parse(out.closedAt))) {
    delete out.closedAt;
  }

  return out;
}

function dedupeOpenTrades(rows) {
  // Keep latest OPEN by (symbol, side)
  const latest = new Map(); // key: symbol|side -> index
  rows.forEach((r, idx) => {
    if (r.status !== 'OPEN') return;
    const key = `${r.symbol}|${r.side}`;
    const nowT = parseTime(r.timestamp) || 0;

    if (!latest.has(key)) {
      latest.set(key, idx);
    } else {
      const prevIdx = latest.get(key);
      const prevT = parseTime(rows[prevIdx].timestamp) || 0;
      if (nowT >= prevT) latest.set(key, idx);
    }
  });

  // collect survivors for OPEN; all CLOSED survive
  const keep = new Array(rows.length).fill(false);
  // mark all CLOSED
  rows.forEach((r, idx) => { if (r.status === 'CLOSED') keep[idx] = true; });
  // mark latest OPEN per key
  latest.forEach(idx => { keep[idx] = true; });

  return rows.filter((_, i) => keep[i]);
}

function main() {
  ensureFileExists(HISTORY_FILE);

  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to read/parse history:', e.message);
    process.exit(1);
  }

  console.log(`Loaded ${raw.length} rows from ${HISTORY_FILE}`);

  // normalize
  let rows = raw.map(normalizeRow);

  // dedupe open
  rows = dedupeOpenTrades(rows);

  const openCount = rows.filter(r => r.status === 'OPEN').length;
  const closedCount = rows.filter(r => r.status === 'CLOSED').length;

  if (DRY) {
    console.log('[DRY RUN] No backup/write will be performed.');
    console.log(`Would write ${rows.length} rows back to ${HISTORY_FILE}`);
    console.log(`Stats → OPEN: ${openCount} | CLOSED: ${closedCount}`);
    return;
  }

  // backup once per run
  const backupPath = `${HISTORY_FILE}.${Date.now()}.bak`;
  try {
    fs.copyFileSync(HISTORY_FILE, backupPath);
    console.log(`Backup saved: ${backupPath}`);
  } catch (e) {
    console.warn('Backup failed (continuing):', e.message);
  }

  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(rows, null, 2));
    console.log(`✅ Wrote ${rows.length} rows to ${HISTORY_FILE}`);
    console.log(`Stats → OPEN: ${openCount} | CLOSED: ${closedCount}`);
  } catch (e) {
    console.error('Write failed:', e.message);
    process.exit(1);
  }
}

main();