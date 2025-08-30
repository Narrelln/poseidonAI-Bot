// models/LearningMemory.js
/* eslint-disable no-console */
const mongoose = require('mongoose');

const TickSchema = new mongoose.Schema(
  { t: { type: Number, required: true }, p: { type: Number, required: true } },
  { _id: false }
);

const RailsSchema = new mongoose.Schema(
  {
    lastPrice: Number,
    todayHigh: Number,
    todayLow: Number,
    ath12: Number,  atl12: Number,
    ath24: Number,  atl24: Number,
    ath36: Number,  atl36: Number,
    ath48: Number,  atl48: Number,
    ath7d: Number,  atl7d: Number,
    ath30: Number,  atl30: Number,
    // aliases (keep consumers happy)
    ath12h: Number, atl12h: Number,
    ath24h: Number, atl24h: Number,
    ath36h: Number, atl36h: Number,
    ath48h: Number, atl48h: Number,
    ath30d: Number, atl30d: Number,
    nearestSupport: Number,
    nearestResistance: Number,
    avgConfidence: Number,
    trapCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const LearningMemorySchema = new mongoose.Schema(
  {
    symbol: { type: String, index: true, unique: true }, // spot form e.g. "BTCUSDT"
    ticks:  { type: [TickSchema], default: [] },         // optional (can be large)
    rails:  { type: RailsSchema, default: {} },
    updatedAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

LearningMemorySchema.index({ updatedAt: -1 });

module.exports = mongoose.models.LearningMemory
  || mongoose.model('LearningMemory', LearningMemorySchema);