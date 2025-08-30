// models/tpState.js
/**
 * Poseidon — Model M01: TP State
 * ------------------------------
 * Persists trailing/TP1 state per contract so the TP/SL monitor
 * recovers cleanly after restarts.
 *
 * Notes:
 * - Unique index on `key` ensures one row per contract.
 * - `timestamps` adds createdAt/updatedAt; monitor can still $set updatedAt explicitly.
 * - Hot‑reload safe (mongoose.models guard) for nodemon/dev.
 */

const mongoose = require('mongoose');

const TpStateSchema = new mongoose.Schema(
  {
    key:         { type: String, required: true }, // normalized, e.g. "DOGEUSDTM"
    contract:    { type: String, required: true }, // original exchange contract
    tp1Done:     { type: Boolean, default: false },
    peakRoi:     { type: Number,  default: Number.NEGATIVE_INFINITY },
    trailArmed:  { type: Boolean, default: false },
    lastSeenQty: { type: Number,  default: 0 },
    // createdAt / updatedAt are added by timestamps below
  },
  {
    collection: 'tp_states',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

// One document per contract key
TpStateSchema.index({ key: 1 }, { unique: true });

// Hot‑reload guard to avoid OverwriteModelError during dev
module.exports = mongoose.models.TpState || mongoose.model('TpState', TpStateSchema);