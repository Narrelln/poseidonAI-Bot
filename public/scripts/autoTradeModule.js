// autoTradeModule.js — Executes trades via backend using KuCoin

const BASE_URL = "http://localhost:3000";

// Open Trade (LONG or SHORT)
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

// Close Trade (specify contract and side to close)
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

// (Optional) Set TP/SL — If you have a backend endpoint for this, implement here.
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