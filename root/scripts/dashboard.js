console.log('dashboard.js loaded');

const walletActivityLog = []; // ✅ Declare first

function simulateSmartActivity(logs) {
  logs.forEach(entry => {
    console.log(`💡 Simulating smart wallet: ${entry.wallet} → ${entry.token}`);
    addWalletActivity(`${entry.wallet} bought ${entry.token}`);
    walletActivityLog.push({ wallet: entry.wallet, token: entry.token, timestamp: Date.now() });
  });

  detectWalletConvergence(walletActivityLog); // ✅ Call after pushing logs
}
function allocateCapital({ winRate, bonding, volume }) {
  const confidence = 0.5 * (winRate / 100) + 0.25 * ((100 - bonding) / 100) + 0.25 * (volume / 10000);
  const amount = confidence >= 0.9 ? 1 : confidence >= 0.75 ? 0.6 : confidence >= 0.5 ? 0.3 : 0.1;

  return {
    confidence: +(confidence * 100).toFixed(1),
    amount,
    message: `Confidence Score: ${(confidence * 100).toFixed(1)}%`
  };
}
function autoTradeEngine({ token, entry, priceNow, smartExit }) {
  const gain = ((priceNow - entry) / entry) * 100;

  if (gain >= 35 || smartExit) {
    console.log(`🟢 Auto-Sell Triggered at +${gain.toFixed(1)}% for ${token}`);
  } else {
    console.log(`⚪ Hold Position for ${token} — Gain: ${gain.toFixed(1)}%`);
  }
  return {
    status: 'executed',
    token: token.name,
    confidence,
    amount,
    priceNow,
  };
}
  
  function simulateLiveTradeMonitor() {
    const events = [
      "$BOLT — 6 smart wallets entered in 30s (+64% volume)",
      "$DOGEY — dev exited at 122K MC (alert)",
      "$FURY — bonded at 18%, snipers converging",
      "$RAID — dropped below support, exits increasing"
    ];
    events.forEach((event, i) => setTimeout(() => addLiveTradeEvent(event), i * 2000));
  }
// === Global Stats Update ===
document.getElementById("wallets").textContent = "1,234";
document.getElementById("sentiment").textContent = "Bullish";
document.getElementById("trades").textContent = "3 Open";
document.getElementById("pnl").textContent = "+5.2 SOL";

const el = document.getElementById("sniper-index-feed");
if (el) {
  el.innerHTML = "<p>No snipers loaded yet.</p>";
}

// === Learning Kernel Memory ===
const learningMemory = [];

function logLearningEvent({ token, bonding, volume, wallet, marketCap }) {
  const timestamp = new Date().toISOString();
  
  learningMemory.push({
    token,
    bonding,
    volume,
    wallet,
    marketCap,
    time: timestamp,
    outcome: null
  });

  console.log("📘 Learning Kernel Logged:", token);
  saveMemoryToStorage();
  renderLearningMemory();
}

function simulateOutcomeEvaluation(token, result = "+42%") {
  const match = learningMemory.find(e => e.token === token && !e.outcome);
  if (match) match.outcome = result;
}

function triggerLearningFromWallet(message) {
  const tokenMatch = message.match(/\$(\w+)/);
  const walletName = message.includes("Groovy") ? "Groovy"
                   : message.includes("Cupsey") ? "Cupsey"
                   : message.includes("Assassin") ? "Assassin"
                   : "Unknown";

  if (tokenMatch) {
    const token = `$${tokenMatch[1]}`;
    const bonding = Math.floor(Math.random() * 40);
    const volume = 4000 + Math.floor(Math.random() * 8000);
    const marketCap = 55000 + Math.floor(Math.random() * 30000);

    const entry = { token, bonding, volume, wallet: walletName, marketCap };

    logLearningEvent(entry);
    checkSignalTrigger(entry);
    setTimeout(() => simulateOutcomeEvaluation(token), 180000); // auto evaluate after 3 mins
  }
}

// === Core UI Functions ===
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
  triggerLearningFromWallet(message);
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

// === Wallet Insights Panel ===
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

// === Pattern Analyzer ===
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

// === Smart Signal Trigger ===
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

// === Learning Renderer ===
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

// === Local Storage Integration ===
function saveMemoryToStorage() {
  localStorage.setItem("poseidon_memory", JSON.stringify(learningMemory));
}

function loadMemoryFromStorage() {
  const saved = localStorage.getItem("poseidon_memory");
  if (saved) {
    const parsed = JSON.parse(saved);
    parsed.forEach(entry => learningMemory.push(entry));
    console.log("🧠 Loaded Poseidon's memory from localStorage");
  } else {
    console.log("🧠 No prior memory found");
  }
}


// === Futures Intelligence System ===
const futuresMemory = [];

function logFuturesTrade({ symbol, macd, bbSignal, volumeChange, confidence, result = null }) {
  const entry = {
    time: new Date().toISOString(),
    symbol, macd, bbSignal, volumeChange, confidence, result
  };
  futuresMemory.push(entry);
  console.log("📊 Logged Futures Trade:", entry);
  renderFuturesMemory();
}

function evaluateFuturesOpportunity(symbol, priceHistory) {
  const macd = calculateMACD(priceHistory);
  const bb = calculateBollingerSignal(priceHistory);
  const volumeChange = detectVolumeSpike(priceHistory);
  const confidence = (macd.signal === "bullish" ? 0.4 : 0)
                   + (bb === "breakout" ? 0.3 : 0)
                   + (volumeChange > 1.2 ? 0.3 : 0);
  const score = (confidence * 100).toFixed(1);
  console.log(`🤖 Futures Signal: ${symbol} — Confidence: ${score}%`);
  logFuturesTrade({ symbol, macd: macd.signal, bbSignal: bb, volumeChange, confidence });
}

function renderFuturesMemory() {
  const panel = document.getElementById("futures-signal-log");
  if (!panel) return;
  panel.innerHTML = futuresMemory.slice(-5).reverse().map(f => `
    <div class="log-entry">
      <strong>${f.symbol}</strong> — ${f.confidence * 100}%<br>
      MACD: ${f.macd}, BB: ${f.bbSignal}, Volume Spike: ${f.volumeChange.toFixed(2)}x<br>
      ${f.result ? `Result: ${f.result}` : `<span style="color:gray;">Pending</span>`}
    </div>
  `).join("");
}

