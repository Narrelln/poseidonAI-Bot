const mongoose = require('mongoose');

const positionNoteSchema = new mongoose.Schema({
  contract: { type: String, required: true, unique: true },
  note: { type: String },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PositionNote', positionNoteSchema);