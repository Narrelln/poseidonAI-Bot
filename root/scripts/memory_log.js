console.log("Memory Log Initialized");

const memory = {
  trades: [],
  triggers: [],
  patterns: [],
};

function logTrade({ token, reason, entryPrice, entryTime, amount }) {
  memory.trades.push({
    token,
    reason,
    entryPrice,
    entryTime,
    amount,
    exitPrice: null,
    exitTime: null,
    result: null,
    details: {},
  });

  console.log(`📝 Trade logged: ${token} | Reason: ${reason}`);
}

function updateTradeExit(token, exitPrice, exitTime, reasonClosed = "TP/SL") {
  const trade = memory.trades.find(t => t.token === token && !t.exitPrice);
  if (!trade) return;

  trade.exitPrice = exitPrice;
  trade.exitTime = exitTime;
  trade.result = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  trade.details.reasonClosed = reasonClosed;

  console.log(`📤 Trade closed: ${token} | ROI: ${trade.result.toFixed(2)}%`);
}

function logTrigger({ type, token, time, context }) {
  memory.triggers.push({
    type,
    token,
    time,
    context,
  });

  console.log(`⚡ Trigger recorded: ${type} on ${token}`);
}

function getAllTrades() {
  return memory.trades;
}

function getTriggersByToken(token) {
  return memory.triggers.filter(t => t.token === token);
}

function clearMemory() {
  memory.trades = [];
  memory.triggers = [];
  memory.patterns = [];
}

export {
  logTrade,
  updateTradeExit,
  logTrigger,
  getAllTrades,
  getTriggersByToken,
  clearMemory
 };