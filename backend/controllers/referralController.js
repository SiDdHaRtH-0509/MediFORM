const crypto = require('crypto');
const mongoose = require('mongoose');
const Referral = require('../models/Referral');
const FollowUp = require('../models/FollowUp');
const Screening = require('../models/Screening');
const Transfer = require('../models/Transfer');
const User = require('../models/User');
const QRSession = require('../models/QRSession');
const AuditLog = require('../models/AuditLog');
const Consent = require('../models/Consent');
const consentService = require('../services/consentService');
const cryptoService = require('../services/cryptoService');
const notificationService = require('../services/notificationService');
const userController = require('./userController');

function generateReferralId() {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  return `REF-${year}-${randomSuffix}`;
}

function generateRandomPin() {
  return cryptoService.generateSecurePIN();
}

function isAuthorizedForPatient(user, pid) {
  if (user.role === 'doctor') return true;
  if (user.role === 'patient') {
    const userPid = (user.username || '').toLowerCase();
    const targetPid = (pid || '').toLowerCase();
    return userPid === targetPid || targetPid.includes(userPid);
  }
  return false;
}

// Lifecycle Permitted State Transitions (Phase 3)
const VALID_TRANSITIONS = {
  'PENDING': ['ACKNOWLEDGED', 'ACCEPTED', 'REJECTED', 'CANCELLED'],
  'ACKNOWLEDGED': ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  'ACCEPTED': ['IN_PROGRESS', 'REJECTED', 'CANCELLED'],
  'IN_PROGRESS': ['FOLLOW_UP_REQUIRED', 'COMPLETED', 'CANCELLED'],
  'FOLLOW_UP_REQUIRED': ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  'IN_TRANSIT': ['ACKNOWLEDGED', 'ACCEPTED', 'IN_PROGRESS', 'CANCELLED'],
  'COMPLETED': [], // Terminal
  'REJECTED': ['PENDING'], // Can only be reset via formal reassignment
  'CANCELLED': [] // Terminal
};

async function findReferral(id) {
  if (!id) return null;
  if (typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/)) {
    return await Referral.findById(id);
  }
  return await Referral.findOne({ referralId: id });
}

function isAuthorizedReceivingDoctor(user, referral) {
  if (user.role !== 'doctor') return false;
  const userIdStr = (user.userId || '').toString();
  const userHospital = (user.hospitalName || (user.currentUser && user.currentUser.hospitalName) || '').toLowerCase();
  
  const recDocIdStr = referral.receivingDoctorId ? referral.receivingDoctorId.toString() : '';
  const refDocIdStr = referral.referringDoctorId ? referral.referringDoctorId.toString() : '';
  const recHosp = (referral.receivingHospital || '').toLowerCase();

  // If user is the referring doctor and not the assigned receiving doctor, they cannot act as receiving doctor
  if (refDocIdStr && refDocIdStr === userIdStr && recDocIdStr && recDocIdStr !== userIdStr) {
    return false;
  }

  // Explicitly assigned receiving doctor
  if (recDocIdStr && recDocIdStr === userIdStr) return true;

  // Unassigned referral or authorized receiving hospital delegate
  if (userHospital && recHosp && userHospital === recHosp && refDocIdStr !== userIdStr) {
    return true;
  }

  return false;
}

// Doctor Directory alias export for /api/referrals/doctors
exports.getDoctorsDirectory = userController.getDoctorsDirectory;

/**
 * Initiate Referral from a Flagged Screening Result (Doctor only)
 */
