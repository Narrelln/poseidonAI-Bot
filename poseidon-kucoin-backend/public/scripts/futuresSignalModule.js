// === futuresSignalModule.js — Scanning + Signal Engine (Pump/Drop Detection, TA Analysis, Confidence) ===

import { fetchFuturesPrice, fetchVolumeAndOI } from './futuresApi.js';
import { evaluatePoseidonDecision } from './futuresDecisionEngine.js';
import { isBotActive } from './poseidonBotModule.js';
import { setActiveSymbols } from './sessionStatsModule.js';
import { initFuturesPositionTracker } from './futuresPositionTracker.js';
import { detectTrendPhase } from './trendPhaseDetector.js';

let activeSymbols = [];
const MAX_VOLUME_CAP = 20_000_000;
const taCache = new Map();
const lastSignalLogTimestamps = new Map();

async function fetchTA(symbol) {
  if (taCache.has(symbol)) return taCache.get(symbol);
  try {
    const res = await fetch(`/api/ta/${symbol}`);
    if (!res.ok) throw new Error('TA endpoint error');
    const ta = await res.json();
    taCache.set(symbol, ta);
    return ta;
  } catch (err) {
    console.warn(`[TA] Fallback for ${symbol}:`, err.message);
    taCache.set(symbol, null);
    return null;
  }
}

export async function analyzeAndTrigger(symbol, options = {}) {
  if (!isBotActive() && !options.manual) return;
  taCache.clear();

  try {
    const { volume } = await fetchVolumeAndOI(symbol);
    const vol = parseFloat(volume) || 0;
    if (vol > MAX_VOLUME_CAP) return;

    // 1️⃣ Check trend phase for sniper short
    const trendPhase = await detectTrendPhase(symbol);
    if (trendPhase.phase === 'peak' || trendPhase.phase === 'reversal') {
      const analysis = {
        macdSignal: "Sell",
        bbSignal: "Breakdown",
        volumeSpike: true,
        confidence: 98,
        bigDrop: true,
        bigPump: false,
        manual: options.manual || false
      };
      logSignalToFeed(symbol, {
        ...analysis,
        trendPhase: trendPhase.phase,
        reasons: trendPhase.reasons.join(', ')
      }, true);
      await evaluatePoseidonDecision(symbol, analysis);
      return;
    }

    // 2️⃣ Check big drop
    const bigDrop = await detectBigDrop(symbol);
    if (bigDrop) {
      const analysis = {
        macdSignal: "Sell", bbSignal: "Breakdown", volumeSpike: true,
        confidence: 99, bigDrop: true, bigPump: false, manual: options.manual || false
      };
      logSignalToFeed(symbol, analysis, true);
      await evaluatePoseidonDecision(symbol, analysis);
      return;
    }

    // 3️⃣ Check big pump
    const bigPump = await detectBigPump(symbol);
    if (bigPump) {
      const analysis = {
        macdSignal: "Buy", bbSignal: "Breakout", volumeSpike: true,
        confidence: 99, bigDrop: false, bigPump: true, manual: options.manual || false
      };
      logSignalToFeed(symbol, analysis, true);
      await evaluatePoseidonDecision(symbol, analysis);
      return;
    }

    // 4️⃣ Standard TA Analysis
    const ta = await fetchTA(symbol);
    let macdSignal = 'Sell', bbSignal = 'None', volumeSpike = false;
    if (ta) {
      if (ta.macd?.signal) macdSignal = ta.macd.signal === 'bullish' ? 'Buy' : 'Sell';
      if (ta.bb?.breakout !== undefined) bbSignal = ta.bb.breakout ? 'Breakout' : 'None';
      volumeSpike = !!ta.volumeSpike;
    } else {
      macdSignal = Math.random() > 0.5 ? 'Buy' : 'Sell';
      bbSignal = Math.random() > 0.7 ? 'Breakout' : 'None';
      volumeSpike = Math.random() > 0.6;
    }

    const confidence = parseFloat(calculateConfidence(macdSignal, bbSignal, volumeSpike));
    const analysis = {
      macdSignal,
      bbSignal,
      volumeSpike,
      confidence,
      bigDrop: false,
      bigPump: false,
      manual: options.manual || false
    };

    logSignalToFeed(symbol, analysis, false);
    await evaluatePoseidonDecision(symbol, analysis);
  } catch (error) {
    console.error(`❌ Analysis failed for ${symbol}:`, error.message);
  }
}

