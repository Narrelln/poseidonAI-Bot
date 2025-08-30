// bootstrap/cycleBootstrap.js  (CommonJS)
const { startCycleWatcherServer, getCycleWatcherStatus, stopCycleWatcher } =
  require('../handlers/cycleWatcher');

let booted = false;

async function bootCycleWatcher() {
  if (booted) return;
  booted = true;

  try {
    const status = await startCycleWatcherServer([]); // empty → auto-pick majors/memes
    console.log('[cycle] started:', status);
  } catch (e) {
    booted = false;
    console.warn('[cycle] start failed:', e?.message || e);
    return;
  }

  // lightweight heartbeat
  setTimeout(async () => {
    try {
      const s = await getCycleWatcherStatus();
      console.log('[cycle] heartbeat:', s);
    } catch (_) {}
  }, 8000);

  // graceful stop on shutdown signals
  const stop = async (sig) => {
    try {
      const s = await stopCycleWatcher();
      console.log(`[cycle] stopped on ${sig}:`, s);
    } catch (e) {
      console.warn('[cycle] stop failed:', e?.message || e);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

module.exports = { bootCycleWatcher };