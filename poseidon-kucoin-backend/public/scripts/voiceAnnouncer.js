// /public/scripts/voiceAnnouncer.js
// Poseidon Voice Announcer (pro edition)
// - Smart voice selection (prefers premium neural voices if present)
// - Safe queueing (no overlap), optional interrupt
// - De-duplication (ignore repeated lines within a short window)
// - User controls: enable/mute, rate, pitch, volume, voice override
// - Settings persisted in localStorage

(function () {
  if (!('speechSynthesis' in window)) {
    console.warn('[Announcer] Web Speech API not supported in this browser.');
    window.Announcer = {
      enabled: false,
      speak: () => {},
      setEnabled: () => {},
      setRate: () => {},
      setPitch: () => {},
      setVolume: () => {},
      setVoiceByName: () => {},
      listVoices: () => [],
      getSettings: () => ({ enabled: false }),
    };
    return;
  }

  // ---------- persistence ----------
  const LS_KEY = 'POSEIDON_TTS_SETTINGS';
  const defaults = {
    enabled: true,
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voiceName: '',          // empty => auto-pick best
    dedupeWindowMs: 4000,   // ignore identical phrase within this window
  };
  function loadSettings() {
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem(LS_KEY)) || {}) }; }
    catch { return { ...defaults }; }
  }
  function saveSettings() { localStorage.setItem(LS_KEY, JSON.stringify(settings)); }

  let settings = loadSettings();

  // ---------- voice selection ----------
  const preferredExact = [
    // Edge/Chrome (Azure online voices)
    'Microsoft Aria Online (Natural)',
    'Microsoft Jenny Online (Natural)',
    'Microsoft Guy Online (Natural)',
    'Microsoft Davis Online (Natural)',
    // Legacy Azure names
    'Microsoft Jenny (Natural)',
    'Microsoft Aria (Natural)',
    // macOS / iOS high quality
    'Siri Voice 4',
    'Siri Voice 3',
    'Samantha',
    'Alex',
    'Ava (Enhanced)',
  ];
  const preferredContains = [
    'Jenny', 'Aria', 'Guy', 'Davis', 'Neural', 'Natural', 'Siri', 'Samantha', 'Alex', 'Ava'
  ];

  let VOICES = [];
  let currentVoice = null;
  let voicesReady = false;
  let voicesWaiters = [];

  function resolveBestVoice() {
    const list = VOICES;
    if (!list || !list.length) return null;

    // explicit user override
    if (settings.voiceName) {
      const exact = list.find(v => v.name === settings.voiceName);
      if (exact) return exact;
      const loose = list.find(v => v.name.toLowerCase().includes(settings.voiceName.toLowerCase()));
      if (loose) return loose;
    }

    // exact preferred names
    for (const name of preferredExact) {
      const m = list.find(v => v.name === name);
      if (m) return m;
    }
    // partial matches
    for (const part of preferredContains) {
      const m = list.find(v => v.name.includes(part));
      if (m) return m;
    }
    // language preference fallback (en first)
    const en = list.find(v => (v.lang || '').toLowerCase().startsWith('en'));
    if (en) return en;

    // last resort: first voice
    return list[0];
  }

  function setVoice(voice) {
    currentVoice = voice || resolveBestVoice();
  }

  function onVoicesChanged() {
    VOICES = window.speechSynthesis.getVoices() || [];
    setVoice(resolveBestVoice());
    voicesReady = true;
    // flush waiters
    voicesWaiters.forEach(fn => { try { fn(); } catch {} });
    voicesWaiters = [];
    console.info('[Announcer] Loaded', VOICES.length, 'voices. Using:', currentVoice && currentVoice.name);
  }

  // Some browsers fire voices asynchronously
  window.speechSynthesis.onvoiceschanged = onVoicesChanged;
  // Kick once in case they’re already there
  setTimeout(onVoicesChanged, 0);

  function waitForVoices() {
    return new Promise(resolve => {
      if (voicesReady) return resolve();
      voicesWaiters.push(resolve);
      // give up after 2s but still let it speak with default
      setTimeout(resolve, 2000);
    });
  }

  // ---------- queue & de-dupe ----------
  const q = [];
  let speaking = false;
  const lastSaid = new Map(); // text -> timestamp

  function canSay(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    const last = lastSaid.get(t) || 0;
    const now = Date.now();
    if (now - last < settings.dedupeWindowMs) return false;
    lastSaid.set(t, now);
    return true;
  }

  function playNext() {
    if (!settings.enabled) { q.length = 0; speaking = false; return; }
    if (speaking) return;
    const item = q.shift();
    if (!item) { speaking = false; return; }
    speaking = true;

    const utter = new SpeechSynthesisUtterance(item.text);
    utter.rate = settings.rate;
    utter.pitch = settings.pitch;
    utter.volume = settings.volume;
    if (currentVoice) utter.voice = currentVoice;
    // Safety: prefer English if unknown
    if (!utter.lang && currentVoice && currentVoice.lang) utter.lang = currentVoice.lang;

    utter.onend = () => { speaking = false; // slight delay to avoid chop
      setTimeout(playNext, 50);
    };
    utter.onerror = (e) => {
      console.warn('[Announcer] TTS error:', e.error);
      speaking = false;
      setTimeout(playNext, 50);
    };

    try {
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn('[Announcer] speak() failed:', e.message);
      speaking = false;
      setTimeout(playNext, 50);
    }
  }

  // ---------- public API ----------
  async function speak(text, opts = {}) {
    if (!settings.enabled) return;
    await waitForVoices();

    const s = String(text || '').trim();
    if (!s) return;

    // interrupt mode (for urgent alerts)
    if (opts.interrupt) {
      window.speechSynthesis.cancel();
      q.length = 0;
      speaking = false;
      // small pause to ensure previous is cleared
      await new Promise(r => setTimeout(r, 20));
    }

    if (!opts.allowDuplicates && !canSay(s)) return;

    q.push({ text: s });
    playNext();
  }

  function setEnabled(on) { settings.enabled = !!on; saveSettings();
    if (!on) { window.speechSynthesis.cancel(); q.length = 0; speaking = false; }
  }
  function toggleEnabled() { setEnabled(!settings.enabled); }
  function setRate(v)   { const n = Number(v); if (n > 0 && n <= 3) { settings.rate = n; saveSettings(); } }
  function setPitch(v)  { const n = Number(v); if (n >= 0 && n <= 2) { settings.pitch = n; saveSettings(); } }
  function setVolume(v) { const n = Number(v); if (n >= 0 && n <= 1) { settings.volume = n; saveSettings(); } }

  function setVoiceByName(name) {
    if (!VOICES.length) return;
    const exact = VOICES.find(v => v.name === name);
    const loose = exact || VOICES.find(v => v.name.toLowerCase().includes(String(name).toLowerCase()));
    if (loose) {
      settings.voiceName = loose.name;
      saveSettings();
      setVoice(loose);
      return true;
    }
    return false;
  }

  function listVoices() {
    return (VOICES || []).map(v => ({ name: v.name, lang: v.lang, default: v.default || false }));
  }

  function getSettings() { return { ...settings, voice: currentVoice && currentVoice.name }; }

  // Optional global shortcuts for DevTools:
  window.Announcer = {
    speak, setEnabled, toggleEnabled, setRate, setPitch, setVolume,
    setVoiceByName, listVoices, getSettings,
    enabled: settings.enabled,
  };

  // ---------- Auto-tune defaults for trading UIs ----------
  // If your page sets a preferred voice via global, we respect it:
  if (window.POSEIDON_TTS_VOICE) {
    waitForVoices().then(() => setVoiceByName(window.POSEIDON_TTS_VOICE));
  }

  // Light sanity logs
  console.info('[Announcer] Ready. Enabled:', settings.enabled, 'Rate:', settings.rate, 'Pitch:', settings.pitch);

})();

