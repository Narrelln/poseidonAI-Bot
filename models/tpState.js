/**
 * Poseidon — Model M01: TP State
 * ------------------------------
 * Purpose:
 *   Persist trailing/TP1 state per contract so the TP/SL monitor
 *   recovers cleanly after restarts (nodemon, deploys, crashes).
 *
 * Fields:
 *   - key: normalized contract key (e.g., "DOGEUSDTM")
 *   - contract: original contract string from exchange
 *   - tp1Done: whether 40% partial was already taken
 *   - peakRoi: highest ROI seen after TP1 (for trailing)
 *   - trailArmed: whether trailing is active
 *   - lastSeenQty: last known size (debugging/consistency)
 *   - updatedAt: last persistence time
 *
 * Notes:
 *   The main server already connects Mongoose; this model only defines schema.
 */

const mongoose = require('mongoose');

const TpStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // index removed here
    contract: { type: String, required: true },
    tp1Done: { type: Boolean, default: false },
    peakRoi: { type: Number, default: -Infinity },
    trailArmed: { type: Boolean, default: false },
    lastSeenQty: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'tp_states' }
);

// ✅ Single, authoritative index definition
TpStateSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('TpState', TpStateSchema);