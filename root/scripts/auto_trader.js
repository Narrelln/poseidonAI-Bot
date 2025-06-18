console.log("Auto Trader Engine Active");

let tradeHistory = [];

function autoBuy(token, allocation, reason = "Smart Trigger") {
  const entry = {
    token,
    amount: allocation,
    reason,
    buyTime: Date.now(),
    status: 'open',
    entryPrice: getPrice(token),
    targetPrice: null,
    stopLoss: null
  };

  tradeHistory.push(entry);
  console.log(`✅ AUTO-BUY: ${token} | Alloc: ${allocation} SOL | Reason: ${reason}`);
}

function autoSell(token, reason = "TP/SL") {
  const trade = tradeHistory.find(t => t.token === token && t.status === 'open');
  if (!trade) return;

  trade.status = 'closed';
  trade.sellTime = Date.now();
  trade.exitPrice = getPrice(token);
  trade.reasonClosed = reason;

  console.log(`❌ AUTO-SELL: ${token} | Reason: ${reason}`);
}

function getPrice(token) {
  return Math.random() * 0.01 + 0.05;
}

function getOpenTrades() {
  return tradeHistory.filter(t => t.status === 'open');
}

function getTradeHistory() {
  return tradeHistory;
}

export {
  autoBuy,
  autoSell,
  getOpenTrades,
  getTradeHistory
 };