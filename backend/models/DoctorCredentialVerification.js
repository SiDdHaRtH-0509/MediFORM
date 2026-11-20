const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  documentId: {
    type: String,
    required: true,
    index: true
  },
  documentType: {
    type: String,
    enum: ['REGISTRATION_CERTIFICATE', 'HOSPITAL_AFFILIATION', 'SUPPORTING_CREDENTIAL'],
    default: 'REGISTRATION_CERTIFICATE',
    required: true
  },
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  fileType: {
    type: String,
    required: true,
    trim: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  fileData: {
    type: String,
    required: true // Base64 data URI or encrypted binary string stored securely
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const resubmissionEntrySchema = new mongoose.Schema({
  submissionTimestamp: { type: Date, default: Date.now },
  medicalRegistrationNumber: { type: String, trim: true },
  registrationAuthority: { type: String, trim: true },
  registrationJurisdiction: { type: String, trim: true },
  professionalDesignation: { type: String, trim: true },
  hospitalAffiliation: { type: String, trim: true },
  documentsSummary: [{
    documentId: String,
    documentType: String,
    fileName: String,
    fileSize: Number
  }],
  decision: {
    type: String,
    enum: ['VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED', 'PENDING']
  },
  decisionNotes: { type: String, trim: true },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewerName: { type: String, trim: true },
  reviewedAt: { type: Date }
}, { _id: false });

const doctorCredentialVerificationSchema = new mongoose.Schema({
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  medicalRegistrationNumber: {
    type: String,
    required: true,
    trim: true
  },
  registrationAuthority: {
    type: String,
    required: true,
    trim: true
  },
  registrationJurisdiction: {
    type: String,
    required: true,
    trim: true
  },
  professionalDesignation: {
    type: String,
    trim: true,
    default: ''
  },
  hospitalAffiliation: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED'],
    default: 'PENDING',
    index: true
  },
  documents: [documentSchema],
  submissionTimestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  reviewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  reviewerName: {
    type: String,
    trim: true,
    default: ''
  },
  reviewTimestamp: {
    type: Date,
    default: null
  },
  reviewNotes: {
    type: String,
    trim: true,
    default: ''
  },
  resubmissionHistory: [resubmissionEntrySchema],
  auditHistory: [{
    eventType: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: String,
    actorRole: String,
    details: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('DoctorCredentialVerification', doctorCredentialVerificationSchema);
