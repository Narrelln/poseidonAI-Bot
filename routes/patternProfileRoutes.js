/* eslint-disable no-console */
/**
 * routes/patternProfileRoutes.js
 *
 * Backfill & inspect endpoints for pattern profile.
 *
 * POST /api/pattern-profile/backfill
 *   body: { symbol: "ADA-USDTM|ADA|ADAUSDT", candles?: [{t,h,l},...], days?: 7 }
 *   If `candles` omitted, the route tries /api/candles/:spot?tf=1d&limit=N.
 *
 * GET /api/pattern-profile/:symbol?limit=30
 *   Returns recent stored rows for a symbol.
 */

const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const uri  = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbNm = process.env.MONGO_DB || 'poseidon';
const coll = process.env.MONGO_PATTERN_COLL || 'pattern_profile';
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

const router = express.Router();

let collection;
async function getColl() {
  if (collection) return collection;
  const client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  collection = client.db(dbNm).collection(coll);
  try { await collection.createIndex({ symbol: 1, day: -1 }, { name: 'sym_day_idx' }); } catch {}
  return collection;
}

function up(s){return String(s||'').toUpperCase();}
function toContract(any){
  let s=up(any).replace(/[-_]/g,'');
  if (s.endsWith('USDTM')) return s;
  if (s.endsWith('USDT')) return s+'M';
  return s+'USDTM';
}
function toSpot(any){ return up(toContract(any)).replace(/USDTM$/, 'USDT'); }
function yyyymmdd(ts){ const d=new Date(ts); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function emFromDaily({ high, low }) {
  const H=+high, L=+low;
  if(!(H>0)&&!(L>0)) return null;
  const mid=(H+L)/2;
  return ((H-L)/mid)*100;
}

async function fetchDailyCandles(spot, days=7){
  try{
    const { data } = await axios.get(`${BASE}/api/candles/${spot}?tf=1d&limit=${Math.max(3,days)}`, { timeout: 9000 });
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.candles) ? data.candles : []);
    return rows
      .map(r => ({ t:+r.t||+r.time||+r.ts||0, h:+r.h||+r.high, l:+r.l||+r.low }))
      .filter(r => Number.isFinite(r.t) && r.t>0 && r.h>0 && r.l>0)
      .sort((a,b)=>a.t-b.t);
  }catch(e){
    console.warn('[patternRoutes] fetchDailyCandles failed', spot, e?.message||e);
    return [];
  }
}

// POST backfill
router.post('/pattern-profile/backfill', async (req,res)=>{
  try{
    const symRaw = req.body?.symbol;
    if(!symRaw) return res.status(400).json({ ok:false, error:'symbol required' });
    const fut = toContract(symRaw);
    const spot = toSpot(symRaw);
    const days = Math.max(3, Math.min(90, Number(req.body?.days)||14));

    let candles = Array.isArray(req.body?.candles) ? req.body.candles : null;
    if(!candles) candles = await fetchDailyCandles(spot, days);
    if(!candles || !candles.length) return res.status(400).json({ ok:false, error:'no candles' });

    const c = await getColl();
    let wrote = 0;
    for(const k of candles){
      const day = yyyymmdd(k.t);
      const emPct = emFromDaily({ high:k.h, low:k.l }) ?? 1.2;
      const doc = { symbol: fut, day, emPct: Number(emPct), realizedPct: Number(emPct), updatedAt: new Date() };
      await c.updateOne({ symbol:fut, day }, { $set: doc }, { upsert:true });
      wrote++;
    }
    return res.json({ ok:true, wrote, symbol:fut });
  }catch(e){
    console.error('[patternRoutes] backfill error', e?.message||e);
    return res.status(500).json({ ok:false, error:e?.message||'fail' });
  }
});

// GET inspect
router.get('/pattern-profile/:symbol', async (req,res)=>{
  try{
    const fut = toContract(req.params.symbol);
    const lim = Math.max(1, Math.min(200, Number(req.query.limit)||30));
    const c   = await getColl();
    const rows = await c.find({ symbol:fut }).sort({ day:-1 }).limit(lim).toArray();
    return res.json({ ok:true, symbol:fut, rows });
  }catch(e){
    console.error('[patternRoutes] get error', e?.message||e);
    return res.status(500).json({ ok:false, error:e?.message||'fail' });
  }
});

module.exports = router;