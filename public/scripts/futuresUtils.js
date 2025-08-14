// futuresUtils.js — Utility Functions for Poseidon Futures System

// === Unified Log to Main Feed ===
export function logToFeed(msg) {
  const feed = document.getElementById("futures-log-feed");
  if (!feed) return;

  const log = document.createElement("div");
  log.className = "log-entry";
  log.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  feed.insertBefore(log, feed.firstChild);

  if (feed.children.length > 25) {
    feed.removeChild(feed.lastChild);
  }
}

// === Log to Performance Panel ===
export function logToPerformanceFeed(message) {
  const panel = document.getElementById("futures-performance-panel");
  if (!panel) return;

  const el = document.createElement("div");
  el.className = "log-entry";
  el.style.fontSize = "12px";
  el.style.color = "#aaa";
  el.innerHTML = `${getTimestamp()} ${message}`;
  panel.appendChild(el);
}

// === Trace AI Decision Internally ===
export function logDecisionTrace(symbol, details) {
  const trace = `
🧠 TRACE for ${symbol}:
MACD: ${details.macdSignal}
BB: ${details.bbSignal}
Volume Spike: ${details.volumeSpike}
Confidence: ${details.confidence}%
  `;
  logToFeed(trace.trim());
}

// === Timestamp Helper ===
function getTimestamp() {
  const now = new Date();
  return `[${now.toLocaleTimeString()}]`;
}