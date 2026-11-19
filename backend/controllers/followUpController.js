const FollowUp = require('../models/FollowUp');
const Referral = require('../models/Referral');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const notificationService = require('../services/notificationService');
const { processFollowUpRemindersAndStatuses } = require('../services/followUpSchedulerService');

/**
 * Helper to check doctor authorization for a referral
 */
function isDoctorAuthorizedForReferral(doctorUser, referral) {
  const userIdStr = (doctorUser.userId || (doctorUser._id && doctorUser._id.toString()) || '').toString();
  const userHospital = ((doctorUser.hospitalName) || '').toLowerCase().trim();

  const isReceivingDoc = referral.receivingDoctorId && referral.receivingDoctorId.toString() === userIdStr;
  const isReferringDoc = referral.referringDoctorId && referral.referringDoctorId.toString() === userIdStr;
  const isReceivingHosp = userHospital && referral.receivingHospital && userHospital === referral.receivingHospital.toLowerCase().trim();

  return isReceivingDoc || isReferringDoc || isReceivingHosp;
}

/**
 * Schedule a new structured follow-up (Doctor Only)
 * POST /api/follow-ups
 */
exports.createFollowUp = async (req, res) => {
  try {
    const { referralId, dueDate, instructions, priority } = req.body;

    if (!referralId) {
      return res.status(400).json({
        success: false,
        error: { code: 'REFERRAL_ID_REQUIRED', message: 'Associated referral ID is required.' }
      });
    }

    if (!dueDate || isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DUE_DATE', message: 'A valid follow-up due date and time is required.' }
      });
    }

    // Find originating referral
    const referral = await Referral.findOne({
      $or: [
        { referralId: referralId.trim() },
        ...(referralId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: referralId }] : [])
      ]
    });

    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    // Verify doctor authorization
    if (!isDoctorAuthorizedForReferral(req.user, referral)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_FOLLOW_UP_CREATION', message: 'You are not authorized to create follow-ups for this referral.' }
      });
    }

    // Resolve Patient User
    const patientUser = await notificationService.resolvePatientUser(referral.patientId);

    const followUp = new FollowUp({
      referralRef: referral._id,
      referralId: referral.referralId,
      patientId: referral.patientId,
      patientUserId: patientUser ? patientUser._id : null,
      responsibleDoctorId: req.user.userId,
      responsibleDoctorUsername: req.user.username,
      responsibleDoctorName: req.user.name || req.user.username,
      targetHospital: referral.receivingHospital || req.user.hospitalName || 'Attending Center',
      targetDepartment: referral.receivingDepartment || 'Specialty Care',
      dueDate: new Date(dueDate),
      instructions: instructions ? instructions.trim() : '',
      priority: priority || referral.priority || 'Routine',
      status: 'SCHEDULED'
    });

    await followUp.save();

    // Update referral lifecycle
    const previousStatus = referral.status;
    referral.treatmentDocumentation.followUpRequired = true;
    if (instructions) {
      referral.treatmentDocumentation.followUpInstructions = instructions.trim();
    }

    if (['PENDING', 'ACKNOWLEDGED', 'ACCEPTED', 'IN_PROGRESS'].includes(referral.status)) {
      referral.status = 'FOLLOW_UP_REQUIRED';
    }

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'FOLLOW_UP_REQUIRED',
      previousStatus,
      newStatus: referral.status,
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: `Follow-up scheduled (${followUp.followUpId}) for ${new Date(dueDate).toLocaleString()}. Instructions: ${instructions || 'Standard follow-up care'}`
    });

    await referral.save();

    await AuditLog.create({
      action: 'FOLLOW_UP_CREATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        followUpId: followUp.followUpId,
        referralId: referral.referralId,
        dueDate: followUp.dueDate
      }
    });

    // Automated Notification (Phase 5)
    await notificationService.notifyFollowUpEvent('FOLLOW_UP_SCHEDULED', followUp);

    return res.status(201).json({
      success: true,
      message: 'Follow-up appointment successfully scheduled.',
      followUp
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error scheduling follow-up.' }
    });
  }
};

/**
 * List Follow-Ups (Role-based & IDOR protected)
 * GET /api/follow-ups
 */
