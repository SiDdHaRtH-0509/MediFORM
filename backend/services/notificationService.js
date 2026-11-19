const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

/**
 * Resolves patient user account from patientId/UHID
 */
async function resolvePatientUser(patientId) {
  if (!patientId) return null;
  const cleanPid = patientId.trim();
  return await User.findOne({
    $or: [
      { username: new RegExp(`^${cleanPid}$`, 'i') },
      { email: new RegExp(`^${cleanPid}$`, 'i') }
    ],
    role: 'patient'
  });
}

/**
 * Checks whether user has opted into this category of notifications.
 * Essential clinical notifications bypass preference blocks to ensure safety.
 */
function shouldDeliverNotification(user, category, isEssential) {
  if (isEssential) return true;
  if (!user || !user.notificationPreferences) return true;

  const prefs = user.notificationPreferences;
  switch (category) {
    case 'REFERRAL_UPDATE':
    case 'MONITORING_ALERT':
      return prefs.referralUpdates !== false;
    case 'APPOINTMENT_REMINDER':
      return prefs.appointmentReminders !== false;
    case 'FOLLOW_UP_REMINDER':
      return prefs.followUpReminders !== false;
    case 'GENERAL_CARE':
      return prefs.generalCareUpdates !== false;
    default:
      return true;
  }
}

/**
 * Safely creates an in-app notification with idempotency check.
 */
async function createNotification({
  eventId,
  recipientUserId,
  recipientPatientId,
  recipientRole = 'patient',
  relatedReferralId,
  relatedReferralRef,
  notificationType,
  category = 'REFERRAL_UPDATE',
  title,
  message,
  isEssential = false
}) {
  try {
    const finalEventId = (eventId || new mongoose.Types.ObjectId()).toString();

    // 1. Resolve Recipient User
    let recipientUser = null;
    if (recipientUserId) {
      recipientUser = await User.findById(recipientUserId);
    } else if (recipientPatientId) {
      recipientUser = await resolvePatientUser(recipientPatientId);
    }

    const resolvedUserId = recipientUser ? recipientUser._id : (recipientUserId || null);
    const resolvedPatientId = recipientPatientId || (recipientUser ? recipientUser.username : null);

    // 2. Idempotency Check: Distinct lifecycle event deduplication per recipient
    const dedupeQuery = {
      eventId: finalEventId,
      ...(resolvedUserId
        ? { recipientUserId: resolvedUserId }
        : { recipientPatientId: resolvedPatientId })
    };

    const existing = await Notification.findOne(dedupeQuery);
    if (existing) {
      return existing;
    }

    // 3. Check User Preferences
    const delivered = shouldDeliverNotification(recipientUser, category, isEssential);
    if (!delivered) {
      // Preference disabled and non-essential: Skip delivery
      return null;
    }

    // If essential communication and preference was disabled, mark title accordingly
    const prefDisabled = recipientUser && recipientUser.notificationPreferences &&
      !shouldDeliverNotification(recipientUser, category, false);
    const finalTitle = (isEssential && prefDisabled) ? `[Priority Notice] ${title}` : title;

    const notif = new Notification({
      eventId: finalEventId,
      recipientUserId: resolvedUserId,
      recipientPatientId: resolvedPatientId,
      recipientRole,
      relatedReferralId,
      relatedReferralRef,
      notificationType,
      category,
      title: finalTitle,
      message,
      isEssential: Boolean(isEssential),
      deliveryStatus: 'DELIVERED'
    });

    try {
      await notif.save();
      return notif;
    } catch (saveErr) {
      // Database-level protection: handle concurrent insertion race conditions gracefully
      if (saveErr.code === 11000) {
        return await Notification.findOne(dedupeQuery);
      }
      throw saveErr;
    }
  } catch (err) {
    console.error('Error creating notification:', err.message);
    return null;
  }
}

/**
 * Resolves or extracts the canonical lifecycle event identifier.
 * Uses the referral timeline event _id when available to ensure
 * retrying the same transition reuses its original identifier,
 * while new transitions have unique identifiers.
 */
