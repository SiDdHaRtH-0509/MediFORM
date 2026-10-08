const mongoose = require('mongoose');

const qrSessionSchema = new mongoose.Schema({
  uuid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  transferId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transfer',
    required: true
  },
  encryptedPayload: {
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    encryptedData: { type: String, required: true }
  },
  pinHash: {
    type: String,
    required: true
  },
  failedAttempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 5
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index automatically removes expired QR records
  },
  createdByUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isRevoked: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('QRSession', qrSessionSchema);