function calculateMACD(data) {
  if (data.length < 26) return { signal: "neutral" };
  const shortEMA = ema(data, 12);
  const longEMA = ema(data, 26);
  const macd = shortEMA[shortEMA.length - 1] - longEMA[longEMA.length - 1];
  const signal = macd > 0 ? "bullish" : macd < 0 ? "bearish" : "neutral";
  return { signal, value: macd.toFixed(2) };
}

function calculateBollingerSignal(data) {
  if (data.length < 20) return "neutral";
  const avg = data.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const stdDev = Math.sqrt(data.slice(-20).reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / 20);
  const latest = data[data.length - 1];
  if (latest > avg + 2 * stdDev) return "breakout";
  if (latest < avg - 2 * stdDev) return "breakdown";
  return "neutral";
}

function detectVolumeSpike(volumes) {
  if (volumes.length < 10) return 1;
  const recentAvg = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const latest = volumes[volumes.length - 1];
  return latest / recentAvg;
}

function ema(data, period) {
  const k = 2 / (period + 1);
  const emaArray = [data[0]];
  for (let i = 1; i < data.length; i++) {
    emaArray.push(data[i] * k + emaArray[i - 1] * (1 - k));
  }
  return emaArray;
}


// === External APIs ===
const HELIUS_API_KEY = "4f5e9d85-690a-4420-899d-4d9d5cac9171";
const TRACKED_WALLETS = [
  "34ZEH778zL8ctkLwxxERLX5ZnUu6MuFyX9CWrs8kucMw",
  "suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK",
  "6LChaYRYtEYjLEHhzo4HdEmgNwu2aia8CM8VhR9wn6n7"
];

async function fetchWalletActivity(wallet) {
  const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=5`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) return;

    data.forEach(tx => {
      const tokenChange = tx.tokenTransfers?.[0];
      if (!tokenChange || !tokenChange.mint) return;
      const token = tokenChange.tokenName || tokenChange.mint.slice(0, 6);
      const direction = tokenChange.amount > 0 ? "bought" : "sold";
      const time = new Date(tx.timestamp * 1000).toLocaleTimeString();
      const msg = `[${time}] ${wallet.slice(0, 5)}... ${direction} ${token}`;
      addWalletActivity(msg);
    });
  } catch (err) {
    console.error("Helius API error:", err);
  }
}

async function pollWallets() {
  for (const wallet of TRACKED_WALLETS) {
    await fetchWalletActivity(wallet);
  }
}

const BYBIT_SYMBOLS = [
  { symbol: "DOGEUSDT", display: "$DOGE" },
  { symbol: "WIFUSDT", display: "$WIF" },
  { symbol: "PEPEUSDT", display: "$PEPE" },
  { symbol: "SOLUSDT", display: "$SOL" }
];
// === Bybit Candlestick Fetch ===
async function fetchBybitCandles(symbol = "DOGEUSDT", interval = "1", limit = 50) {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data?.result?.list) return [];

    return data.result.list.map(candle => ({
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4])
    }));
  } catch (err) {
    console.error("Bybit Candle Fetch Error:", err);
    return [];
  }
}

async function fetchBybitFutures(symbolObj) {
  const url = `https://api.bybit.com/v5/market/tickers?category=linear`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.result || !Array.isArray(data.result.list)) return;

    const ticker = data.result.list.find(t => t.symbol === symbolObj.symbol);
    if (!ticker) return;

    const price = parseFloat(ticker.lastPrice).toFixed(5);
    const change = parseFloat(ticker.price24hPcnt * 100).toFixed(2);
    const volume = (parseFloat(ticker.turnover24h) / 1e6).toFixed(1);
    const msg = `📉 ${symbolObj.display} — ${price} (${change}%) — $${volume}M vol`;
    addLiveTradeEvent(msg);
  } catch (err) {
    console.error("Bybit API error:", err);
  }
}

async function pollBybitFutures() {
  for (const s of BYBIT_SYMBOLS) {
    await fetchBybitFutures(s);
  }
  // === Futures Technical Indicators ===
function calculateMACD(candles) {
  const getEMA = (data, period) => {
    const k = 2 / (period + 1);
    let ema = data[0].close;
    const result = [ema];
    for (let i = 1; i < data.length; i++) {
      ema = data[i].close * k + ema * (1 - k);
      result.push(ema);
    }
    return result;
  };

  if (candles.length < 26) return null;

  const ema12 = getEMA(candles, 12);
  const ema26 = getEMA(candles, 26).slice(ema12.length - ema26.length);
  const macdLine = ema12.map((val, i) => val - ema26[i]);
  const signalLine = getEMA(macdLine.map(v => ({ close: v })), 9);
  const latestMACD = macdLine[macdLine.length - 1];
  const latestSignal = signalLine[signalLine.length - 1];

  return {
    macd: latestMACD,
    signal: latestSignal,
    crossover: latestMACD > latestSignal ? "bullish" : latestMACD < latestSignal ? "bearish" : "neutral"
  };
}function calculateMACD(candles, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    const emaArray = [data[0]];
    for (let i = 1; i < data.length; i++) {
      emaArray.push(data[i] * k + emaArray[i - 1] * (1 - k));
    }
    return emaArray;
  };

  const closes = candles.map(c => c.close);
  const ema12 = ema(closes, shortPeriod);
  const ema26 = ema(closes, longPeriod);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, signalPeriod);

  const latestMACD = macdLine[macdLine.length - 1];
  const latestSignal = signalLine[signalLine.length - 1];
  const crossover =
    latestMACD > latestSignal
      ? "bullish"
      : latestMACD < latestSignal
      ? "bearish"
      : "neutral";

  return {
    macd: latestMACD,
    signal: latestSignal,
    crossover
  };
}

