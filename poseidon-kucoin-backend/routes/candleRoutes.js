/* routes/candleRoutes.js
 * Minimal candles endpoint used by patternStats & cron.
 * Proxies KuCoin Futures klines and returns [{t,o,h,l,c,v}, ...] (newest last).
 */
const express = require('express');
const axios = require('axios');

const router = express.Router();
const KUCOIN_BASE = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';

// Optional helpers if you already have them; otherwise light fallbacks
let parseToKucoinContractSymbol, toKucoinApiSymbol;
try { ({ parseToKucoinContractSymbol, toKucoinApiSymbol } = require('../kucoinHelper')); } catch (_) {
  parseToKucoinContractSymbol = (s) => {
    if (!s) return '';
    let t = String(s).toUpperCase().replace(/[-_]/g, '');
    if (t.endsWith('USDTM')) t = t.slice(0, -5);
    else if (t.endsWith('USDT')) t = t.slice(0, -4);
    if (t === 'BTC') t = 'XBT';
    return `${t}-USDTM`;
  };
  toKucoinApiSymbol = (c) => String(c || '').replace(/-/g, '');
}

// Map tf -> KuCoin granularity (minutes)
const TF = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '2h': 120, '4h': 240, '8h': 480, '1d': 1440
};

router.get('/candles/:symbol', async (req, res) => {
  try {
    const raw = String(req.params.symbol || '').toUpperCase();
    const tf   = String(req.query.tf || '1h').toLowerCase();
    const lim  = Math.max(10, Math.min(1000, Number(req.query.limit) || 100));
    const gran = TF[tf] || 60;

    const contract = parseToKucoinContractSymbol(raw);
    const apiSym   = toKucoinApiSymbol(contract);

    const nowSec   = Math.floor(Date.now() / 1000);
    const spanSec  = gran * 60 * lim;
    const fromSec  = nowSec - spanSec;

    const url = `${KUCOIN_BASE}/api/v1/kline/query`;
    const params = { symbol: apiSym, granularity: gran, from: fromSec, to: nowSec };

    const { data } = await axios.get(url, { params, timeout: 10000 });
    const rows = Array.isArray(data?.data) ? data.data : [];

    // KuCoin row: [time, open, close, high, low, volume, turnover]
    const out = rows
      .map(r => ({
        t: Number(r[0]) * 1000,     // ms
        o: Number(r[1]),
        c: Number(r[2]),
        h: Number(r[3]),
        l: Number(r[4]),
        v: Number(r[5])
      }))
      .filter(k => Number.isFinite(k.t) && Number.isFinite(k.o) && Number.isFinite(k.h) && Number.isFinite(k.l))
      .sort((a,b) => a.t - b.t);

    res.json(out);
  } catch (e) {
    console.warn('[candles] error:', e?.message || e);
    res.status(502).json({ ok:false, error:'candles_fetch_failed' });
  }
});

module.exports = router;