exports.createReferralFromScreening = async (req, res) => {
  try {
    const {
      sourceScreeningId,
      clinicalReason,
      priority,
      receivingHospital,
      receivingDepartment = 'Emergency / Triage',
      receivingDoctorId,
      receivingDoctorUsername,
      receivingDoctorName,
      allowDuplicate = false,
      duplicateAuthorizationReason
    } = req.body;

    if (!sourceScreeningId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_SOURCE_SCREENING', message: 'Source screening ID is required to initiate a referral.' }
      });
    }

    if (!clinicalReason || !clinicalReason.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_CLINICAL_REASON', message: 'Clinical reason for referral is required.' }
      });
    }

    // Locate source screening (by screeningId or Mongo _id)
    let screening = null;
    if (sourceScreeningId.match(/^[0-9a-fA-F]{24}$/)) {
      screening = await Screening.findById(sourceScreeningId);
    }
    if (!screening) {
      screening = await Screening.findOne({ screeningId: sourceScreeningId });
    }

    if (!screening) {
      return res.status(404).json({
        success: false,
        error: { code: 'SCREENING_NOT_FOUND', message: 'Source screening record does not exist.' }
      });
    }

    // 1. Consent Validation (Security Requirement)
    if (!screening.patientConsent || screening.patientConsent.consentGiven === false) {
      await AuditLog.create({
        action: 'REFERRAL_CREATION_BLOCKED_NO_CONSENT',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { screeningId: screening.screeningId, pid: screening.pid }
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'CONSENT_REQUIRED',
          message: 'Patient consent must be verified and recorded before initiating an external referral.'
        }
      });
    }

    // 2. Screening Flagging Verification
    // Normal screening results do not generate referrals; must be flagged by CDS
    if (!screening.evaluation || !screening.evaluation.isFlagged) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SCREENING_NOT_FLAGGED',
          message: 'Only screening results classified as abnormal, concerning, or requiring clinical attention can generate a referral. Normal screenings cannot be referred.'
        }
      });
    }

    // 3. Referral-Screening Relationship & Duplicate Prevention
    const existingActiveReferral = await Referral.findOne({
      sourceScreeningRef: screening._id,
      status: { $in: ['PENDING', 'ACCEPTED', 'IN_TRANSIT'] }
    });

    if (existingActiveReferral && !allowDuplicate) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_REFERRAL_EXISTS',
          message: `An active referral (${existingActiveReferral.referralId}) already exists for this screening event. Duplicate active referrals require explicit authorization.`,
          existingReferralId: existingActiveReferral.referralId
        }
      });
    }

    if (existingActiveReferral && allowDuplicate) {
      await AuditLog.create({
        action: 'DUPLICATE_REFERRAL_EXPLICITLY_AUTHORIZED',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: {
          sourceScreeningId: screening.screeningId,
          existingReferralId: existingActiveReferral.referralId,
          reason: duplicateAuthorizationReason || 'Clinical escalation requested by doctor.'
        }
      });
    }

    // 4. Validate Receiving Doctor Identity (Never trust free-text identities as proof)
    let validatedReceivingDoctor = null;
    if (receivingDoctorId) {
      if (!mongoose.Types.ObjectId.isValid(receivingDoctorId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_RECEIVING_DOCTOR', message: 'Target receiving doctor ID is not a valid identifier.' }
        });
      }
      validatedReceivingDoctor = await User.findById(receivingDoctorId);
      if (!validatedReceivingDoctor || validatedReceivingDoctor.role !== 'doctor') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_RECEIVING_DOCTOR', message: 'Target receiving doctor is not a valid registered doctor account.' }
        });
      }
    }

    // Determine referral priority
    const finalPriority = priority || screening.evaluation.recommendedPriority || 'Urgent';
    const referringHospital = screening.hospital || req.user.hospitalName || 'Referring Facility';
    const targetHospital = receivingHospital || (validatedReceivingDoctor ? validatedReceivingDoctor.hospitalName : null) || 'Receiving Specialty Medical Center';
    const targetDepartment = receivingDepartment || (validatedReceivingDoctor ? validatedReceivingDoctor.department : null) || 'Emergency / Triage';

    // Verify patient hasn't revoked consent for target receiving hospital or doctor
    const revokedConsent = await Consent.findOne({
      patientId: new RegExp(`^${screening.pid}$`, 'i'),
      status: 'REVOKED',
      $or: [
        { authorizedHospital: new RegExp(`^${targetHospital}$`, 'i') },
        ...(validatedReceivingDoctor ? [{ authorizedDoctorId: validatedReceivingDoctor._id }] : [])
      ]
    }).sort({ revokedAt: -1 });

    const activeConsent = await Consent.findOne({
      patientId: new RegExp(`^${screening.pid}$`, 'i'),
      status: 'GRANTED',
      expiresAt: { $gt: new Date() },
      $or: [
        { authorizedHospital: new RegExp(`^${targetHospital}$`, 'i') },
        ...(validatedReceivingDoctor ? [{ authorizedDoctorId: validatedReceivingDoctor._id }] : [])
      ]
    }).sort({ createdAt: -1 });

    if (revokedConsent && (!activeConsent || activeConsent.createdAt < revokedConsent.revokedAt)) {
      await AuditLog.create({
        action: 'REFERRAL_CREATION_BLOCKED_CONSENT_REVOKED',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { screeningId: screening.screeningId, pid: screening.pid, targetHospital }
      });
      return res.status(403).json({
        success: false,
        error: {
          code: 'CONSENT_REVOKED',
          message: 'Patient has explicitly revoked consent for data sharing with the receiving hospital or doctor.'
        }
      });
    }

    let uniqueReferralId = generateReferralId();
    let collisionCheck = await Referral.findOne({ referralId: uniqueReferralId });
    while (collisionCheck) {
      uniqueReferralId = generateReferralId();
      collisionCheck = await Referral.findOne({ referralId: uniqueReferralId });
    }

    // 5. Existing Handoff Integration (Connects with QR/PIN Transfer model)
    const formattedMeds = (screening.medications || []).map(m => ({
      n: m.name || m.n || 'Unspecified',
      d: m.dose || m.d || '',
      r: m.route || m.r || 'Oral',
      frequency: m.frequency || '',
      notes: m.notes || ''
    }));

    const formattedInvestigations = (screening.investigations || []).map(inv =>
      typeof inv === 'string' ? inv : `${inv.name} [${inv.status}]: ${inv.notes || ''}`
    );

    const recipientUserIds = validatedReceivingDoctor ? [validatedReceivingDoctor._id] : [];
    const recipientUsernames = validatedReceivingDoctor ? [validatedReceivingDoctor.username] : [];

    const transfer = new Transfer({
      pid: screening.pid,
      nam: screening.patientName,
      age: screening.age,
      gender: screening.gender,
      bg: screening.bloodGroup || 'Unknown',
      contactNumber: screening.contactNumber,
      emergencyContact: screening.emergencyContact,
      fh: referringHospital,
      th: targetHospital,
      rt: clinicalReason.trim(),
      priority: finalPriority,
      referringDoctor: req.user.name || req.user.username,
      receivingDepartment: targetDepartment,
      pd: screening.clinicalNotes || screening.evaluation.summary || 'Flagged Screening Referral',
      sum: `Clinical Referral ${uniqueReferralId} from Screening ${screening.screeningId}. Reason: ${clinicalReason.trim()}. Assessment: ${screening.evaluation.summary}`,
      alg: screening.allergies || [],
      noKnownAllergies: (screening.allergies || []).length === 0,
      med: formattedMeds,
      vit: screening.vitals || {},
      pi: formattedInvestigations,
      otherDetails: [
        { title: 'Referral ID', value: uniqueReferralId, category: 'ADMINISTRATIVE', priority: 'IMPORTANT' },
        { title: 'Source Screening ID', value: screening.screeningId, category: 'ADMINISTRATIVE', priority: 'IMPORTANT' },
        { title: 'NEWS2 Score', value: `${screening.evaluation.news2Score} (${screening.evaluation.riskLevel} RISK)`, category: 'PROCEDURE', priority: screening.evaluation.riskLevel === 'HIGH' ? 'CRITICAL' : 'IMPORTANT' }
      ],
      issuerUserId: req.user.userId,
      issuerUsername: req.user.username,
      recipientUserIds,
      recipientUsernames,
      status: 'IN_TRANSIT',
      acknowledgementStatus: 'PENDING',
      isCurrent: true,
      version: 1,
      history: [{
        action: 'REFERRAL_HANDOFF_INITIATED',
        timestamp: new Date(),
        doctorUsername: req.user.username,
        hospital: referringHospital,
        version: 1,
        notes: `Transfer created for referral ${uniqueReferralId} based on screening ${screening.screeningId}`
      }],
      sourceScreeningId: screening.screeningId
    });

    await transfer.save();

    // 6. Create the Referral with Ownership Model (Phase 2) & Audit Timeline (Phase 3)
    const assignmentHistory = validatedReceivingDoctor ? [{
      previousReceivingDoctorId: null,
      previousReceivingDoctorUsername: null,
      previousReceivingDoctorName: null,
      newReceivingDoctorId: validatedReceivingDoctor._id,
      newReceivingDoctorUsername: validatedReceivingDoctor.username,
      newReceivingDoctorName: validatedReceivingDoctor.name || validatedReceivingDoctor.username,
      assignedByUserId: req.user.userId,
      assignedByUsername: req.user.username,
      timestamp: new Date(),
      reason: 'Initial referral doctor assignment'
    }] : [];

    const initialTimeline = [
      {
        eventType: 'REFERRAL_CREATED',
        previousStatus: null,
        newStatus: 'PENDING',
        performingUserId: req.user.userId,
        performingUsername: req.user.username,
        performingUserRole: req.user.role,
        timestamp: new Date(),
        notes: `Referral initiated from screening ${screening.screeningId}`
      }
    ];

    if (validatedReceivingDoctor) {
      initialTimeline.push({
        eventType: 'DOCTOR_ASSIGNED',
        previousStatus: 'PENDING',
        newStatus: 'PENDING',
        performingUserId: req.user.userId,
        performingUsername: req.user.username,
        performingUserRole: req.user.role,
        timestamp: new Date(),
        notes: `Assigned to Dr. ${validatedReceivingDoctor.name || validatedReceivingDoctor.username}`
      });
    }

    initialTimeline.push({
      eventType: 'HANDOFF_INITIATED',
      previousStatus: 'PENDING',
      newStatus: 'PENDING',
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: `Handoff transfer record ${transfer._id} generated for secure clinical transport`
    });

    const referral = new Referral({
      referralId: uniqueReferralId,
      patientId: screening.pid,
      patientName: screening.patientName,
      sourceScreeningId: screening.screeningId,
      sourceScreeningRef: screening._id,
      referringDoctorId: req.user.userId,
      referringDoctorUsername: req.user.username,
      referringDoctorName: req.user.name || '',
      referringHospital: referringHospital,
      receivingDoctorId: validatedReceivingDoctor ? validatedReceivingDoctor._id : null,
      receivingDoctorUsername: validatedReceivingDoctor ? validatedReceivingDoctor.username : null,
      receivingDoctorName: validatedReceivingDoctor ? (validatedReceivingDoctor.name || validatedReceivingDoctor.username) : null,
      receivingHospital: targetHospital,
      receivingDepartment: targetDepartment,
      assignmentTimestamp: validatedReceivingDoctor ? new Date() : null,
      assignedBy: validatedReceivingDoctor ? req.user.userId : null,
      assignmentHistory,
      timeline: initialTimeline,
      clinicalReason: clinicalReason.trim(),
      relevantScreeningResult: {
        news2Score: screening.evaluation.news2Score,
        riskLevel: screening.evaluation.riskLevel,
        flagReasons: screening.evaluation.flagReasons,
        vitalsSummary: screening.vitals,
        findingsSummary: screening.evaluation.summary
      },
      priority: finalPriority,
      status: 'PENDING',
      transferId: transfer._id,
      patientConsentValidated: true,
      patientConsentTimestamp: screening.patientConsent.consentTimestamp || new Date(),
      isDuplicateAuthorized: Boolean(allowDuplicate),
      duplicateAuthorizationReason: allowDuplicate ? duplicateAuthorizationReason : null
    });

    await referral.save();

    // Update transfer with referral link
    transfer.referralId = referral._id;
    await transfer.save();

    // Maintain verifiable two-way relationship in Screening
    screening.activeReferralId = referral._id;
    screening.referralHistory.push(referral._id);
    await screening.save();

    // Audit Trail
    await AuditLog.create({
      action: 'REFERRAL_CREATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        referralId: referral.referralId,
        sourceScreeningId: screening.screeningId,
        patientId: referral.patientId,
        priority: referral.priority,
        transferId: transfer._id,
        receivingDoctorId: validatedReceivingDoctor ? validatedReceivingDoctor._id : null,
        isDuplicateAuthorized: Boolean(allowDuplicate)
      }
    });

    // Register Specialist Referral Consent record for new receiving hospital/doctor
    try {
      let patientUserObj = await User.findOne({
        $or: [{ username: referral.patientId.toLowerCase() }, { email: referral.patientId.toLowerCase() }]
      });
      if (!patientUserObj) {
        try {
          patientUserObj = await User.create({
            username: referral.patientId,
            email: `${referral.patientId.toLowerCase()}@mediform.internal`,
            name: referral.patientName || referral.patientId,
            role: 'patient',
            isEmailVerified: true
          });
        } catch (uErr) {
          patientUserObj = await User.findOne({ username: referral.patientId });
        }
      }
      if (patientUserObj && targetHospital) {
        await consentService.createConsentRecord({
          patientUserId: patientUserObj._id,
          patientId: referral.patientId,
          patientName: referral.patientName,
          purpose: 'SPECIALIST_REFERRAL',
          authorizedDoctorId: validatedReceivingDoctor ? validatedReceivingDoctor._id : null,
          authorizedDoctorName: validatedReceivingDoctor ? (validatedReceivingDoctor.name || validatedReceivingDoctor.username) : '',
          authorizedHospital: targetHospital,
          durationDays: 30,
          metadata: { referralId: referral.referralId, screeningId: screening.screeningId },
          actorId: req.user.userId,
          actorRole: 'doctor'
        });
      }
    } catch (cErr) {
      // Non-blocking
    }

    // Automated Patient & Clinician Notifications (Phase 4 / 4.1 Idempotent Event)
    const creationTimelineEntry = referral.timeline && referral.timeline.find(t => t.eventType === 'REFERRAL_CREATED');
    await notificationService.notifyReferralEvent('REFERRAL_CREATED', referral, {
      eventId: creationTimelineEntry ? creationTimelineEntry._id.toString() : undefined
    });

    return res.status(201).json({
      success: true,
      message: 'Referral created successfully and linked to source screening and handoff transfer.',
      referral,
      transfer
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error creating referral.' }
    });
  }
};

