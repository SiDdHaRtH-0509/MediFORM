const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  username: {
    type: String,
    trim: true,
    lowercase: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['doctor', 'patient'],
    default: 'doctor',
    required: true
  },
  hospitalName: {
    type: String,
    required: function() { return this.role === 'doctor'; },
    trim: true
  },
  specialization: {
    type: String,
    trim: true,
    default: 'General Medicine'
  },
  department: {
    type: String,
    trim: true,
    default: 'Emergency / Triage'
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  bio: {
    type: String,
    trim: true,
    default: ''
  },
  profilePhoto: {
    type: String,
    default: ''
  },
  yearsOfExperience: {
    type: Number,
    default: 0,
    min: 0
  },
  medicalRegistrationNumber: {
    type: String,
    trim: true,
    default: ''
  },
  registrationAuthority: {
    type: String,
    trim: true,
    default: ''
  },
  registrationJurisdiction: {
    type: String,
    trim: true,
    default: ''
  },
  professionalDesignation: {
    type: String,
    trim: true,
    default: ''
  },
  institutionalAffiliationDetails: {
    type: String,
    trim: true,
    default: ''
  },
  verificationStatus: {
    type: String,
    enum: ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED'],
    default: 'UNVERIFIED',
    index: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  isInstitutionalVerifier: {
    type: Boolean,
    default: false,
    index: true
  },
  lastProfileUpdate: {
    type: Date,
    default: null
  },
  notificationPreferences: {
    referralUpdates: { type: Boolean, default: true },
    appointmentReminders: { type: Boolean, default: true },
    followUpReminders: { type: Boolean, default: true },
    generalCareUpdates: { type: Boolean, default: true }
  },
  tokenVersion: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.pre('save', async function(next) {
  if (!this.username && this.email) {
    this.username = this.email;
  }
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

