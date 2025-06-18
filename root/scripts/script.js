console.log('Script loaded successfully');

// === Robot Sentiment Glow ===
function updateSentimentGlow(sentiment) {
  const robot = document.getElementById("poseidonBot");
  const glowColors = {
    bullish: "#00ff91",
    neutral: "#03dac5",
    bearish: "#ff4f4f"
  };
  if (robot && glowColors[sentiment]) {
    robot.style.filter = `drop-shadow(0 0 15px ${glowColors[sentiment]})`;
  }
}

// === Update System Stats ===
function updateStatsPanel() {
  document.getElementById("walletCount").innerText = "28";
  document.getElementById("signalCount").innerText = "12";
  document.getElementById("executionRate").innerText = "86";
}

// === Awareness Panel Content ===
function updateAwarenessPanel() {
  const strategy = document.getElementById("strategy-summary");
  const trade = document.getElementById("trade-summary");
  const triggers = document.getElementById("recent-triggers");

  if (strategy) strategy.innerText = "Observing smart wallet clusters. Adapting to Maestro dip signals.";
  if (trade) trade.innerText = "Latest trade: $WIFUSDT – SHORT at 0.1189 | Confidence: 74%";
  if (triggers) {
    triggers.innerHTML = `
      <ul>
        <li>🔔 Smart Trigger: 3 whales entered $BOLT at 10K MC</li>
        <li>🔥 Auto Buy: Entered $FURY at 17K after dip</li>
        <li>🚨 Exit Alert: Groovy sold $DOGEY at +43%</li>
      </ul>
    `;
  }
}

// === Initial Trigger ===
updateSentimentGlow("neutral");
updateStatsPanel();
updateAwarenessPanel();

// === Optional Live Cycle ===
setTimeout(() => updateSentimentGlow("bullish"), 3000);
setTimeout(() => updateSentimentGlow("bearish"), 6000);