/**
 * Reassign Referral to a different registered Receiving Doctor (Doctor only)
 */
exports.reassignReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const receivingDoctorId = req.body.receivingDoctorId || req.body.newReceivingDoctorId;
    const { reason, department } = req.body;

    if (!receivingDoctorId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_RECEIVING_DOCTOR', message: 'Target receiving doctor ID is required.' }
      });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_REASSIGNMENT_REASON', message: 'A clinical reason for reassignment is mandatory.' }
      });
    }

    let referral = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      referral = await Referral.findById(id);
    }
    if (!referral) {
      referral = await Referral.findOne({ referralId: id });
    }

    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    // Authorization: User must be doctor
    if (req.user.role !== 'doctor') {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ROLE', message: 'Only authorized doctors can reassign referrals.' }
      });
    }

    // Authorization Check:
    // User must be referring doctor, current receiving doctor, or doctor at referring/receiving hospital
    const userIdStr = (req.user.userId || '').toString();
    const userHospital = (req.user.hospitalName || (req.currentUser && req.currentUser.hospitalName) || '').toLowerCase();
    const refDocIdStr = referral.referringDoctorId ? referral.referringDoctorId.toString() : '';
    const recDocIdStr = referral.receivingDoctorId ? referral.receivingDoctorId.toString() : '';
    const refHosp = (referral.referringHospital || '').toLowerCase();
    const recHosp = (referral.receivingHospital || '').toLowerCase();

    const isReferringDoctor = refDocIdStr === userIdStr;
    const isCurrentReceiving = recDocIdStr === userIdStr;
    const isHospitalStaff = userHospital && (userHospital === refHosp || userHospital === recHosp);

    if (!isReferringDoctor && !isCurrentReceiving && !isHospitalStaff) {
      await AuditLog.create({
        action: 'UNAUTHORIZED_REASSIGNMENT_ATTEMPT',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { referralId: referral.referralId, targetDoctorId: receivingDoctorId, reason: reason.trim() }
      });
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_REASSIGNMENT', message: 'You are not authorized to reassign this referral.' }
      });
    }

    // Validate Target Receiving Doctor exists and is an authorized doctor
    if (!mongoose.Types.ObjectId.isValid(receivingDoctorId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_RECEIVING_DOCTOR', message: 'Invalid receiving doctor ID format.' }
      });
    }

    const targetDoctor = await User.findById(receivingDoctorId);
    if (!targetDoctor || targetDoctor.role !== 'doctor') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_RECEIVING_DOCTOR', message: 'Selected target doctor is not a valid registered doctor account.' }
      });
    }

    // Capture previous assignment details
    const previousDoctorId = referral.receivingDoctorId;
    const previousDoctorUsername = referral.receivingDoctorUsername;
    const previousDoctorName = referral.receivingDoctorName;

    // Apply updates
    referral.receivingDoctorId = targetDoctor._id;
    referral.receivingDoctorUsername = targetDoctor.username;
    referral.receivingDoctorName = targetDoctor.name || targetDoctor.username;
    if (targetDoctor.hospitalName) {
      referral.receivingHospital = targetDoctor.hospitalName;
    }
    if (department && department.trim()) {
      referral.receivingDepartment = department.trim();
    }
    referral.assignmentTimestamp = new Date();
    referral.assignedBy = req.user.userId;

    // Escalation / Reassignment Path: If referral was REJECTED, reset to PENDING for the newly assigned doctor
    const prevStatus = referral.status;
    if (referral.status === 'REJECTED') {
      referral.status = 'PENDING';
      referral.rejection = undefined;
    }

    // Preserve assignment history (Never silently overwrite)
    referral.assignmentHistory.push({
      previousReceivingDoctorId: previousDoctorId,
      previousReceivingDoctorUsername: previousDoctorUsername,
      previousReceivingDoctorName: previousDoctorName,
      newReceivingDoctorId: targetDoctor._id,
      newReceivingDoctorUsername: targetDoctor.username,
      newReceivingDoctorName: targetDoctor.name || targetDoctor.username,
      assignedByUserId: req.user.userId,
      assignedByUsername: req.user.username,
      timestamp: new Date(),
      reason: reason.trim()
    });

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'REFERRAL_REASSIGNED',
      previousStatus: prevStatus,
      newStatus: referral.status,
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      reason: reason.trim(),
      notes: `Reassigned from Dr. ${previousDoctorName || 'Unassigned'} to Dr. ${targetDoctor.name || targetDoctor.username}`
    });

    referral.timeline.push({
      eventType: 'DOCTOR_ASSIGNED',
      previousStatus: referral.status,
      newStatus: referral.status,
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: `Assigned to Dr. ${targetDoctor.name || targetDoctor.username} (${targetDoctor.hospitalName || 'Target Hospital'})`
    });

    await referral.save();

    // Update underlying Transfer recipient access
    if (referral.transferId) {
      const transfer = await Transfer.findById(referral.transferId);
      if (transfer) {
        if (!transfer.recipientUserIds.some(id => id.toString() === targetDoctor._id.toString())) {
          transfer.recipientUserIds.push(targetDoctor._id);
        }
        if (!transfer.recipientUsernames.some(u => u.toLowerCase() === targetDoctor.username.toLowerCase())) {
          transfer.recipientUsernames.push(targetDoctor.username);
        }
        transfer.history.push({
          action: 'REFERRAL_REASSIGNED',
          timestamp: new Date(),
          doctorUsername: req.user.username,
          hospital: req.user.hospitalName || 'Hospital',
          notes: `Referral reassigned to Dr. ${targetDoctor.name || targetDoctor.username} (${reason.trim()})`
        });
        await transfer.save();
      }
    }

    // Audit Log
    await AuditLog.create({
      action: 'REFERRAL_REASSIGNED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        referralId: referral.referralId,
        previousReceivingDoctorId: previousDoctorId,
        newReceivingDoctorId: targetDoctor._id,
        reason: reason.trim()
      }
    });

    // Register Specialist Referral Consent record for new receiving hospital/doctor
    try {
      let patientUserObj = await User.findOne({
        $or: [{ username: referral.patientId.toLowerCase() }, { email: referral.patientId.toLowerCase() }]
      });
      if (!patientUserObj) {
        try {
          patientUserObj = await User.create({
            username: referral.patientId,
            email: `${referral.patientId.toLowerCase()}@mediform.internal`,
            name: referral.patientName || referral.patientId,
            role: 'patient',
            isEmailVerified: true
          });
        } catch (uErr) {
          patientUserObj = await User.findOne({ username: referral.patientId });
        }
      }
      if (patientUserObj && targetHospital) {
        await consentService.createConsentRecord({
          patientUserId: patientUserObj._id,
          patientId: referral.patientId,
          patientName: referral.patientName,
          purpose: 'SPECIALIST_REFERRAL',
          authorizedDoctorId: validatedReceivingDoctor ? validatedReceivingDoctor._id : null,
          authorizedDoctorName: validatedReceivingDoctor ? (validatedReceivingDoctor.name || validatedReceivingDoctor.username) : '',
          authorizedHospital: targetHospital,
          durationDays: 30,
          metadata: { referralId: referral.referralId, screeningId: screening.screeningId },
          actorId: req.user.userId,
          actorRole: 'doctor'
        });
      }
    } catch (cErr) {
      // Non-blocking
    }

    // Automated Patient & Clinician Notifications (Phase 4 / 4.1 Idempotent Event)
    const reassignmentEntry = referral.timeline && referral.timeline[referral.timeline.length - 1];
    await notificationService.notifyReferralEvent('REFERRAL_REASSIGNED', referral, {
      eventId: reassignmentEntry ? reassignmentEntry._id.toString() : undefined
    });

    return res.status(200).json({
      success: true,
      message: `Referral successfully reassigned to Dr. ${targetDoctor.name || targetDoctor.username}.`,
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error reassigning referral.' }
    });
  }
};

