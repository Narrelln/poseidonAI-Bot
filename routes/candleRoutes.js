// routes/candleRoutes.js
// Minimal candles endpoint used by patternStats & cron.
// Proxies KuCoin Futures klines and returns [{t,o,h,l,c,v}, ...] (newest last).

const express = require('express');
const axios = require('axios');
const router = express.Router();

const KUCOIN_BASE = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';

// Optional helpers
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

// Basic guard: allow only symbols like ADAUSDT, SOLUSDT, etc.
const SPOT_RX = /^[A-Z]{2,15}USDT$/;
function toValidSpot(input) {
  const raw = String(input || '').toUpperCase();
  const contract = parseToKucoinContractSymbol(raw);
  if (!contract) return null;
  const base = contract.replace(/-USDTM$/, '');
  const spot = `${base}USDT`;
  return SPOT_RX.test(spot) ? spot : null;
}

// Cooldown/backoff map
const cooldown = new Map();
function underCooldown(key) {
  const t = cooldown.get(key) || 0;
  return Date.now() < t;
}
function setCooldown(key, ms = 15000) {
  cooldown.set(key, Date.now() + ms);
}

// TF map
const TF = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '2h': 120, '4h': 240, '8h': 480, '1d': 1440
};

router.get('/candles/:symbol', async (req, res) => {
  try {
    const spot = toValidSpot(req.params.symbol);
    if (!spot) return res.json([]); // quietly drop invalid input

    const tf   = String(req.query.tf || '1h').toLowerCase();
    const lim  = Math.max(10, Math.min(1000, Number(req.query.limit) || 100));
    const gran = TF[tf] || 60;
    const key  = `${spot}:${tf}:${lim}`;

    if (underCooldown(key)) return res.json([]);  // backoff if recent failure

    const contract = parseToKucoinContractSymbol(spot);
    const apiSym   = toKucoinApiSymbol(contract);
    const nowMs    = Date.now(); // KuCoin expects ms
    const fromMs   = nowMs - (gran * 60 * 1000 * lim);

    const { data } = await axios.get(`${KUCOIN_BASE}/api/v1/kline/query`, {
      params: { symbol: apiSym, granularity: gran, from: fromMs, to: nowMs },
      timeout: 10000
    });

    const rows = Array.isArray(data?.data) ? data.data : [];
    const out = rows.map(r => ({
      t: Number(r[0]),
      o: Number(r[1]),
      c: Number(r[2]),
      h: Number(r[3]),
      l: Number(r[4]),
      v: Number(r[5])
    })).filter(k => Number.isFinite(k.t) && Number.isFinite(k.o));

    res.json(out.sort((a, b) => a.t - b.t));
  } catch (e) {
    const sym = String(req.params.symbol || '').toUpperCase();
    setCooldown(`${sym}:${req.query.tf || '1h'}:${req.query.limit || 100}`);
    console.warn('[candles] error:', e?.message || e);
    res.status(502).json({ ok: false, error: 'candles_fetch_failed' });
  }
});

module.exports = router;