// Bridge the announcer to your UI and audit bus (with picker + cycling)
(function () {
  const BTN_ID = 'voice-toggle';
  const PICKER_ID = 'voice-picker';

  const qs = (id) => document.getElementById(id);

  function setBtn(on) {
    const btn = qs(BTN_ID);
    if (!btn) return;
    btn.textContent = `Voice: ${on ? 'ON' : 'OFF'}`;
    btn.classList.toggle('on', !!on);
  }

  function getVoiceList() {
    try { return window.Announcer?.listVoices?.() || []; } catch { return []; }
  }

  function selectVoiceByName(name) {
    const ok = window.Announcer?.setVoiceByName?.(name);
    if (ok) {
      localStorage.setItem('POSEIDON_TTS_SETTINGS_OVERRIDE', name);
      // tiny test line
      window.Announcer?.speak?.(`Selected voice: ${name}`, { interrupt: true, allowDuplicates: true });
    }
    return ok;
  }

  function cycleVoice(direction = 1) {
    const voices = getVoiceList();
    if (!voices.length) return;

    const cur = window.Announcer?.getSettings?.().voice || '';
    const idx = Math.max(0, voices.findIndex(v => v.name === cur));
    const next = voices[(idx + direction + voices.length) % voices.length];
    if (next) {
      selectVoiceByName(next.name);
      const sel = qs(PICKER_ID);
      if (sel) sel.value = next.name;
    }
  }

  function buildVoicePicker() {
    // inject a <select> next to #voice-toggle
    const btn = qs(BTN_ID);
    if (!btn || qs(PICKER_ID)) return;

    const wrap = btn.parentElement || btn.closest('.dock') || btn;
    const sel = document.createElement('select');
    sel.id = PICKER_ID;
    sel.style.marginLeft = '8px';
    sel.style.pointerEvents = 'auto'; // parent has pointer-events:none in your dock
    sel.title = 'Choose a voice';

    const voices = getVoiceList();
    sel.innerHTML = voices.map(v => `<option value="${v.name}">${v.name} ${v.default ? '•' : ''}</option>`).join('');

    // try persisted override first
    const override = localStorage.getItem('POSEIDON_TTS_SETTINGS_OVERRIDE');
    const current = override || (window.Announcer?.getSettings?.().voice || '');
    if (current) sel.value = current;

    sel.addEventListener('change', () => {
      selectVoiceByName(sel.value);
    });

    // add a quick preview on double-click
    sel.addEventListener('dblclick', () => {
      window.Announcer?.speak?.('Previewing this voice.');
    });

    wrap.insertBefore(sel, btn.nextSibling);
  }

  function announceHello() {
    try { window.Announcer?.speak?.('Poseidon voice online.', { interrupt: true }); } catch {}
  }

  function initToggle() {
    const btn = qs(BTN_ID);
    if (!btn) return;

    // Click toggles on/off; Shift+Click cycles the voice
    btn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        cycleVoice(+1);
        return;
      }
      const was = !!window.Announcer?.getSettings?.().enabled;
      window.Announcer?.setEnabled?.(!was);
      const now = !!window.Announcer?.getSettings?.().enabled;
      setBtn(now);
      if (now) announceHello();
    });

    const enabled = !!window.Announcer?.getSettings?.().enabled;
    setBtn(enabled);
    if (enabled) announceHello();
  }

  // Map Poseidon events → phrases (kept same)
  function speakForEvent(detail) {
    if (!detail) return;
    const { event, symbol, side, confidence, price, reason } = detail;
    const base = String(symbol || '').replace(/-USDTM$/,'');
    const conf = (confidence != null) ? `, ${Math.round(confidence)} percent` : '';

    switch (event) {
      case 'analysis':
        if (window.POSEIDON_FEED_TRACE) window.Announcer?.speak?.(`${base} analysis updated`);
        break;
      case 'decision':
        window.Announcer?.speak?.(`Candidate: ${base}${conf}`);
        break;
      case 'placed':
      case 'executed':
        window.Announcer?.speak?.(
          `Trade ${side && side.toLowerCase()==='sell' ? 'short' : 'long'} ${base} opened at ${Number(price).toFixed(4)}`
        );
        break;
      case 'tp': window.Announcer?.speak?.(`${base} take profit hit`); break;
      case 'sl': window.Announcer?.speak?.(`${base} stop loss hit`); break;
      case 'warning': window.Announcer?.speak?.(`${base} warning: ${reason || 'check chart'}`, { interrupt: true }); break;
      case 'closed': window.Announcer?.speak?.(`${base} position closed`); break;
      default: break;
    }
  }

  function initAuditBus() {
    window.addEventListener('poseidon:signal', (e) => { try { speakForEvent(e.detail); } catch {} });
  }

  // Boot once DOM is ready; build picker after voices load
  document.addEventListener('DOMContentLoaded', () => {
    initToggle();
    initAuditBus();

    // wait a tick for the announcer to load voices, then build the picker
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const voices = getVoiceList();
      if (voices.length || tries > 40) {
        clearInterval(t);
        if (voices.length) buildVoicePicker();
      }
    }, 100); // up to ~4s
  });

  // Dev helpers
  window.Announcer = Object.assign(window.Announcer || {}, {
    cycleVoices: cycleVoice,
    preview: (text='This is a preview.') => window.Announcer?.speak?.(text, { interrupt: true, allowDuplicates: true }),
  });
})();