// /scripts/signalQaToggle.js
const BTN   = document.getElementById('qa-mode-toggle');
const BADGE = document.getElementById('qa-mode-badge');

function getMode() {
  return (localStorage.getItem('POSEIDON_QA_MODE') || 'test').toLowerCase();
}
function setMode(mode) {
  mode = (mode === 'real' ? 'real' : 'test');
  localStorage.setItem('POSEIDON_QA_MODE', mode);
  window.SIGNAL_QA_MODE = mode;
  BADGE.textContent = mode.toUpperCase();
  BADGE.classList.toggle('real', mode === 'real');
  BTN.textContent = mode === 'real' ? 'Switch to TEST' : 'Switch to REAL';
  // notify the auditor to switch horizons
  window.dispatchEvent(new CustomEvent('poseidon:qa-mode', { detail: { mode } }));
}

// init
setMode(getMode());

// click handler
BTN?.addEventListener('click', () => {
  setMode(getMode() === 'real' ? 'test' : 'real');
});