function evaluateFuturesTrade(token, candles) {
  const macd = calculateMACD(candles);
  console.log(`${token.name} MACD Raw:`, macd);
  if (!macd) return;

  let confidence = 0;

  if (macd.crossover === "bullish") confidence += 30;
  if (macd.crossover === "bearish") confidence -= 30;

  const volume = analyzeVolumeStrength(candles);
  if (volume?.spike) confidence += 20;
  if (volume?.divergence) confidence -= 10;

  const action = confidence >= 30 ? "LONG"
               : confidence <= -30 ? "SHORT"
               : "HOLD";

  const msg = `📉 ${token.name} → MACD: ${macd.crossover} | Action: ${action} | Confidence: ${confidence}%`;
  console.log(msg);
  addLiveTradeEvent(msg);

  if (action !== "HOLD") {
    triggerFuturesTrade(token.name, action, confidence);
  }
}

function triggerFuturesTrade(token, action, confidence) {
  console.log(`✅ FUTURES TRADE: ${action} ${token} with ${confidence}% confidence`);
}

async function fetchFastMovingTokensFromPump() {
    try {
        const res = await fetch("https://poseidon-relay.replit.app/tokens");
      const data = await res.json();
      if (!Array.isArray(data)) return;
  
      data.slice(0, 5).forEach(token => {ame = tokename || token.symbol || token.id?.slice(0, 6);
        const bonding = token.bonding_percent ?? "N/A";
        const mc = token.market_cap ?? 0;
        const volume = token.volume_24h ?? 0;
  
        const msg = `🚀 ${name} — ${bonding}% bonded — ${Math.round(volume)} vol — $${mc} MC`;
        addLiveTradeEvent(msg);
      });
    } catch (err) {
      console.error("Pump.fun API error:", err);
    }
  }
  const walletActivityLog = [];

// === Boot Sequence ===
window.addEventListener("DOMContentLoaded", () => {
  loadMemoryFromStorage();
  simulateSmartActivity();
  simulateLiveTradeMonitor();
  updateWalletInsights();
  pollWallets();
  pollBybitFutures();
  fetchFastMovingTokensFromPump();
  renderSniperIndex(); // << ✅ ADD THIS
  renderROIMemory(learningMemory); // Add this inside DOMContentLoaded
  setInterval(pollWallets, 15000);
  setInterval(pollBybitFutures, 20000);
  setInterval(renderLearningMemory, 30000);
  setInterval(analyzePatterns, 30000);
  setInterval(renderSniperIndex, 30000); // already included ✅
  setInterval(simulateFuturesExecution, 10000); // every 10s
});

// 🧠 Poseidon Avatar Interactivity
const avatar = document.getElementById("poseidon-avatar");
const eyes = avatar.querySelector(".poseidon-eyes");
let poseidonAwake = false;

avatar.addEventListener("mouseenter", () => {
  avatar.classList.add("active");
});

avatar.addEventListener("mouseleave", () => {
  avatar.classList.remove("active");
});

avatar.addEventListener("click", () => {
  poseidonAwake = !poseidonAwake;
  eyes.textContent = poseidonAwake ? "🧠" : "👁️‍🗨️";
});




// 1. Candle generator
function generateFakeCandlesWithVolume(count = 20) {
  let candles = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    let open = price;
    let close = price + (Math.random() - 0.5) * 2;
    let high = Math.max(open, close) + Math.random() * 1.5;
    let low = Math.min(open, close) - Math.random() * 1.5;
    let volume = 1000 + Math.random() * 5000;
    candles.push({ open, high, low, close, volume });
    price = close;
  }
  return candles;
}

// 2. Test execution logic
function testExecutionLogic() {
  const token = {
    name: "$TESTY",
    bondingPercent: 25,
    marketCap: 50000,
    recentSmartWallets: 3,
    candles: generateFakeCandlesWithVolume()
  };
  evaluateTradeOpportunity(token, token.candles);
}
testExecutionLogic(); // <-- This line should run after both functions are defined

// 3. Evaluation logic
function evaluateTradeOpportunity(token, candles) {
  console.log("📊 Evaluating:", token.name);
  candles.forEach((c, i) => {
    console.log(`Candle ${i + 1} - Close: ${c.close}, Volume: ${c.volume}`);
  });
}

// Run the simulation every 10 seconds
setInterval(runVolumeSimulation, 10000);

function runVolumeSimulation() {
  const candles = generateFakeCandlesWithVolume(); // We'll modify this below
  const volumeResult = analyzeVolumeStrength(candles);

  if (volumeResult) {
    console.log("📈 Volume Analysis:", volumeResult);

    if (volumeResult.spike) {
      console.log("🔥 Volume spike detected — possible whale/sniper move");
    }

    if (volumeResult.divergence) {
      console.log("⚠️ Volume divergence — price action may be weak/fake");
    }
  }
  async function testFuturesMACD() {
    const tokens = [
      { name: "$DOGE", symbol: "DOGEUSDT" },
      { name: "$WIF", symbol: "WIFUSDT" },
      { name: "$PEPE", symbol: "PEPEUSDT" },
      { name: "$SOL", symbol: "SOLUSDT" }
    ];
  
    for (const token of tokens) {
      const candles = await fetchBybitCandles(token.symbol, "1", 50);
      if (candles.length >= 26) {
        evaluateFuturesTrade(token, candles);
      }
    }
  }
  setInterval(testFuturesMACD, 20000); // Run every 20 seconds
  
}function evaluateTradeOpportunity(token, candles) {
  const bollinger = calculateBollingerBands(candles);
  const volume = analyzeVolumeStrength(candles);
  const macd = calculateMACD(candles);
  console.log(`${token.name} MACD Raw:`, macd);
  const bonding = token.bondingPercent;
  const marketCap = token.marketCap;
  const smartBuyers = token.recentSmartWallets || 0;

  if (smartBuyers >= 2 && bonding < 40 && marketCap < 80000) {
    let confidence = 0;
    if (macd.histogram > 0) confidence += 15;
    if (macd.histogram < 0) confidence -= 10;

    if (bollinger.breakout === 'above') confidence += 30;
    if (bollinger.compression) confidence += 20;
    if (volume.spike) confidence += 30;
    if (!volume.divergence) confidence += 10;

    if (confidence >= 0) { // force buy for testing
      console.log("⚙️ Trigger condition met. Attempting to BUY...");
      triggerBuy(token, confidence);
    } else {
      console.log(`⏸️ Skipped ${token.name} — Confidence: ${confidence}%`);
    }

  } else {
    console.log(`⚠️ Ignored ${token.name} — not meeting basic conditions.`);
  }
}

