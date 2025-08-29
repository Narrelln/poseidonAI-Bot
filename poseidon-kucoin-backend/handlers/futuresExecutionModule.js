// === handlers/futuresExecutionModule.js — Backend KuCoin-Compatible Trade Executor (patched) ===

const axios = require('axios');
const { updateCapitalScore } = require('./capitalRiskEngine');
const { logToFeed } = require('./futuresOps');
const { getOpenPositions, fetchTradableSymbols } = require('../utils/walletHelper'); // ✅ removed toKuCoinContractSymbol here
const { triggerAutoShutdownWithCooldown } = require('./poseidonBotModule');
const { parseToKucoinContractSymbol } = require('../kucoinHelper'); // ✅ canonical normalization

// ---- tradables cache -------------------------------------------------------
let validSymbols = [];          // raw rows from fetchTradableSymbols()
let validBases = new Set();     // e.g., "BTC", "ETH"
let validContracts = new Set(); // e.g., "BTC-USDTM"
let symbolContractMap = Object.create(null);

// base = "BTC" from "BTC", "BTCUSDT", "BTC-USDTM", etc.
function normBase(s = '') {
  return String(s).toUpperCase().replace(/[-_]/g, '').replace(/USDTM?$/, '');
}

function toKucoinContract(symbol) {
  if (symbolContractMap[symbol]) return symbolContractMap[symbol];
  return parseToKucoinContractSymbol(symbol); // e.g., "BTCUSDT" -> "BTC-USDTM"
}

async function initFuturesExecutionModule() {
  console.log('⚙️ Backend Futures Execution Module Initialized');

  try {
    validSymbols = await fetchTradableSymbols(); // expect rows with .symbol
  } catch (e) {
    console.warn('⚠️ fetchTradableSymbols failed:', e.message);
    validSymbols = [];
  }

  validBases.clear();
  validContracts.clear();
  symbolContractMap = Object.create(null);

  for (const row of validSymbols) {
    const raw = String(row.symbol || '').toUpperCase();
    if (!raw) continue;

    // derive both keys
    const base = normBase(raw);
    const contract = parseToKucoinContractSymbol(raw);

    validBases.add(base);
    validContracts.add(contract);

    // also map raw → contract so callers can pass scanner symbols
    symbolContractMap[raw] = contract;
    symbolContractMap[base] = contract;
  }
}

// ---- helpers ---------------------------------------------------------------

function normalizeDirection(dir = '') {
  const s = String(dir).toLowerCase();
  return s === 'buy' || s === 'long' ? 'buy' : 'sell';
}

// Find if an opposite position exists on the same contract/side
function findOppositeOpen(positions = [], contract, side /* 'buy' | 'sell' */) {
  const opp = side === 'buy' ? 'sell' : 'buy';
  return positions.find(p => {
    const pContract = String(p.contract || p.symbol || '').toUpperCase();
    const pSide = String(p.side || '').toLowerCase(); // many backends expose "buy"/"sell"
    const pSize = Number(p.size || p.quantity || 0);
    return pContract === contract.toUpperCase() && pSide === opp && pSize > 0;
  });
}

// ---- main ops --------------------------------------------------------------

// Flip logic: close opposite first, then place new
async function placeAndFlip(symbol, side, notionalUsd = 10, leverage = 5, isManual = false) {
  const raw = String(symbol).toUpperCase();
  const contract = toKucoinContract(raw);
  const base = normBase(raw);
  const dir = normalizeDirection(side);

  // tradable validation (accept either base or contract)
  if (!validBases.has(base) && !validContracts.has(contract)) {
    logToFeed(`⚠️ ${raw} not in tradable set (base ${base}, contract ${contract})`);
    return;
  }

  try {
    const positions = await getOpenPositions(); // expect array of { contract, side, size, ... }
    const opposite = findOppositeOpen(positions, contract, dir);
    if (opposite) {
      logToFeed(`♻️ Closing ${opposite.side.toUpperCase()} before flipping to ${dir.toUpperCase()} on ${contract}`);
      await closeTrade(raw, opposite.side); // pass the actual side we’re closing
    }
  } catch (err) {
    console.warn('⚠️ Could not inspect positions before flip:', err.message);
  }

  await executeTrade(raw, dir, notionalUsd, isManual, leverage);
}

