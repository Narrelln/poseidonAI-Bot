/* eslint-disable no-console */
// routes/signalAuditRoutes.js — PRO summary + CSV export
const express = require('express');
const router  = express.Router();
const SignalAudit = require('../models/SignalAudit');

// ------------------------------
// Helpers
// ------------------------------
function parseDateish(v, fallbackMs) {
  if (!v) return new Date(Date.now() - fallbackMs);
  if (/^\d+$/.test(String(v))) return new Date(Number(v)); // epoch ms
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : new Date(Date.now() - fallbackMs);
}
function safePct(n, d) { return d ? (n / d) * 100 : 0; }
function round(x, p = 2) {
  const v = Number(x);
  return Number.isFinite(v) ? Number(v.toFixed(p)) : 0;
}

// ------------------------------
// 1) Upsert a record from FE (already in your version)
// ------------------------------
router.post('/signal-audit', async (req, res) => {
  try {
    const doc = req.body || {};
    if (!doc.id)                    return res.status(400).json({ ok:false, error:'missing id' });
    if (!doc.symbol)                return res.status(400).json({ ok:false, error:'missing symbol' });
    if (!doc.side)                  return res.status(400).json({ ok:false, error:'missing side' });
    if (!doc.event)                 return res.status(400).json({ ok:false, error:'missing event' });
    if (!Number.isFinite(doc.at))   return res.status(400).json({ ok:false, error:'missing at (ms)' });
    if (!Number.isFinite(doc.price))return res.status(400).json({ ok:false, error:'missing price' });

    const saved = await SignalAudit.findOneAndUpdate(
      { id: doc.id },
      { $set: doc },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select('_id id');
    res.json({ ok: true, _id: saved._id, id: saved.id });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || 'db error' });
  }
});

// ------------------------------
// 2) Rolling stats (24h) — you already had this
// ------------------------------
router.get('/signal-audit/stats', async (_req, res) => {
  try {
    const since = new Date(Date.now() - 24*60*60*1000);

    const pipeline = [
      { $match: { createdAt: { $gte: since } } },
      { $facet: {
          total:   [ { $count: 'n' } ],
          results: [
            { $unwind: { path: '$results', preserveNullAndEmptyArrays: false } },
            { $project: { horizonMs: '$results.horizonMs', correct: '$results.correct' } },
            { $bucket: {
                groupBy: '$horizonMs',
                boundaries: [0, 300000, 900000, Number.MAX_SAFE_INTEGER],
                default: Number.MAX_SAFE_INTEGER,
                output: {
                  n:  { $sum: 1 },
                  ok: { $sum: { $cond: ['$correct', 1, 0] } }
                }
            } }
          ]
      } }
    ];

    const out = await SignalAudit.aggregate(pipeline);
    const first = out[0] || { total: [], results: [] };

    const acc = { total: (first.total[0]?.n || 0), m5:{ok:0,n:0}, m15:{ok:0,n:0}, h1:{ok:0,n:0} };
    for (const b of first.results) {
      const key = b._id <= 300000 ? 'm5' : b._id <= 900000 ? 'm15' : 'h1';
      acc[key].n += b.n; acc[key].ok += b.ok;
    }
    res.json({ ok:true, acc });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || 'db error' });
  }
});

