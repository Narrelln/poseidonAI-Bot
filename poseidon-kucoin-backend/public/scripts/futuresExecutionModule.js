// === futuresExecutionModule.js — KuCoin-Compatible Manual + Auto Execution

import { updateCapitalScore } from './capitalRiskEngine.js';
import { logToFeed } from './futuresUtils.js';
import { fetchTradableSymbols, mapSymbolToContract } from './futuresApi.js';
import { triggerAutoShutdownWithCooldown } from './poseidonBotModule.js';

let validSymbols = [];
let symbolContractMap = {};

// --- Helper: Map "DOGEUSDT" to "DOGE-USDTM"
function toKucoinContract(symbol) {
  if (symbolContractMap[symbol]) return symbolContractMap[symbol];
  // crude but works for most: DOGEUSDT => DOGE-USDTM
  return symbol.replace("USDT", "-USDTM");
}

export async function initFuturesExecutionModule() {
  console.log("⚙️ Futures Trade Execution Module Loaded");
  validSymbols = await fetchTradableSymbols();
  // Build a map for contract conversion
  symbolContractMap = {};
  validSymbols.forEach(sym => {
    symbolContractMap[sym] = toKucoinContract(sym);
  });
}

// === Main Trade Execution Handler ===
export async function executeTrade(symbol, direction, size = 100, isManual = false, leverage = 5, tp = null, sl = null) {
  symbol = symbol.toUpperCase();
  direction = direction.toLowerCase(); // "buy"/"sell" for KuCoin

  if (!validSymbols.includes(symbol)) {
    logToFeed(`⚠️ Symbol ${symbol} is not tradable.`);
    return;
  }

  const contract = toKucoinContract(symbol);
  const tradeType = isManual ? 'Manual' : 'Auto';
  const logMsg = `🟢 ${tradeType} ${direction.toUpperCase()} ${symbol} @ ${size} USDT ${tp ? `(TP: ${tp}%, SL: ${sl}%)` : ''}`;
  logToFeed(logMsg);

  try {
    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contract,          // KuCoin expects contract key!
        side: direction,   // must be "buy" or "sell"
        size,
        leverage,
        tp,
        sl
      })
    });

    const result = await response.json();
    console.log("✅ Order Response:", result);

    if (result?.code === "200000" || result?.success) {
      logToFeed(`✅ Trade executed: ${symbol} (${direction.toUpperCase()})`);
      updateCapitalScore(1);
    } else if (result?.msg && result.msg.toLowerCase().includes("already open")) {
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

// === Close Trade Handler ===
export async function closeTrade(symbol, side = null) {
  symbol = symbol.toUpperCase();
  const contract = toKucoinContract(symbol);
  logToFeed(`🔴 Closing position for ${symbol}...`);

  try {
    // Now always send both contract and side for KuCoin backend logic
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