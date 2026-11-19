const mongoose = require('mongoose');

const consentSchema = new mongoose.Schema({
  consentId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    index: true
  },
  patientUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  patientId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  patientName: {
    type: String,
    trim: true,
    default: ''
  },
  purpose: {
    type: String,
    required: true,
    enum: [
      'EMERGENCY_TRANSFER',
      'SPECIALIST_REFERRAL',
      'CLINICAL_REVIEW',
      'GENERAL_CARE',
      'SECOND_OPINION'
    ],
    default: 'SPECIALIST_REFERRAL'
  },
  authorizedDoctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  authorizedDoctorName: {
    type: String,
    trim: true,
    default: ''
  },
  authorizedHospital: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  permittedCategories: {
    type: [String],
    enum: [
      'DEMOGRAPHICS',
      'VITALS',
      'SCREENING_RESULTS',
      'CLINICAL_NOTES',
      'MEDICATIONS',
      'REFERRAL_DETAILS',
      'INVESTIGATIONS'
    ],
    default: [
      'DEMOGRAPHICS',
      'VITALS',
      'SCREENING_RESULTS',
      'CLINICAL_NOTES',
      'MEDICATIONS',
      'REFERRAL_DETAILS',
      'INVESTIGATIONS'
    ]
  },
  status: {
    type: String,
    enum: ['GRANTED', 'REVOKED', 'EXPIRED'],
    default: 'GRANTED',
    index: true
  },
  grantedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  revokedAt: {
    type: Date,
    default: null
  },
  revocationReason: {
    type: String,
    trim: true,
    default: null
  },
  revokedByUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  version: {
    type: Number,
    default: 1
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

consentSchema.index({ patientUserId: 1, status: 1 });
consentSchema.index({ patientId: 1, status: 1 });
consentSchema.index({ authorizedHospital: 1, status: 1 });
consentSchema.index({ authorizedDoctorId: 1, status: 1 });
consentSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('Consent', consentSchema);
