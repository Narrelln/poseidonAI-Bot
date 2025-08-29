// backend/utils/botStatus.js
let active = false;
let lastToggle = 0;

function isBotActive() { return active; }
function setBotActive(v) {
  active = !!v;
  lastToggle = Date.now();
  return { active, lastToggle };
}

module.exports = { isBotActive, setBotActive, getBotState: () => ({ active, lastToggle }) };