/**
 * List Referrals (Auth required, IDOR & Organizational Isolation protected)
 * Supports views: 'incoming', 'my_assigned', 'unassigned', 'urgent'
 */
exports.getReferrals = async (req, res) => {
  try {
    const { status, patientId, priority, view, hospital, limit = 50 } = req.query;
    const query = {};

    // IDOR protection: Patients can only retrieve their own referrals
    if (req.user.role === 'patient') {
      const patientPid = req.user.username;
      query.patientId = new RegExp(`^${patientPid}$`, 'i');
    } else {
      // Doctor View Modes (Section 5 Requirement)
      const userId = req.user.userId;
      const userHospital = req.user.hospitalName || (req.currentUser && req.currentUser.hospitalName) || '';

      if (view === 'my_assigned') {
        // B. My Assigned Referrals
        query.receivingDoctorId = userId;
      } else if (view === 'incoming') {
        // A. Incoming Referrals: Assigned to me OR incoming to my hospital
        const orConditions = [{ receivingDoctorId: userId }];
        if (userHospital) {
          orConditions.push({ receivingHospital: new RegExp(`^${userHospital}$`, 'i') });
        }
        query.$or = orConditions;
      } else if (view === 'unassigned') {
        // C. Unassigned Referrals
        query.receivingDoctorId = null;
        if (hospital) {
          query.receivingHospital = new RegExp(hospital.trim(), 'i');
        } else if (userHospital) {
          query.receivingHospital = new RegExp(`^${userHospital}$`, 'i');
        }
      } else if (view === 'urgent') {
        // D. Urgent Referrals
        query.priority = { $in: ['Emergency', 'Urgent'] };
        if (userHospital) {
          query.$or = [
            { referringHospital: new RegExp(`^${userHospital}$`, 'i') },
            { receivingHospital: new RegExp(`^${userHospital}$`, 'i') },
            { referringDoctorId: userId },
            { receivingDoctorId: userId }
          ];
        }
      } else if (hospital) {
        query.$or = [
          { referringHospital: new RegExp(hospital.trim(), 'i') },
          { receivingHospital: new RegExp(hospital.trim(), 'i') }
        ];
      }

      if (patientId) {
        query.patientId = new RegExp(`^${patientId.trim()}$`, 'i');
      }
    }

    if (status) {
      query.status = status;
    }

    if (priority && view !== 'urgent') {
      query.priority = priority;
    }

    const referrals = await Referral.find(query)
      .populate('sourceScreeningRef')
      .populate('transferId')
      .populate('assignedBy', 'name username hospitalName')
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    return res.status(200).json({
      success: true,
      referrals,
      count: referrals.length
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving referrals.' }
    });
  }
};

/**
 * Get Referral by ID
 */