function triggerBuy(token, confidence) {
  const capital = calculateCapital(confidence);
  console.log(`✅ AUTO BUY TRIGGERED: ${token.name} at ${token.marketCap} MC`);
  console.log(`🔹 Capital Allocated: ${capital} SOL`);
  console.log(`🔹 Confidence Score: ${confidence}%`);
}

  // === Capital Allocation Logic ===
  function calculateCapital(confidence) {
    if (confidence >= 90) return 1;
    if (confidence >= 80) return 0.5;
    if (confidence >= 70) return 0.3;
    return 0.1;
  }

  function analyzePatterns() {
    const trades = getAllTrades(); // Assumes getAllTrades is available
    if (trades.length < 5) {
      console.log("🧪 Not enough trade data to analyze.");
      return null;
    }
  
    const results = {
      avgROI: 0,
      winRate: 0,
      commonBonding: [],
      entryMCZones: {
        '30K–50K': 0,
        '50K–70K': 0,
        '70K–90K': 0,
        '90K+': 0,
      },
      triggerEffectiveness: {},
    };
  
    let wins = 0;
    let totalROI = 0;
  
    for (const trade of trades) {
      const { result, reason, entryPrice, exitPrice, details } = trade;
  
      if (result > 0) wins++;
      totalROI += result;
  
      const mc = details?.marketCap || 0;
      if (mc < 50000) results.entryMCZones['30K–50K']++;
      else if (mc < 70000) results.entryMCZones['50K–70K']++;
      else if (mc < 90000) results.entryMCZones['70K–90K']++;
      else results.entryMCZones['90K+']++;
  
      const src = reason || 'Unknown';
      results.triggerEffectiveness[src] = (results.triggerEffectiveness[src] || 0) + 1;
  
      if (details?.bonding !== undefined) {
        results.commonBonding.push(details.bonding);
      }
    }
  
    results.avgROI = parseFloat((totalROI / trades.length).toFixed(2));
    results.winRate = parseFloat(((wins / trades.length) * 100).toFixed(2));
  
    console.log("🧠 Poseidon Pattern Summary:");
    console.log(results);
  
    return results;
  }
  document.getElementById("toggle-sniper-index").onclick = function () {
    const sidebar = document.getElementById("sniper-index-sidebar");
    sidebar.classList.toggle("hidden");
  };
  
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
    `).join(""); // ✅ Done here
  }
  

  // === WebSocket Client ===
  const socket = new WebSocket("ws://localhost:8080");
  socket.onmessage = function (event) {
  const message = event.data;
  console.log("📩 Incoming WS Message:", message);
  addWalletActivity(message); // Optional: Also renders to UI feed
};
  
  // Dummy implementations for testing
  function evaluateTradeOpportunity(token, candles) {
    console.log("Evaluating opportunity for:", token.name);
  }
  function addWalletActivity(message) {
    console.log("Wallet Activity:", message);
  }}
  
// --- True Outcome Simulation ---
async function fetchTokenROI(tokenSymbol) {
    const response = await fetch(`https://api.tensor.trade/token/${tokenSymbol}/roi`);
    const data = await response.json();
    return data.currentROI || null;
}

async function simulateTradeOutcome(tokenSymbol, entryROI) {
    const currentROI = await fetchTokenROI(tokenSymbol);
    if (!currentROI) return;
    const outcome = currentROI >= entryROI ? 'WIN' : 'LOSS';
    updateLearningMemory(tokenSymbol, outcome, currentROI);
}

function updateLearningMemory(tokenSymbol, outcome, currentROI) {
    const memory = JSON.parse(localStorage.getItem('poseidonMemory')) || {}
    memory[tokenSymbol] = { outcome, roi: currentROI, timestamp: Date.now() };
    localStorage.setItem('poseidonMemory', JSON.stringify(memory));
}

// --- Wallet Memory Cleanup ---
setInterval(() => {
    const memory = JSON.parse(localStorage.getItem('walletMemory')) || {}
    const now = Date.now();
    Object.keys(memory).forEach(wallet => {
        const inactiveHours = (now - memory[wallet].lastActiveTimestamp) / (1000 * 60 * 60);
        if (inactiveHours > 24) delete memory[wallet];
    });
    localStorage.setItem('walletMemory', JSON.stringify(memory));
}, 3600000);

// --- Real Token Data Integration ---
async function fetchTokenMetadata(tokenSymbol) {
    const response = await fetch(`https://api.tensor.trade/token/${tokenSymbol}/metadata`);
    const data = await response.json();
    return {
        bondingPercentage: data.bondingPercentage,
        volume: data.volume,
        marketCap: data.marketCap
    };
}

async function updateTokenDataUI(tokenSymbol) {
    const metadata = await fetchTokenMetadata(tokenSymbol);
    if (!metadata) return;
    document.getElementById('bonding-percentage').innerText = `${metadata.bondingPercentage}%`;
    document.getElementById('volume').innerText = metadata.volume.toLocaleString();
    document.getElementById('market-cap').innerText = `$${metadata.marketCap.toLocaleString()}`;
}


// === 1. ROI Memory Panel ===
function renderROIMemory(memory) {
  if (!Array.isArray(memory) || memory.length === 0) return;
  const avgROI = memory.reduce((sum, t) => sum + (t.roi || 0), 0) / memory.length;
  console.log("📊 Avg ROI across trades:", avgROI.toFixed(2));
}

// === 2. Smart Wallet Convergence Engine ===
function detectWalletConvergence(walletLogs) {
  const timeMap = {};
  walletLogs.forEach(log => {
    const { token, wallet, timestamp } = log;
    if (!timeMap[token]) timeMap[token] = [];
    timeMap[token].push({ wallet, timestamp });
  });

  for (const token in timeMap) {
    const entries = timeMap[token];
    entries.sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < entries.length - 1; i++) {
      const delta = entries[i + 1].timestamp - entries[i].timestamp;
      if (entries[i].wallet !== entries[i + 1].wallet && delta < 30000) {
        console.log("⚡ Wallet Convergence on", token, "between", entries[i].wallet, "and", entries[i + 1].wallet);
      }
    }
  }
}