// Main execution — for manual & auto trades (MARGIN-FIRST)
// direction = 'buy' | 'sell'
async function executeTrade(symbol, direction, notionalUsd = 10, isManual = false, leverage = 5, tp = null, sl = null) {
  const raw = String(symbol).toUpperCase();
  const dir = normalizeDirection(direction);

  const contract = toKucoinContract(raw);
  const base = normBase(raw);

  // tradable validation
  if (!validBases.has(base) && !validContracts.has(contract)) {
    logToFeed(`⚠️ Symbol ${raw} is not tradable (base ${base}, contract ${contract}).`);
    return;
  }

  const tradeType = isManual ? 'Manual' : 'Auto';
  logToFeed(`🟢 ${tradeType} ${dir.toUpperCase()} ${contract} @ margin ${notionalUsd} USDT (lev ${leverage})`);

  try {
    // ✅ Use margin-first backend route (expects LONG/SHORT)
    const placeSide = dir === 'buy' ? 'LONG' : 'SHORT';

    const response = await axios.post('http://localhost:3000/api/place-trade', {
      symbol: contract,                 // send normalized contract
      side: placeSide,                  // LONG/SHORT
      notionalUsd,
      leverage,
      tpPercent: tp,
      slPercent: sl,
      manual: isManual
    });

    const result = response.data;
    if (result?.success || result?.code === '200000' || result?.code === 'SUCCESS') {
      logToFeed(`✅ Trade executed: ${contract} (${placeSide})`);
      updateCapitalScore(1);
    } else if ((result?.msg || '').toLowerCase().includes('already open') || result?.code === 'DUPLICATE') {
      logToFeed(`🔒 Trade already open for ${contract} (${placeSide})`);
    } else {
      throw new Error(result?.msg || result?.error || 'Unknown error');
    }
  } catch (err) {
    console.error('❌ Trade failed', err?.response?.data || err.message);
    logToFeed(`❌ Trade failed: ${err?.response?.data?.msg || err.message}`);
    updateCapitalScore(-1);
    triggerAutoShutdownWithCooldown();
  }
}

// Close trade (optionally only one side)
async function closeTrade(symbol, side = null) {
  const raw = String(symbol).toUpperCase();
  const contract = toKucoinContract(raw);

  const closeMsg = side ? `Closing ${String(side).toUpperCase()} side for ${contract}…` : `Closing position for ${contract}…`;
  logToFeed(`🔴 ${closeMsg}`);

  try {
    const payload = { contract };
    if (side) {
      // backend tolerance: accept BUY/SELL or buy/sell
      const s = normalizeDirection(side) === 'buy' ? 'BUY' : 'SELL';
      payload.side = s;
    }

    const response = await axios.post('http://localhost:3000/api/close-trade', payload);
    const result = response.data;

    if (result?.success || result?.status === 'closed') {
      logToFeed(`🔻 Position closed: ${result.msg || 'Success'}`);
    } else {
      logToFeed(`⚠️ Close failed: ${result?.error || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('❌ Close failed', err?.response?.data || err.message);
    logToFeed(`❌ Close failed: ${err?.response?.data?.msg || err.message}`);
  }
}

// PPDA Entry (dual-side support)
async function ppdaExecute(symbol, side, usdtAmount = 5, leverage = 5) {
  await placeAndFlip(symbol, side, usdtAmount, leverage, false);
}

module.exports = {
  initFuturesExecutionModule,
  placeAndFlip,
  executeTrade,
  closeTrade,
  ppdaExecute
};