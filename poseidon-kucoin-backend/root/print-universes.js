#!/usr/bin/env node
/* Print Cycle vs Reversal universes based on the frozen scan.
 * - Reads /api/scan-tokens (top50 / movers / gainers / losers / memes)
 * - Loads config/tokenWhitelist.json (if present)
 * - Normalizes symbol bases (XBT->BTC, strips -USDTM/USDT/underscores)
 * - Prints CYCLE and REVERSAL sets and their counts
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const args = process.argv.slice(2);
const get = (k, def) => {
  const v = args.find(a => a.startsWith(`--${k}=`));
  return v ? v.split('=').slice(1).join('=').trim() : def;
};

const PORT = Number(get('port', process.env.PORT || 3000));
const BASE = `http://localhost:${PORT}`;

// majors + memes master lists
const MAJORS = new Set(['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC']);
const MEMES_DEFAULT = new Set(['SHIB','PEPE','TRUMP','FLOKI','BONK','WIF','AIDOGE','TSUKA','HARRY','WOJAK','GROK','BODEN','MAGA','MYRO','DOGE']);

function up(s=''){ return String(s).toUpperCase(); }
function baseOf(sym='') {
  let b = up(sym).replace(/[-_]/g,'').replace(/USDTM?$/,'').replace(/USDT$/,'');
  if (b === 'XBT') b = 'BTC';
  return b;
}
function uniq(arr){ return Array.from(new Set(arr.filter(Boolean))); }

function fetchJson(url){
  return new Promise((resolve,reject)=>{
    const req = http.get(url, res=>{
      let buf=''; res.setEncoding('utf8');
      res.on('data', c=>buf+=c);
      res.on('end', ()=>{
        try { resolve(JSON.parse(buf)); }
        catch(e){ reject(new Error(`Bad JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, ()=>{ req.destroy(new Error('timeout')); });
  });
}

function loadWhitelist() {
  const p = path.join(__dirname, '..', 'config', 'tokenWhitelist.json');
  try {
    const j = JSON.parse(fs.readFileSync(p,'utf8'));
    const list = Array.isArray(j?.whitelist) ? j.whitelist : Array.isArray(j) ? j : [];
    return new Set(list.map(baseOf));
  } catch {
    return new Set();
  }
}

(async function main(){
  try {
    const data = await fetchJson(`${BASE}/api/scan-tokens`);

    // accept several possible arrays; prefer top50 if present
    const pools = [];
    if (Array.isArray(data?.top50))   pools.push(...data.top50);
    if (!pools.length && Array.isArray(data?.movers))  pools.push(...data.movers);
    if (!pools.length && Array.isArray(data?.gainers)) pools.push(...data.gainers);
    if (!pools.length && Array.isArray(data?.losers))  pools.push(...data.losers);
    if (!pools.length) {
      console.log('No scan rows found.');
      return;
    }

    const scanBases = uniq(pools.map(r => baseOf(r?.symbol || r?.base || r?.bybitBase || '')));

    const wl = loadWhitelist();                       // whitelist from file
    const memes = new Set(
      (Array.isArray(data?.memes) ? data.memes.map(x=>baseOf(x?.base||x?.symbol||'')) : [])
      .filter(Boolean)
    );
    // if API has no memes array, fall back to our default list
    const memeSet = memes.size ? memes : MEMES_DEFAULT;

    // CYCLE = majors ∪ memes ∪ whitelist, intersected with scanBases
    const cycle = new Set();
    for (const b of scanBases) {
      if (MAJORS.has(b) || memeSet.has(b) || wl.has(b)) cycle.add(b);
    }
    // REVERSAL = scanBases \ cycle
    const reversal = scanBases.filter(b => !cycle.has(b));

    // Pretty print
    const P = (title, arr) => {
      console.log(`\n${title} (${arr.length})`);
      console.log(arr.sort().join(', ') || '∅');
    };

    console.log('=== Scanner Snapshot ===');
    console.log(`scanBases: ${scanBases.length}`);
    P('CYCLE = majors ∪ memes ∪ whitelist ∩ scan', Array.from(cycle));
    P('REVERSAL = scan \\ cycle', reversal);

  } catch (e) {
    console.error('Error:', e.message);
  }
})();