// === 3. Capital Allocator ===
function allocateCapitalBasedOnConfidence(confidence) {
  if (confidence >= 90) return 1;
  if (confidence >= 80) return 0.75;
  if (confidence >= 70) return 0.5;
  return 0.25;
}

// === 4. Auto Buy/Sell Engine ===
function autoTradeEngine(token, price, confidence) {
  const capital = allocateCapitalBasedOnConfidence(confidence);
  if (confidence >= 75) {
    console.log(`🚀 Auto-Buy triggered for ${token} using ${capital} SOL`);
    // Hook: initiateBuy(token, capital);
  }

  if (price >= token.entryPrice * 1.35) {
    console.log(`💰 Auto-Sell triggered for ${token} at +35% gain`);
    // Hook: initiateSell(token);
  }

  if (token.smartWalletsExited) {
    console.log(`⚠️ Smart Wallet Exit detected for ${token}, consider selling`);
    // Hook: initiateSell(token);
  }
}


// === SIGNAL ROUTING INTEGRATION ===
function handleSmartWalletSignal(message) {
  const tokenMatch = message.match(/\$(\w+)/);
  if (!tokenMatch) return;

  const token = `$${tokenMatch[1]}`;
  const bonding = Math.floor(Math.random() * 30);
  const volume = 5000 + Math.floor(Math.random() * 10000);
  const marketCap = 55000 + Math.floor(Math.random() * 25000);
  const wallet = "SmartTrigger";

  const confidence = (3 / 5 * 0.4) + ((100 - bonding) / 100 * 0.3) + (volume / 10000 * 0.3);
  const allocation = (0.1 + 0.9 * confidence).toFixed(2);

  const capitalMsg = `💰 ${allocation} SOL allocated to ${token} — confidence ${(confidence * 100).toFixed(1)}%`;
  addLiveTradeEvent(capitalMsg);

  // Auto Buy Logic
  if (confidence >= 0.65) {
    const buyMsg = `✅ AUTO BUY SIGNAL: ${token} — ${allocation} SOL`;
    addLiveTradeEvent(buyMsg);
  }

  // Auto Sell Logic (Simulated)
  setTimeout(() => {
    const sellMsg = `🔻 AUTO SELL: ${token} exited with +35% or Smart Exit logic`;
    addLiveTradeEvent(sellMsg);
  }, 180000); // 3 minutes
}
// === Futures Execution Simulation ===
function simulateFuturesExecution() {
  console.log("🔁 simulateFuturesExecution is running");
  const mockTokens = [
    { name: "$DOGE", price: 0.0832, confidence: 82 },
    { name: "$WIF", price: 0.1251, confidence: 88 },
    { name: "$PEPE", price: 0.0000013, confidence: 63 },
  ];

  mockTokens.forEach(token => {
    const candles = generateFakeCandlesWithVolume();
    const result = evaluateFuturesTrade(token, candles);

    const log = document.createElement("div");
    log.className = "log-entry";
    log.textContent = `🧠 Simulated ${result.action} on ${token.name} | Confidence: ${result.confidence}% | MACD: ${result.macd}`;
    document.getElementById("futures-execution-log").prepend(log);
  });
}

// Hook into WebSocket signal receiver
if (typeof socket !== "undefined") {
  socket.addEventListener("message", function (event) {
    handleSmartWalletSignal(event.data);
  });
}

// === Signal Routing Integration ===
function handleSmartWalletSignal(message) {
  const parsed = typeof message === "string" && message.includes("$") ? parseMessage(message) : null;
  if (!parsed) return;

  const { token, winRate, bonding, volume } = parsed;

  const { confidence, amount, message: scoreMsg } = allocateCapital({ winRate, bonding, volume });
  console.log("📊 Capital Allocation Decision:", scoreMsg);

  if (confidence >= 75) {
    const buyMsg = `✅ AUTO BUY SIGNAL: ${token} → ${amount} SOL`;
    addLiveTradeEvent(buyMsg);
    console.log(buyMsg);
  }

  // Simulate Sell Action (3 mins later)
  setTimeout(() => {
    const sellMsg = `🔻 AUTO SELL: ${token} exited with +35% or Smart Exit`;
    addLiveTradeEvent(sellMsg);
    console.log(sellMsg);
  }, 180000); // 3 minutes
}

if (typeof socket !== "undefined") {
  socket.addEventListener("message", function (event) {
    handleSmartWalletSignal(event.data);
  });
}

// --- Missing Hooks and Visual Triggers ---
function triggerVisualUpdate(elementId, data) {
    const el = document.getElementById(elementId);
    if(el) el.innerText = data;
}

// --- renderROIMemory() for UI ---
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

// Automatically call renderROIMemory periodically
setInterval(renderROIMemory, 60000);

// --- Autonomous Buy/Sell Simulation ---
async function autoTradeSimulation(tokenSymbol, entryROI, entryPrice) {
    const currentROI = await fetchTokenROI(tokenSymbol);
    if (currentROI === null) return;

    if (currentROI >= entryROI + 35) {
        executeAutoSell(tokenSymbol, currentROI);
    } else if (detectSmartWalletExit(tokenSymbol)) {
        executeAutoSell(tokenSymbol, currentROI, true);
    }
}

function executeAutoSell(tokenSymbol, roi, smartExit = false) {
    const reason = smartExit ? "Smart Wallet Exit Detected" : "ROI Target Reached";
    updateLearningMemory(tokenSymbol, 'SOLD', roi);
    console.log(`Auto-sold ${tokenSymbol} | ROI: ${roi}% | Reason: ${reason}`);
    triggerVisualUpdate('trade-alert', `Auto-sold ${tokenSymbol} at ${roi}% due to ${reason}`);
}

function detectSmartWalletExit(tokenSymbol) {
    // Dummy logic placeholder: Replace with real detection
    return Math.random() < 0.1;
}

