const mongoose = require('mongoose');

function generateNotificationId() {
  const year = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `NOTIF-${year}-${rand}`;
}

const notificationSchema = new mongoose.Schema({
  notificationId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: generateNotificationId
  },
  // Distinct lifecycle event/transition identifier (Phase 4.1 Idempotency)
  eventId: {
    type: String,
    required: true,
    index: true
  },
  recipientUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  recipientPatientId: {
    type: String,
    trim: true,
    index: true
  },
  recipientRole: {
    type: String,
    enum: ['patient', 'doctor'],
    default: 'patient'
  },
  relatedReferralId: {
    type: String,
    trim: true,
    index: true
  },
  relatedReferralRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Referral',
    default: null
  },
  notificationType: {
    type: String,
    required: true,
    enum: [
      'REFERRAL_CREATED',
      'DOCTOR_ASSIGNED',
      'REFERRAL_ACKNOWLEDGED',
      'REFERRAL_ACCEPTED',
      'REFERRAL_REJECTED',
      'REFERRAL_REASSIGNED',
      'TREATMENT_DOCUMENTED',
      'FOLLOW_UP_REQUIRED',
      'REFERRAL_CLOSED',
      'FOLLOW_UP_SCHEDULED',
      'FOLLOW_UP_REMINDER_UPCOMING',
      'FOLLOW_UP_REMINDER_DUE',
      'FOLLOW_UP_OVERDUE',
      'FOLLOW_UP_MISSED',
      'FOLLOW_UP_RESCHEDULED',
      'FOLLOW_UP_COMPLETED',
      'FOLLOW_UP_CANCELLED',
      'MONITORING_ALERT_CRITICAL',
      'MONITORING_ALERT_HIGH',
      'GENERAL_UPDATE',
      'VERIFICATION_SUBMITTED',
      'VERIFICATION_APPROVED',
      'VERIFICATION_REJECTED',
      'VERIFICATION_RESUBMISSION_REQUIRED',
      'REVERIFICATION_REQUIRED',
      'TRANSFER_DISPATCHED',
      'EMS_CRITICAL_ALERT',
      'EMERGENCY_SMS_SENT'
    ]
  },
  category: {
    type: String,
    enum: ['REFERRAL_UPDATE', 'APPOINTMENT_REMINDER', 'FOLLOW_UP_REMINDER', 'GENERAL_CARE', 'MONITORING_ALERT', 'ACCOUNT_VERIFICATION', 'EMERGENCY_TRANSFER'],
    default: 'REFERRAL_UPDATE',
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  isEssential: {
    type: Boolean,
    default: false
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: {
    type: Date,
    default: null
  },
  deliveryStatus: {
    type: String,
    enum: ['DELIVERED', 'PENDING', 'FAILED'],
    default: 'DELIVERED'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

notificationSchema.index({ recipientUserId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipientPatientId: 1, isRead: 1, createdAt: -1 });
// Database-level protection against duplicate notifications for the same event per recipient
notificationSchema.index(
  { eventId: 1, recipientUserId: 1 },
  { unique: true, partialFilterExpression: { recipientUserId: { $type: 'objectId' } } }
);
notificationSchema.index(
  { eventId: 1, recipientPatientId: 1 },
  { unique: true, partialFilterExpression: { recipientUserId: null, recipientPatientId: { $type: 'string' } } }
);

module.exports = mongoose.model('Notification', notificationSchema);
