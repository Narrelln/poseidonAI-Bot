/* Single source of truth for Poseidon "Bot ON/OFF"
   - GET  /api/bot         -> { enabled }
   - POST /api/bot {enabled:true|false}
   What it flips when enabled:
     • globalThis.__POSEIDON_AUTO_PLACE          (evaluator & FE read this)
     • globalThis.__POSEIDON_BOT_ENABLED         (alias used by some modules)
     • process.env.POSEIDON_ALLOW_EXECUTION='true'  (hard env gate)
     • Emits socket event 'poseidon:bot' {enabled}
     • (Optional) ensure watchers are running if server owns them
*/

const express = require('express');
const router = express.Router();

const io = globalThis.__POSEIDON_IO__;
const DISABLE_SERVER_WATCHERS =
  String(process.env.DISABLE_SERVER_WATCHERS || 'false').toLowerCase() === 'true';

// In‑memory state (survives while process lives)
let BOT_ENABLED = (() => {
  const envDefault = String(process.env.BOT_ENABLED_DEFAULT || 'true').toLowerCase() === 'true';
  const pre = !!(globalThis && (globalThis.__POSEIDON_AUTO_PLACE || globalThis.__POSEIDON_BOT_ENABLED));
  return pre || envDefault;
})();

// Reflect initial state on boot to all flags
globalThis.__POSEIDON_AUTO_PLACE  = BOT_ENABLED;
globalThis.__POSEIDON_BOT_ENABLED = BOT_ENABLED;
if (BOT_ENABLED) process.env.POSEIDON_ALLOW_EXECUTION = 'true';

function broadcast(enabled) {
  try { io?.emit?.('poseidon:bot', { enabled }); } catch {}
}

async function ensureWatchersIfServerOwns() {
  if (DISABLE_SERVER_WATCHERS) return; // Autopilot owns them
  try {
    const { bootCycleWatcher } = require('../bootstrap/cycleBootstrap');
    if (typeof bootCycleWatcher === 'function') bootCycleWatcher();
  } catch (e) {
    console.warn('[botRoutes] cycle bootstrap skipped:', e?.message || e);
  }
  try {
    const { bootReversalWatcher } = require('../bootstrap/reversalBootstrap');
    if (typeof bootReversalWatcher === 'function') bootReversalWatcher();
  } catch {}
}

// --- GET status
router.get('/bot', (_req, res) => {
  // Trust the live flags if someone toggled elsewhere
  const live =
    !!(globalThis && (globalThis.__POSEIDON_AUTO_PLACE || globalThis.__POSEIDON_BOT_ENABLED)) ||
    String(process.env.POSEIDON_ALLOW_EXECUTION || 'false').toLowerCase() === 'true' ||
    !!BOT_ENABLED;
  BOT_ENABLED = live;
  res.json({ ok: true, enabled: live });
});

// --- POST toggle
router.post('/bot', async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    BOT_ENABLED = enabled;

    // Flip ALL execution/placement gates, once and for all:
    globalThis.__POSEIDON_AUTO_PLACE  = enabled;
    globalThis.__POSEIDON_BOT_ENABLED = enabled;
    process.env.POSEIDON_ALLOW_EXECUTION = enabled ? 'true' : 'false';

    console.log(`[botRoutes] Bot → ${enabled ? 'ON' : 'OFF'}`);
    broadcast(enabled);

    if (enabled) await ensureWatchersIfServerOwns();

    res.json({ ok: true, enabled });
  } catch (e) {
    console.error('[botRoutes] toggle error:', e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message || 'toggle_failed') });
  }
});

module.exports = router;