/* routes/signalAuditExport.js
 * CSV export for SignalAudit with filters and safety caps.
 *
 * Query params:
 *  - since:   ISO date (inclusive)
 *  - until:   ISO date (exclusive)
 *  - minConf: number 0..100 (>=)
 *  - symbol:  exact match, e.g. BTC-USDTM (optional)
 *  - event:   analysis|decision|skipped (optional)
 *  - limit:   max docs to scan (default 10000, hard max 50000)
 */
const express = require('express');
const router = express.Router();
const { Parser } = require('json2csv');
const SignalAudit = require('../models/SignalAudit');

function toNum(v, d = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

router.get('/signal-audit/export.csv', async (req, res) => {
  try {
    // --- build query ---
    const q = {};
    const since = req.query.since ? new Date(req.query.since) : null;
    const until = req.query.until ? new Date(req.query.until) : null;

    if (since || until) {
      q.createdAt = {};
      if (since && !isNaN(since)) q.createdAt.$gte = since;
      if (until && !isNaN(until)) q.createdAt.$lt  = until;
      if (!Object.keys(q.createdAt).length) delete q.createdAt;
    }

    const minConf = toNum(req.query.minConf);
    if (Number.isFinite(minConf)) q.confidence = { $gte: Math.max(0, Math.min(100, minConf)) };

    if (req.query.symbol) q.symbol = String(req.query.symbol).toUpperCase().trim();
    if (req.query.event)  q.event  = String(req.query.event).toLowerCase();

    // safety cap
    const hardMax = 50_000;
    const def     = 10_000;
    const limit   = Math.min(Math.max(1, toNum(req.query.limit, def)), hardMax);

    // --- fetch lean docs (only what we need) ---
    const docs = await SignalAudit
      .find(q, {
        _id: 0, id: 1, symbol: 1, event: 1, confidence: 1, reason: 1,
        side: 1, price: 1, at: 1, results: 1, createdAt: 1
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // --- flatten rows (one per result horizon) ---
    const rows = [];
    for (const d of docs) {
      const base = {
        id: d.id,
        symbol: d.symbol,
        event: d.event,
        confidence: d.confidence,
        reason: d.reason,
        side: d.side,
        price: d.price,
        createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : '',
        at: d.at ? new Date(d.at).toISOString() : ''
      };
      if (Array.isArray(d.results) && d.results.length) {
        for (const r of d.results) {
          rows.push({
            ...base,
            horizonMs: r.horizonMs,
            scoredAt: r.at ? new Date(r.at).toISOString() : '',
            scoredPrice: r.price,
            forwardRoiPct: r.forwardRoiPct,
            correct: r.correct
          });
        }
      } else {
        // still emit a row so you can see unscored events
        rows.push({ ...base, horizonMs: '', scoredAt: '', scoredPrice: '', forwardRoiPct: '', correct: '' });
      }
    }

    const fields = [
      'id','symbol','event','side','confidence','reason','price',
      'createdAt','at','horizonMs','scoredAt','scoredPrice','forwardRoiPct','correct'
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(rows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="signal-audit-export.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    console.error('[signal-audit/export.csv] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;