// ------------------------------
// 3) PRO Summary — “final score” over any window
// GET /api/signal-audit/summary?since=ISO|ms&until=ISO|ms&symbol=BTC-USDTM&minConf=70&event=decision
// ------------------------------
router.get('/signal-audit/summary', async (req, res) => {
  try {
    const since   = parseDateish(req.query.since, 7*24*60*60*1000); // default: last 7 days
    const until   = parseDateish(req.query.until, 0);
    const symbolQ = String(req.query.symbol || '').trim();
    const minConf = Number(req.query.minConf);
    const eventQ  = String(req.query.event || '').trim(); // analysis | skipped | decision | (blank=all)

    const match = { createdAt: { $gte: since, ...(until ? { $lte: until } : {}) } };
    if (symbolQ) match.symbol = symbolQ;
    if (eventQ)  match.event  = eventQ;

    const pipeline = [
      { $match: match },
      // Flatten results (one row per horizon scoring)
      { $unwind: { path: '$results', preserveNullAndEmptyArrays: false } },
      // Keep only records above a confidence floor if requested
      ...(Number.isFinite(minConf) ? [{ $match: { confidence: { $gte: minConf } } }] : []),
      // Shape fields we care about
      { $project: {
          symbol: 1,
          side: 1,
          event: 1,
          confidence: 1,
          horizonMs: '$results.horizonMs',
          forwardRoiPct: '$results.forwardRoiPct',
          correct: '$results.correct'
      } },
      { $facet: {
        // Overall per horizon
        perHorizon: [
          { $group: {
              _id: '$horizonMs',
              n: { $sum: 1 },
              ok: { $sum: { $cond: ['$correct', 1, 0] } },
              avgRoi: { $avg: '$forwardRoiPct' },
              avgAbsRoi: { $avg: { $abs: '$forwardRoiPct' } },
              rois: { $push: '$forwardRoiPct' }
          } },
          { $sort: { _id: 1 } }
        ],
        // By side (BUY/SELL)
        bySide: [
          { $group: {
              _id: '$side',
              n: { $sum: 1 },
              ok: { $sum: { $cond: ['$correct', 1, 0] } },
              avgRoi: { $avg: '$forwardRoiPct' }
          } },
          { $sort: { _id: 1 } }
        ],
        // By symbol (top accuracy)
        bySymbol: [
          { $group: {
              _id: '$symbol',
              n: { $sum: 1 },
              ok: { $sum: { $cond: ['$correct', 1, 0] } },
              avgRoi: { $avg: '$forwardRoiPct' }
          } },
          { $addFields: { winRate: { $cond: [{ $gt: ['$n', 0] }, { $multiply: [{ $divide: ['$ok', '$n'] }, 100] }, 0] } } },
          { $sort: { winRate: -1, n: -1 } },
          { $limit: 20 }
        ],
        // Totals
        totals: [
          { $group: {
              _id: null,
              n: { $sum: 1 },
              ok: { $sum: { $cond: ['$correct', 1, 0] } },
              avgRoi: { $avg: '$forwardRoiPct' },
              avgAbsRoi: { $avg: { $abs: '$forwardRoiPct' } }
          } }
        ]
      } }
    ];

    const out = await SignalAudit.aggregate(pipeline);
    const first = out[0] || { perHorizon: [], bySide: [], bySymbol: [], totals: [] };

    // Compute medians/p95 for each horizon in Node (Mongo doesn't have easy median)
    function median(arr) {
      if (!arr || !arr.length) return 0;
      const a = arr.slice().sort((x,y) => x - y);
      const mid = Math.floor(a.length / 2);
      return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
    }
    function p95(arr) {
      if (!arr || !arr.length) return 0;
      const a = arr.slice().sort((x,y) => x - y);
      const idx = Math.floor(0.95 * (a.length - 1));
      return a[idx];
    }

    const perHorizon = first.perHorizon.map(h => ({
      horizonMs: h._id,
      samples: h.n,
      wins: h.ok,
      winRatePct: round(safePct(h.ok, h.n), 2),
      avgRoiPct: round(h.avgRoi, 3),
      avgAbsRoiPct: round(h.avgAbsRoi, 3),
      medianRoiPct: round(median(h.rois), 3),
      p95RoiPct: round(p95(h.rois), 3)
    }));

    const totalsRaw = first.totals[0] || { n: 0, ok: 0, avgRoi: 0, avgAbsRoi: 0 };
    const totals = {
      samples: totalsRaw.n,
      wins: totalsRaw.ok,
      winRatePct: round(safePct(totalsRaw.ok, totalsRaw.n), 2),
      avgRoiPct: round(totalsRaw.avgRoi, 3),
      avgAbsRoiPct: round(totalsRaw.avgAbsRoi, 3)
    };

    const bySide = first.bySide.map(s => ({
      side: s._id,
      samples: s.n,
      wins: s.ok,
      winRatePct: round(safePct(s.ok, s.n), 2),
      avgRoiPct: round(s.avgRoi, 3)
    }));

    const bySymbol = first.bySymbol.map(s => ({
      symbol: s._id,
      samples: s.n,
      wins: s.ok,
      winRatePct: round(s.winRate, 2),
      avgRoiPct: round(s.avgRoi, 3)
    }));

    res.json({
      ok: true,
      window: { since, until: until || null, minConf: Number.isFinite(minConf) ? minConf : null, symbol: symbolQ || null, event: eventQ || null },
      totals,
      perHorizon,
      bySide,
      bySymbol
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || 'db error' });
  }
});

// ------------------------------
// 4) CSV Export (for Excel/Sheets)
// GET /api/signal-audit/export.csv?since=...&until=...&minConf=70&symbol=...&event=...
// ------------------------------
router.get('/signal-audit/export.csv', async (req, res) => {
  try {
    const since   = parseDateish(req.query.since, 7*24*60*60*1000);
    const until   = parseDateish(req.query.until, 0);
    const symbolQ = String(req.query.symbol || '').trim();
    const minConf = Number(req.query.minConf);
    const eventQ  = String(req.query.event || '').trim();

    const match = { createdAt: { $gte: since, ...(until ? { $lte: until } : {}) } };
    if (symbolQ) match.symbol = symbolQ;
    if (eventQ)  match.event  = eventQ;

    const pipeline = [
      { $match: match },
      { $unwind: { path: '$results', preserveNullAndEmptyArrays: false } },
      ...(Number.isFinite(minConf) ? [{ $match: { confidence: { $gte: minConf } } }] : []),
      { $project: {
          createdAt: 1,
          event: 1,
          symbol: 1,
          side: 1,
          confidence: 1,
          entryPrice: '$price',
          horizonMs: '$results.horizonMs',
          evalAt: '$results.at',
          evalPrice: '$results.price',
          forwardRoiPct: '$results.forwardRoiPct',
          correct: '$results.correct'
      } },
      { $sort: { createdAt: 1 } }
    ];

    const rows = await SignalAudit.aggregate(pipeline);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="poseidon_signal_audit.csv"');

    // header
    res.write([
      'createdAt','event','symbol','side','confidence',
      'entryPrice','horizonMs','evalAt','evalPrice','forwardRoiPct','correct'
    ].join(',') + '\n');

    for (const r of rows) {
      const line = [
        new Date(r.createdAt).toISOString(),
        r.event,
        r.symbol,
        r.side,
        Number(r.confidence ?? 0),
        Number(r.entryPrice ?? 0),
        Number(r.horizonMs ?? 0),
        r.evalAt ? new Date(r.evalAt).toISOString() : '',
        Number(r.evalPrice ?? 0),
        Number(r.forwardRoiPct ?? 0).toFixed(6),
        r.correct ? 1 : 0
      ].join(',');
      res.write(line + '\n');
    }
    res.end();
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || 'export failed' });
  }
});

module.exports = router;