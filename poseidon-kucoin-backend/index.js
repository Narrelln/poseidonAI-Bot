// === Poseidon Backend Main Server ===
// [1] Express/bootstrap + single source of truth for /api/close-trade via handlers/closeTradeRoute
// [2] No direct app.post('/api/close-trade', closeFuturesPosition) mount anywhere else
// [3] /api/preview-order remains mounted directly (simple stateless preview)

require('dotenv').config();

const path     = require('path');
const http     = require('http');
const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// Help SSE stay alive on some proxies/hosts
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 66_000;

const PORT = process.env.PORT || 3000;

// Expose IO for modules that emit (e.g., tpSlMonitor)
globalThis.__POSEIDON_IO__ = io;

// === Ownership flag: let Autopilot own watchers when true ===
// Set DISABLE_SERVER_WATCHERS=true when you run Autopilot, so the server won't
// start Cycle/Reversal on its own (prevents double starts).
const DISABLE_SERVER_WATCHERS =
  String(process.env.DISABLE_SERVER_WATCHERS || 'false').toLowerCase() === 'true';
if (DISABLE_SERVER_WATCHERS) {
  console.log('[server] Watchers are disabled here (DISABLE_SERVER_WATCHERS=true). Autopilot owns them.');
}

// Optional: Reversal watcher HTTP routes, guarded by env
const USE_REVERSAL =
  String(process.env.USE_REVERSAL || 'false').toLowerCase() === 'true';
let reversalWatcherRoutes = null;
if (USE_REVERSAL) {
  try {
    reversalWatcherRoutes = require('./routes/reversalWatcherRoutes');
  } catch (e) {
    console.warn('[reversal] routes not found:', e?.message || e);
  }
}

// === Middleware & Static ===
app.use(cors());
app.use(express.json()); // sufficient; no need for body-parser

