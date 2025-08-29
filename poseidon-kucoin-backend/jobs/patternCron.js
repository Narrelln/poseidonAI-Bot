/* jobs/patternCron.js
 * Poseidon — Daily Pattern Profile Writer
 *
 * - At ~00:05 UTC, computes pattern profiles for active symbols
 * - Persists rows into Mongo `patternStats` collection
 * - Emits feed lines so you can watch it in the SSE stream
 * - Can be invoked manually or as a one-shot (—once)
 */

require('dotenv').config();

const { publish } = require('../server/feedBus');
const { getPatternProfile } = require('../handlers/patternStats');
const { MongoClient } = require('mongodb');

// Optional helpers
let listActiveSymbols;
try { ({ listActiveSymbols } = require('../handlers/decisionHelper')); } catch {}

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGO_DB || 'poseidon';
const collectionName = process.env.MONGO_PATTERN_STATS || 'patternStats';

const DRY = String(process.env.PATTERN_DRY_RUN || 'false').toLowerCase() === 'true';

function logFeed(level, msg, data = {}) {
  publish({ type: 'pattern', level, symbol: 'SYSTEM', msg, data, tags: ['pattern', 'cron'] });
  if (level === 'error') console.error('[patternCron]', msg, data);
  else console.log('[patternCron]', msg, data);
}

async function getSymbols() {
  // Prefer scanner’s active list
  if (typeof listActiveSymbols === 'function') {
    try {
      const arr = await listActiveSymbols();
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {
      logFeed('warn', 'listActiveSymbols failed; falling back to majors', { error: e?.message });
    }
  }
  // Safe fallback
  return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT'];
}

async function connectDB() {
  const client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection(collectionName);
  try { await col.createIndex({ symbol: 1, date: -1 }); } catch {}
  return { client, col };
}

function utcMidnight(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

async function runOnce({ when = new Date() } = {}) {
  const date = utcMidnight(when); // store rows stamped to the UTC day
  const symbols = await getSymbols();

  logFeed('info', `Pattern write start (${symbols.length} symbols)`, { date: date.toISOString(), dry: DRY });

  const { client, col } = await connectDB();
  try {
    let ok = 0, fail = 0;

    for (const sym of symbols) {
      try {
        const prof = await getPatternProfile(sym, { days: 7 });
        if (!prof || !Number.isFinite(prof.emPct)) throw new Error('bad-profile');

        const doc = {
          symbol: sym,
          date,
          emPct: Number(prof.emPct),
          realizedVsEM: Number(prof.realizedVsEM),
          consistency01: Number(prof.consistency01),
          morningMovePct: Number(prof.morningMovePct || 0),
          middayPullbackPct: Number(prof.middayPullbackPct || 0),
          afternoonReboundPct: Number(prof.afternoonReboundPct || 0),
          lastUpdated: new Date()
        };

        if (!DRY) {
          // Upsert the row for this UTC date (one per day)
          await col.updateOne(
            { symbol: sym, date },
            { $set: doc },
            { upsert: true }
          );
        }

        ok++;
        if (ok <= 5) { // don't spam
          logFeed('info', `EM saved ${sym}`, { emPct: doc.emPct, rvEM: doc.realizedVsEM, c01: doc.consistency01 });
        }
      } catch (e) {
        fail++;
        logFeed('error', `EM save failed ${sym}`, { error: e?.message });
      }
    }

    logFeed('info', 'Pattern write done', { ok, fail, dry: DRY });
    return { ok, fail, count: symbols.length };
  } finally {
    await client.close().catch(() => {});
  }
}

/* ---------------- scheduler ----------------
 * Fires every minute; only runs job when time is 00:05 UTC ± 30s and not already run.
 */
let _ranTodayFor = null; // ISO date string we already ran for
function shouldRunNow() {
  const now = new Date();
  const hour = now.getUTCHours();
  const min = now.getUTCMinutes();
  if (hour !== 0 || min !== 5) return false;
  const iso = utcMidnight(now).toISOString();
  if (_ranTodayFor === iso) return false;
  _ranTodayFor = iso;
  return true;
}

async function loop() {
  if (shouldRunNow()) {
    try { await runOnce(); } catch (e) { logFeed('error', 'Scheduled run failed', { error: e?.message }); }
  }
}

// CLI mode
if (require.main === module) {
  const once = process.argv.includes('--once');
  const now  = process.argv.includes('--now');
  if (once || now) {
    runOnce().then(r => {
      logFeed('info', 'Manual run complete', r);
      if (once) process.exit(0);
    });
  } else {
    logFeed('info', 'Scheduler started (00:05 UTC daily)');
    setInterval(loop, 60 * 1000);
  }
}

module.exports = { runOnce };