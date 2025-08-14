const { MongoClient } = require('mongodb');
const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
const dbName = 'poseidon';
const collectionName = 'tokenPatterns';

let db, collection;

async function connectDB() {
  if (!collection) {
    const client = new MongoClient(uri);
    await client.connect();
    db = client.db(dbName);
    collection = db.collection(collectionName);
  }
  return collection;
}

async function getTokenProfile(symbol) {
  const col = await connectDB();
  return await col.findOne({ symbol });
}

async function recordTradeResult(symbol, result = {}) {
  const col = await connectDB();

  const update = {
    $push: {
      tradeHistory: {
        date: new Date(),
        result: result.result || 'win',
        gain: result.gain || 0,
        duration: result.duration || 0
      }
    },
    $set: { lastUpdated: Date.now() }
  };

  if (result.result === 'win') {
    update.$inc = { wins: 1 };
  } else if (result.result === 'loss') {
    update.$inc = { losses: 1 };
  }

  await col.updateOne({ symbol }, update, { upsert: true });
}

async function updateTokenBehavior(symbol, taSnapshot = {}) {
  const col = await connectDB();

  await col.updateOne(
    { symbol },
    {
      $addToSet: {
        idealTACombo: { $each: taSnapshot.activeIndicators || [] }
      },
      $inc: {
        fakeoutCount: taSnapshot.fakeout ? 1 : 0,
        stableBuildupCount: taSnapshot.stable ? 1 : 0
      },
      $set: { lastUpdated: Date.now() }
    },
    { upsert: true }
  );
}

async function adjustConfidenceByProfile(symbol, baseConfidence) {
  const profile = await getTokenProfile(symbol);
  if (!profile) return baseConfidence;

  if (profile.wins > 10 && profile.wins / (profile.losses + 1) >= 2) {
    baseConfidence += 5;
  }
  if (profile.fakeoutCount >= 5) {
    baseConfidence -= 6;
  }
  if (profile.avgPumpAfterConf70 >= 100) {
    baseConfidence += 5;
  }

  return Math.max(0, Math.min(100, baseConfidence));
}

// === New static token behavior overrides ===
const overrides = {
  'TRUMPUSDTM': { fastTP: true },
  'DOGEUSDTM': { needsVolume: 5000000, requiresHighRSI: true },
  'PEPEUSDTM': { needsVolume: 3000000 },
  'AIDOGEUSDTM': { needsVolume: 2000000, fastTP: true },
  'GROKUSDTM': { requiresHighRSI: true },
};

// === Profile fallback logic ===
function getPattern(symbol) {
  const upper = symbol.toUpperCase();
  return overrides[upper] || {
    needsVolume: 100000,
    requiresHighRSI: false,
    fastTP: false
  };
}

module.exports = {
  getTokenProfile,
  recordTradeResult,
  updateTokenBehavior,
  adjustConfidenceByProfile,
  getPattern
};