exports.getFollowUps = async (req, res) => {
  try {
    const { referralId, status, filter } = req.query;
    let baseQuery = {};

    if (req.user.role === 'patient') {
      // Canonical identity enforcement: patients can ONLY view their own follow-ups
      const verifiedUsername = ((req.currentUser && req.currentUser.username) || (req.user && req.user.username) || '').trim();
      baseQuery.$or = [
        { patientUserId: req.user.userId },
        ...(verifiedUsername ? [{ patientId: new RegExp(`^${verifiedUsername}$`, 'i') }] : [])
      ];
    } else {
      // Doctor: follow-ups where they are responsible or for authorized referrals
      baseQuery.responsibleDoctorId = req.user.userId;
    }

    if (referralId) {
      baseQuery.referralId = referralId.trim();
    }

    if (status) {
      baseQuery.status = status;
    } else if (filter) {
      switch (filter) {
        case 'upcoming':
          baseQuery.status = { $in: ['SCHEDULED', 'UPCOMING', 'DUE'] };
          break;
        case 'overdue':
          baseQuery.status = 'OVERDUE';
          break;
        case 'missed':
          baseQuery.status = 'MISSED';
          break;
        case 'completed':
          baseQuery.status = 'COMPLETED';
          break;
        default:
          break;
      }
    }

    const followUps = await FollowUp.find(baseQuery).sort({ dueDate: 1 });

    // Summary counts for dashboard badges
    let countQuery = {};
    if (req.user.role === 'patient') {
      const verifiedUsername = ((req.currentUser && req.currentUser.username) || (req.user && req.user.username) || '').trim();
      countQuery.$or = [
        { patientUserId: req.user.userId },
        ...(verifiedUsername ? [{ patientId: new RegExp(`^${verifiedUsername}$`, 'i') }] : [])
      ];
    } else {
      countQuery.responsibleDoctorId = req.user.userId;
    }

    const [upcomingCount, overdueCount, missedCount, completedCount] = await Promise.all([
      FollowUp.countDocuments({ ...countQuery, status: { $in: ['SCHEDULED', 'UPCOMING', 'DUE'] } }),
      FollowUp.countDocuments({ ...countQuery, status: 'OVERDUE' }),
      FollowUp.countDocuments({ ...countQuery, status: 'MISSED' }),
      FollowUp.countDocuments({ ...countQuery, status: 'COMPLETED' })
    ]);

    return res.status(200).json({
      success: true,
      count: followUps.length,
      summary: {
        upcomingCount,
        overdueCount,
        missedCount,
        completedCount
      },
      followUps
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving follow-ups.' }
    });
  }
};

/**
 * Get Single Follow-Up by ID
 * GET /api/follow-ups/:id
 */
exports.getFollowUpById = async (req, res) => {
  try {
    const { id } = req.params;
    const followUp = await FollowUp.findOne({
      $or: [
        { followUpId: id },
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])
      ]
    });

    if (!followUp) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Follow-up record not found.' }
      });
    }

    // IDOR Protection: Patient can only view their own
    if (req.user.role === 'patient') {
      const patUserIdStr = (req.user.userId || '').toString();
      const patUsername = (req.user.username || '').toLowerCase();
      const fPidStr = followUp.patientUserId ? followUp.patientUserId.toString() : '';
      const fPid = (followUp.patientId || '').toLowerCase();

      const isOwner = (fPidStr && fPidStr === patUserIdStr) || (fPid && fPid === patUsername);
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN_ACCESS', message: 'You are not authorized to view this follow-up.' }
        });
      }
    }

    return res.status(200).json({
      success: true,
      followUp
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error fetching follow-up.' }
    });
  }
};

/**
 * Reschedule Follow-Up (Doctor Only)
 * PATCH /api/follow-ups/:id/reschedule
 */
exports.rescheduleFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const { newDueDate, reason } = req.body;

    if (!newDueDate || isNaN(new Date(newDueDate).getTime())) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DUE_DATE', message: 'A valid new due date and time is required.' }
      });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'RESCHEDULE_REASON_REQUIRED', message: 'Clinical or logistical reason for rescheduling is mandatory.' }
      });
    }

    const followUp = await FollowUp.findOne({
      $or: [
        { followUpId: id },
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])
      ]
    });

    if (!followUp) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Follow-up record not found.' }
      });
    }

    if (followUp.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_COMPLETED', message: 'Completed follow-ups cannot be rescheduled.' }
      });
    }

    if (followUp.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: { code: 'CANNOT_RESCHEDULE_CANCELLED', message: 'Cancelled follow-ups cannot be rescheduled.' }
      });
    }

    const referral = await Referral.findOne({
      $or: [
        { _id: followUp.referralRef },
        { referralId: followUp.referralId }
      ]
    });

    if (referral && !isDoctorAuthorizedForReferral(req.user, referral)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_FOLLOW_UP_ACTION', message: 'You are not authorized to reschedule this follow-up.' }
      });
    }

    // Record in rescheduleHistory
    followUp.rescheduleHistory.push({
      previousDueDate: followUp.dueDate,
      newDueDate: new Date(newDueDate),
      reason: reason.trim(),
      rescheduledByDoctorId: req.user.userId,
      rescheduledByDoctorUsername: req.user.username,
      timestamp: new Date()
    });

    followUp.dueDate = new Date(newDueDate);
    followUp.status = 'SCHEDULED';
    followUp.missedAt = null;
    // Invalidate obsolete reminders for the old due date so fresh reminders fire for the new date
    followUp.remindersSent = [];

    await followUp.save();

    // Audit Log & Timeline
    await AuditLog.create({
      action: 'FOLLOW_UP_RESCHEDULED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        followUpId: followUp.followUpId,
        referralId: followUp.referralId,
        newDueDate: followUp.dueDate,
        reason: reason.trim()
      }
    });

    if (referral) {
      if (!referral.timeline) referral.timeline = [];
      referral.timeline.push({
        eventType: 'STATUS_UPDATED',
        previousStatus: referral.status,
        newStatus: referral.status,
        performingUserId: req.user.userId,
        performingUsername: req.user.username,
        performingUserRole: req.user.role,
        timestamp: new Date(),
        notes: `Follow-up (${followUp.followUpId}) rescheduled to ${new Date(newDueDate).toLocaleString()}. Reason: ${reason.trim()}`
      });
      await referral.save();
    }

    // Automated Patient Notification
    await notificationService.notifyFollowUpEvent('FOLLOW_UP_RESCHEDULED', followUp);

    return res.status(200).json({
      success: true,
      message: 'Follow-up successfully rescheduled.',
      followUp
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error rescheduling follow-up.' }
    });
  }
};

