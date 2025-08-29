// /models/ObservedMover.js
const mongoose = require('mongoose');

const SnapshotSchema = new mongoose.Schema({
  price: Number,
  quoteVolume: Number,
  priceChgPct: Number,
  category: { type: String, enum: ['gainer','loser',''], default: '' },
  source: { type: String, default: 'Bybit' }
}, { _id: false });

const ObservedMoverSchema = new mongoose.Schema({
  base:         { type: String, required: true, index: true, unique: true }, // normalized BASE (KuCoin aliasing, e.g., XBT)
  bybitBase:    { type: String, default: '' },                                // original base as seen on Bybit (e.g., BTC)
  firstSeen:    { type: Date,   default: () => new Date() },
  lastSeen:     { type: Date,   default: () => new Date(), index: true },
  expiresAt:    { type: Date,   required: true, index: true },                // TTL
  whitelisted:  { type: Boolean, default: false },
  lastSnapshot: { type: SnapshotSchema, default: () => ({}) }
}, { timestamps: true });

// TTL: expire exactly at expiresAt
ObservedMoverSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.ObservedMover || mongoose.model('ObservedMover', ObservedMoverSchema);