// serve client scripts/styles
app.use(
  '/scripts',
  express.static(path.join(__dirname, 'public', 'scripts'), {
    setHeaders: (res, p) => {
      if (p.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    },
  })
);
app.use('/styles', express.static(path.join(__dirname, 'styles')));
app.use(express.static(path.join(__dirname, 'public')));

// === Route Modules ===
const marketroutes                 = require('./routes/marketroutes.js');
const walletRoutes                 = require('./routes/walletRoutes');
const taRoutes                     = require('./routes/taRoutes');              // legacy bundle (mount AFTER custom TA)
const { router: scanTokenRouter }  = require('./routes/newScanTokens');
const positionNoteRoutes           = require('./routes/positionNoteRoutes');    // ✅ Notes API
const learningMemoryRoutes         = require('./routes/learningMemoryRoutes');  // ✅ Learning Memory
const tpStatusRoute                = require('./routes/tpStatusRoute');         // ✅ TP/SL snapshots API
const capitalRoute                 = require('./routes/capitalRoute');
const tradeLedgerRoute             = require('./routes/tradeLedgerRoute');      // ✅ ledger-first /api/trade-history
const sessionStatsRoute            = require('./routes/sessionStatsRoute');
const tokenWhitelistRoute          = require('./routes/tokenWhitelistRoute');
const cycleWatcherRoutes           = require('./routes/cycleWatcherRoutes');
const priceRoute                   = require('./routes/priceRoute');
const signalAuditRoutes            = require('./routes/signalAuditRoutes');
const botRoutes                    = require('./routes/botRoutes');
const { router: learningMemorySeederRoutes } = require('./routes/learningMemorySeeder');
const tradeRoutes                  = require('./routes/tradeRoutes');
const autoplaceRoutes              = require('./routes/autoPlace');
const { registerPatternRoutes }    = require('./routes/patternRoutes');
// ✅ NEW: rails verification routes
const verifyRailsRoutes            = require('./routes/verifyRailsRoutes');
const candleRoutes                 = require('./routes/candleRoutes');



// Handlers / APIs
const { registerOrderRoute } = require('./handlers/orderHandler');
const { registerCloseTradeRoute } = require('./handlers/closeTradeRoute');
const { registerConfirmRecoveryRoute } = require('./routes/confirmRecoveryRoute');
const { registerRSIReversalRoute } = require('./routes/rsiReversalRoute');
const { analyzeSymbol } = require('./handlers/taClient.js');
const { loadLearningMemory } = require('./handlers/learningMemory');
const { previewOrder } = require('./handlers/previewOrder');
const { kucoinGet } = require('./handlers/futuresApi');

// === Custom TA Route (MUST be before legacy taRoutes) ===
app.get('/api/ta/:symbol', async (req, res) => {
  try {
    const raw = req.params.symbol || '';
    const result = await analyzeSymbol(raw);

    if (!result || result.valid === false) {
      return res.status(400).json({
        nodata: true,
        error: result?._volumeGate
          ? `Volume gate: ${JSON.stringify(result._volumeGate)}`
          : (result?.reason || 'Invalid TA result'),
        ...(Number.isFinite(result?.quoteVolume) && { quoteVolume: result.quoteVolume }),
      });
    }

    res.json({ nodata: false, ...result });
  } catch (err) {
    console.error('❌ TA route error:', err.message);
    res.status(500).json({ nodata: true, error: 'Internal server error' });
  }
});

// === Register Routes (now mount others) ===
app.use('/api', priceRoute);
app.use('/api', marketroutes);
app.use('/api', walletRoutes);
app.use('/api', scanTokenRouter);
app.use('/api', positionNoteRoutes);
app.use('/api', tpStatusRoute);
app.use('/api', learningMemoryRoutes);
app.use('/api', learningMemorySeederRoutes);
app.use('/api', sessionStatsRoute);
app.use('/api', tokenWhitelistRoute);
app.use('/api', capitalRoute);
app.use('/api', cycleWatcherRoutes);
if (reversalWatcherRoutes) app.use('/api', reversalWatcherRoutes); // guarded
app.use('/api', signalAuditRoutes);      // ← mount once
app.use('/api', botRoutes);
app.use('/api', autoplaceRoutes);
app.use('/api', candleRoutes);


// ✅ NEW: rails verifier endpoints
app.use('/api', verifyRailsRoutes);

// ✅ Ledger-first trade history route mounted under /api
app.use('/api', tradeLedgerRoute);
app.use('/api', tradeRoutes);

// ⚠️ Legacy TA after custom TA
app.use('/api', taRoutes);

// Guarded (optional) strategy debug route
try {
  const { registerStrategyDebugRoute } = require('./routes/strategyDebugRoute');
  if (typeof registerStrategyDebugRoute === 'function') registerStrategyDebugRoute(app);
} catch {
  console.log('ℹ️ strategyDebugRoute not present — skipping');
}
// Strategy Health
app.use('/api', require('./routes/strategyHealthRoutes'));
// scheduler
app.use('/api', require('./routes/schedulerRoute'));

// exporter (guarded)
try {
  app.use('/api', require('./routes/signalAuditExport'));
  console.log('🧾 signalAuditExport mounted');
} catch (e) {
  console.log('ℹ️ signalAuditExport not mounted:', e?.message || e);
}

// [4] Stateless preview
app.post('/api/preview-order', previewOrder);

// Adaptive policy routes (guarded)
try {
  app.use('/api', require('./routes/policyRoutes'));
  console.log('🧠 policyRoutes mounted');
} catch (e) {
  console.log('ℹ️ policyRoutes not mounted:', e?.message || e);
}

// [5] Trade open/close mounts — close goes ONLY through the wrapper
registerOrderRoute(app, io);
registerCloseTradeRoute(app, io);
registerConfirmRecoveryRoute(app);
registerRSIReversalRoute(app);
registerPatternRoutes(app);
// === Feed routes (robust mounting) ==========================================
(function mountFeedRoutes() {
  let mounted = false;
  try {
    // Support either a register function or a router export
    const feedMod = require('./routes/feedRoutes.js');
    if (feedMod && typeof feedMod.registerFeedRoutes === 'function') {
      feedMod.registerFeedRoutes(app, io); // preferred
      mounted = true;
      console.log('📡 feedRoutes registered via registerFeedRoutes(app)');
    } else if (feedMod && feedMod.router) {
      app.use('/api', feedMod.router);
      mounted = true;
      console.log('📡 feedRoutes mounted via exported router');
    } else if (typeof feedMod === 'function') {
      // some versions export a bare router function
      app.use('/api', feedMod);
      mounted = true;
      console.log('📡 feedRoutes mounted via function export');
    }
  } catch (e) {
    console.warn('⚠️ feedRoutes module not found, falling back to inline feed endpoints:', e?.message || e);
  }

  // Fallback inline SSE + history using server/feedBus (so FE always works)
  if (!mounted) {
    try {
      const { bus, getBuffer } = require('./server/feedBus'); // <-- correct bus
      app.get('/api/feed/history', (req, res) => {
        const since = Number.parseInt(req.query.since || '0', 10);
        const items = getBuffer({ since: Number.isFinite(since) ? since : undefined });
        res.json({ items });
      });

      app.get('/api/feed/stream', (req, res) => {
        res.set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no'
        });

        // immediate hello so clients don’t stall
        res.write(`: connected ${Date.now()}\n\n`);

        const write = (item) => {
          try {
            res.write(`event: feed\n`);
            res.write(`data: ${JSON.stringify(item)}\n\n`);
          } catch { /* client closed */ }
        };

        // subscribe to the server bus
        const listener = (item) => write(item);
        bus.on('feed', listener);

        // keep-alive ping to keep proxies happy
        const ping = setInterval(() => {
          try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
        }, 25_000);

        req.on('close', () => {
          clearInterval(ping);
          bus.off('feed', listener);
          try { res.end(); } catch {}
        });
      });

      console.log('📡 Inline /api/feed/* endpoints mounted (fallback via server/feedBus)');
    } catch (e) {
      console.warn('⚠️ server/feedBus fallback unavailable; live feed limited to in-page events:', e?.message || e);
    }
  }
})();

