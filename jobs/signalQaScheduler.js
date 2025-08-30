// /workers/signalQaScheduler.js
const SignalAudit = require('../models/SignalAudit');

// Horizons from env (default REAL)
const QA_MODE = (process.env.POSEIDON_QA_MODE || 'real').toLowerCase();
const HORIZONS = QA_MODE === 'test'
  ? [5_000, 15_000, 60_000]               // 5s / 15s / 60s (smoke tests)
  : [300_000, 900_000, 3_600_000];        // 5m / 15m / 60m (real)

function gradeSignal(p0, pT, side) {
  const dir = side === 'SELL' ? -1 : 1;
  const roi = ((pT - p0) / p0) * 100 * dir;
  return { forwardRoiPct: roi, correct: roi > 0 };
}

async function fetchPrice(symbol) {
  const s = String(symbol || '').toUpperCase();
  let norm = s.replace(/[-_]/g,'').replace(/USDTM$/, 'USDT');
  if (norm === 'XBTUSDT') norm = 'BTCUSDT';

  const base = process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3000';
  const url  = `${base}/api/price?symbol=${encodeURIComponent(norm)}`;

  // Node 18+ has global fetch; otherwise install node-fetch
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return undefined;

  const j = await r.json().catch(() => ({}));
  const p = Number(j?.price);
  return Number.isFinite(p) ? p : undefined;
}

/** schedule evaluations for a just-upserted doc */
function scheduleEvaluations(doc) {
  const id = doc.id;
  if (!id) return;

  // avoid double-booking horizons already present
  const have = new Set((doc.results || []).map(r => r.horizonMs));

  for (const h of HORIZONS) {
    if (have.has(h)) continue;
    setTimeout(async () => {
      try {
        const cur = await SignalAudit.findOne({ id }).lean();
        if (!cur) return;
        if (cur.side === 'HOLD') return; // don't grade neutrals

        const pT = await fetchPrice(cur.symbol);
        if (!Number.isFinite(pT)) return;

        const { forwardRoiPct, correct } = gradeSignal(cur.price, pT, cur.side || 'BUY');
        await SignalAudit.updateOne(
          { id },
          { $push: { results: { horizonMs: h, at: Date.now(), price: pT, forwardRoiPct, correct } } }
        );
      } catch (e) {
        console.error('[QA] eval error', id, e?.message || e);
      }
    }, h);
  }
}

/** optional: catch up any recent docs missing some horizons (call on server boot) */
async function catchupRecent(minutes = 120) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  const docs = await SignalAudit.find({ createdAt: { $gte: since } }).lean();
  for (const d of docs) scheduleEvaluations(d);
}

module.exports = { scheduleEvaluations, catchupRecent, HORIZONS, QA_MODE };