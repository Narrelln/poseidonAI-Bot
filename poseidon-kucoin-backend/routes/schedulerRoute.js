// routes/schedulerRoute.js — Poseidon auto session planner (ledger-first)
// Learns profitable hours globally and per-symbol from the trade ledger.

const express = require('express');
const router = express.Router();
const { list: ledgerList } = require('../utils/tradeLedger');

// ====== TUNABLES ======
const N_DAYS = 7;                         // lookback window (days)
const MIN_TRADES_PER_HOUR = 4;            // min samples to trust a global hour
const TOP_HOURS = 8;                      // keep top N global hours

const MIN_TRADES_PER_SYMBOL_HOUR = 3;     // min samples to trust a per-symbol hour
const TOP_HOURS_PER_SYMBOL = 6;           // keep top N hours per symbol
const MAX_SYMBOLS_EMIT = 80;              // cap payload size

const REST_AFTER_CONSEC_LOSSES = 3;       // global cooling if recent streak is cold
// ======================

function toHourUTC(ts) {
  const d = new Date(ts);
  return isNaN(d) ? null : d.getUTCHours();
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function baseFromSymbol(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[-_]/g, '')
    .replace(/USDTM?$/, '');   // e.g. ADA-USDTM, ADAUSDT → ADA
}

function compositeScore({ wins, trades, pnlSum }) {
  // 70% winrate + 30% expectancy (USDT per trade); soft weight if tiny sample
  const wr = trades ? wins / trades : 0;
  const exp = trades ? pnlSum / trades : 0;
  return (wr * 100) * 0.7 + (exp) * 0.3;
}

function computeGlobal(rows) {
  const byHour = Array.from({ length: 24 }, () => ({ trades:0, wins:0, losses:0, pnlSum:0 }));

  for (const r of rows) {
    const h = toHourUTC(r.closedAt || r.date);
    if (h == null) continue;
    const p = num(r.pnl);
    if (!Number.isFinite(p)) continue;
    const b = byHour[h];
    b.trades++; b.pnlSum += p;
    if (p > 0) b.wins++; else if (p < 0) b.losses++;
  }

  const scored = byHour.map((b, h) => {
    const score = compositeScore(b);
    const sampleFactor = Math.min(1, b.trades / MIN_TRADES_PER_HOUR);
    const finalScore = score * sampleFactor;
    const wrPct = b.trades ? +(b.wins * 100 / b.trades).toFixed(1) : 0;
    const exp = b.trades ? +(b.pnlSum / b.trades).toFixed(3) : 0;
    return { hour:h, trades:b.trades, wins:b.wins, losses:b.losses, wr: wrPct, exp, score:+finalScore.toFixed(3) };
  });

  const allow = scored
    .filter(s => s.trades >= MIN_TRADES_PER_HOUR)
    .sort((a,b) => b.score - a.score)
    .slice(0, TOP_HOURS)
    .map(s => s.hour)
    .sort((a,b) => a - b);

  const avoid = scored
    .filter(s => s.trades >= MIN_TRADES_PER_HOUR && s.score < 0)
    .map(s => s.hour)
    .sort((a,b) => a - b);

  return { byHour: scored, allowHours: allow, avoidHours: avoid };
}

function computePerSymbol(rows) {
  // Build: perSymbol[BASE][hour] -> bucket
  const perSymbol = new Map();

  for (const r of rows) {
    const base = baseFromSymbol(r.symbol);
    if (!base) continue;
    const h = toHourUTC(r.closedAt || r.date);
    if (h == null) continue;
    const p = num(r.pnl);
    if (!Number.isFinite(p)) continue;

    if (!perSymbol.has(base)) perSymbol.set(base, Array.from({ length: 24 }, () => ({ trades:0, wins:0, losses:0, pnlSum:0 })));
    const buckets = perSymbol.get(base);
    const b = buckets[h];
    b.trades++; b.pnlSum += p;
    if (p > 0) b.wins++; else if (p < 0) b.losses++;
  }

  // Score hours per symbol
  const out = {};
  let emitted = 0;
  for (const [base, buckets] of perSymbol.entries()) {
    if (emitted >= MAX_SYMBOLS_EMIT) break;

    const scored = buckets.map((b, h) => {
      const score = compositeScore(b);
      const sampleFactor = Math.min(1, b.trades / MIN_TRADES_PER_SYMBOL_HOUR);
      const finalScore = score * sampleFactor;
      const wrPct = b.trades ? +(b.wins * 100 / b.trades).toFixed(1) : 0;
      const exp = b.trades ? +(b.pnlSum / b.trades).toFixed(3) : 0;
      return { hour:h, trades:b.trades, wins:b.wins, losses:b.losses, wr: wrPct, exp, score:+finalScore.toFixed(3) };
    });

    const allow = scored
      .filter(s => s.trades >= MIN_TRADES_PER_SYMBOL_HOUR)
      .sort((a,b) => b.score - a.score)
      .slice(0, TOP_HOURS_PER_SYMBOL)
      .map(s => s.hour)
      .sort((a,b) => a - b);

    const avoid = scored
      .filter(s => s.trades >= MIN_TRADES_PER_SYMBOL_HOUR && s.score < 0)
      .map(s => s.hour)
      .sort((a,b) => a - b);

    out[base] = {
      allowHours: allow,
      avoidHours: avoid,
      byHour: scored,
      trades: scored.reduce((s, x) => s + x.trades, 0)
    };
    emitted++;
  }

  return out;
}

function computePlan(rowsAll) {
  const since = Date.now() - N_DAYS * 24 * 3600 * 1000;
  const rows = rowsAll.filter(r =>
    String(r.status).toUpperCase() === 'CLOSED' &&
    new Date(r.closedAt || r.date || 0).getTime() >= since
  );

  // global cold streak
  let consecutiveLosses = 0;
  for (const r of rows.slice().sort((a,b)=> new Date(b.closedAt||b.date) - new Date(a.closedAt||a.date))) {
    const p = num(r.pnl);
    if (!Number.isFinite(p)) continue;
    if (p < 0) consecutiveLosses++;
    else break;
  }

  const global = computeGlobal(rows);
  const perSymbol = computePerSymbol(rows);

  const cooling = consecutiveLosses >= REST_AFTER_CONSEC_LOSSES;

  return {
    sinceDays: N_DAYS,
    cooling,
    coolingReason: cooling ? `Consecutive losses: ${consecutiveLosses}` : null,
    allowHoursGlobal: global.allowHours,
    avoidHoursGlobal: global.avoidHours,
    byHourGlobal: global.byHour,
    perSymbol,                 // e.g. { ADA: { allowHours, avoidHours, byHour, trades }, ... }
    tz: 'UTC'
  };
}

router.get('/session-plan', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const rows = await ledgerList(800); // a little deeper for per-symbol samples
    const plan = computePlan(Array.isArray(rows) ? rows : []);
    res.json({ success: true, ...plan });
  } catch (e) {
    console.error('[session-plan] error:', e.message);
    res.status(500).json({ success:false, error:e.message });
  }
});

module.exports = router;