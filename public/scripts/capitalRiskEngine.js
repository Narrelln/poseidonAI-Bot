// capitalRiskEngine.js — Poseidon's Upgraded Capital Health System

let capitalState = {
  totalCapital: 100,           // Live total balance (updated via real PnL)
  capitalUsed: 0,              // Tracks deployed capital
  profitRecycled: 0,           // From previous wins
  consecutiveLosses: 0,
  consecutiveWins: 0,
  capitalScore: 100,
  preservationMode: false,
};

// === Log new trade (capital allocation) ===
export function recordTrade(amount, isProfitRecycled = false) {
  capitalState.capitalUsed += amount;
  if (isProfitRecycled) capitalState.profitRecycled += amount;
  updateCapitalScore();
}

// === Apply real trade outcome (linked to PnL) ===
export function applyTradeOutcome(pnlAmount = 0) {
  const isWin = pnlAmount > 0;

  // 🧠 Update capital balance
  capitalState.totalCapital += pnlAmount;
  capitalState.capitalUsed = Math.max(capitalState.capitalUsed - Math.abs(pnlAmount), 0);

  // 📉 Track performance streaks
  if (isWin) {
    capitalState.consecutiveWins++;
    capitalState.consecutiveLosses = 0;
  } else {
    capitalState.consecutiveLosses++;
    capitalState.consecutiveWins = 0;
  }

  updateCapitalScore();
}

// === Capital score calculator ===
export function updateCapitalScore() {
  let score = 100;

  const usedRatio = capitalState.capitalUsed / capitalState.totalCapital;
  if (capitalState.consecutiveLosses >= 2) score -= 30;
  if (capitalState.consecutiveWins >= 3) score += 10;
  if (usedRatio > 0.5) score -= 20;

  capitalState.capitalScore = Math.max(0, Math.min(100, score));
  capitalState.preservationMode = capitalState.capitalScore < 40;
}

// === Get status externally ===
export function getCapitalStatus() {
  return {
    score: capitalState.capitalScore,
    preservationMode: capitalState.preservationMode,
    availableCapital: capitalState.totalCapital - capitalState.capitalUsed,
    profitRecycled: capitalState.profitRecycled,
    totalCapital: capitalState.totalCapital.toFixed(2),
    capitalUsed: capitalState.capitalUsed.toFixed(2),
  };
}

// === Manual reset or session fresh start ===
export function resetCapitalTracker(startingBalance = 100) {
  capitalState = {
    totalCapital: startingBalance,
    capitalUsed: 0,
    profitRecycled: 0,
    consecutiveLosses: 0,
    consecutiveWins: 0,
    capitalScore: 100,
    preservationMode: false,
  };
}