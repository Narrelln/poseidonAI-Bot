// === futuresSignalModule.js — Signal Engine with Scanner Loop ===

import { fetchFuturesPrice, fetchVolumeAndOI } from './futuresApi.js';
import { evaluatePoseidonDecision } from './futuresDecisionEngine.js';
import { isBotActive } from './poseidonBotModule.js';
import { detectTrendPhase } from './trendPhaseDetector.js';
import { getActiveSymbols, refreshSymbols } from './poseidonScanner.js';

const MAX_VOLUME_CAP = 20_000_000;
const taCache = new Map();
const lastSignalLogTimestamps = new Map();

let scanIndex = 0;
let scanInterval; // 🆕 Added scan loop tracker

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

  try {
    const { volume } = await fetchVolumeAndOI(symbol);
    const vol = parseFloat(volume) || 0;
    if (vol > MAX_VOLUME_CAP) return;

    const trendPhase = await detectTrendPhase(symbol);
    if (['peak', 'reversal'].includes(trendPhase.phase)) {
      const analysis = {
        macdSignal: "Sell",
        bbSignal: "Breakdown",
        volumeSpike: true,
        confidence: 98,
        bigDrop: true,
        bigPump: false,
        manual: options.manual || false,
        trendPhase: trendPhase.phase,
        reasons: trendPhase.reasons.join(', ')
      };
      logSignalToFeed(symbol, analysis, true);
      await evaluatePoseidonDecision(symbol, analysis);
      return;
    }

    const bigDrop = await detectBigDrop(symbol);
    if (bigDrop) {
      const analysis = {
        macdSignal: "Sell",
        bbSignal: "Breakdown",
        volumeSpike: true,
        confidence: 99,
        bigDrop: true,
        bigPump: false,
        manual: options.manual || false
      };
      logSignalToFeed(symbol, analysis, true);
      await evaluatePoseidonDecision(symbol, analysis);
      return;
    }

    const bigPump = await detectBigPump(symbol);
    if (bigPump) {
      const analysis = {
        macdSignal: "Buy",
        bbSignal: "Breakout",
        volumeSpike: true,
        confidence: 99,
        bigDrop: false,
        bigPump: true,
        manual: options.manual || false
      };
      logSignalToFeed(symbol, analysis, true);
      await evaluatePoseidonDecision(symbol, analysis);
      return;
    }

    const ta = await fetchTA(symbol);
    let macdSignal = 'Sell', bbSignal = 'None', volumeSpike = false;

    if (ta) {
      if (ta.macd?.signal) macdSignal = ta.macd.signal === 'bullish' ? 'Buy' : 'Sell';
      if (ta.bb?.breakout !== undefined) bbSignal = ta.bb.breakout ? 'Breakout' : 'None';
      volumeSpike = !!ta.volumeSpike;
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
    const percentDrop = ((history[0] - price) / history[0]) * 100;
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
    const percentPump = ((price - history[0]) / history[0]) * 100;
    return percentPump > 12;
  } catch (err) {
    console.warn(`⚡ Big pump check failed for ${symbol}:`, err.message);
    return false;
  }
}

function logSignalToFeed(symbol, analysis, highlight = false) {
  const now = Date.now();
  if (now - (lastSignalLogTimestamps.get(symbol) || 0) < 30000) return;
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

// === 🆕 Start signal engine loop ===
export function startSignalEngine() {
  if (scanInterval) return;
  refreshSymbols();
  setInterval(refreshSymbols, 15 * 60 * 1000);
  scanInterval = setInterval(() => {
    const symbols = getActiveSymbols();
    if (!symbols.length) return;
    const symbol = symbols[scanIndex % symbols.length];
    analyzeAndTrigger(symbol);
    scanIndex++;
  }, 5000);
}

// === Dev Window Bindings ===
window.analyzeAndTrigger = analyzeAndTrigger;
window.detectBigPump = detectBigPump;
window.evaluatePoseidonDecision = evaluatePoseidonDecision;