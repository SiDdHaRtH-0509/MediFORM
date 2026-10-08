const mongoose = require('mongoose');

const otpChallengeSchema = new mongoose.Schema({
  challengeId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  identifier: {
    type: String,
    required: true,
    index: true
  },
  otpHash: {
    type: String,
    required: true
  },
  purpose: {
    type: String,
    enum: ['REGISTRATION', 'EMAIL_VERIFICATION', 'LOGIN', 'PASSWORD_RESET'],
    required: true
  },
  pendingUserData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  failedAttempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 5
  },
  resendAvailableAt: {
    type: Date,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index removes expired challenges automatically
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isConsumed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('OTPChallenge', otpChallengeSchema);
