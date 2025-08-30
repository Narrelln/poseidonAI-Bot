/**
 * models/CycleState.js
 * Tracks per-symbol cycle phase so Poseidon can resume after restart.
 */
const mongoose = require('mongoose');

const CycleStateSchema = new mongoose.Schema({
  // identity
  symbol: { type: String, required: true, unique: true, index: true }, // e.g. ADA-USDTM

  // cycle phase
  phase:  { type: String, default: 'IDLE', enum: ['IDLE','IMPULSE','EXHAUST','REVERSAL','RESET'] },

  // windows
  impulseBeganAt: { type: Date, default: null },
  lastExitAt:     { type: Date, default: null },

  // reference levels (rolling 30d)
  atl30: { type: Number, default: null },
  ath30: { type: Number, default: null },
  levelsUpdatedAt: { type: Date, default: null },

  // optional SR rails snapshot (fallback if learning-memory unavailable)
  supports:    { type: [Number], default: [] },
  resistances: { type: [Number], default: [] },

  // last trade context (for distance / re-entry checks)
  lastEntryPx: { type: Number, default: null },
  lastExitPx:  { type: Number, default: null },

  // momentum breadcrumbs (from TA)
  lastSignal:   { type: String, default: null },   // 'bullish'|'bearish'|...
  lastConf:     { type: Number, default: null },   // 0..100
  lastMomentum: { type: Number, default: null },   // 0..1

  // NEW: cycleWatcher observability (we set these in handlers/cycleWatcher.js)
  lastHint:     { type: String, default: '' },             // e.g. 'exit_exhaust', 'reset'
  lastReasons:  { type: [String], default: [] },           // concise bullets for why we acted
  arrivedTag:   { type: String, enum: ['', 'nearATL', 'nearATH'], default: '' },
  lastTraceId:  { type: String, default: null }            // correlates with decisionHelper logs
}, {
  collection: 'cycle_states',
  timestamps: true,           // adds createdAt / updatedAt
  versionKey: false
});

// Helpful secondary indexes
CycleStateSchema.index({ phase: 1, updatedAt: -1 });
CycleStateSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('CycleState', CycleStateSchema);