exports.getReferralById = async (req, res) => {
  try {
    const { id } = req.params;

    let referral = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      referral = await Referral.findById(id).populate('sourceScreeningRef').populate('transferId').populate('assignedBy', 'name username hospitalName');
    }
    if (!referral) {
      referral = await Referral.findOne({ referralId: id }).populate('sourceScreeningRef').populate('transferId').populate('assignedBy', 'name username hospitalName');
    }

    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    // IDOR Check
    if (!isAuthorizedForPatient(req.user, referral.patientId)) {
      await AuditLog.create({
        action: 'UNAUTHORIZED_REFERRAL_ACCESS',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { referralId: referral.referralId, patientId: referral.patientId, reason: 'Patient IDOR violation' }
      });
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_RECORD_ACCESS', message: 'Unauthorized to view this referral record.' }
      });
    }

    // Hospital Access & Consent Restriction Check (Phase 7 Access Control Hardening)
    if (req.user.role === 'doctor') {
      const userHospital = (req.user.hospitalName || (req.currentUser && req.currentUser.hospitalName) || '').toLowerCase();
      const userIdStr = (req.user.userId || '').toString();
      const isReferringDoc = (referral.referringDoctorId || '').toString() === userIdStr;
      const isReceivingDoc = (referral.receivingDoctorId || '').toString() === userIdStr;
      const isHospitalStaff = userHospital && (
        userHospital === (referral.referringHospital || '').toLowerCase() ||
        userHospital === (referral.receivingHospital || '').toLowerCase()
      );

      // If doctor is completely unaffiliated with either the doctors or the hospitals
      if (!isReferringDoc && !isReceivingDoc && !isHospitalStaff && userHospital) {
        await AuditLog.create({
          action: 'UNAUTHORIZED_REFERRAL_ACCESS',
          actorId: req.user.userId,
          actorRole: req.user.role,
          details: { referralId: referral.referralId, patientId: referral.patientId, reason: 'Isolated hospital network access attempt' }
        });
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN_HOSPITAL_ACCESS', message: 'Access denied: Referral belongs to an isolated hospital network.' }
        });
      }

      // Consent check for doctor
      const consentCheck = await consentService.verifyAccessConsent({
        patientId: referral.patientId,
        requestingUser: req.user,
        hospital: req.user.hospitalName,
        authorUserId: referral.referringDoctorId,
        assignedDoctorId: referral.receivingDoctorId,
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });

      if (!consentCheck.authorized) {
        await AuditLog.create({
          action: 'UNAUTHORIZED_REFERRAL_ACCESS',
          actorId: req.user.userId,
          actorRole: req.user.role,
          details: { referralId: referral.referralId, patientId: referral.patientId, reason: consentCheck.reason }
        });
        return res.status(403).json({
          success: false,
          error: { code: consentCheck.code || 'FORBIDDEN_RECORD_ACCESS', message: consentCheck.reason }
        });
      }
    }

    return res.status(200).json({
      success: true,
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving referral record.' }
    });
  }
};

/**
 * Generate Secure Handoff QR for Referral (Doctor only)
 */
exports.generateReferralQR = async (req, res) => {
  try {
    const { id } = req.params;
    const { pin: customPin } = req.body;

    let referral = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      referral = await Referral.findById(id);
    }
    if (!referral) {
      referral = await Referral.findOne({ referralId: id });
    }

    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    // Validate Consent (Security Requirement)
    if (!referral.patientConsentValidated) {
      return res.status(403).json({
        success: false,
        error: { code: 'CONSENT_REQUIRED', message: 'Patient consent is not validated for this referral.' }
      });
    }

    if (!referral.transferId) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_TRANSFER_LINK', message: 'Referral is missing associated handoff transfer record.' }
      });
    }

    const transfer = await Transfer.findById(referral.transferId);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Associated transfer handoff record not found.' }
      });
    }

    // 6-digit PIN validation or random generation
    const pin = customPin && /^\d{6}$/.test(customPin) ? customPin : generateRandomPin();

    // Encrypt payload with AES-256-GCM
    const payloadObj = transfer.toObject();
    const encryptedPayload = cryptoService.encryptPayload(payloadObj);
    const pinHash = await cryptoService.hashPIN(pin);

    const ttlMinutes = parseInt(process.env.QR_SHARE_TTL_MINUTES || '120', 10);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const uuid = crypto.randomUUID();

    const qrSession = new QRSession({
      uuid,
      transferId: transfer._id,
      encryptedPayload,
      pinHash,
      failedAttempts: 0,
      maxAttempts: parseInt(process.env.PIN_MAX_ATTEMPTS || '5', 10),
      expiresAt,
      createdByUserId: req.user.userId
    });

    await qrSession.save();

    referral.qrSessionUuid = uuid;
    await referral.save();

    const baseUrl = process.env.APP_PUBLIC_URL || 'https://mediform.health';
    const shareUrl = `${baseUrl}/handoff/${uuid}`;

    await AuditLog.create({
      action: 'REFERRAL_QR_GENERATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { referralId: referral.referralId, uuid, transferId: transfer._id, expiresAt }
    });

    return res.status(200).json({
      success: true,
      qrSession: {
        uuid,
        pin,
        expiresAt,
        shareUrl,
        transferId: transfer._id,
        referralId: referral.referralId
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error generating referral QR session.' }
    });
  }
};

/**
 * Acknowledge Referral Receipt (Receiving Doctor or Hospital Delegate)
 */
exports.acknowledgeReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const referral = await findReferral(id);
    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    if (!isAuthorizedReceivingDoctor(req.user, referral)) {
      await AuditLog.create({
        action: 'UNAUTHORIZED_REFERRAL_ACKNOWLEDGEMENT_ATTEMPT',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { referralId: referral.referralId }
      });
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_RECEIVING_DOCTOR',
          message: 'Only the assigned receiving doctor or an authorized receiving hospital clinician can acknowledge this referral.'
        }
      });
    }

    // Permitted: PENDING -> ACKNOWLEDGED (or legacy IN_TRANSIT -> ACKNOWLEDGED)
    if (referral.status !== 'PENDING' && referral.status !== 'IN_TRANSIT') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Cannot acknowledge referral in '${referral.status}' status. Referral must be in 'PENDING' status.`
        }
      });
    }

    const previousStatus = referral.status;
    referral.status = 'ACKNOWLEDGED';
    referral.acknowledgement = {
      acknowledgedByDoctorId: req.user.userId,
      acknowledgedByDoctorUsername: req.user.username,
      acknowledgedByDoctorName: req.user.name || req.user.username,
      acknowledgedAt: new Date(),
      decision: 'ACKNOWLEDGED',
      notes: notes ? notes.trim() : ''
    };

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'REFERRAL_ACKNOWLEDGED',
      previousStatus,
      newStatus: 'ACKNOWLEDGED',
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: notes ? notes.trim() : 'Referral receipt explicitly acknowledged by receiving doctor.'
    });

    await referral.save();

    await AuditLog.create({
      action: 'REFERRAL_ACKNOWLEDGED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        referralId: referral.referralId,
        previousStatus,
        newStatus: 'ACKNOWLEDGED',
        notes: notes ? notes.trim() : ''
      }
    });

    // Automated Patient & Clinician Notifications (Phase 4 / 4.1 Idempotent Event)
    const ackEntry = referral.timeline && referral.timeline[referral.timeline.length - 1];
    await notificationService.notifyReferralEvent('REFERRAL_ACKNOWLEDGED', referral, {
      eventId: ackEntry ? ackEntry._id.toString() : undefined
    });

    return res.status(200).json({
      success: true,
      message: 'Referral acknowledged successfully.',
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error acknowledging referral.' }
    });
  }
};

/**
 * Accept Referral (Receiving Doctor or Hospital Delegate)
 */
exports.acceptReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const referral = await findReferral(id);
    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    if (!isAuthorizedReceivingDoctor(req.user, referral)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_RECEIVING_DOCTOR',
          message: 'Only the assigned receiving doctor or an authorized receiving hospital clinician can accept this referral.'
        }
      });
    }

    // Permitted: PENDING -> ACCEPTED, ACKNOWLEDGED -> ACCEPTED, IN_TRANSIT -> ACCEPTED
    if (!['PENDING', 'ACKNOWLEDGED', 'IN_TRANSIT'].includes(referral.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Cannot accept referral with status '${referral.status}'.`
        }
      });
    }

    const previousStatus = referral.status;
    referral.status = 'ACCEPTED';

    if (!referral.acknowledgement || !referral.acknowledgement.acknowledgedAt) {
      referral.acknowledgement = {
        acknowledgedByDoctorId: req.user.userId,
        acknowledgedByDoctorUsername: req.user.username,
        acknowledgedByDoctorName: req.user.name || req.user.username,
        acknowledgedAt: new Date(),
        decision: 'ACCEPTED',
        notes: notes ? notes.trim() : 'Accepted upon review'
      };
    }

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'REFERRAL_ACCEPTED',
      previousStatus,
      newStatus: 'ACCEPTED',
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: notes ? notes.trim() : 'Referral accepted for clinical intake.'
    });

    await referral.save();

    await AuditLog.create({
      action: 'REFERRAL_ACCEPTED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        referralId: referral.referralId,
        previousStatus,
        newStatus: 'ACCEPTED'
      }
    });

    // Automated Patient & Clinician Notifications (Phase 4 / 4.1 Idempotent Event)
    const acceptEntry = referral.timeline && referral.timeline[referral.timeline.length - 1];
    await notificationService.notifyReferralEvent('REFERRAL_ACCEPTED', referral, {
      eventId: acceptEntry ? acceptEntry._id.toString() : undefined
    });

    return res.status(200).json({
      success: true,
      message: 'Referral accepted successfully.',
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error accepting referral.' }
    });
  }
};