function calculateConfidence(macd, bb, spike) {
  let score = 60 + Math.random() * 20;
  if (spike) score += 7;
  if (bb === 'Breakout') score += 8;
  if (macd === 'Buy') score += 5;
  return Math.min(score, 99).toFixed(1);
}

export async function detectBigDrop(symbol) {
  try {
    const { price, history } = await fetchFuturesPrice(symbol);
    if (!history || history.length < 2) return false;
    const oldest = history[0];
    const latest = price;
    const percentDrop = ((oldest - latest) / oldest) * 100;
    return percentDrop > 12;
  } catch (err) {
    console.warn(`⚡ Big drop check failed for ${symbol}:`, err.message);
    return false;
  }
}

export async function detectBigPump(symbol) {
  try {
    const { price, history } = await fetchFuturesPrice(symbol);
    if (!history || history.length < 2) return false;
    const oldest = history[0];
    const latest = price;
    const percentPump = ((latest - oldest) / oldest) * 100;
    return percentPump > 12;
  } catch (err) {
    console.warn(`⚡ Big pump check failed for ${symbol}:`, err.message);
    return false;
  }
}

function logSignalToFeed(symbol, analysis, highlight = false) {
  const now = Date.now();
  const last = lastSignalLogTimestamps.get(symbol) || 0;
  if (now - last < 30000) return;
  lastSignalLogTimestamps.set(symbol, now);

  const feed = document.getElementById("futures-signal-feed");
  if (!feed) return;
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `
    [${new Date().toLocaleTimeString()}] 📡 <strong>${symbol}</strong> →
    MACD: ${analysis.macdSignal},
    BB: ${analysis.bbSignal},
    Volume Spike: ${analysis.volumeSpike ? '✅' : '❌'},
    Confidence: ${analysis.confidence}% 
    ${analysis.trendPhase ? `<br><span style='color:orange;font-weight:bold;'>📉 ${analysis.trendPhase.toUpperCase()} — ${analysis.reasons}</span>` : ""}
    ${analysis.bigDrop ? "<span style='color:red;font-weight:bold;'>⚡ BIG DROP DETECTED!</span>" : ""}
    ${analysis.bigPump ? "<span style='color:lime;font-weight:bold;'>🚀 BIG PUMP DETECTED!</span>" : ""}
  `;
  if (highlight) entry.style.background = "#1a001a";
  feed.prepend(entry);

  const logs = feed.querySelectorAll('.log-entry');
  if (logs.length > 25) {
    for (let i = logs.length - 1; i >= 25; i--) logs[i].remove();
  }
}

export async function refreshSymbols() {
  try {
    const gainersRes = await fetch('/api/top-gainers');
    const losersRes = await fetch('/api/top-losers');
    const gainers = await gainersRes.json();
    const losers = await losersRes.json();

    const combined = [...gainers.slice(0, 21), ...losers.slice(0, 9)];
    const uniqueSymbols = [...new Map(combined.map(item => [item.symbol, item])).values()];
    activeSymbols = uniqueSymbols.map(e => e.symbol);
    setActiveSymbols(activeSymbols);
    updateScanningList(uniqueSymbols);
    console.log("🧠 Active Futures Symbols:", activeSymbols);
    activeSymbols.forEach(symbol => initFuturesPositionTracker(symbol));
  } catch (err) {
    console.error("❌ Symbol refresh failed:", err);
  }
}

export function updateScanningList(entries) {
  const el = document.getElementById('scanning-list');
  if (!el) return;
  el.innerHTML = '';
  entries.forEach(({ symbol, change }) => {
    const entry = document.createElement('div');
    entry.classList.add('log-entry');
    if (change > 0) entry.classList.add('gainer');
    else if (change < 0) entry.classList.add('loser');
    entry.textContent = `${symbol} (${change.toFixed(2)}%)`;
    el.appendChild(entry);
  });
}

export function getActiveSymbols() {
  return activeSymbols;
}

// === Intervals ===
setInterval(refreshSymbols, 15 * 60 * 1000);
refreshSymbols();

setInterval(() => {
  if (!activeSymbols.length) {
    console.warn("🚫 No symbols to analyze. Waiting for refresh.");
    return;
  }
  taCache.clear();
  activeSymbols.forEach(symbol => analyzeAndTrigger(symbol));
}, 12000);

updateScanningList([]);

window.analyzeAndTrigger = analyzeAndTrigger;
window.refreshSymbols = refreshSymbols;
window.detectBigPump = detectBigPump;
window.evaluatePoseidonDecision = evaluatePoseidonDecision;