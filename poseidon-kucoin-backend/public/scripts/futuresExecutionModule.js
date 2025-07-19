// === futuresExecutionModule.js — KuCoin-Compatible Manual + Auto Execution (with PPDA flip logic)

import { updateCapitalScore } from './capitalRiskEngine.js';
import { logToFeed } from './futuresUtils.js';
import { fetchTradableSymbols, getOpenPositions } from './futuresApi.js';
import { triggerAutoShutdownWithCooldown } from './poseidonBotModule.js';

let validSymbols = [];
let symbolContractMap = {};

// --- Normalize "DOGEUSDT" → "DOGE-USDTM"
function toKucoinContract(symbol) {
  if (symbolContractMap[symbol]) return symbolContractMap[symbol];
  return symbol.replace("USDT", "-USDTM");
}

export async function initFuturesExecutionModule() {
  console.log("⚙️ Futures Trade Execution Module Loaded");
  validSymbols = await fetchTradableSymbols();
  symbolContractMap = {};
  validSymbols.forEach(sym => {
    symbolContractMap[sym] = toKucoinContract(sym);
  });
}

// === Flip logic: close opposite first, then place new ===
export async function placeAndFlip(symbol, side, size = 100, leverage = 5, isManual = false) {
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
export async function executeTrade(symbol, direction, size = 100, isManual = false, leverage = 5, tp = null, sl = null) {
  symbol = symbol.toUpperCase();
  direction = direction.toLowerCase();

  if (!validSymbols.includes(symbol)) {
    logToFeed(`⚠️ Symbol ${symbol} is not tradable.`);
    return;
  }

  const contract = toKucoinContract(symbol);
  const tradeType = isManual ? 'Manual' : 'Auto';
  logToFeed(`🟢 ${tradeType} ${direction.toUpperCase()} ${symbol} @ ${size} USDT`);

  try {
    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract, side: direction, size, leverage, tp, sl })
    });

    const result = await response.json();
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

// === Close handler (used during flips) ===
export async function closeTrade(symbol, side = null) {
  symbol = symbol.toUpperCase();
  const contract = toKucoinContract(symbol);
  logToFeed(`🔴 Closing position for ${symbol}...`);

  try {
    const payload = { contract };
    if (side) payload.side = side.toLowerCase();
    const response = await fetch('/api/close-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
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
export async function ppdaExecute(symbol, side, usdtAmount = 5, leverage = 5) {
  await placeAndFlip(symbol, side, usdtAmount, leverage, false);
}