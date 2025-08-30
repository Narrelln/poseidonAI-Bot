// silenceTraceLogs.js — load this BEFORE other scripts
(() => {
    const origLog   = console.log;
    const origInfo  = console.info;
    const origDebug = console.debug;
  
    // Any prefixes you want to squelch
    const MUTES = [
      '[TRACE] DOM insert',
      '[TRACE] observing',
      '[TRACE]',
    ];
  
    const shouldMute = (firstArg) =>
      typeof firstArg === 'string' && MUTES.some(p => firstArg.startsWith(p));
  
    console.log = function (...args) {
      if (shouldMute(args[0])) return;
      return origLog.apply(this, args);
    };
    console.info = function (...args) {
      if (shouldMute(args[0])) return;
      return origInfo.apply(this, args);
    };
    console.debug = function (...args) {
      if (shouldMute(args[0])) return;
      return origDebug.apply(this, args);
    };
  })();