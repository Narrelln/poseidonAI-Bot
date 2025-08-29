// /models/SignalAudit.js
const mongoose = require('mongoose');

const ResultSchema = new mongoose.Schema({
  horizonMs:    { type: Number, min: 1, required: true },
  at:           { type: Number, required: true },   // timestamp (ms) when this horizon was scored
  price:        { type: Number, required: true },   // price at scoring time
  forwardRoiPct:{ type: Number, default: 0 },
  correct:      { type: Boolean, default: false },
  durationMs:   { type: Number, min: 0, default: 0 } // ← NEW: time from event → scoring
}, { _id: false });

const SignalAuditSchema = new mongoose.Schema({
  // Frontend-generated id (one record per event id)
  id:         { type: String, index: true },

  // Event metadata
  at:         { type: Number, required: true }, // creation time (ms)
  event:      { type: String, enum: ['analysis','skipped','decision'], required: true },
  symbol:     { type: String, required: true }, // e.g. BTC-USDTM
  side:       { type: String, enum: ['BUY','SELL','HOLD'], required: true },

  // Signal context
  confidence: { type: Number, min: 0, max: 100 },
  price:      { type: Number, required: true },  // p0 (price at event time)
  reason:     { type: String, default: '' },
  corr:       { type: String, default: '' },     // correlation id for tracing

  // Evaluations over time
  results:    { type: [ResultSchema], default: [] }
}, { timestamps: true });

// Helpful indexes
SignalAuditSchema.index({ createdAt: -1 });
SignalAuditSchema.index({ symbol: 1, createdAt: -1 });
// If you want to enforce one doc per FE id, uncomment after cleaning dupes:
// SignalAuditSchema.index({ id: 1 }, { unique: true, sparse: true });

module.exports =
  mongoose.models.SignalAudit || mongoose.model('SignalAudit', SignalAuditSchema);