function getEventIdForTransition(eventType, referral, extra = {}) {
  if (extra && extra.eventId) return extra.eventId.toString();
  if (extra && extra.transitionId) return extra.transitionId.toString();

  if (referral && Array.isArray(referral.timeline) && referral.timeline.length > 0) {
    // Reverse search for timeline event matching eventType
    for (let i = referral.timeline.length - 1; i >= 0; i--) {
      const item = referral.timeline[i];
      if (item.eventType === eventType && item._id) {
        return item._id.toString();
      }
    }
    // Fallback to latest timeline item id
    const last = referral.timeline[referral.timeline.length - 1];
    if (last && last._id) {
      return last._id.toString();
    }
  }

  // Fallback for objects without timeline: deterministic by referral ID + eventType if referral exists
  if (referral && referral._id) {
    return `${referral._id.toString()}_${eventType}`;
  } else if (referral && referral.referralId) {
    return `${referral.referralId}_${eventType}`;
  }

  return new mongoose.Types.ObjectId().toString();
}

/**
 * Dispatches automated notifications for referral lifecycle events.
 */
async function notifyReferralEvent(eventType, referral, extra = {}) {
  if (!referral) return;

  const referralId = referral.referralId;
  const referralRef = referral._id;
  const patientId = referral.patientId;
  const receivingHosp = referral.receivingHospital || 'Specialty Care Center';
  const referringDoc = referral.referringDoctorName || referral.referringDoctorUsername || 'Referring Physician';
  const receivingDoc = referral.receivingDoctorName || referral.receivingDoctorUsername || 'Specialist Physician';

  // Determine unique transition/event identifier for idempotency
  const eventId = getEventIdForTransition(eventType, referral, extra);

  // Resolve Patient User
  const patientUser = await resolvePatientUser(patientId);
  const patientUserId = patientUser ? patientUser._id : null;

  switch (eventType) {
    case 'REFERRAL_CREATED': {
      // 1. Patient Notification (Essential only for emergency priority)
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: referralRef,
        notificationType: 'REFERRAL_CREATED',
        category: 'REFERRAL_UPDATE',
        title: 'New Medical Referral Created',
        message: `A referral (${referralId}) to ${receivingHosp} has been initiated for you by Dr. ${referringDoc}.`,
        isEssential: referral.priority === 'Emergency'
      });

      // 2. If receiving doctor is already assigned at creation
      if (referral.receivingDoctorId) {
        await createNotification({
          eventId,
          recipientUserId: referral.receivingDoctorId,
          recipientRole: 'doctor',
          relatedReferralId: referralId,
          relatedReferralRef: referralRef,
          notificationType: 'DOCTOR_ASSIGNED',
          category: 'REFERRAL_UPDATE',
          title: 'New Clinical Referral Assigned',
          message: `You have been assigned as receiving clinician for referral ${referralId} from ${referral.referringHospital || 'Origin Hospital'}.`,
          isEssential: true
        });
      }
      break;
    }

    case 'DOCTOR_ASSIGNED': {
      // Patient Notification
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: referralRef,
        notificationType: 'DOCTOR_ASSIGNED',
        category: 'REFERRAL_UPDATE',
        title: 'Specialist Assigned',
        message: `Dr. ${receivingDoc} at ${receivingHosp} has been assigned to your referral (${referralId}).`,
        isEssential: false
      });

      // Receiving Doctor Notification
      if (referral.receivingDoctorId) {
        await createNotification({
          eventId,
          recipientUserId: referral.receivingDoctorId,
          recipientRole: 'doctor',
          relatedReferralId: referralId,
          relatedReferralRef: referralRef,
          notificationType: 'DOCTOR_ASSIGNED',
          category: 'REFERRAL_UPDATE',
          title: 'New Clinical Referral Assigned',
          message: `You have been assigned as receiving clinician for referral ${referralId} from ${referral.referringHospital || 'Origin Hospital'}.`,
          isEssential: true
        });
      }
      break;
    }

    case 'REFERRAL_ACKNOWLEDGED': {
      // Patient Notification
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: referralRef,
        notificationType: 'REFERRAL_ACKNOWLEDGED',
        category: 'REFERRAL_UPDATE',
        title: 'Referral Receipt Confirmed',
        message: `Your referral (${referralId}) was received and acknowledged by the clinical care team at ${receivingHosp}.`,
        isEssential: false
      });

      // Referring Doctor Notification
      if (referral.referringDoctorId) {
        await createNotification({
          eventId,
          recipientUserId: referral.referringDoctorId,
          recipientRole: 'doctor',
          relatedReferralId: referralId,
          relatedReferralRef: referralRef,
          notificationType: 'REFERRAL_ACKNOWLEDGED',
          category: 'REFERRAL_UPDATE',
          title: 'Referral Acknowledged',
          message: `Referral ${referralId} for patient ${patientId} was acknowledged by Dr. ${referral.acknowledgement?.acknowledgedByDoctorName || receivingDoc}.`,
          isEssential: false
        });
      }
      break;
    }

    case 'REFERRAL_ACCEPTED': {
      // Patient Notification
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: referralRef,
        notificationType: 'REFERRAL_ACCEPTED',
        category: 'REFERRAL_UPDATE',
        title: 'Referral Intake Accepted',
        message: `Your referral (${referralId}) has been accepted by Dr. ${receivingDoc} for clinical intake.`,
        isEssential: false
      });

      // Referring Doctor Notification
      if (referral.referringDoctorId) {
        await createNotification({
          eventId,
          recipientUserId: referral.referringDoctorId,
          recipientRole: 'doctor',
          relatedReferralId: referralId,
          relatedReferralRef: referralRef,
          notificationType: 'REFERRAL_ACCEPTED',
          category: 'REFERRAL_UPDATE',
          title: 'Referral Accepted by Receiving Hospital',
          message: `Referral ${referralId} for patient ${patientId} has been accepted by ${receivingHosp}.`,
          isEssential: false
        });
      }
      break;
    }

    case 'REFERRAL_REJECTED': {
      // Patient Notification (Strict Zero Private Clinical Data, Neutral Phrasing)
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: referralRef,
        notificationType: 'REFERRAL_REJECTED',
        category: 'REFERRAL_UPDATE',
        title: 'Referral Review Update',
        message: `Your referral (${referralId}) could not be accommodated at ${receivingHosp}. Your referring physician has been notified to reassign your care.`,
        isEssential: true
      });

      // Referring Doctor Notification (Actionable with reason)
      if (referral.referringDoctorId) {
        await createNotification({
          eventId,
          recipientUserId: referral.referringDoctorId,
          recipientRole: 'doctor',
          relatedReferralId: referralId,
          relatedReferralRef: referralRef,
          notificationType: 'REFERRAL_REJECTED',
          category: 'REFERRAL_UPDATE',
          title: 'Action Required: Referral Declined',
          message: `Referral ${referralId} for patient ${patientId} was declined by ${receivingHosp}. Reason: "${referral.rejection?.reason || 'Unit capacity'}". Please review and reassign.`,
          isEssential: true
        });
      }
      break;
    }

    case 'REFERRAL_REASSIGNED': {
      // Patient Notification
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: referralRef,
        notificationType: 'REFERRAL_REASSIGNED',
        category: 'REFERRAL_UPDATE',
        title: 'Specialist Reassignment',
        message: `Your referral (${referralId}) has been transferred to Dr. ${receivingDoc} at ${receivingHosp}.`,
        isEssential: true
      });

      // Newly Assigned Doctor Notification
      if (referral.receivingDoctorId) {
        await createNotification({
          eventId,
          recipientUserId: referral.receivingDoctorId,
          recipientRole: 'doctor',
          relatedReferralId: referralId,
          relatedReferralRef: referralRef,
          notificationType: 'REFERRAL_REASSIGNED',
          category: 'REFERRAL_UPDATE',
          title: 'Reassigned Referral Intake',
          message: `Referral ${referralId} has been reassigned to you from ${referral.referringHospital || 'Origin Hospital'}.`,
          isEssential: true
        });
      }
      break;
    }

    case 'TREATMENT_DOCUMENTED': {
      // Patient Notification (Neutral: zero diagnoses, drugs, or vitals)
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: referralRef,
        notificationType: 'TREATMENT_DOCUMENTED',
        category: 'GENERAL_CARE',
        title: 'Clinical Consultation Documented',
        message: `Clinical treatment for your referral (${referralId}) has been updated by your attending physician.`,
        isEssential: false
      });
      break;
    }

    case 'FOLLOW_UP_REQUIRED': {
      // Patient Notification
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: referralRef,
        notificationType: 'FOLLOW_UP_REQUIRED',
        category: 'FOLLOW_UP_REMINDER',
        title: 'Follow-Up Care Scheduled',
        message: `A clinical follow-up is requested for your referral (${referralId}). Please check your care plan schedule.`,
        isEssential: true
      });
      break;
    }

    case 'REFERRAL_CLOSED': {
      // Patient Notification
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: referralRef,
        notificationType: 'REFERRAL_CLOSED',
        category: 'REFERRAL_UPDATE',
        title: 'Referral Completed',
        message: `Your clinical referral (${referralId}) has been completed and closed by your attending care team.`,
        isEssential: false
      });

      // Referring Doctor Notification
      if (referral.referringDoctorId) {
        await createNotification({
          eventId,
          recipientUserId: referral.referringDoctorId,
          recipientRole: 'doctor',
          relatedReferralId: referralId,
          relatedReferralRef: referralRef,
          notificationType: 'REFERRAL_CLOSED',
          category: 'REFERRAL_UPDATE',
          title: 'Referral Completed',
          message: `Referral ${referralId} for patient ${patientId} has been closed by ${receivingHosp}.`,
          isEssential: false
        });
      }
      break;
    }

    default:
      break;
  }
}

