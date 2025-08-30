// /public/scripts/funTemplates.js
// 50+ spicy communicative templates for Live Futures Feed

// ===== FUN TEMPLATES =====
const tradeOpenTemplates = [
    `🟢 \${sym} entered @ \${entry} — Poseidon just pulled the trigger 🎯`,
    `⚡ \${sym} live trade ON! Entry \${entry}, leverage \${lev}x 🚀`,
    `🤖 \${sym} activated — AI sniper in hunting mode 🐺`,
    `🔥 \${sym} moving — position secured, let's ride 🎢`,
    `🎯 Entry locked: \${sym} @ \${entry}, aiming sky-high 🌕`,
    `💥 \${sym} launched — let's break the chains ⛓️`,
    `🚀 \${sym} liftoff confirmed — boosters engaged 🔥`,
    `🎮 \${sym} in play — Poseidon pressed START ▶️`,
    `🌊 \${sym} wave caught — surfing trend now 🏄`,
    `🛡️ \${sym} fortress built @ \${entry}, holding the line ⚔️`,
  ];
  
  const tpTemplates = [
    `🎉 \${sym} TP1 hit (+\${roi}%) — pockets smiling 😎💸`,
    `💎🙌 \${sym} TP2 cleared — profits raining ☔`,
    `🔥 \${sym} TP3 maxed out — Poseidon screaming MOON 🚀🌕`,
    `📈 \${sym} booked TP at \${price}, stacking gains 🏦`,
    `🍾 \${sym} took partials, celebrating with champagne 🥂`,
    `🏆 \${sym} crushed target, leaderboard updated 🏅`,
    `💰 \${sym} locked profits in the vault 🏦🔑`,
    `✨ \${sym} shining bright — TP milestone hit 🌟`,
    `🥇 \${sym} gold medal trade — victory dance 💃`,
    `🚪 \${sym} walked through profit gate — next stage ahead ➡️`,
  ];
  
  const slTemplates = [
    `🥶 \${sym} clipped at SL — regrouping now…`,
    `💔 \${sym} rejected @ \${price}, bears laughing 🐻😂`,
    `⚠️ \${sym} lost momentum — off the hotlist 🚫`,
    `😵 \${sym} knocked out at stop loss — reset incoming 🔄`,
    `🩸 \${sym} took a hit, bleeding out 💔`,
    `👻 \${sym} vanished from radar — SL closed it down`,
    `🛑 \${sym} forced exit — Poseidon pulled the brakes ⛔`,
    `🪦 \${sym} R.I.P. trade — stopped at \${price} ⚰️`,
    `🎭 \${sym} fakeout tricked us — stop triggered 🎭`,
    `📉 \${sym} fell through trapdoor — SL saved the wallet 🪂`,
  ];
  
  const cycleTemplates = [
    `🕰️ Majors cooling — rest hour active 💤 resuming soon ⏳`,
    `🌪️ \${sym} volatility watch — buckle up 🎢`,
    `🔄 \${sym} shifting gears — trend reversal in play 🔁`,
    `🌙 \${sym} under quiet hours — waiting for breakout 🌌`,
    `⚡ \${sym} heating up again — cycle restart 🔥`,
    `🚦 \${sym} green light flashing — cycle resuming ✅`,
    `📊 \${sym} recalibrating — cycle meter resetting ♻️`,
    `🌞 Morning cycle warming up — \${sym} stretching 🧘`,
    `🌑 Night cycle active — \${sym} moving silently 🌃`,
    `🎯 \${sym} pinged back on radar — cycle confirmed 📡`,
  ];
  
  const narrativeTemplates = [
    `🐋 Whale alert: \${sym} volume spike spotted 👀`,
    `📜 Legends whisper patience — \${sym} still brewing 🍵`,
    `🤡 Market clowning again — \${sym} fakeout party 🎭`,
    `🐂 Bulls flexing — \${sym} looking unstoppable 💪`,
    `🐻 Bears scheming — \${sym} struggling under pressure 😤`,
    `🎮 \${sym} entering God mode cheat codes 🎮🚀`,
    `🧩 Puzzle forming — \${sym} trend piece falling in place 🧠`,
    `🦅 \${sym} eagle-eye breakout forming, wings spread 🪽`,
    `🏰 \${sym} building castle walls at \${price} 🏰`,
    `🎆 \${sym} fireworks incoming — sentiment turning hot 🔥`,
  ];
  
  // --- FIX: escape $ and braces in the regex ---
  function fill(tpl, data = {}) {
    return tpl
      .replace(/\$\{sym\}/g,   String(data.sym   ?? '???'))
      .replace(/\$\{entry\}/g, String(data.entry ?? '--'))
      .replace(/\$\{lev\}/g,   String(data.lev   ?? '1'))
      .replace(/\$\{roi\}/g,   String(data.roi   ?? '0'))
      .replace(/\$\{price\}/g, String(data.price ?? '--'));
  }
  
  export function pickRandomTemplate(event, data = {}) {
    let bucket;
    switch (event) {
      case 'trade_open': bucket = tradeOpenTemplates; break;
      case 'tp':         bucket = tpTemplates;        break;
      case 'sl':         bucket = slTemplates;        break;
      case 'cycle':      bucket = cycleTemplates;     break;
      case 'narrative':  bucket = narrativeTemplates; break;
      default:
        bucket = [
          ...tradeOpenTemplates, ...tpTemplates,
          ...slTemplates, ...cycleTemplates, ...narrativeTemplates
        ];
    }
    return fill(bucket[Math.floor(Math.random() * bucket.length)], data);
  }
  
  export function renderStory(evt = {}) {
    const sym   = (evt.symbol || evt.sym || 'SYSTEM').toUpperCase();
    const price = evt.data?.price     ?? evt.price     ?? '--';
    const entry = evt.data?.entry     ?? evt.entry     ?? '--';
    const lev   = evt.data?.leverage  ?? evt.lev       ?? evt.leverage ?? '1';
    const roi   = evt.data?.roi       ?? evt.roi       ?? '0';
  
    const type = String(evt.type || evt.category || '').toLowerCase();
    let bucket = 'narrative';
    if (type === 'trade')        bucket = 'trade_open';
    else if (type === 'tp')      bucket = 'tp';
    else if (type === 'sl')      bucket = 'sl';
    else if (type === 'ta' || type === 'scanner' || type === 'cycle') bucket = 'cycle';
  
    return pickRandomTemplate(bucket, { sym, price, entry, lev, roi });
  }
  
  export function renderSerious(ev = {}) {
    const ts   = new Date(ev.ts || Date.now()).toLocaleTimeString();
    const type = (ev.type || '').toLowerCase();
    const sym  = (ev.symbol || ev.sym || 'SYSTEM').toUpperCase();
    const d    = ev.data || {};
    const sig  = (d.signal || ev.msg || '').toString().toUpperCase();
  
    switch (type) {
      case 'trade':
        return `${ts} • ${sym}: position opened at ${d.entry ?? '--'} (lev ${d.leverage ?? d.lev ?? '--'}x).`;
      case 'tp':
        return `${ts} • ${sym}: take‑profit filled at ${d.price ?? '--'} (${d.roi ?? '--'}%).`;
      case 'sl':
        return `${ts} • ${sym}: stop loss triggered at ${d.price ?? '--'}.`;
      case 'decision':
        return `${ts} • ${sym}: decision → ${sig || 'UPDATE'}.`;
      case 'ta':
      case 'analysis':
        return `${ts} • ${sym}: analysis signal → ${sig || 'NEUTRAL'}.`;
      case 'cycle':
        return `${ts} • ${sym}: cycle update — ${ev.msg || d.phase || 'status changed'}.`;
      default:
        return `${ts} • ${sym}: ${ev.msg || 'event received'}.`;
    }
  }
  
  export function renderByMode(mode, ev) {
    return mode === 'serious' ? renderSerious(ev) : renderStory(ev);
  }