// Load learning memory once server boots
loadLearningMemory();

// === KuCoin Utils (positions only, for UI & reconcilers) ===
const { getOpenFuturesPositions } = require('./kucoinHelper');

const {
  startCycleWatcherServer,
  stopCycleWatcher,
  getCycleWatcherStatus
} = require('./handlers/cycleWatcher');

// start
app.post('/api/start-cycle-watcher-server', async (req, res) => {
  try {
    const list = Array.isArray(req.body?.contracts) ? req.body.contracts : [];
    const status = await startCycleWatcherServer(list);
    res.json({ ok: true, status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// stop
app.post('/api/stop-cycle-watcher', (_req, res) => {
  const status = stopCycleWatcher();
  res.json({ ok: true, status });
});

// status
app.get('/api/cycle-watcher-status', (_req, res) => {
  res.json({ ok: true, status: getCycleWatcherStatus() });
});


// Pattern profile routes (backfill & inspect)
app.use('/api', verifyRailsRoutes);
try {
  const patternProfileRoutes = require('./routes/patternProfileRoutes');
  app.use('/api', patternProfileRoutes);
  console.log('📈 patternProfileRoutes mounted');
} catch (e) {
  console.log('ℹ️ patternProfileRoutes not mounted:', e?.message || e);
}

// =======================[ ✅ NEW: partial TP Manager wiring ]=======================
const partialTP = require('./handlers/partialTPManager');

partialTP.setConfig({
  ladder: { stepPct: 50, takeFraction: 0.25, maxSteps: 10 },
  trailDropPct: 0.25,
  minExitConfidence: 60,
  emitThrottleMs: 1200,
  minRemainderContracts: 0
});

(function registerPartialTPExecutors() {
  // optional local direct handlers (if you expose them)
  let reducePosition = null;
  let closePosition  = null;
  try {
    // If you have a central trade executor exposing these, we’ll prefer them.
    const exec = require('./handlers/tradeExecutor'); // optional
    reducePosition = typeof exec.reducePosition === 'function' ? exec.reducePosition : null;
    closePosition  = typeof exec.closePosition  === 'function' ? exec.closePosition  : null;
  } catch { /* optional */ }

  // Fallback to calling our own HTTP route if no direct handler is exposed
  const axios = require('axios');

  partialTP.registerExecutors({
    partialClose: async (symbol, qty) => {
      try {
        if (reducePosition) {
          return await reducePosition({ symbol, quantityContracts: qty, reduceOnly: true });
        }
        await axios.post(`http://localhost:${PORT}/api/close-trade`, {
          symbol,
          quantityContracts: qty,
          reduceOnly: true
        }, { timeout: 12_000 });
      } catch (e) {
        io.emit('feed', { kind: 'tp', symbol, msg: `⚠️ partialClose failed: ${e?.message || e}`, ts: Date.now() });
        throw e;
      }
    },
    closeAll: async (symbol) => {
      try {
        if (closePosition) {
          return await closePosition({ symbol });
        }
        await axios.post(`http://localhost:${PORT}/api/close-trade`, {
          symbol,
          closeAll: true
        }, { timeout: 12_000 });
      } catch (e) {
        io.emit('feed', { kind: 'tp', symbol, msg: `⚠️ closeAll failed: ${e?.message || e}`, ts: Date.now() });
        throw e;
      }
    },
    emitFeed: (payload) => {
      // normalized feed payload
      io.emit('feed', { ...payload, ts: payload?.ts || Date.now() });
    }
  });

  // Default config: 100% ROI TP1, take 25%, trail 20%, exit on reversal if conf < 60
  partialTP.setTPConfig({
    tp1RoiPct: Number(process.env.TP1_ROI_PCT || 100),
    tp1TakeFraction: Number(process.env.TP1_TAKE_FRACTION || 0.25),
    trailDropPct: Number(process.env.TP_TRAIL_DROP_PCT || 0.20),
    minExitConfidence: Number(process.env.TP_MIN_EXIT_CONF || 60),
    emitThrottleMs: 2500
  });
})();

// Fast 1s loop — push live positions into partialTP tracker (momentum-friendly)
(function startFastTPPulse() {
  const { initTPTracker, updateTPStatus } = partialTP;

  async function pulse() {
    try {
      const positions = await getOpenFuturesPositions(); // enriched (entry, mark, size, leverage, etc.)
      if (!Array.isArray(positions) || !positions.length) return;

      for (const p of positions) {
        const symbol = String(p.contract || p.symbol || '').toUpperCase();   // e.g., BTC-USDTM
        const side   = (p.side || '').toLowerCase().includes('sell') ? 'short' : 'long';
        const entry  = Number(p.avgEntryPrice || p.entryPrice || p.entry || 0);
        const price  = Number(p.markPrice || p.price || 0);
        const size   = Number(p.size || p.quantity || p.contracts || 0);     // contracts
        const lot    = Number(p.lotSize || 1);
        const minSz  = Number(p.minSize || 0);
        const initM  = Number(p.value || p.margin || p.initialMargin || 0);

        if (!(entry > 0) || !(price > 0) || !(size > 0)) continue;

        // initialize (idempotent) then update
        initTPTracker({
          symbol,
          side,
          entryPrice: entry,
          size,
          lotSize: lot,
          minSize: minSz,
          initialMargin: initM,
          confidence: Number(p.confidence || 70)
        });

        // Plug TA confidence + phase if you want sharper exits
        let conf = 70, phase = 'uptrend';
        try {
          const ta = await analyzeSymbol(symbol.replace('-USDTM', 'USDT'));
          if (ta) {
            conf = Number(ta.confidence ?? conf);
            // simple mapper (optional)
            phase = (ta.overextended ? 'peak' : (ta.signal === 'bearish' ? 'reversal' : 'uptrend'));
          }
        } catch { /* soft fail */ }

        await updateTPStatus({
          symbol,
          currentPrice: price,
          confidence: conf,
          trendPhase: phase,
          initialMargin: initM > 0 ? initM : undefined
        });
      }
    } catch (e) {
      // keep silent-ish; avoid noisy logs every second
      console.warn('[tpPulse] error:', e?.message || e);
    }
  }

  setInterval(pulse, 1000); // 1s — “quick react”
})();
// ====================[ /NEW: partial TP Manager wiring ]=============================


// === WebSocket Events ===
io.on('connection', (socket) => {
  console.log('🔌 Client connected');
  socket.on('disconnect', () => console.log('❌ Client disconnected'));
});

// [6] Small health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// === Static Homepage & Catch-All ===
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});

// --- MongoDB Connection + resilient retry ---
const MAX_RETRIES = 50;
const RETRY_MS = 10_000;

async function connectWithRetry(attempt = 1) {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8_000,
    });
    console.log('✅ MongoDB connected');

    const tpMon = require('./tpSlMonitor');
    if (typeof tpMon.initTpFeed === 'function') {
      await tpMon.initTpFeed();
      console.log('🗃️ TP/SL feed hydrated from Mongo');
    }

    // ✅ NEW: hydrate in-memory rails tape from Mongo so /api/verify-rails has live rails immediately
    try {
      const { hydrateFromDb } = require('./handlers/extremaRails');
      await hydrateFromDb(); // hydrate all symbols (bounded slice in the helper)
    } catch (e) {
      console.warn('⚠️ rails tape hydration skipped:', e?.message || e);
    }

  } catch (err) {
    const msg = String((err && err.message) || err);
    if (msg.includes('MongoServerSelectionError') || msg.includes('ENOTFOUND') || msg.includes('timeout')) {
      console.error('❌ MongoDB connection failed:', msg);
      console.error('ℹ️ Hint: If you are on MongoDB Atlas, whitelist your current public IP in Atlas → Network Access.');
    } else {
      console.error('❌ Mongo error:', msg);
    }
    if (attempt < MAX_RETRIES) {
      console.log(`⏳ Retry ${attempt}/${MAX_RETRIES} in ${RETRY_MS/1000}s...`);
      setTimeout(() => connectWithRetry(attempt + 1), RETRY_MS);
    } else {
      console.error('🛑 Gave up connecting to Mongo after many retries.');
    }
  }
}
connectWithRetry();