// Run simulation periodically for active tokens
setInterval(() => {
    const activeTrades = JSON.parse(localStorage.getItem('activeTrades')) || [];
    activeTrades.forEach(trade => {
        autoTradeSimulation(trade.tokenSymbol, trade.entryROI, trade.entryPrice);
    });
}, 30000);

// --- Strengthen Futures Panel Display ---
function updateFuturesPanel(data) {
    triggerVisualUpdate('futures-market-cap', `$${data.marketCap}`);
    triggerVisualUpdate('futures-volume', data.volume);
    triggerVisualUpdate('futures-trend', data.trend);
}

async function fetchAndUpdateFuturesPanel(tokenSymbol) {
    const metadata = await fetchTokenMetadata(tokenSymbol);
    if (!metadata) return;
    updateFuturesPanel({
        marketCap: metadata.marketCap,
        volume: metadata.volume,
        trend: metadata.volume > 100000 ? 'High' : 'Low'
    });
}

// Periodically refresh futures panel every minute
setInterval(() => fetchAndUpdateFuturesPanel('BTCUSDT'), 60000);

let trackedCA = null;
let sniperTrackingActive = false;

async function startSniperTracking() {
  trackedCA = document.getElementById("ca-input").value.trim();
  if (!trackedCA) {
    alert("Please enter a valid Contract Address.");
    return;
  }

  document.getElementById("tracker-status").innerText = "Tracking...";
  sniperTrackingActive = true;
  pollSniperTracker();
}

async function pollSniperTracker() {
  if (!sniperTrackingActive || !trackedCA) return;

  // Simulated API fetch placeholders
  const marketCap = await fetchMarketCap(trackedCA);
  const bonding = await fetchBondingPercent(trackedCA);
  const wallets = await fetchSmartWalletCount(trackedCA);

  document.getElementById("tracker-mc").innerText = `${marketCap} SOL`;
  document.getElementById("tracker-bond").innerText = `${bonding}%`;
  document.getElementById("tracker-wallets").innerText = wallets;

  // Auto-entry logic placeholder
  if (bonding < 40 && wallets >= 2 && marketCap > 50) {
    document.getElementById("tracker-status").innerText = "Auto-entering trade...";
    autoEnterTrade(trackedCA);
    sniperTrackingActive = false;
    return;
  }

  setTimeout(pollSniperTracker, 5000); // poll every 5 seconds
}

function manualSniperEntry() {
  if (!trackedCA) {
    alert("Please enter a Contract Address first.");
    return;
  }

  document.getElementById("tracker-status").innerText = "Manual Entry Activated!";
  autoEnterTrade(trackedCA); // Use the same trade entry logic
  sniperTrackingActive = false;
}

// Simulated fetchers
async function fetchMarketCap(ca) {
  // Replace with real API
  return Math.floor(Math.random() * 100) + 20;
}

async function fetchBondingPercent(ca) {
  // Replace with real API
  return Math.floor(Math.random() * 50);
}

async function fetchSmartWalletCount(ca) {
  // Replace with real API
  return Math.floor(Math.random() * 5);
}

function autoEnterTrade(ca) {
  console.log(`✅ Poseidon entered trade on ${ca}`);
  // TODO: Hook into trade engine, set TP/SL, update memory
}



// ==========================
// 📡 Market Cap & Bonding Tracker
// ==========================
async function fetchMarketCap(ca) {
  try {
    const response = await fetch(`https://public-api.birdeye.so/public/token/${ca}`, {
      headers: { 'X-API-KEY': 'cfcc5485796a4e85ac0444fac13dd9a2' }
    });
    const data = await response.json();
    return data?.data?.market_cap || 0;
  } catch {
    return 0;
  }
}

async function fetchBondingPercent(ca) {
  try {
    const response = await fetch(`https://public-api.birdeye.so/public/token/${ca}`, {
      headers: { 'X-API-KEY': 'cfcc5485796a4e85ac0444fac13dd9a2' }
    });
    const data = await response.json();
    return data?.data?.bonding_rate || 0;
  } catch {
    return 0;
  }
}

// ==========================
// 👤 Smart Wallet Activity Tracker
// ==========================
async function fetchSmartWalletCount(ca) {
  try {
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${ca}/transactions?api-key=4f5e9d85-690a-4420-899d-4d9d5cac9171`);
    const data = await response.json();
    return data.length;
  } catch {
    return 0;
  }
}

function isKnownSmartWallet(wallet) {
  const known = ['Groovy', 'Cupsey', 'Smart5', 'Assassin'];
  return known.includes(wallet);
}

// ==========================
// 🧠 Poseidon Decision Engine
// ==========================
async function poseidonSniperLoop(ca) {
  const confidence = await poseidonConfidenceScore(ca);
  console.log(`🤖 Poseidon score for ${ca}: ${confidence}`);
  if (confidence >= 65) {
    autoEnterTrade(ca);
  }
}

async function poseidonConfidenceScore(ca) {
  const bonding = await fetchBondingPercent(ca);
  const mc = await fetchMarketCap(ca);
  const smartCount = await fetchSmartWalletCount(ca);

  let score = 0;
  if (bonding < 35) score += 25;
  if (mc >= 55000 && mc <= 80000) score += 25;
  if (smartCount >= 3) score += 40;

  return score;
}
manualTPPercent = 35; // Default TP %

// Removed duplicate tpSlider
// Removed duplicate tpLabel

if (tpSlider && tpLabel) {
  tpSlider.addEventListener("input", () => {
    manualTPPercent = parseInt(tpSlider.value);
    tpLabel.textContent = `TP: ${manualTPPercent}%`;
  });
}
// ==========================
// 🚀 Trade Entry Handler
// ==========================
function autoEnterTrade(ca) {
  const entryPrice = fetchTokenPrice(ca);
  const tp = entryPrice * (1 + manualTPPercent / 100);
  const sl = entryPrice * 0.6;

  manageTradeLifecycle(ca, entryPrice, tp, sl);
}

// ==========================
// ♻️ Trade Lifecycle
// ==========================
function manageTradeLifecycle(ca, entryPrice, tp, sl) {
  const interval = setInterval(async () => {
    const current = await fetchTokenPrice(ca);
    if (current >= tp) {
      console.log(`💰 TP HIT for ${ca}`);
      clearInterval(interval);
    } else if (current <= sl) {
      console.log(`🛑 SL HIT for ${ca}`);
      clearInterval(interval);
    } else {
      const smartDumped = await checkSmartExits(ca);
      if (smartDumped) {
        console.log(`⚠️ Smart wallet exit for ${ca}`);
        clearInterval(interval);
      }
    }
  }, 4000);
}

// ==========================
// 🧠 Smart Exit Check
// ==========================
async function checkSmartExits(ca) {
  try {
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${ca}/transactions?api-key=4f5e9d85-690a-4420-899d-4d9d5cac9171`);
    const data = await response.json();
    let smartExits = 0;
    for (const tx of data) {
      if (isKnownSmartWallet(tx?.sender)) smartExits++;
    }
    return smartExits >= 2;
  } catch {
    return false;
  }
}

