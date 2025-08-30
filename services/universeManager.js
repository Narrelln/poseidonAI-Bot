// services/universeManager.js
/* Builds the symbol universe for Cycle/Predator
 * Modes: TOP50 (default), ALL, CUSTOM
 */
const axios = require('axios');
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

const MODE = String(process.env.PREDATOR_SCAN_MODE || 'TOP50').toUpperCase(); // TOP50 | ALL | CUSTOM
const MAX_TOKENS = Number(process.env.PREDATOR_MAX_TOKENS || 80);

function toContract(sym='') {
  let s = String(sym).toUpperCase().replace(/[-_]/g,'');
  if (!s.endsWith('USDTM')) s = s.replace(/USDT$/, '') + 'USDTM';
  return s.replace(/USDTM$/, '') + '-USDTM';
}

async function fromTop50() {
  try {
    const { data } = await axios.get(`${BASE}/api/scan-tokens`, { timeout: 8000 });
    const arr = Array.isArray(data?.top50) ? data.top50 : [];
    const out = [];
    for (const r of arr) {
      const base = String(r?.symbol || r?.base || '').toUpperCase().replace(/[-_]/g,'').replace(/USDTM?$/,'').replace(/USDT$/,'');
      if (!base) continue;
      out.push(toContract(base + 'USDT'));
      if (out.length >= MAX_TOKENS) break;
    }
    return out;
  } catch { return []; }
}

async function fromAll() {
  try {
    // if you have an endpoint that lists all futures contracts, call it here
    // fallback: reuse /api/scan-tokens top list if nothing else
    const top = await fromTop50();
    return top;
  } catch { return []; }
}

function fromCustom() {
  // comma-separated bases in env: e.g. "BTC,ETH,SOL,ADA,DOGE,LINK"
  const raw = String(process.env.PREDATOR_CUSTOM_LIST || '').trim();
  if (!raw) return [];
  return raw.split(',').map(x => x.trim()).filter(Boolean).map(b => toContract(b + 'USDT')).slice(0, MAX_TOKENS);
}

async function getUniverse() {
  if (MODE === 'ALL') return (await fromAll());
  if (MODE === 'CUSTOM') return fromCustom();
  return (await fromTop50());
}

module.exports = { getUniverse };