// === Launch Server ===
server.listen(PORT, () => {
  console.log(`🚀 Poseidon backend live at http://localhost:${PORT}`);

  // Kick off the cycle watcher after HTTP server is up (unless Autopilot owns it)
  if (DISABLE_SERVER_WATCHERS) {
    console.log('[server] Watchers are disabled here (DISABLE_SERVER_WATCHERS=true). Autopilot owns them.');
  } else {
    try {
      const { bootCycleWatcher } = require('./bootstrap/cycleBootstrap');
      if (typeof bootCycleWatcher === 'function') bootCycleWatcher();
    } catch (e) {
      console.warn('[cycle] bootstrap not found or failed to start:', e?.message || e);
    }
  }

  // Optionally start reversal watcher routes already mounted above if USE_REVERSAL=true
  if (USE_REVERSAL) {
    console.log('🔄 Reversal watcher routes enabled');
  }

  // ⬇️ Start Signal QA scheduler (optional; safe if file missing)
  try {
    const { startSignalQaScheduler } = require('./jobs/signalQaScheduler');
    if (typeof startSignalQaScheduler === 'function') {
      // Pass io in case you want to broadcast results later
      startSignalQaScheduler({ io });
      console.log('🧪 Signal QA scheduler started');
    } else {
      console.log('ℹ️ jobs/signalQaScheduler present but no startSignalQaScheduler() export');
    }
  } catch (e) {
    console.log('ℹ️ Signal QA scheduler not started (jobs/signalQaScheduler not found or failed):', e?.message || e);
  }

  // Adaptive Bot (guarded above in routes, and a background tuner here)
  try {
    const { startAdaptiveTuner } = require('./jobs/adaptiveTuner');
    startAdaptiveTuner({ io }); // runs every 5 min by default
    console.log('🧠 Adaptive tuner started');
  } catch (e) {
    console.log('ℹ️ Adaptive tuner not started:', e?.message || e);
  }

  // Pattern Profile daily cron (EM writer)
try {
  const { startPatternProfileCron } = require('./jobs/patternProfileCron');
  startPatternProfileCron({ io });
  console.log('🗓️ Pattern profile cron armed');
} catch (e) {
  console.log('ℹ️ Pattern profile cron not started:', e?.message || e);
}

// OPTIONAL: start scheduler if enabled via env
if (String(process.env.PATTERN_SCHEDULER || 'true').toLowerCase() === 'true') {
  require('./jobs/patternCron'); // starts minute loop unless run with --once
}

});