/**
 * Record Patient Attendance Check-In (Doctor or Patient)
 * PATCH /api/follow-ups/:id/attendance
 */
exports.recordAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { attended = true, notes = '' } = req.body;

    const followUp = await FollowUp.findOne({
      $or: [
        { followUpId: id },
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])
      ]
    });

    if (!followUp) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Follow-up record not found.' }
      });
    }

    // Patient check-in verification
    if (req.user.role === 'patient') {
      const patUserIdStr = (req.user.userId || '').toString();
      const patUsername = (req.user.username || '').toLowerCase();
      const fPidStr = followUp.patientUserId ? followUp.patientUserId.toString() : '';
      const fPid = (followUp.patientId || '').toLowerCase();

      const isOwner = (fPidStr && fPidStr === patUserIdStr) || (fPid && fPid === patUsername);
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN_ACCESS', message: 'You are not authorized to check in for this follow-up.' }
        });
      }
    }

    followUp.attendance = {
      attended: Boolean(attended),
      attendedAt: new Date(),
      confirmedBy: req.user.role === 'patient' ? 'PATIENT' : 'DOCTOR',
      notes: notes.trim()
    };

    await followUp.save();

    return res.status(200).json({
      success: true,
      message: 'Follow-up attendance check-in recorded successfully.',
      attendance: followUp.attendance
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error recording attendance.' }
    });
  }
};

/**
 * Complete and Document Clinical Follow-Up (Doctor Only)
 * POST /api/follow-ups/:id/complete
 */
