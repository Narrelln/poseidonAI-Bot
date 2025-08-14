// /public/scripts/voiceAnnouncer.js
// Voice announcements for Poseidon events (opens/closes/TP feed)

const synth = window.speechSynthesis;
const QUEUE = [];
let speaking = false;

const STORE_KEY = 'poseidon_voice_enabled';
let enabled = JSON.parse(localStorage.getItem(STORE_KEY) || 'true'); // default ON

function speakNow(text) {
  if (!synth || !enabled) return;
  const u = new SpeechSynthesisUtterance(String(text));
  u.rate = 1.0;   // slower? 0.95–1.0
  u.pitch = 1.0;  // neutral
  u.onend = () => { speaking = false; flush(); };
  synth.speak(u);
}

function flush() {
  if (speaking || !QUEUE.length || !enabled) return;
  speaking = true;
  const text = QUEUE.shift();
  speakNow(text);
}

function say(text) {
  if (!text) return;
  // prevent spammy duplicates in a short window
  const last = say._last || { t: 0, msg: '' };
  const now = Date.now();
  if (last.msg === text && now - last.t < 2500) return;
  say._last = { t: now, msg: text };

  QUEUE.push(text);
  flush();
}

// --- UI toggle (small floating button) ---
function mountToggle() {
  const id = 'poseidon-voice-toggle';
  if (document.getElementById(id)) return;

  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = enabled ? '🔊 Voice: ON' : '🔇 Voice: OFF';
  Object.assign(btn.style, {
    position: 'fixed', right: '16px', bottom: '16px',
    padding: '6px 10px', background: '#0b2a3a', color: '#aef',
    border: '1px solid #135', borderRadius: '8px', fontFamily: 'monospace',
    zIndex: 9999, cursor: 'pointer'
  });
  btn.onclick = () => {
    enabled = !enabled;
    localStorage.setItem(STORE_KEY, JSON.stringify(enabled));
    btn.textContent = enabled ? '🔊 Voice: ON' : '🔇 Voice: OFF';
    if (enabled) flush();
  };
  document.body.appendChild(btn);
}

// --- Wire to socket events ---
function wireSockets() {
  if (!window.io) return;
  const socket = window.io();

  // When an order is submitted from UI
  socket.on('trade-pending', (d) => {
    const s = d?.contract || d?.symbol || '—';
    const side = (d?.side || '').toString().toUpperCase();
    const lev = d?.leverage ? `${d.leverage}x` : '';
    say(`Submitting ${side} on ${s} ${lev}`);
  });

  // When exchange accepted (you already emit this)
  socket.on('trade-confirmed', (d) => {
    const s = d?.symbol || d?.contract || '—';
    const side = (d?.side || '').toString().toUpperCase();
    const lev = d?.leverage ? `${d.leverage}x` : '';
    say(`Order accepted for ${s}. ${side}. Leverage ${lev}.`);
  });

  // 🔵 NEW: speak on close result (your close route already emits 'trade-closed')
  socket.on('trade-closed', (d) => {
    const s = d?.contract || '—';
    const pnl = d?.pnl ?? '';
    const roi = d?.pnlPercent ? d.pnlPercent.replace('%',' percent') : '';
    say(`Closed ${s}. P and L ${pnl}. ROI ${roi}.`);
  });

  // Optional: if you later emit a generic TP feed bus line
  socket.on('tp-feed', (e) => {
    // e.g. {state:'TP1_TAKEN'|'SL_HIT'|'TRAIL_EXIT'...' , text:'...'}
    if (!e?.state || !e?.text) return;
    // Keep it short for voice:
    if (e.state === 'TP1_TAKEN') say(`Take profit one reached on ${e.contract}.`);
    else if (e.state === 'SL_HIT') say(`Stop loss hit on ${e.contract}.`);
    else if (e.state === 'TRAIL_EXIT') say(`Trailing stop exit on ${e.contract}.`);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  mountToggle();
  wireSockets();
});

// Export in case other modules want to speak
export { say };