// handlers/learningMemorySeeder.js
/* eslint-disable no-console */
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

function baseOf(sym = '') {
  return String(sym).toUpperCase().replace(/[-_]/g, '').replace(/USDTM?$/, '').replace(/USDT$/, '');
}
// TA prefers BTC over XBT for "spot"
function toSpot(sym) {
  let b = baseOf(sym);
  if (!b) return '';
  if (b === 'XBT') b = 'BTC';
  return `${b}USDT`;
}
function toContract(sym) {
  const b = baseOf(sym);
  return b ? `${b}-USDTM` : '';
}

async function fetchTop50() {
  try {
    const { data } = await axios.get(`${BASE}/api/scan-tokens`, { timeout: 8000 });
    const rows = Array.isArray(data?.top50) ? data.top50 : [];
    const set = new Set();
    for (const r of rows) {
      // accept symbol or base; store as contract for clarity
      const c = toContract(r?.symbol || r?.base || r);
      if (c) set.add(c);
    }
    return [...set];
  } catch (e) {
    console.warn('[Seeder] failed to fetch /api/scan-tokens:', e?.message || e);
    return [];
  }
}

async function fetchTA(spot) {
  try {
    const { data } = await axios.get(`${BASE}/api/ta/${spot}`, { timeout: 6000 });
    return data || {};
  } catch {
    return {};
  }
}

async function writeTick(spot, price) {
  if (!(Number(price) > 0)) return false;
  try {
    await axios.post(`${BASE}/api/learning-memory/tick`, { symbol: spot, price: Number(price) }, { timeout: 4000 });
    return true;
  } catch (e) {
    console.warn('[Seeder] tick write failed for', spot, e?.message || e);
    return false;
  }
}

// ---- service state
let TIMER = null;
let WATCH = [];
let LAST_CYCLE_AT = 0;
let LAST_WRITES = 0;

async function seedOnce() {
  const contracts = await fetchTop50();
  WATCH = contracts;
  let writes = 0;

  // Pull TA and write a single tick for each symbol we have price for
  await Promise.all(contracts.map(async (contract) => {
    const spot = toSpot(contract);
    if (!spot) return;
    const ta = await fetchTA(spot);
    const price = Number(ta?.price ?? ta?.markPrice ?? 0);
    if (await writeTick(spot, price)) writes += 1;
  }));

  LAST_WRITES = writes;
  LAST_CYCLE_AT = Date.now();
  console.log(`[Seeder] one-shot: ${writes}/${contracts.length} ticks written`);
  return { total: contracts.length, writes };
}

async function runCycle() {
  // periodic: refresh list (frozen top50) then write one tick each
  await seedOnce();
}

function start({ intervalMs = 5000 } = {}) {
  if (TIMER) return getStatus();
  TIMER = setInterval(() => { runCycle().catch(()=>{}); }, Math.max(2000, intervalMs));
  console.log(`[Seeder] started @ ${Math.max(2000, intervalMs)}ms`);
  // kick immediately
  runCycle().catch(()=>{});
  return getStatus();
}

function stop() {
  if (TIMER) clearInterval(TIMER);
  TIMER = null;
  console.log('[Seeder] stopped');
  return getStatus();
}

function getStatus() {
  return {
    running: !!TIMER,
    watching: Array.isArray(WATCH) ? WATCH.length : 0,
    lastCycleAt: LAST_CYCLE_AT,
    lastWrites: LAST_WRITES
  };
}

module.exports = {
  startLearningMemorySeeder: start,
  stopLearningMemorySeeder: stop,
  seedLearningMemoryOnce: seedOnce,
  getLearningMemorySeederStatus: getStatus,
};