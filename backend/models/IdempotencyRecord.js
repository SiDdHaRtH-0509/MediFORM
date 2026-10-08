const mongoose = require('mongoose');

const idempotencyRecordSchema = new mongoose.Schema({
  idempotencyKey: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  requestHash: {
    type: String,
    required: true
  },
  responsePayload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  transferId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transfer'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 // 24-hour TTL automatic cleanup
  }
}, {
  timestamps: true
});

// Compound unique index to prevent race condition duplicate transfer creation
idempotencyRecordSchema.index({ idempotencyKey: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
