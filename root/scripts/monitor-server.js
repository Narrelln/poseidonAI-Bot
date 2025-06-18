console.log('Poseidon Trade Monitor loaded');

const statUpdates = {
  'live-trades': 12,
  'avg-roi': '+37.5%',
  'top-token': '$DOGEY'
};

const walletUpdates = {
  'top-snipers': 'Groovy',
  'active-wallets': '28',
  'latest-entry': '$BLAST'
};

function updateStats() {
  for (const id in statUpdates) {
    const el = document.getElementById(id);
    if (el) el.textContent = statUpdates[id];
  }
  for (const id in walletUpdates) {
    const el = document.getElementById(id);
    if (el) el.textContent = walletUpdates[id];
  }
}

function simulateStats() {
  const liveTrades = Math.floor(Math.random() * 20) + 5;
  const avgROI = (Math.random() * 100 - 30).toFixed(2);
  const tokens = ["$DOGE", "$WIF", "$BLAST", "$CHEEMS", "$TOSHI", "$PUMP"];
  const topToken = tokens[Math.floor(Math.random() * tokens.length)];

  document.getElementById("live-trades").textContent = liveTrades;
  document.getElementById("avg-roi").textContent = `${avgROI}%`;
  document.getElementById("top-token").textContent = topToken;
}

function simulateLogFeed() {
  const log = document.getElementById("trade-log");
  const entry = document.createElement("div");
  entry.classList.add("log-entry");

  const messages = [
    "Smart Wallet BUY: $DOGE surged 12%",
    "Insider SELL: $WIF dropped -9%",
    "Whale just entered $TOSHI at 0.3 SOL",
    "Cupsey-style sniper entered $BLAST",
    "Bot swarm triggered $PUMP token at launch"
  ];

  const message = messages[Math.floor(Math.random() * messages.length)];
  const timestamp = `[${new Date().toLocaleTimeString()}]`;

  let badgeClass = '';
  let badgeLabel = '';

  if (message.includes("BUY")) {
    badgeClass = "badge-buy"; badgeLabel = "BUY";
  } else if (message.includes("SELL")) {
    badgeClass = "badge-sell"; badgeLabel = "SELL";
  } else if (message.includes("Whale")) {
    badgeClass = "badge-whale"; badgeLabel = "Whale";
  } else if (message.includes("Bot")) {
    badgeClass = "badge-bot"; badgeLabel = "Bot";
  } else if (message.includes("Insider")) {
    badgeClass = "badge-insider"; badgeLabel = "Insider";
  }

  entry.innerHTML = `${timestamp} <span class="badge ${badgeClass}">${badgeLabel}</span> ${message}`;
  log.prepend(entry);

  if (log.children.length > 20) {
    log.removeChild(log.lastChild);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  updateStats();
  simulateStats();
  simulateLogFeed();
  setInterval(simulateStats, 5000);
  setInterval(simulateLogFeed, 4000);
});