// ==========================
// 📊 Price Simulator
// ==========================
function fetchTokenPrice(ca) {
  return (Math.random() * 100).toFixed(2);
}

function trackTokenByCA() {
  const input = document.getElementById("manual-ca-input");
  const ca = input.value.trim();
  const log = document.getElementById("ca-tracker-log");

  if (!ca || ca.length < 32) {
    log.textContent = "❌ Invalid contract address.";
    return;
  }

  log.textContent = `🔍 Watching ${ca}...`;

  // Poseidon's loop takes over
  poseidonSniperLoop(ca); // ← this function must exist in the JS
}

// === Poseidon Modules Injected ===

// === Poseidon Live Token Data Trackers ===
async function fetchMarketCap(ca) {
  try {
    const res = await fetch(`https://api.tensor.so/v1/marketcap/${ca}?api_key=cfcc5485796a4e85ac0444fac13dd9a2`);
    const json = await res.json();
    return json.marketCap || 0;
  } catch (err) {
    console.warn("Market Cap API error", err);
    return 0;
  }
}

async function fetchBondingPercent(ca) {
  try {
    const res = await fetch(`https://api.tensor.so/v1/bonding/${ca}?api_key=cfcc5485796a4e85ac0444fac13dd9a2`);
    const json = await res.json();
    return json.bondingPercent || 0;
  } catch (err) {
    console.warn("Bonding % API error", err);
    return 0;
  }
}

// === Smart Wallet Detector ===
async function fetchSmartWalletCount(ca) {
  try {
    const res = await fetch(`https://api.helius.xyz/v0/tokens/${ca}/holders?api-key=4f5e9d85-690a-4420-899d-4d9d5cac9171`);
    const json = await res.json();
    return json.accounts.filter(acc => isKnownSmartWallet(acc.owner)).length;
  } catch (err) {
    console.warn("Smart Wallet API error", err);
    return 0;
  }
}

function isKnownSmartWallet(walletAddress) {
  const known = ["Groovy", "Cupsey", "Assassin"];
  return known.some(name => walletAddress.includes(name));
}

// === Core Poseidon Loop ===
async function poseidonSniperLoop(ca) {
  const bonding = await fetchBondingPercent(ca);
  const marketCap = await fetchMarketCap(ca);
  const smartCount = await fetchSmartWalletCount(ca);
  const confidence = poseidonConfidenceScore({ bonding, marketCap, smartCount });

  if (confidence >= 65) autoEnterTrade(ca, confidence);
}

function poseidonConfidenceScore({ bonding, marketCap, smartCount }) {
  let score = 0;
  if (smartCount >= 3) score += 40;
  if (bonding < 30) score += 30;
  if (marketCap >= 55000 && marketCap <= 80000) score += 30;
  return score;
}

// === Trade Entry & Lifecycle ===
function autoEnterTrade(ca, confidence) {
  const entryPrice = fetchTokenPrice(ca);  // simulated
  const tp = entryPrice * 1.35;
  const sl = entryPrice * 0.60;
  manageTradeLifecycle(ca, entryPrice, tp, sl);
}

function manageTradeLifecycle(ca, entry, tp, sl) {
  const interval = setInterval(async () => {
    const current = fetchTokenPrice(ca);
    if (current >= tp || current <= sl || checkSmartExits(ca)) {
      clearInterval(interval);
      console.log(`🛑 Exiting ${ca} at ${current}`);
    }
  }, 3000);
}

// === Manual Trade Control State ===
let isPoseidonPaused = false;
// Removed duplicate manualTPPercent declaration

// === DOM Elements ===
const pauseBtn = document.getElementById("pause-btn");
const resumeBtn = document.getElementById("resume-btn");
const tpValue = document.getElementById("tp-value");
const takeProfitBtn = document.getElementById("take-profit-btn");
const forceExitBtn = document.getElementById("force-exit-btn");

// === Button Listeners ===
pauseBtn.addEventListener("click", () => {
  isPoseidonPaused = true;
  pauseBtn.style.display = "none";
  resumeBtn.style.display = "inline-block";
  console.log("🛑 Poseidon paused by user.");
});

resumeBtn.addEventListener("click", () => {
  isPoseidonPaused = false;
  resumeBtn.style.display = "none";
  pauseBtn.style.display = "inline-block";
  console.log("▶️ Poseidon resumed.");
});

tpSlider.addEventListener("input", () => {
  manualTPPercent = parseInt(tpSlider.value);
  tpValue.textContent = `${manualTPPercent}%`;
});

takeProfitBtn.addEventListener("click", () => {
  console.log(`💰 Manual Take Profit triggered at ${manualTPPercent}%`);
  // Simulate a partial exit (you can adjust based on your actual trade manager)
  simulatePartialProfit(manualTPPercent);
});

forceExitBtn.addEventListener("click", () => {
  console.log("❌ User manually exited trade.");
  simulateForceExit();
});

// === Poseidon should check this before taking trade actions ===
function isPoseidonAllowedToAct() {
  return !isPoseidonPaused;
}

// === Simulated Placeholder Logic (replace with real handlers) ===
function simulatePartialProfit(percent) {
  console.log(`📊 Poseidon locked in ${percent}% of profit.`);
  // Call actual trade manager to partially close
}