/**
 * Reject Referral with Mandatory Reason (Receiving Doctor or Hospital Delegate)
 */
exports.rejectReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REJECTION_REASON',
          message: 'A mandatory clinical justification reason is required to reject a referral.'
        }
      });
    }

    const referral = await findReferral(id);
    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    if (!isAuthorizedReceivingDoctor(req.user, referral)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_RECEIVING_DOCTOR',
          message: 'Only the assigned receiving doctor or an authorized receiving hospital clinician can reject this referral.'
        }
      });
    }

    if (!['PENDING', 'ACKNOWLEDGED', 'ACCEPTED', 'IN_TRANSIT'].includes(referral.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Cannot reject referral in '${referral.status}' status.`
        }
      });
    }

    const previousStatus = referral.status;
    referral.status = 'REJECTED';
    referral.rejection = {
      rejectedByDoctorId: req.user.userId,
      rejectedByDoctorUsername: req.user.username,
      rejectedByDoctorName: req.user.name || req.user.username,
      rejectedAt: new Date(),
      reason: reason.trim()
    };

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'REFERRAL_REJECTED',
      previousStatus,
      newStatus: 'REJECTED',
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      reason: reason.trim(),
      notes: `Rejected by Dr. ${req.user.name || req.user.username}: ${reason.trim()}`
    });

    await referral.save();

    await AuditLog.create({
      action: 'REFERRAL_REJECTED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        referralId: referral.referralId,
        previousStatus,
        newStatus: 'REJECTED',
        reason: reason.trim()
      }
    });

    // Automated Patient & Clinician Notifications (Phase 4 / 4.1 Idempotent Event)
    const rejectEntry = referral.timeline && referral.timeline[referral.timeline.length - 1];
    await notificationService.notifyReferralEvent('REFERRAL_REJECTED', referral, {
      eventId: rejectEntry ? rejectEntry._id.toString() : undefined
    });

    return res.status(200).json({
      success: true,
      message: 'Referral rejected. Rejection reason recorded and audit logged.',
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error rejecting referral.' }
    });
  }
};

/**
 * Start Treatment (Receiving Doctor)
 */
exports.startTreatment = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const referral = await findReferral(id);
    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    if (!isAuthorizedReceivingDoctor(req.user, referral)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_RECEIVING_DOCTOR',
          message: 'Only authorized receiving clinicians can initiate treatment.'
        }
      });
    }

    if (referral.status !== 'ACCEPTED') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Cannot start treatment on referral with status '${referral.status}'. Referral must be in 'ACCEPTED' status before starting treatment.`
        }
      });
    }

    const previousStatus = referral.status;
    referral.status = 'IN_PROGRESS';

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'TREATMENT_STARTED',
      previousStatus,
      newStatus: 'IN_PROGRESS',
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: notes ? notes.trim() : 'Patient clinical treatment initiated.'
    });

    await referral.save();

    await AuditLog.create({
      action: 'TREATMENT_STARTED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { referralId: referral.referralId }
    });

    return res.status(200).json({
      success: true,
      message: 'Treatment initiated.',
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error starting treatment.' }
    });
  }
};

/**
 * Document Clinical Treatment (Receiving Doctor)
 */