/**
 * Dispatches automated notifications for follow-up scheduling & reminder events (Phase 5).
 */
async function notifyFollowUpEvent(eventType, followUp, extra = {}) {
  if (!followUp) return null;
  const eventId = extra.eventId || `${followUp.followUpId}_${eventType}_${new Date(followUp.dueDate).getTime()}`;
  const referralId = followUp.referralId;
  const patientId = followUp.patientId;
  const docName = followUp.responsibleDoctorName || followUp.responsibleDoctorUsername || 'Attending Physician';
  const formattedDate = new Date(followUp.dueDate).toLocaleDateString();

  // Resolve Patient User
  const patientUser = await resolvePatientUser(patientId);
  const patientUserId = patientUser ? patientUser._id : (followUp.patientUserId || null);

  switch (eventType) {
    case 'FOLLOW_UP_SCHEDULED':
      return await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: followUp.referralRef,
        notificationType: 'FOLLOW_UP_SCHEDULED',
        category: 'FOLLOW_UP_REMINDER',
        title: 'Follow-Up Visit Scheduled',
        message: `A follow-up visit for referral ${referralId} has been scheduled for ${formattedDate} with Dr. ${docName}.`,
        isEssential: true
      });

    case 'FOLLOW_UP_REMINDER_UPCOMING':
      return await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: followUp.referralRef,
        notificationType: 'FOLLOW_UP_REMINDER_UPCOMING',
        category: 'FOLLOW_UP_REMINDER',
        title: 'Upcoming Follow-Up Reminder',
        message: `Reminder: You have an upcoming clinical follow-up for referral ${referralId} scheduled on ${formattedDate}.`,
        isEssential: false
      });

    case 'FOLLOW_UP_REMINDER_DUE':
      return await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: followUp.referralRef,
        notificationType: 'FOLLOW_UP_REMINDER_DUE',
        category: 'FOLLOW_UP_REMINDER',
        title: 'Follow-Up Visit Due Today',
        message: `Your clinical follow-up visit for referral ${referralId} is due today. Please check in with your attending clinic.`,
        isEssential: true
      });

    case 'FOLLOW_UP_OVERDUE': {
      // Patient notification
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: followUp.referralRef,
        notificationType: 'FOLLOW_UP_OVERDUE',
        category: 'FOLLOW_UP_REMINDER',
        title: 'Follow-Up Visit Overdue',
        message: `Your scheduled follow-up for referral ${referralId} is past due. Please contact your care center to attend or reschedule.`,
        isEssential: true
      });

      // Doctor alert
      if (followUp.responsibleDoctorId) {
        await createNotification({
          eventId,
          recipientUserId: followUp.responsibleDoctorId,
          recipientRole: 'doctor',
          relatedReferralId: referralId,
          relatedReferralRef: followUp.referralRef,
          notificationType: 'FOLLOW_UP_OVERDUE',
          category: 'FOLLOW_UP_REMINDER',
          title: 'Follow-Up Overdue Alert',
          message: `Follow-up for patient ${patientId} on referral ${referralId} is past due.`,
          isEssential: true
        });
      }
      break;
    }

    case 'FOLLOW_UP_MISSED': {
      // Patient notification
      await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: followUp.referralRef,
        notificationType: 'FOLLOW_UP_MISSED',
        category: 'FOLLOW_UP_REMINDER',
        title: 'Missed Follow-Up Appointment',
        message: `Your scheduled follow-up for referral ${referralId} was marked missed. Please contact Dr. ${docName}'s office to reschedule your care.`,
        isEssential: true
      });

      // Doctor alert
      if (followUp.responsibleDoctorId) {
        await createNotification({
          eventId,
          recipientUserId: followUp.responsibleDoctorId,
          recipientRole: 'doctor',
          relatedReferralId: referralId,
          relatedReferralRef: followUp.referralRef,
          notificationType: 'FOLLOW_UP_MISSED',
          category: 'FOLLOW_UP_REMINDER',
          title: 'Action Required: Patient Missed Follow-Up',
          message: `Patient ${patientId} missed the scheduled follow-up for referral ${referralId}. Please review and reschedule.`,
          isEssential: true
        });
      }
      break;
    }

    case 'FOLLOW_UP_RESCHEDULED':
      return await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: followUp.referralRef,
        notificationType: 'FOLLOW_UP_RESCHEDULED',
        category: 'FOLLOW_UP_REMINDER',
        title: 'Follow-Up Appointment Rescheduled',
        message: `Your follow-up visit for referral ${referralId} has been rescheduled to ${formattedDate}.`,
        isEssential: true
      });

    case 'FOLLOW_UP_COMPLETED':
      return await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: followUp.referralRef,
        notificationType: 'FOLLOW_UP_COMPLETED',
        category: 'FOLLOW_UP_REMINDER',
        title: 'Follow-Up Visit Completed',
        message: `Your follow-up appointment for referral ${referralId} has been completed and documented by your attending physician.`,
        isEssential: false
      });

    case 'FOLLOW_UP_CANCELLED':
      return await createNotification({
        eventId,
        recipientUserId: patientUserId,
        recipientPatientId: patientId,
        recipientRole: 'patient',
        relatedReferralId: referralId,
        relatedReferralRef: followUp.referralRef,
        notificationType: 'FOLLOW_UP_CANCELLED',
        category: 'FOLLOW_UP_REMINDER',
        title: 'Follow-Up Appointment Cancelled',
        message: `Your scheduled follow-up visit for referral ${referralId} has been cancelled by your care team.`,
        isEssential: true
      });

    default:
      break;
  }
}

