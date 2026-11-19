const mongoose = require('mongoose');

function generateFollowUpId() {
  const year = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `FLP-${year}-${rand}`;
}

const followUpSchema = new mongoose.Schema({
  followUpId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: generateFollowUpId
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
    trim: true,
    index: true
  },
  patientId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  patientUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  responsibleDoctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  responsibleDoctorUsername: {
    type: String,
    required: true,
    trim: true
  },
  responsibleDoctorName: {
    type: String,
    default: '',
    trim: true
  },
  targetHospital: {
    type: String,
    default: '',
    trim: true
  },
  targetDepartment: {
    type: String,
    default: '',
    trim: true
  },
  dueDate: {
    type: Date,
    required: true,
    index: true
  },
  instructions: {
    type: String,
    trim: true,
    default: ''
  },
  priority: {
    type: String,
    enum: ['Routine', 'Urgent', 'Emergency'],
    default: 'Routine',
    index: true
  },
  status: {
    type: String,
    enum: [
      'SCHEDULED',
      'UPCOMING',
      'DUE',
      'OVERDUE',
      'MISSED',
      'COMPLETED',
      'CANCELLED'
    ],
    default: 'SCHEDULED',
    index: true
  },
  remindersSent: [{
    stage: {
      type: String,
      enum: ['UPCOMING_24H', 'DUE_SOON', 'OVERDUE', 'MISSED'],
      required: true
    },
    sentAt: {
      type: Date,
      default: Date.now
    },
    eventId: {
      type: String,
      required: true
    }
  }],
  lastReminderAt: {
    type: Date,
    default: null
  },
  missedAt: {
    type: Date,
    default: null
  },
  rescheduleHistory: [{
    previousDueDate: { type: Date, required: true },
    newDueDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },
    rescheduledByDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rescheduledByDoctorUsername: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  attendance: {
    attended: { type: Boolean, default: false },
    attendedAt: { type: Date, default: null },
    confirmedBy: { type: String, enum: ['DOCTOR', 'PATIENT', null], default: null },
    notes: { type: String, default: '' }
  },
  clinicalCompletion: {
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    completedByDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedByDoctorUsername: { type: String, default: null },
    completedByDoctorName: { type: String, default: null },
    outcomeNotes: { type: String, default: '' },
    treatmentSummary: { type: String, default: '' }
  },
  cancellation: {
    isCancelled: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
    cancelledByDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledByDoctorUsername: { type: String, default: null },
    reason: { type: String, default: '' }
  }
}, {
  timestamps: true
});

followUpSchema.index({ status: 1, dueDate: 1 });
followUpSchema.index({ patientUserId: 1, status: 1 });
followUpSchema.index({ responsibleDoctorId: 1, status: 1 });
followUpSchema.index({ referralRef: 1, createdAt: -1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