exports.documentTreatment = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      treatmentSummary,
      clinicalObservations,
      proceduresPerformed,
      medicationsAdministered,
      treatmentDate,
      followUpRequired = false,
      followUpInstructions
    } = req.body;

    if (!treatmentSummary || !treatmentSummary.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_TREATMENT_SUMMARY',
          message: 'Treatment summary is mandatory.'
        }
      });
    }

    if (followUpRequired && (!followUpInstructions || !followUpInstructions.trim())) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FOLLOW_UP_INSTRUCTIONS',
          message: 'Follow-up instructions are required when follow-up care is indicated.'
        }
      });
    }

    const referral = await findReferral(id);
    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    if (!isAuthorizedReceivingDoctor(req.user, referral)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_RECEIVING_DOCTOR',
          message: 'Only authorized receiving clinicians can document treatment.'
        }
      });
    }

    if (['REJECTED', 'CANCELLED', 'COMPLETED'].includes(referral.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_FOR_TREATMENT',
          message: `Cannot document treatment on a ${referral.status} referral.`
        }
      });
    }

    const formattedProcedures = Array.isArray(proceduresPerformed)
      ? proceduresPerformed.map(p => typeof p === 'string' ? p.trim() : (p.name || '')).filter(Boolean)
      : (proceduresPerformed ? [proceduresPerformed.toString().trim()] : []);

    const formattedMeds = Array.isArray(medicationsAdministered)
      ? medicationsAdministered.map(m => ({
          name: m.name || m.drugName || m.n || 'Medication',
          dose: m.dose || m.d || '',
          route: m.route || m.r || 'Oral',
          frequency: m.frequency || '',
          notes: m.notes || ''
        }))
      : [];

    referral.treatmentDocumentation = {
      treatmentSummary: treatmentSummary.trim(),
      clinicalObservations: clinicalObservations ? clinicalObservations.trim() : '',
      proceduresPerformed: formattedProcedures,
      medicationsAdministered: formattedMeds,
      treatmentDate: treatmentDate ? new Date(treatmentDate) : new Date(),
      responsibleDoctorId: req.user.userId,
      responsibleDoctorUsername: req.user.username,
      responsibleDoctorName: req.user.name || req.user.username,
      followUpRequired: Boolean(followUpRequired),
      followUpInstructions: followUpInstructions ? followUpInstructions.trim() : '',
      documentedAt: new Date()
    };

    const previousStatus = referral.status;
    let newStatus = referral.status;

    if (referral.status === 'ACCEPTED' || referral.status === 'PENDING') {
      newStatus = followUpRequired ? 'FOLLOW_UP_REQUIRED' : 'IN_PROGRESS';
    } else if (referral.status === 'IN_PROGRESS' && followUpRequired) {
      newStatus = 'FOLLOW_UP_REQUIRED';
    } else if (referral.status === 'FOLLOW_UP_REQUIRED' && !followUpRequired) {
      newStatus = 'IN_PROGRESS';
    }

    referral.status = newStatus;

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'TREATMENT_DOCUMENTED',
      previousStatus,
      newStatus,
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: `Treatment documented: ${treatmentSummary.trim()}`
    });

    if (followUpRequired) {
      referral.timeline.push({
        eventType: 'FOLLOW_UP_REQUIRED',
        previousStatus: newStatus,
        newStatus,
        performingUserId: req.user.userId,
        performingUsername: req.user.username,
        performingUserRole: req.user.role,
        timestamp: new Date(),
        notes: `Follow-up indicated: ${followUpInstructions ? followUpInstructions.trim() : ''}`
      });
    }

    await referral.save();

    await AuditLog.create({
      action: 'TREATMENT_DOCUMENTED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        referralId: referral.referralId,
        followUpRequired: Boolean(followUpRequired)
      }
    });

    // Automated Patient Notifications (Phase 4 / 4.1 Idempotent Events)
    const treatmentEntry = referral.timeline && referral.timeline.slice().reverse().find(t => t.eventType === 'TREATMENT_DOCUMENTED');
    await notificationService.notifyReferralEvent('TREATMENT_DOCUMENTED', referral, {
      eventId: treatmentEntry ? treatmentEntry._id.toString() : undefined
    });
    if (followUpRequired) {
      const followUpEntry = referral.timeline && referral.timeline.slice().reverse().find(t => t.eventType === 'FOLLOW_UP_REQUIRED');
      await notificationService.notifyReferralEvent('FOLLOW_UP_REQUIRED', referral, {
        eventId: followUpEntry ? followUpEntry._id.toString() : undefined
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Treatment documented successfully.',
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error documenting treatment.' }
    });
  }
};

/**
 * Confirm Clinical Care (Receiving Doctor)
 */
exports.confirmCare = async (req, res) => {
  try {
    const { id } = req.params;
    const { confirmationSummary, followUpAddressed = false, followUpPlan } = req.body;

    const referral = await findReferral(id);
    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    if (!isAuthorizedReceivingDoctor(req.user, referral)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_RECEIVING_DOCTOR',
          message: 'Only authorized receiving clinicians can confirm care.'
        }
      });
    }

    // 1. Treatment documentation must exist
    if (!referral.treatmentDocumentation || !referral.treatmentDocumentation.treatmentSummary) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TREATMENT_NOT_DOCUMENTED',
          message: 'Care cannot be confirmed before clinical treatment documentation exists.'
        }
      });
    }

    // 2. Any required follow-up must be addressed or planned
    if (referral.treatmentDocumentation.followUpRequired && !followUpAddressed && !followUpPlan) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UNRESOLVED_FOLLOW_UP',
          message: 'Referral indicates required follow-up. Follow-up must be addressed or an explicit follow-up plan confirmed before care confirmation.'
        }
      });
    }

    referral.careConfirmation = {
      isConfirmed: true,
      confirmedByDoctorId: req.user.userId,
      confirmedByDoctorUsername: req.user.username,
      confirmedByDoctorName: req.user.name || req.user.username,
      confirmedAt: new Date(),
      confirmationSummary: (confirmationSummary && confirmationSummary.trim()) || 'Clinical care and patient condition verified by attending physician.',
      followUpAddressed: Boolean(followUpAddressed),
      followUpPlan: followUpPlan ? followUpPlan.trim() : ''
    };

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'CARE_CONFIRMED',
      previousStatus: referral.status,
      newStatus: referral.status,
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: referral.careConfirmation.confirmationSummary
    });

    await referral.save();

    await AuditLog.create({
      action: 'CARE_CONFIRMED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { referralId: referral.referralId }
    });

    return res.status(200).json({
      success: true,
      message: 'Care confirmed successfully.',
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error confirming care.' }
    });
  }
};

/**
 * Close Referral (Receiving Doctor, Referring Doctor, or Hospital Staff)
 */
exports.closeReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const { closureNotes, followUpPlan } = req.body;

    const referral = await findReferral(id);
    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    const userIdStr = (req.user.userId || '').toString();
    const userHospital = (req.user.hospitalName || (req.currentUser && req.currentUser.hospitalName) || '').toLowerCase();
    const isReceivingDoc = referral.receivingDoctorId && referral.receivingDoctorId.toString() === userIdStr;
    const isReferringDoc = referral.referringDoctorId && referral.referringDoctorId.toString() === userIdStr;
    const isReceivingHospStaff = userHospital && referral.receivingHospital && userHospital === referral.receivingHospital.toLowerCase();

    if (!isReceivingDoc && !isReferringDoc && !isReceivingHospStaff) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_CLOSURE',
          message: 'You are not authorized to close this referral.'
        }
      });
    }

    if (referral.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_CLOSED', message: 'Referral is already completed and closed.' }
      });
    }

    if (['REJECTED', 'CANCELLED'].includes(referral.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CANNOT_CLOSE_REJECTED_OR_CANCELLED',
          message: `Cannot close a ${referral.status.toLowerCase()} referral.`
        }
      });
    }

    // Condition 1: Treatment documentation must exist
    if (!referral.treatmentDocumentation || !referral.treatmentDocumentation.treatmentSummary) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TREATMENT_NOT_DOCUMENTED',
          message: 'Referral cannot be closed without documented treatment. Treatment documentation must exist prior to closure.'
        }
      });
    }

    // Condition 2: Care must be confirmed
    if (!referral.careConfirmation || !referral.careConfirmation.isConfirmed) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CARE_NOT_CONFIRMED',
          message: 'Referral cannot be closed before clinical care has been explicitly confirmed.'
        }
      });
    }

    // Condition 3: Any required follow-up must be addressed
    const hasUnresolvedFollowUp = referral.treatmentDocumentation.followUpRequired &&
      !referral.careConfirmation.followUpAddressed &&
      !(followUpPlan && followUpPlan.trim()) &&
      !referral.careConfirmation.followUpPlan;

    if (hasUnresolvedFollowUp) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UNRESOLVED_FOLLOW_UP',
          message: 'Referral requires follow-up care. An explicit follow-up plan or resolution must be confirmed before closure.'
        }
      });
    }

    // Condition 4 (Phase 5 & 5.1): All active structured follow-up appointments must be resolved (including MISSED)
    const unresolvedStructuredFollowUps = await FollowUp.countDocuments({
      $or: [
        { referralRef: referral._id },
        { referralId: referral.referralId }
      ],
      status: { $in: ['SCHEDULED', 'UPCOMING', 'DUE', 'OVERDUE', 'MISSED'] }
    });

    if (unresolvedStructuredFollowUps > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UNRESOLVED_FOLLOW_UP',
          message: `Referral cannot be closed while ${unresolvedStructuredFollowUps} required follow-up appointment(s) remain unresolved. Complete or cancel pending follow-ups prior to care closure.`
        }
      });
    }

    const previousStatus = referral.status;
    referral.status = 'COMPLETED';
    referral.closure = {
      isClosed: true,
      closedByDoctorId: req.user.userId,
      closedByDoctorUsername: req.user.username,
      closedByDoctorName: req.user.name || req.user.username,
      closedAt: new Date(),
      closureNotes: (closureNotes && closureNotes.trim()) || 'Clinical handoff and treatment successfully closed.'
    };

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'REFERRAL_CLOSED',
      previousStatus,
      newStatus: 'COMPLETED',
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: referral.closure.closureNotes
    });

    await referral.save();

    // Clear active referral on source screening
    if (referral.sourceScreeningRef) {
      const screening = await Screening.findById(referral.sourceScreeningRef);
      if (screening && screening.activeReferralId && screening.activeReferralId.toString() === referral._id.toString()) {
        screening.activeReferralId = null;
        await screening.save();
      }
    }

    // Synchronize Transfer record
    if (referral.transferId) {
      const transfer = await Transfer.findById(referral.transferId);
      if (transfer) {
        transfer.status = 'RECEIVED';
        transfer.acknowledgementStatus = 'ACKNOWLEDGED';
        transfer.history.push({
          action: 'REFERRAL_LIFECYCLE_COMPLETED',
          timestamp: new Date(),
          doctorUsername: req.user.username,
          hospital: req.user.hospitalName || 'Hospital',
          notes: `Referral ${referral.referralId} treatment closed: ${referral.closure.closureNotes}`
        });
        await transfer.save();
      }
    }

    await AuditLog.create({
      action: 'REFERRAL_CLOSED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        referralId: referral.referralId,
        closureNotes: referral.closure.closureNotes
      }
    });

    // Automated Patient & Clinician Notifications (Phase 4 / 4.1 Idempotent Event)
    const closeEntry = referral.timeline && referral.timeline[referral.timeline.length - 1];
    await notificationService.notifyReferralEvent('REFERRAL_CLOSED', referral, {
      eventId: closeEntry ? closeEntry._id.toString() : undefined
    });

    return res.status(200).json({
      success: true,
      message: 'Referral successfully closed and documented.',
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error closing referral.' }
    });
  }
};

