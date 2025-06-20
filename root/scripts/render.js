// ui-render.js – Handles all DOM rendering for Poseidon Dashboard

function addReactiveLog(message) {
    const feed = document.getElementById("log-feed");
    const entry = document.createElement("div");
    entry.classList.add("log-entry");
    entry.innerHTML = message;
    feed.appendChild(entry);
  }
  
  function addWalletActivity(message) {
    const feed = document.getElementById("wallet-activity-feed");
    const entry = document.createElement("div");
    entry.classList.add("log-entry");
    entry.textContent = message;
  
    const placeholder = feed.querySelector(".log-entry");
    if (placeholder && placeholder.textContent.includes("Awaiting wallet activity")) {
      feed.removeChild(placeholder);
    }
  
    const logs = feed.querySelectorAll(".log-entry");
    if (logs.length >= 5) {
      feed.removeChild(logs[0]);
    }
  
    feed.appendChild(entry);
    if (typeof triggerLearningFromWallet === 'function') {
      triggerLearningFromWallet(message);
    }
  }
  
  function addLiveTradeEvent(message) {
    const monitor = document.getElementById("live-trade-monitor");
    const entry = document.createElement("div");
    entry.classList.add("log-entry");
    entry.textContent = message;
  
    const logs = monitor.querySelectorAll(".log-entry");
    if (logs.length >= 5) {
      monitor.removeChild(logs[0]);
    }
    monitor.appendChild(entry);
  }
  
  function updateTradeMonitor({ token, action, confidence, volume }) {
    const monitor = document.getElementById("live-trade-monitor");
    const existing = monitor.querySelector(`.log-entry[data-token="${token}"]`);
  
    const text = `📊 ${token} — ${action} | Confidence: ${confidence}% | Vol: ${volume}`;
  
    if (existing) {
      existing.textContent = text;
    } else {
      const div = document.createElement("div");
      div.className = "log-entry";
      div.setAttribute("data-token", token);
      div.textContent = text;
      monitor.prepend(div);
    }
  }
  
  function updateCapitalAllocator(token = "$WIF", wallets = 3, bonding = 24, volume = 6200) {
    const decisionBox = document.getElementById("allocation-decision");
    const reasonBox = document.getElementById("allocation-reason");
  
    const confidence = (wallets / 5 * 0.4) + ((100 - bonding) / 100 * 0.3) + (volume / 10000 * 0.3);
    const alloc = (0.1 + 0.9 * confidence).toFixed(2);
  
    if (decisionBox && reasonBox) {
      decisionBox.textContent = `${alloc} SOL allocated to ${token}`;
      reasonBox.textContent = `Confidence: ${(confidence * 100).toFixed(1)}% — ${wallets} wallets, bonding ${bonding}%, volume ${volume}`;
    }
  }
  
  function updateWalletInsights() {
    const insights = document.getElementById("wallet-insights");
    const walletProfiles = [
      { name: "Groovy", winRate: "78%", lastTokens: ["$ZOOM", "$FURY", "$DOGEY"], role: "Sniper" },
      { name: "Princess Dev", winRate: "61%", lastTokens: ["$BLAST", "$GLXY", "$RAID"], role: "Influencer" },
      { name: "Assassin", winRate: "84%", lastTokens: ["$JUMP", "$WOLF", "$MOON"], role: "Convergence Trigger" }
    ];
  
    insights.innerHTML = `
      <h2>🧠 Wallet Insights</h2>
      ${walletProfiles.map(wallet => `
        <div class="log-entry">
          <strong>${wallet.name}</strong> — ${wallet.role}<br>
          Win Rate: ${wallet.winRate}<br>
          Recent Tokens: ${wallet.lastTokens.join(", ")}
        </div>
      `).join("")}
    `;
  }
  
  function analyzePatterns() {
    const output = document.getElementById("pattern-output");
    if (!output || learningMemory.length === 0) return;
  
    const wins = learningMemory.filter(e => e.outcome && e.outcome.includes("+"));
    if (wins.length === 0) {
      output.innerHTML = "No successful trades yet to analyze.";
      return;
    }
  
    const avgBonding = Math.round(wins.reduce((sum, e) => sum + e.bonding, 0) / wins.length);
    const avgVolume = Math.round(wins.reduce((sum, e) => sum + e.volume, 0) / wins.length);
    const avgMC = Math.round(wins.reduce((sum, e) => sum + e.marketCap, 0) / wins.length);
  
    const walletCounts = {};
    wins.forEach(e => {
      walletCounts[e.wallet] = (walletCounts[e.wallet] || 0) + 1;
    });
  
    const topWallet = Object.entries(walletCounts).sort((a, b) => b[1] - a[1])[0][0];
    const winRate = Math.round((wins.length / learningMemory.length) * 100);
  
    output.innerHTML = `
      <div class="log-entry">
        <strong>📊 Win Rate:</strong> ${winRate}% (${wins.length}/${learningMemory.length})<br>
        <strong>🧩 Avg Bonding:</strong> ${avgBonding}%<br>
        <strong>📈 Avg Volume:</strong> ${avgVolume}<br>
        <strong>💰 Avg MC:</strong> ${avgMC}<br>
        <strong>🔍 Most Frequent Wallet:</strong> ${topWallet}
      </div>
    `;
  }
  
  function analyzeBollingerVolumePatterns() {
    const output = document.getElementById("pattern-output");
    if (!output || learningMemory.length < 10) return;
  
    const recent = learningMemory.slice(-10);
    const prices = recent.map(e => e.marketCap);
  
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / prices.length);
    const upper = avg + (2 * stdDev);
    const lower = avg - (2 * stdDev);
  
    const latest = prices[prices.length - 1];
    let signal = "Neutral zone";
    if (latest > upper) signal = "📈 Above upper Bollinger Band — Possible breakout";
    else if (latest < lower) signal = "📉 Below lower Bollinger Band — Possible reversal zone";
  
    output.innerHTML += `
      <div class="log-entry">
        <strong>📊 Bollinger Band Insight</strong><br>
        Avg: ${avg.toFixed(1)} | Upper: ${upper.toFixed(1)} | Lower: ${lower.toFixed(1)}<br>
        Latest MC: ${latest.toFixed(1)} — ${signal}
      </div>
    `;
    setInterval(analyzeBollingerVolumePatterns, 30000);
  }
  
  function checkSignalTrigger(entry) {
    const { wallet, bonding, volume, marketCap } = entry;
    const signalBox = document.getElementById("auto-signal-log");
  
    const recent = learningMemory.filter(e => e.wallet === wallet);
    const wins = recent.filter(e => e.outcome && e.outcome.includes("+")).length;
    const total = recent.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
  
    const goodWallet = total >= 3 && winRate >= 60;
    const lowBonding = bonding < 30;
    const goodVolume = volume > 6000;
    const lowMC = marketCap < 75000;
  
    if (goodWallet && lowBonding && goodVolume && lowMC) {
      signalBox.innerHTML = `🔔 <strong>BUY SIGNAL</strong>: ${wallet} — ${winRate.toFixed(1)}% WR, Bonding ${bonding}%, Vol ${volume}, MC ${marketCap}`;
      signalBox.classList.add("flash-alert");
    }
  }
  
  function renderLearningMemory() {
    const container = document.getElementById("learning-log-feed");
    if (!container) return;
  
    const logs = learningMemory.slice(-5).reverse();
    if (logs.length === 0) {
      container.innerHTML = "No memory logs yet.";
      return;
    }
  
    container.innerHTML = logs.map(log => `
      <div class="log-entry">
        <strong>${log.token}</strong> — ${log.wallet}<br>
        Bonding: ${log.bonding}% | Volume: ${log.volume} | MC: ${log.marketCap}<br>
        ${log.outcome ? `✅ Outcome: ${log.outcome}` : `<span style="color:#888;">Outcome pending...</span>`}
      </div>
    `).join("");
  }
  
  function renderFuturesMemory() {
    const panel = document.getElementById("futures-signal-log");
    if (!panel) return;
    panel.innerHTML = futuresMemory.slice(-5).reverse().map(f => `
      <div class="log-entry">
        <strong>${f.symbol}</strong> — ${f.confidence * 100}%<br>
        MACD: ${f.macd}, BB: ${f.bbSignal}, Volume Spike: ${f.volumeChange.toFixed(2)}x<br>
        ${f.result ? `Result: ${f.result}` : `<span style="color:gray;">Pending</span>}
      </div>
    `).join("");
  }
  
  function renderSniperIndex() {
    const topWallets = [
      { name: "Groovy", lastToken: "$ZOOM", style: "Aggressive", outcome: "+300%", status: "Holding" },
      { name: "Cupsey", lastToken: "$DOGEY", style: "Exit", outcome: "+45%", status: "Exited" },
      { name: "Smart5", lastToken: "$JUMP", style: "Trigger", outcome: "+21%", status: "Active" }
    ];
  
    const feed = document.getElementById("sniper-index-feed");
    if (!feed) return;
    feed.innerHTML = topWallets.map(w => `
      <div class="log-entry">
        <strong>${w.name}</strong> – ${w.lastToken}<br>
        Style: ${w.style}<br>
        Outcome: ${w.outcome}<br>
        Status: ${w.status}
      </div>
    `).join("");
  }
  
  function renderROIMemory() {
      const memory = JSON.parse(localStorage.getItem('poseidonMemory')) || {};
      const container = document.getElementById('roi-memory-panel');
      if (!container) return;
  
      container.innerHTML = '';
      for (const token in memory) {
          const entry = memory[token];
          container.innerHTML += `<div class="roi-entry">Token: ${token} | Outcome: ${entry.outcome} | ROI: ${entry.roi}%</div>`;
      }
  }
  
  function triggerVisualUpdate(elementId, data) {
      const el = document.getElementById(elementId);
      if(el) el.innerText = data;
  }
  
  function updateFuturesPanel(data) {
      triggerVisualUpdate('futures-market-cap', `$${data.marketCap}`);
      triggerVisualUpdate('futures-volume', data.volume);
      triggerVisualUpdate('futures-trend', data.trend);
  }
  
  // Export for browser global
  window.addReactiveLog = addReactiveLog;
  window.addWalletActivity = addWalletActivity;
  window.addLiveTradeEvent = addLiveTradeEvent;
  window.updateTradeMonitor = updateTradeMonitor;
  window.updateCapitalAllocator = updateCapitalAllocator;
  window.updateWalletInsights = updateWalletInsights;
  window.analyzePatterns = analyzePatterns;
  window.analyzeBollingerVolumePatterns = analyzeBollingerVolumePatterns;
  window.checkSignalTrigger = checkSignalTrigger;
  window.renderLearningMemory = renderLearningMemory;
  window.renderFuturesMemory = renderFuturesMemory;
  window.renderSniperIndex = renderSniperIndex;
  window.renderROIMemory = renderROIMemory;
  window.triggerVisualUpdate = triggerVisualUpdate;
  window.updateFuturesPanel = updateFuturesPanel;
  