const mongoose = require('mongoose');

const screeningSchema = new mongoose.Schema({
  screeningId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  pid: {
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
  age: {
    type: Number,
    required: true
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    default: 'Other'
  },
  bloodGroup: {
    type: String,
    trim: true,
    default: 'Unknown'
  },
  contactNumber: {
    type: String,
    trim: true
  },
  emergencyContact: {
    type: String,
    trim: true
  },

  // Clinical measurements
  vitals: {
    hr: { type: Number },
    bp: { type: String },
    rr: { type: Number },
    spo2: { type: Number },
    temp: { type: Number },
    glucose: { type: Number },
    gcs: { type: Number },
    timestamp: { type: Date, default: Date.now },
    notes: { type: String }
  },

  investigations: [{
    name: { type: String },
    status: { type: String, enum: ['Pending', 'Completed', 'Abnormal'], default: 'Pending' },
    notes: { type: String }
  }],

  allergies: [{ type: String }],
  medications: [{
    name: { type: String },
    dose: { type: String },
    route: { type: String },
    frequency: { type: String },
    notes: { type: String }
  }],

  clinicalNotes: {
    type: String,
    trim: true
  },

  // Automated Clinical Classification via existing MediFORM CDS
  evaluation: {
    isFlagged: { type: Boolean, default: false, index: true },
    riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'LOW' },
    news2Score: { type: Number, default: 0 },
    flagReasons: [{ type: String }],
    recommendedPriority: { type: String, enum: ['Routine', 'Urgent', 'Emergency'], default: 'Routine' },
    summary: { type: String }
  },

  // Patient Consent Verification
  patientConsent: {
    consentGiven: { type: Boolean, default: true },
    consentTimestamp: { type: Date, default: Date.now },
    consentedBy: { type: String, default: 'Patient' }
  },

  // Relationship to Referral
  activeReferralId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Referral',
    default: null
  },
  referralHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Referral'
  }],

  // Author and Hospital Metadata
  recordedByUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  recordedByUsername: {
    type: String,
    required: true
  },
  hospital: {
    type: String,
    required: true
  },

  screeningDateTime: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

screeningSchema.index({ pid: 1, 'evaluation.isFlagged': 1 });

module.exports = mongoose.model('Screening', screeningSchema);
