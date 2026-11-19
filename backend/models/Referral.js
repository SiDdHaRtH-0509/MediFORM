const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referralId: {
    type: String,
    required: true,
    unique: true,
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
    required: true,
    trim: true
  },

  // Verifiable relationship to source screening
  sourceScreeningId: {
    type: String,
    required: true,
    index: true
  },
  sourceScreeningRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Screening',
    required: true,
    index: true
  },

  // Referring Doctor
  referringDoctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  referringDoctorUsername: {
    type: String,
    required: true
  },
  referringDoctorName: {
    type: String,
    default: ''
  },
  referringHospital: {
    type: String,
    required: true
  },

  // Receiving Doctor (if assigned)
  receivingDoctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  receivingDoctorUsername: {
    type: String,
    default: null
  },
  receivingDoctorName: {
    type: String,
    default: null
  },
  receivingHospital: {
    type: String,
    default: null
  },
  receivingDepartment: {
    type: String,
    default: 'Emergency / Triage'
  },

  // Referral Ownership & Assignment (Phase 2)
  assignmentTimestamp: {
    type: Date,
    default: null
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  assignmentHistory: [{
    previousReceivingDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    previousReceivingDoctorUsername: { type: String, default: null },
    previousReceivingDoctorName: { type: String, default: null },
    newReceivingDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    newReceivingDoctorUsername: { type: String, required: true },
    newReceivingDoctorName: { type: String, default: '' },
    assignedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedByUsername: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    reason: { type: String, default: 'Initial referral assignment' }
  }],

  // Clinical reason and screening result reference
  clinicalReason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  relevantScreeningResult: {
    news2Score: { type: Number },
    riskLevel: { type: String },
    flagReasons: [{ type: String }],
    vitalsSummary: { type: mongoose.Schema.Types.Mixed },
    findingsSummary: { type: String }
  },

  priority: {
    type: String,
    enum: ['Routine', 'Urgent', 'Emergency'],
    default: 'Urgent',
    index: true
  },

  status: {
    type: String,
    enum: [
      'PENDING',
      'ACKNOWLEDGED',
      'ACCEPTED',
      'IN_TRANSIT',
      'IN_PROGRESS',
      'FOLLOW_UP_REQUIRED',
      'COMPLETED',
      'REJECTED',
      'CANCELLED'
    ],
    default: 'PENDING',
    index: true
  },

  // Referral Acknowledgement (Phase 3)
  acknowledgement: {
    acknowledgedByDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgedByDoctorUsername: { type: String, default: null },
    acknowledgedByDoctorName: { type: String, default: null },
    acknowledgedAt: { type: Date, default: null },
    decision: { type: String, enum: ['ACKNOWLEDGED', 'ACCEPTED', 'REJECTED', null], default: null },
    notes: { type: String, trim: true, default: '' }
  },

  // Referral Rejection (Phase 3)
  rejection: {
    rejectedByDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedByDoctorUsername: { type: String, default: null },
    rejectedByDoctorName: { type: String, default: null },
    rejectedAt: { type: Date, default: null },
    reason: { type: String, trim: true, default: '' }
  },

  // Treatment Documentation (Phase 3)
  treatmentDocumentation: {
    treatmentSummary: { type: String, trim: true, default: null },
    clinicalObservations: { type: String, trim: true, default: '' },
    proceduresPerformed: [{ type: String, trim: true }],
    medicationsAdministered: [{
      name: { type: String, trim: true },
      dose: { type: String, trim: true },
      route: { type: String, trim: true },
      frequency: { type: String, trim: true },
      notes: { type: String, trim: true }
    }],
    treatmentDate: { type: Date, default: null },
    responsibleDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    responsibleDoctorUsername: { type: String, default: null },
    responsibleDoctorName: { type: String, default: null },
    followUpRequired: { type: Boolean, default: false },
    followUpInstructions: { type: String, trim: true, default: '' },
    documentedAt: { type: Date, default: null }
  },

  // Care Confirmation & Closure (Phase 3)
  careConfirmation: {
    isConfirmed: { type: Boolean, default: false },
    confirmedByDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedByDoctorUsername: { type: String, default: null },
    confirmedByDoctorName: { type: String, default: null },
    confirmedAt: { type: Date, default: null },
    confirmationSummary: { type: String, trim: true, default: '' },
    followUpAddressed: { type: Boolean, default: false },
    followUpPlan: { type: String, trim: true, default: '' }
  },
  closure: {
    isClosed: { type: Boolean, default: false },
    closedByDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedByDoctorUsername: { type: String, default: null },
    closedByDoctorName: { type: String, default: null },
    closedAt: { type: Date, default: null },
    closureNotes: { type: String, trim: true, default: '' }
  },

  // Append-Only Referral Audit Timeline (Phase 3)
  timeline: [{
    eventType: {
      type: String,
      required: true,
      enum: [
        'REFERRAL_CREATED',
        'DOCTOR_ASSIGNED',
        'HANDOFF_INITIATED',
        'REFERRAL_ACKNOWLEDGED',
        'REFERRAL_ACCEPTED',
        'REFERRAL_REJECTED',
        'TREATMENT_STARTED',
        'TREATMENT_DOCUMENTED',
        'FOLLOW_UP_REQUIRED',
        'CARE_CONFIRMED',
        'REFERRAL_CLOSED',
        'REFERRAL_CANCELLED',
        'REFERRAL_REASSIGNED',
        'STATUS_UPDATED'
      ]
    },
    previousStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    performingUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    performingUsername: { type: String, required: true },
    performingUserRole: { type: String, default: 'doctor' },
    timestamp: { type: Date, default: Date.now },
    reason: { type: String, default: '' },
    notes: { type: String, default: '' }
  }],

  // Connection to existing QR/PIN Handoff & Transfer Model
  transferId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transfer',
    default: null,
    index: true
  },
  qrSessionUuid: {
    type: String,
    default: null
  },

  // Explicit Patient Consent Validation (Security Requirement)
  patientConsentValidated: {
    type: Boolean,
    default: true
  },
  patientConsentTimestamp: {
    type: Date,
    default: Date.now
  },

  // Explicit Authorization for Duplicate Referral (if applicable)
  isDuplicateAuthorized: {
    type: Boolean,
    default: false
  },
  duplicateAuthorizationReason: {
    type: String,
    default: null
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

referralSchema.index({ sourceScreeningRef: 1, status: 1 });
referralSchema.index({ patientId: 1, status: 1 });
referralSchema.index({ receivingDoctorId: 1, status: 1 });
referralSchema.index({ receivingHospital: 1, status: 1 });

module.exports = mongoose.model('Referral', referralSchema);
