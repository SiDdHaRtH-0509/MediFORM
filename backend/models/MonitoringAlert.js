const mongoose = require('mongoose');

function generateAlertId() {
  const year = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `ALT-${year}-${rand}`;
}

const monitoringAlertSchema = new mongoose.Schema({
  alertId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: generateAlertId
  },
  referralRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Referral',
    required: true,
    index: true
  },
  referralId: {
    type: String,
    required: true,
    index: true
  },
  patientId: {
    type: String,
    trim: true,
    index: true
  },
  riskClassification: {
    type: String,
    required: true,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    index: true
  },
  riskCategory: {
    type: String,
    required: true,
    enum: [
      'ASSIGNMENT_DELAY',
      'ACKNOWLEDGEMENT_DELAY',
      'REJECTION_UNASSIGNED',
      'INCOMPLETE_CLINICAL_WORKFLOW',
      'FOLLOW_UP_RISK',
      'STALLED_WORKFLOW'
    ],
    index: true
  },
  relevantLifecycleStatus: {
    type: String,
    required: true
  },
  plainLanguageExplanation: {
    type: String,
    required: true,
    trim: true
  },
  evidence: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  recommendedAction: {
    type: String,
    required: true,
    trim: true
  },
  responsibleDoctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  responsibleDoctorName: {
    type: String,
    default: ''
  },
  referringDoctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  referringHospital: {
    type: String,
    default: ''
  },
  receivingHospital: {
    type: String,
    default: ''
  },
  resolutionStatus: {
    type: String,
    enum: ['ACTIVE', 'RESOLVED', 'DISMISSED'],
    default: 'ACTIVE',
    index: true
  },
  dismissedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  dismissedAt: {
    type: Date,
    default: null
  },
  dismissReason: {
    type: String,
    default: ''
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  detectionTimestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  lastEvaluatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

monitoringAlertSchema.index({ referralId: 1, riskCategory: 1, resolutionStatus: 1 });
monitoringAlertSchema.index({ resolutionStatus: 1, riskClassification: 1, createdAt: -1 });

module.exports = mongoose.model('MonitoringAlert', monitoringAlertSchema);
