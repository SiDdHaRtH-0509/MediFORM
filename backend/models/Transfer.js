const mongoose = require('mongoose');

const otherDetailSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  value: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  category: {
    type: String,
    enum: [
      "NURSING",
      "DIETARY",
      "MOBILITY",
      "PROCEDURE",
      "DEVICE",
      "FAMILY",
      "SOCIAL",
      "ADMINISTRATIVE",
      "FOLLOW_UP",
      "SPECIAL_INSTRUCTIONS",
      "OTHER"
    ],
    default: "OTHER"
  },
  priority: {
    type: String,
    enum: ["NORMAL", "IMPORTANT", "CRITICAL"],
    default: "NORMAL"
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const medicationSchema = new mongoose.Schema({
  n: { type: String, required: true, trim: true }, // drug name
  d: { type: String, trim: true }, // dose
  r: { type: String, trim: true }, // route
  frequency: { type: String, trim: true }, // frequency e.g. BD
  startDate: { type: String, trim: true },
  notes: { type: String, trim: true }
}, { _id: false });

const vitalsSchema = new mongoose.Schema({
  hr: { type: Number },
  bp: { type: String },
  rr: { type: Number },
  spo2: { type: Number },
  temp: { type: Number },
  glucose: { type: Number },
  gcs: { type: Number },
  timestamp: { type: Date, default: Date.now },
  notes: { type: String }
}, { _id: false });

const acknowledgementSchema = new mongoose.Schema({
  acknowledgedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acknowledgedByUsername: { type: String },
  arrivalCondition: { type: String, enum: ['Stable', 'Unstable'], required: true },
  arrivalNotes: { type: String, default: '' },
  discrepancies: [{ type: String }],
  acknowledgedAt: { type: Date, default: Date.now }
}, { _id: false });

const historyItemSchema = new mongoose.Schema({
  action: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  doctorUsername: { type: String },
  hospital: { type: String },
  version: { type: Number },
  notes: { type: String }
}, { _id: false });

const transferSchema = new mongoose.Schema({
  // Patient Identity
  pid: { type: String, required: true, trim: true, index: true },
  nam: { type: String, required: true, trim: true },
  age: { type: Number, required: true },
  gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Other' },
  bg: { type: String, required: true, trim: true },
  dob: { type: String },
  contactNumber: { type: String },
  emergencyContact: { type: String },
  address: { type: String },

  // Transfer Information
  fh: { type: String, required: true, trim: true }, // From Hospital
  th: { type: String, required: true, trim: true }, // To Hospital
  rt: { type: String, required: true, trim: true }, // Reason for transfer
  priority: { type: String, enum: ['Routine', 'Urgent', 'Emergency'], default: 'Routine' },
  referringDoctor: { type: String },
  receivingDepartment: { type: String },
  transferDateTime: { type: Date, default: Date.now },

  // Clinical Information
  pd: { type: String, required: true, trim: true }, // Primary Diagnosis
  secondaryDiagnosis: { type: String },
  currentCondition: { type: String },
  sum: { type: String, trim: true }, // Clinical Summary (max 200 words)

  // Allergies
  alg: [{ type: String }],
  noKnownAllergies: { type: Boolean, default: false },

  // Medications
  med: [medicationSchema],

  // Vitals
  vit: vitalsSchema,

  // Investigations
  pi: [{ type: mongoose.Schema.Types.Mixed }],

  // Other Details (Mandatory Feature)
  otherDetails: { type: [otherDetailSchema], default: [] },

  // Administrative / Metadata / Audits
  issuerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  issuerUsername: { type: String, required: true },
  recipientUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  recipientUsernames: [{ type: String }],
  
  status: {
    type: String,
    enum: ['IN_TRANSIT', 'RECEIVED', 'DISCREPANCY', 'UPDATED'],
    default: 'IN_TRANSIT',
    index: true
  },
  acknowledgementStatus: { type: String, enum: ['PENDING', 'ACKNOWLEDGED'], default: 'PENDING' },
  acknowledgement: acknowledgementSchema,

  // Versioning & Immutability
  version: { type: Number, default: 1 },
  previousVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transfer', default: null },
  isCurrent: { type: Boolean, default: true, index: true },
  history: [historyItemSchema],

  submittedAt: { type: Date, default: Date.now, index: true },
  submissionTimestamp: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Compound Indexes for fast history & timeline queries
transferSchema.index({ pid: 1, isCurrent: 1 });
transferSchema.index({ issuerUserId: 1, isCurrent: 1 });

module.exports = mongoose.model('Transfer', transferSchema);