/**
 * Dispatches automated notifications for high-priority monitoring findings (Phase 6).
 * Only CRITICAL and HIGH severity findings generate notifications.
 * Only authorized clinicians receive notifications; patients never receive internal risk assessments.
 */
async function notifyMonitoringAlert(alert) {
  if (!alert) return null;
  if (!['CRITICAL', 'HIGH'].includes(alert.riskClassification)) return null;

  const notifType = alert.riskClassification === 'CRITICAL'
    ? 'MONITORING_ALERT_CRITICAL'
    : 'MONITORING_ALERT_HIGH';

  // Deterministic event identifier: 1 notification per alert id per recipient
  const baseEventId = `MON_${alert.alertId || alert._id}`;

  const recipients = [];
  if (alert.responsibleDoctorId) {
    recipients.push(alert.responsibleDoctorId);
  }
  if (alert.referringDoctorId && (!alert.responsibleDoctorId || alert.referringDoctorId.toString() !== alert.responsibleDoctorId.toString())) {
    recipients.push(alert.referringDoctorId);
  }

  const isEssential = alert.riskClassification === 'CRITICAL';

  const results = [];
  for (const docId of recipients) {
    const docUser = await User.findById(docId);
    if (!docUser || docUser.role !== 'doctor') continue;

    // Check notification preferences before dispatch
    const canDeliver = shouldDeliverNotification(docUser, 'MONITORING_ALERT', isEssential);
    if (!canDeliver) continue;

    const notif = await createNotification({
      eventId: `${baseEventId}_${docId.toString()}`,
      recipientUserId: docId,
      recipientRole: 'doctor',
      relatedReferralId: alert.referralId,
      relatedReferralRef: alert.referralRef,
      notificationType: notifType,
      category: 'MONITORING_ALERT',
      title: `[Clinical Alert - ${alert.riskClassification}] ${alert.riskCategory.replace(/_/g, ' ')}`,
      message: `${alert.plainLanguageExplanation} Recommended action: ${alert.recommendedAction}`,
      isEssential
    });
    if (notif) results.push(notif);
  }

  return results;
}

module.exports = {
  createNotification,
  notifyReferralEvent,
  notifyFollowUpEvent,
  notifyMonitoringAlert,
  resolvePatientUser,
  shouldDeliverNotification
};
