// --- DCA Parameters ---
const DCA_TRIGGER_PCT = -8; // DCA when position is down 8%+
const DCA_STEP_MAX = 2;     // Max 2 DCAs per position
const DCA_STEP_SIZE = 0.5;  // Each DCA = 50% of original size

const dcaMemory = {}; // { [symbol]: { dcaCount, lowestEntry, lastDCAprice } }

// Check if a position needs DCA
export async function checkAndDCA(position) {
  const { symbol, side, entry, pnl, size, leverage } = position;

  // Track per-symbol DCA count
  if (!dcaMemory[symbol]) dcaMemory[symbol] = { dcaCount: 0, lowestEntry: entry, lastDCAprice: entry };

  // Calculate drawdown percent
  const drawdown = (pnl / (entry * size)) * 100 * leverage;

  // Only trigger if DCA steps left and drawdown exceeds trigger
  if (
    drawdown <= DCA_TRIGGER_PCT &&
    dcaMemory[symbol].dcaCount < DCA_STEP_MAX
  ) {
    // Check margin and liquidation risk here before DCA (pseudo):
    // if (!isSafeToDCA()) return;

    // Place DCA order (smaller size)
    const dcaSize = size * DCA_STEP_SIZE;
    await placeFuturesOrder({
      contract: symbol,
      side, // Same direction
      size: dcaSize,
      leverage,
      reason: 'DCA Recovery'
    });

    dcaMemory[symbol].dcaCount += 1;
    dcaMemory[symbol].lastDCAprice = position.currentPrice;
    if (position.currentPrice < dcaMemory[symbol].lowestEntry)
      dcaMemory[symbol].lowestEntry = position.currentPrice;

    console.log(`🟢 DCA placed for ${symbol}. DCA count: ${dcaMemory[symbol].dcaCount}`);
  }
}

// After DCA, check if price rebounds from lowest DCA entry
export function checkDCARecovery(position) {
  const { symbol, currentPrice } = position;
  const mem = dcaMemory[symbol];
  if (!mem || mem.dcaCount === 0) return false;

  // If price recovers 10% from lowest entry, exit all
  const recoveryThreshold = mem.lowestEntry * 1.10;
  if (currentPrice >= recoveryThreshold) {
    // Call your close position logic here!
    closeFuturesPosition(symbol, position.side);
    console.log(`✅ Exited ${symbol} after DCA recovery!`);
    // Reset DCA memory for symbol
    dcaMemory[symbol] = { dcaCount: 0, lowestEntry: currentPrice, lastDCAprice: currentPrice };
    return true;
  }
  return false;
}