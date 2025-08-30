/**
 * Poseidon — Model M02: TP/SL Feed Lines
 * --------------------------------------
 * Persists UI feed lines so they survive refreshes and restarts.
 * Keep each row small and indexed by time + contract.
 */

const mongoose = require('mongoose');

const TpFeedSchema = new mongoose.Schema(
  {
    ts:        { type: Number, required: true, index: true }, // Date.now()
    contract:  { type: String, required: true, index: true }, // e.g., "ADA-USDTM"
    state:     { type: String, default: '' },                 // OPENED | PURSUIT | TRAILING | TP1_TAKEN | SL_HIT | TRAIL_EXIT | ORDER_...
    text:      { type: String, default: '' },                 // human readable message
    roi:       { type: Number, default: null },               // optional numeric ROI for charts
    peak:      { type: Number, default: null },               // optional peak ROI
  },
  { collection: 'tp_feed', versionKey: false }
);

TpFeedSchema.index({ contract: 1, ts: -1 });

module.exports = mongoose.model('TpFeed', TpFeedSchema);