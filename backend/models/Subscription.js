const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  ownerType: {
    type: String,
    enum: ['doctor', 'hospital'],
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  hospitalName: {
    type: String,
    trim: true,
    default: '',
    index: true
  },
  planCode: {
    type: String,
    required: true,
    enum: [
      'DOCTOR_FREE',
      'DOCTOR_PRO',
      'DOCTOR_COMMAND',
      'HOSPITAL_SEVA_PUBLIC',
      'HOSPITAL_DISTRICT',
      'HOSPITAL_MULTISPECIALTY',
      'HOSPITAL_REGIONAL_GRID'
    ],
    default: 'DOCTOR_FREE'
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly', 'grant'],
    default: 'monthly'
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'PAST_DUE', 'CANCELLED'],
    default: 'ACTIVE'
  },
  monthlyTransferQuota: {
    type: Number,
    default: 25 // -1 means unlimited
  },
  monthlySmsQuota: {
    type: Number,
    default: 50
  },
  seatLimit: {
    type: Number,
    default: 1
  },
  usageThisMonth: {
    periodKey: { type: String, default: () => new Date().toISOString().slice(0, 7) },
    transfersCreated: { type: Number, default: 0 },
    qrSessionsGenerated: { type: Number, default: 0 },
    emergencySmsDispatched: { type: Number, default: 0 },
    emergencyBypassesUsed: { type: Number, default: 0 }
  },
  renewsAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  }
}, {
  timestamps: true
});

subscriptionSchema.index({ ownerType: 1, userId: 1 });
subscriptionSchema.index({ ownerType: 1, hospitalName: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
