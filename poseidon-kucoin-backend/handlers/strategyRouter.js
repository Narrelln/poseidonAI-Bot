/**
 * handlers/cycleWatcher.js
 * Polls TA + positions, runs cycleEngine, calls your existing open/close APIs.
 */
const axios = require('axios');
const CycleState = require('../models/CycleState');
const { decide } = require('../services/cycleEngine');
const { buildEntryReasons, buildExitReasons } = require('./strategyReasons'); // backend copy

const BASE = `http://localhost:${process.env.PORT || 3000}`;

async function getTA(spotSymbol) {
  const { data } = await axios.get(`${BASE}/api/ta/${spotSymbol}`);
  return data || {};
}
async function getPositions() {
  const { data } = await axios.get(`${BASE}/api/positions`);
  return data?.positions || [];
}
function toKey(s){return String(s||'').toUpperCase().replace(/-/g,'');}
function toSpot(contract){ return String(contract).replace('-USDTM','USDT'); }

async function tickOne(contract){
  // 1) pull state + data
  const st = await CycleState.findOne({ symbol: contract }).lean();
  const now = Date.now();
  const ta = await getTA(toSpot(contract));   // you already use this in other modules
  const positions = await getPositions();
  const live = positions.find(p => toKey(p.contract||p.symbol) === toKey(contract));

  // Normalize momentum/confidence from your TA payload
  const momentum = Number(ta.momentumScore ?? ta.momentum ?? 0); // expect 0..1
  const conf     = Number(ta.confidence ?? 0);
  const roi      = live ? Number(String(live.roi).replace('%','')) : null;

  const ctx = {
    phase: st?.phase || 'IDLE',
    now,
    impulseBeganAt: st?.impulseBeganAt ? new Date(st.impulseBeganAt).getTime() : null,
    momentum, conf,
    price: Number(ta.price || live?.markPrice || 0),
    roi,
    atl30: st?.atl30, ath30: st?.ath30,
  };

  const { action } = decide(ctx);

  // 2) act via your existing APIs
  if (action === 'ENTER_IMPULSE') {
    // Example: open 50 USDT notional at 5x, same side as TA trend
    const side = (ta.signal === 'bullish') ? 'BUY' : 'SELL';
    await axios.post(`${BASE}/api/place-trade`, { symbol: contract, side, leverage: 5, notionalUsd: 50, manual: false });
    await CycleState.updateOne({ symbol: contract }, { $set: { phase: 'IMPULSE', impulseBeganAt: new Date() }}, { upsert: true });
  }
  else if (action === 'EXIT_FOR_EXHAUST' && live) {
    await axios.post(`${BASE}/api/close-trade`, { contract });
    await CycleState.updateOne({ symbol: contract }, { $set: { phase: 'EXHAUST', lastExitAt: new Date() }}, { upsert: true });
  }
  else if (action === 'ENTER_REVERSAL') {
    const side = (ta.signal === 'bullish') ? 'BUY' : 'SELL';
    await axios.post(`${BASE}/api/place-trade`, { symbol: contract, side, leverage: 5, notionalUsd: 50, manual: false });
    await CycleState.updateOne({ symbol: contract }, { $set: { phase: 'REVERSAL' }}, { upsert: true });
  }
  else if (action === 'RESET') {
    await CycleState.updateOne({ symbol: contract }, { $set: { phase: 'IDLE', impulseBeganAt: null }}, { upsert: true });
  }
  // else HOLD / NONE → do nothing
}

function startCycleWatcher(contracts){
  if (globalThis.__POSEIDON_CYCLE_TIMER__) return;
  globalThis.__POSEIDON_CYCLE_TIMER__ = setInterval(() => {
    contracts.forEach(c => tickOne(c).catch(()=>{}));
  }, 5000);
  console.log('🚀 CycleWatcher started for', contracts.length, 'contracts');
}

module.exports = { startCycleWatcher };