/**
 * Cancel Referral (Referring Doctor, Receiving Doctor, or Hospital Staff)
 */
exports.cancelReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_CANCELLATION_REASON', message: 'A reason for referral cancellation is mandatory.' }
      });
    }

    const referral = await findReferral(id);
    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    if (referral.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: { code: 'CANNOT_CANCEL_COMPLETED', message: 'Completed referrals cannot be cancelled.' }
      });
    }

    if (referral.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_CANCELLED', message: 'Referral is already cancelled.' }
      });
    }

    const previousStatus = referral.status;
    referral.status = 'CANCELLED';

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: 'REFERRAL_CANCELLED',
      previousStatus,
      newStatus: 'CANCELLED',
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      reason: reason.trim(),
      notes: `Referral cancelled: ${reason.trim()}`
    });

    await referral.save();

    if (referral.sourceScreeningRef) {
      const screening = await Screening.findById(referral.sourceScreeningRef);
      if (screening && screening.activeReferralId && screening.activeReferralId.toString() === referral._id.toString()) {
        screening.activeReferralId = null;
        await screening.save();
      }
    }

    await AuditLog.create({
      action: 'REFERRAL_CANCELLED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { referralId: referral.referralId, reason: reason.trim() }
    });

    return res.status(200).json({
      success: true,
      message: 'Referral cancelled.',
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error cancelling referral.' }
    });
  }
};

/**
 * Get Referral Timeline (Lifecycle Audit History)
 */
exports.getReferralTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const referral = await findReferral(id);

    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    if (!isAuthorizedForPatient(req.user, referral.patientId)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied.' }
      });
    }

    return res.status(200).json({
      success: true,
      referralId: referral.referralId,
      status: referral.status,
      timeline: referral.timeline || []
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving referral timeline.' }
    });
  }
};

/**
 * Update Referral Status (Doctor only) - Validates Transitions & Closure
 */
exports.updateReferralStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const allStatuses = [
      'PENDING',
      'ACKNOWLEDGED',
      'ACCEPTED',
      'IN_TRANSIT',
      'IN_PROGRESS',
      'FOLLOW_UP_REQUIRED',
      'COMPLETED',
      'REJECTED',
      'CANCELLED'
    ];

    if (!allStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: `Status must be one of: ${allStatuses.join(', ')}` }
      });
    }

    const referral = await findReferral(id);
    if (!referral) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Referral record not found.' }
      });
    }

    // Permitted state transitions validation
    if (status !== referral.status) {
      const allowed = VALID_TRANSITIONS[referral.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: `Invalid status transition from '${referral.status}' to '${status}'.`
          }
        });
      }
    }

    // If attempting to jump directly to COMPLETED, enforce treatment and care confirmation
    if (status === 'COMPLETED') {
      if (!referral.treatmentDocumentation || !referral.treatmentDocumentation.treatmentSummary) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CLOSURE_REQUIREMENTS_NOT_MET',
            message: 'Referral cannot be marked COMPLETED without documented clinical treatment.'
          }
        });
      }
      if (!referral.careConfirmation || !referral.careConfirmation.isConfirmed) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CLOSURE_REQUIREMENTS_NOT_MET',
            message: 'Referral cannot be marked COMPLETED before clinical care has been confirmed.'
          }
        });
      }
    }

    const previousStatus = referral.status;
    referral.status = status;

    if (status === 'COMPLETED') {
      referral.closure = {
        isClosed: true,
        closedByDoctorId: req.user.userId,
        closedByDoctorUsername: req.user.username,
        closedByDoctorName: req.user.name || req.user.username,
        closedAt: new Date(),
        closureNotes: notes || ''
      };
    }

    if (!referral.timeline) referral.timeline = [];
    referral.timeline.push({
      eventType: status === 'COMPLETED' ? 'REFERRAL_CLOSED' : (status === 'ACCEPTED' ? 'REFERRAL_ACCEPTED' : (status === 'CANCELLED' ? 'REFERRAL_CANCELLED' : 'STATUS_UPDATED')),
      previousStatus,
      newStatus: status,
      performingUserId: req.user.userId,
      performingUsername: req.user.username,
      performingUserRole: req.user.role,
      timestamp: new Date(),
      notes: notes || ''
    });

    await referral.save();

    // If cancelled or completed, clear activeReferralId on screening if it matches this referral
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      const screening = await Screening.findById(referral.sourceScreeningRef);
      if (screening && screening.activeReferralId && screening.activeReferralId.toString() === referral._id.toString()) {
        screening.activeReferralId = null;
        await screening.save();
      }
    }

    await AuditLog.create({
      action: 'REFERRAL_STATUS_UPDATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        referralId: referral.referralId,
        previousStatus,
        newStatus: status,
        notes: notes || ''
      }
    });

    return res.status(200).json({
      success: true,
      message: `Referral status updated to ${status}.`,
      referral
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error updating referral status.' }
    });
  }
};
