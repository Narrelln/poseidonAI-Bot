// === handlers/futuresExecutionModule.js — Backend KuCoin-Compatible Trade Executor ===

const axios = require('axios');
const { updateCapitalScore } = require('./capitalRiskEngine');
const { logToFeed } = require('./futuresOps');
const {
  getOpenPositions,
  fetchTradableSymbols
} = require('./futuresApi'); // ✅ fetchFuturesPrice removed
const { triggerAutoShutdownWithCooldown } = require('./poseidonBotModule');

let validSymbols = [];
let symbolContractMap = {};

// Normalize "DOGEUSDT" → "DOGE-USDTM"
function toKucoinContract(symbol) {
  if (symbolContractMap[symbol]) return symbolContractMap[symbol];
  return symbol.replace("USDT", "-USDTM");
}

async function initFuturesExecutionModule() {
  console.log("⚙️ Backend Futures Execution Module Initialized");
  validSymbols = await fetchTradableSymbols();
  symbolContractMap = {};
  validSymbols.forEach(sym => {
    symbolContractMap[sym.symbol] = toKucoinContract(sym.symbol);
  });
}

// === Flip logic: close opposite first, then place new ===
async function placeAndFlip(symbol, side, size = 100, leverage = 5, isManual = false) {
  symbol = symbol.toUpperCase();
  const contract = toKucoinContract(symbol);
  const oppositeSide = side === 'buy' ? 'sell' : 'buy';

  try {
    const open = await getOpenPositions(symbol);
    const oppositePosition = open?.[oppositeSide.toUpperCase()];
    if (oppositePosition && parseFloat(oppositePosition?.size || 0) > 0) {
      logToFeed(`♻️ Closing ${oppositeSide.toUpperCase()} before flipping to ${side.toUpperCase()}`);
      await closeTrade(symbol, oppositeSide);
    }
  } catch (err) {
    console.warn(`⚠️ Could not check open positions before flip:`, err.message);
  }

  await executeTrade(symbol, side, size, isManual, leverage);
}

// === Main execution — for manual & auto trades ===
async function executeTrade(symbol, direction, size = 100, isManual = false, leverage = 5, tp = null, sl = null) {
  symbol = symbol.toUpperCase();
  direction = direction.toLowerCase();

  const isValid = validSymbols.find(s => s.symbol === symbol);
  if (!isValid) {
    logToFeed(`⚠️ Symbol ${symbol} is not tradable.`);
    return;
  }

  const contract = toKucoinContract(symbol);
  const tradeType = isManual ? 'Manual' : 'Auto';
  logToFeed(`🟢 ${tradeType} ${direction.toUpperCase()} ${symbol} @ ${size} USDT`);

  try {
    const response = await axios.post('http://localhost:3000/api/order', {
      contract,
      side: direction,
      size,
      leverage,
      tp,
      sl
    });

    const result = response.data;
    console.log("✅ Order Response:", result);

    if (result?.code === "200000" || result?.success) {
      logToFeed(`✅ Trade executed: ${symbol} (${direction.toUpperCase()})`);
      updateCapitalScore(1);
    } else if (result?.msg?.toLowerCase?.().includes("already open")) {
      logToFeed(`⚠️ Trade already open for ${symbol} (${direction})`);
    } else {
      throw new Error(result?.msg || result?.error || "Unknown error");
    }
  } catch (err) {
    console.error("❌ Trade failed", err);
    logToFeed(`❌ Trade failed: ${err.message}`);
    updateCapitalScore(-1);
    triggerAutoShutdownWithCooldown();
  }
}

// === Close trade (used during flips) ===
async function closeTrade(symbol, side = null) {
  symbol = symbol.toUpperCase();
  const contract = toKucoinContract(symbol);
  logToFeed(`🔴 Closing position for ${symbol}...`);

  try {
    const payload = { contract };
    if (side) payload.side = side.toLowerCase();

    const response = await axios.post('http://localhost:3000/api/close-trade', payload);
    const result = response.data;

    console.log("✅ Close Result:", result);
    if (result?.success || result?.status === "closed") {
      logToFeed(`🔻 Position closed: ${result.msg || 'Success'}`);
    } else {
      logToFeed(`⚠️ Close failed: ${result.error || "Unknown error"}`);
    }
  } catch (err) {
    console.error("❌ Close failed", err);
    logToFeed(`❌ Close failed: ${err.message}`);
  }
}

// === PPDA Entry (dual-side support) ===
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