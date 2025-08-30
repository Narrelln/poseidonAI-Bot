// autoTradeModule.js — Executes trades via backend using KuCoin (margin-first)

const BASE_URL = "http://localhost:3000";

// New: margin-first open
export async function openMarginTrade(symbol = "DOGEUSDT", side = "LONG", notionalUsd = 10, leverage = 5, tpPercent = null, slPercent = null) {
  try {
    const res = await fetch(`${BASE_URL}/api/place-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, side, notionalUsd, leverage, tpPercent, slPercent, manual: false })
    });
    const json = await res.json();
    console.log("✅ Open Margin Trade Response:", json);
    return json;
  } catch (err) {
    console.error("❌ Failed to open margin trade:", err);
    return null;
  }
}

// Legacy compatibility (still available if needed)
export async function openTrade(contract = "DOGEUSDT", side = "buy", size = 1, leverage = 5) {
  try {
    const res = await fetch(`${BASE_URL}/api/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract, side, size, leverage })
    });
    const json = await res.json();
    console.log("✅ Open Trade Response:", json);
    return json;
  } catch (err) {
    console.error("❌ Failed to open trade:", err);
    return null;
  }
}

export async function closeTrade(contract = "DOGEUSDT", side = "buy") {
  try {
    const res = await fetch(`${BASE_URL}/api/close-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract, side })
    });
    const json = await res.json();
    console.log("✅ Close Trade Response:", json);
    return json;
  } catch (err) {
    console.error("❌ Failed to close trade:", err);
    return null;
  }
}

// Optional: TP/SL
export async function setTPandSL(contract = "DOGEUSDT", takeProfit = 8, stopLoss = -5) {
  try {
    const res = await fetch(`${BASE_URL}/api/set-tp-sl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract, takeProfit, stopLoss })
    });
    const json = await res.json();
    console.log("✅ TP/SL Set Response:", json);
    return json;
  } catch (err) {
    console.error("❌ Failed to set TP/SL:", err);
    return null;
  }
}