exports.completeFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      outcomeNotes,
      treatmentSummary,
      clinicalObservations,
      proceduresPerformed,
      medicationsAdministered,
      followUpAddressed = true
    } = req.body;

    const followUp = await FollowUp.findOne({
      $or: [
        { followUpId: id },
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])
      ]
    });

    if (!followUp) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Follow-up record not found.' }
      });
    }

    if (followUp.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_COMPLETED', message: 'Follow-up is already completed.' }
      });
    }

    if (followUp.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: { code: 'CANNOT_COMPLETE_CANCELLED', message: 'Cancelled follow-ups cannot be completed.' }
      });
    }

    const referral = await Referral.findOne({
      $or: [
        { _id: followUp.referralRef },
        { referralId: followUp.referralId }
      ]
    });

    if (referral && !isDoctorAuthorizedForReferral(req.user, referral)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_FOLLOW_UP_ACTION', message: 'You are not authorized to complete this follow-up.' }
      });
    }

    // Clinical completion
    followUp.status = 'COMPLETED';
    followUp.clinicalCompletion = {
      isCompleted: true,
      completedAt: new Date(),
      completedByDoctorId: req.user.userId,
      completedByDoctorUsername: req.user.username,
      completedByDoctorName: req.user.name || req.user.username,
      outcomeNotes: (outcomeNotes && outcomeNotes.trim()) || 'Follow-up clinical assessment concluded successfully.',
      treatmentSummary: (treatmentSummary && treatmentSummary.trim()) || 'Follow-up consultation documented.'
    };
    followUp.attendance.attended = true;
    if (!followUp.attendance.attendedAt) followUp.attendance.attendedAt = new Date();
    if (!followUp.attendance.confirmedBy) followUp.attendance.confirmedBy = 'DOCTOR';

    await followUp.save();

    // Update originating referral
    if (referral) {
      if (treatmentSummary) {
        referral.treatmentDocumentation.treatmentSummary = treatmentSummary.trim();
        referral.treatmentDocumentation.documentedAt = new Date();
        referral.treatmentDocumentation.responsibleDoctorId = req.user.userId;
        referral.treatmentDocumentation.responsibleDoctorUsername = req.user.username;
        referral.treatmentDocumentation.responsibleDoctorName = req.user.name || req.user.username;
      }
      if (clinicalObservations) {
        referral.treatmentDocumentation.clinicalObservations = clinicalObservations.trim();
      }

      if (followUpAddressed) {
        referral.careConfirmation.followUpAddressed = true;
        referral.careConfirmation.followUpPlan = `Resolved via completed follow-up ${followUp.followUpId}`;
      }

      if (!referral.timeline) referral.timeline = [];
      referral.timeline.push({
        eventType: 'STATUS_UPDATED',
        previousStatus: referral.status,
        newStatus: referral.status,
        performingUserId: req.user.userId,
        performingUsername: req.user.username,
        performingUserRole: req.user.role,
        timestamp: new Date(),
        notes: `Clinical follow-up ${followUp.followUpId} completed. Outcome: ${followUp.clinicalCompletion.outcomeNotes}`
      });

      await referral.save();
    }

    await AuditLog.create({
      action: 'FOLLOW_UP_COMPLETED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        followUpId: followUp.followUpId,
        referralId: followUp.referralId,
        outcomeNotes: followUp.clinicalCompletion.outcomeNotes
      }
    });

    // Automated Patient Notification
    await notificationService.notifyFollowUpEvent('FOLLOW_UP_COMPLETED', followUp);

    return res.status(200).json({
      success: true,
      message: 'Follow-up care clinically documented and completed.',
      followUp
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error completing follow-up.' }
    });
  }
};

/**
 * Cancel Follow-Up (Doctor Only)
 * PATCH /api/follow-ups/:id/cancel
 */
exports.cancelFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const followUp = await FollowUp.findOne({
      $or: [
        { followUpId: id },
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])
      ]
    });

    if (!followUp) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Follow-up record not found.' }
      });
    }

    if (followUp.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: { code: 'CANNOT_CANCEL_COMPLETED', message: 'Completed follow-ups cannot be cancelled.' }
      });
    }

    if (followUp.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_CANCELLED', message: 'Follow-up is already cancelled.' }
      });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'CANCELLATION_REASON_REQUIRED', message: 'A documented reason for cancellation is mandatory.' }
      });
    }

    const referral = await Referral.findOne({
      $or: [
        { _id: followUp.referralRef },
        { referralId: followUp.referralId }
      ]
    });

    if (referral && !isDoctorAuthorizedForReferral(req.user, referral)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_FOLLOW_UP_ACTION', message: 'You are not authorized to cancel this follow-up.' }
      });
    }

    followUp.status = 'CANCELLED';
    followUp.cancellation = {
      isCancelled: true,
      cancelledAt: new Date(),
      cancelledByDoctorId: req.user.userId,
      cancelledByDoctorUsername: req.user.username,
      reason: (reason && reason.trim()) || 'Cancelled by attending physician'
    };

    await followUp.save();

    if (referral) {
      if (!referral.timeline) referral.timeline = [];
      referral.timeline.push({
        eventType: 'STATUS_UPDATED',
        previousStatus: referral.status,
        newStatus: referral.status,
        performingUserId: req.user.userId,
        performingUsername: req.user.username,
        performingUserRole: req.user.role,
        timestamp: new Date(),
        notes: `Follow-up ${followUp.followUpId} cancelled. Reason: ${followUp.cancellation.reason}`
      });
      await referral.save();
    }

    await AuditLog.create({
      action: 'FOLLOW_UP_CANCELLED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        followUpId: followUp.followUpId,
        referralId: followUp.referralId,
        reason: followUp.cancellation.reason
      }
    });

    // Automated Patient Notification
    await notificationService.notifyFollowUpEvent('FOLLOW_UP_CANCELLED', followUp);

    return res.status(200).json({
      success: true,
      message: 'Follow-up appointment cancelled.',
      followUp
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error cancelling follow-up.' }
    });
  }
};

/**
 * Diagnostic / Manual trigger for automated follow-up scheduler processing
 * POST /api/follow-ups/trigger-check
 */
exports.triggerSchedulerCycle = async (req, res) => {
  try {
    const { customNow } = req.body;
    const stats = await processFollowUpRemindersAndStatuses(customNow);
    return res.status(200).json({
      success: true,
      message: 'Follow-up scheduler cycle executed successfully.',
      stats
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error running scheduler cycle.' }
    });
  }
};