// === Simulated Price ===
function fetchTokenPrice(ca) {
  return Math.random() * 0.1 + 0.05; // mock price for now
}

// === Smart Exit Detector ===
function checkSmartExits(ca) {
  const rand = Math.random();
  return rand > 0.92; // simulate 8% smart exit chance
}


// --- Integrated Enhancements ---
// --- Sniper Tracker Panel ---
function updateSniperTrackerPanel(ca, token, confidence, smartWalletCount) {
    document.getElementById('tracked-ca').innerText = ca;
    document.getElementById('tracked-token').innerText = token;
    document.getElementById('confidence-level').innerText = confidence + '%';
    document.getElementById('smart-wallet-count').innerText = smartWalletCount;
}

// --- Self-Advisory Engine ---
function poseidonSniperLoop(ca) {
    fetchTokenMetadata(ca).then(metadata => {
        if(metadata.bondingPercentage > 50) {
            triggerVisualUpdate('advisory-engine', 'Consider lowering capital, bonding is high.');
        } else if(metadata.smartWalletCount < 2) {
            triggerVisualUpdate('advisory-engine', 'Delay entry — not enough smart wallets.');
        }
    });
}

// --- Confidence Display Panel ---
function renderConfidenceBar(tokenSymbol, confidenceScore) {
    const bar = document.getElementById('confidence-bar');
    bar.style.width = confidenceScore + '%';
    bar.style.backgroundColor = confidenceScore < 40 ? 'red' : confidenceScore < 70 ? 'yellow' : 'green';
    bar.innerText = tokenSymbol + ' - ' + confidenceScore + '%';
}

// --- Futures Execution Result Log ---
function appendFuturesResultToPanel(result) {
    const panel = document.getElementById('futures-log-panel');
    const logEntry = document.createElement('div');
    logEntry.innerText = result;
    panel.appendChild(logEntry);
}

// --- Smart Wallet Convergence Visual ---
function renderWalletConvergence(tokenSymbol, walletCount, seconds) {
    const convergencePanel = document.getElementById('wallet-convergence-panel');
    convergencePanel.innerText = `🔁 Convergence on ${tokenSymbol} — ${walletCount} smart wallets in ${seconds}s`;
}

// --- Sniper Override Settings ---
function applySniperOverrides(minBonding, maxMarketCap, minWalletCount) {
    localStorage.setItem('sniperOverrides', JSON.stringify({minBonding, maxMarketCap, minWalletCount}));
}

// --- Animated Header Logo & Collapse Panels ---
document.getElementById('header-logo').classList.add('animated-logo');
function toggleCollapse(panelId) {
    document.getElementById(panelId).classList.toggle('collapsed');
}

// --- Final Hosting Instructions ---
// Ensure secure endpoint configuration on deployment.
// Setup API keys securely on your deployment platform.



// === Poseidon Floating Avatar ===
function injectPoseidonAvatar() {
  const avatar = document.createElement("div");
  avatar.id = "poseidon-avatar";
  avatar.innerHTML = '<div class="pulse-circle"></div>';
  document.body.appendChild(avatar);
}

window.addEventListener("DOMContentLoaded", () => {
  injectPoseidonAvatar();
});




// === 🧠 Poseidon Self-Advisory Engine ===
function runSelfAdvisoryEngine() {
  const advice = [];
  if (walletActivityLog.length < 5) advice.push("Track more smart wallets.");
  if (typeof bonding === 'number' && bonding > 50) advice.push("Delay entry — bonding too high.");
  if (typeof volume === 'number' && volume < 3000) advice.push("Volume low, trade may stall.");
  if (advice.length === 0) advice.push("System is fully optimized for this cycle.");
  console.log("🧠 Poseidon Self-Advisory:", advice.join(" | "));
  return advice;
}

// === 📊 Visual Confidence Renderer ===
function renderConfidencePanel(confidence, amount) {
  const panel = document.getElementById("confidence-panel");
  if (panel) {
    panel.innerHTML = `Score: <strong>${confidence}%</strong> | Capital: <strong>${amount} SOL</strong>`;
  }
}

// === 🧮 ROI Memory Panel Hook ===
function renderROIMemory(memory) {
  if (!Array.isArray(memory) || memory.length === 0) return;
  const avgROI = memory.reduce((sum, t) => sum + (t.roi || 0), 0) / memory.length;
  const panel = document.getElementById("roi-panel");
  if (panel) panel.innerHTML = `📈 Avg ROI: <strong>${avgROI.toFixed(1)}%</strong>`;
}

// === 🧠 Brain Mode Scanner ===
let isBrainMode = true;
function toggleBrainMode() {
  isBrainMode = !isBrainMode;
  document.getElementById("brain-mode-status").textContent = isBrainMode ? "🧠 Brain Mode ON" : "🔕 Brain Mode OFF";
  console.log("🧠 Brain mode now:", isBrainMode);
}

// === 🧪 Sniper Tracker Watch Mode ===
function handleSniperTrackingCA(ca) {
  console.log("🔍 Watching CA:", ca);
  if (isBrainMode) {
    poseidonSniperLoop(ca); // Live scoring loop
  }
}

// === ✅ TP Slider and Trade Controls ===
let manualTPPercent = 35;
const tpSlider = document.getElementById("tp-slider");
const tpLabel = document.getElementById("tp-label");
if (tpSlider && tpLabel) {
  tpSlider.addEventListener("input", () => {
    manualTPPercent = parseInt(tpSlider.value);
    tpLabel.textContent = `TP: ${manualTPPercent}%`;
  });
}

// === 🧿 Poseidon Avatar Hover Animation ===
const avatar = document.getElementById("poseidon-avatar");
const eyes = avatar?.querySelector(".poseidon-eyes");
let poseidonAwake = false;
if (avatar && eyes) {
  avatar.addEventListener("mouseenter", () => avatar.classList.add("active"));
  avatar.addEventListener("mouseleave", () => avatar.classList.remove("active"));
  avatar.addEventListener("click", () => {
    poseidonAwake = !poseidonAwake;
    eyes.textContent = poseidonAwake ? "🧠" : "⚪";
  });
}
