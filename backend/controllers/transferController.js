const crypto = require('crypto');
const Transfer = require('../models/Transfer');
const QRSession = require('../models/QRSession');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const IdempotencyRecord = require('../models/IdempotencyRecord');
const consentService = require('../services/consentService');
const cdsService = require('../services/cdsService');
const cryptoService = require('../services/cryptoService');
const { createNotification } = require('../services/notificationService');
const { recordTransferUsage, recordSmsUsage } = require('./subscriptionController');

function computeCriticalityFromVitals(vit = {}, priority = 'Routine') {
  const news = cdsService.calculateNEWS2(vit || {});
  let level = 'STABLE';
  if (news.score >= 7 || priority === 'Emergency') {
    level = news.score >= 7 ? 'CRITICAL' : 'URGENT';
  } else if (news.score >= 5 || news.singleScore3 || priority === 'Urgent') {
    level = 'URGENT';
  } else if (news.score >= 2) {
    level = 'MODERATE';
  }
  return {
    news2Score: news.score,
    level,
    acuitySummary: `${news.label} (NEWS2: ${news.score})`,
    autoAlertTriggered: level === 'CRITICAL',
    updatedAt: new Date()
  };
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === null || v === undefined || isNaN(Number(v)))) {
    return null;
  }
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

async function authorizeDoctorOrQRSession(req, transfer) {
  if (req.user && req.user.role === 'doctor') {
    return { authorized: true, actorName: req.user.name || req.user.username || 'Receiving Doctor', actorRole: 'doctor' };
  }

  const qrUuid = req.headers['x-qr-uuid'] || req.body?.qrUuid || req.query?.qrUuid;
  const qrPin = req.headers['x-qr-pin'] || req.body?.qrPin || req.query?.qrPin;
  if (qrUuid && qrPin) {
    const session = await QRSession.findOne({ uuid: String(qrUuid).trim() });
    if (
      session &&
      !session.isRevoked &&
      new Date() <= new Date(session.expiresAt) &&
      session.transferId.toString() === transfer._id.toString() &&
      session.failedAttempts < session.maxAttempts
    ) {
      const ok = await cryptoService.verifyPIN(String(qrPin).trim(), session.pinHash);
      if (ok) {
        return { authorized: true, actorName: 'Receiving Hospital / EMS Crew (QR Verified)', actorRole: 'qr_clinician' };
      }
    }
  }
  return { authorized: false };
}

// Helper for patient ownership / IDOR check
function isAuthorizedForPatient(user, pid) {
  if (user.role === 'doctor') return true;
  // Patient users can only access records matching their username or patient ID
  if (user.role === 'patient') {
    const userPid = (user.username || '').toLowerCase();
    const targetPid = (pid || '').toLowerCase();
    return userPid === targetPid || targetPid.includes(userPid);
  }
  return false;
}

// Create new Transfer (Doctor only) with Idempotency Key Handling
exports.createTransfer = async (req, res) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
    const {
      pid, nam, age, gender, bg, dob, contactNumber, emergencyContact, address,
      fh, th, rt, priority = 'Routine', referringDoctor, receivingDepartment, transferDateTime,
      pd, secondaryDiagnosis, currentCondition, sum,
      alg = [], noKnownAllergies = false, med = [], vit, pi = [], otherDetails = [],
      emsDispatch = {}
    } = req.body;

    if (!pid || !nam || !age || !bg || !fh || !th || !rt || !pd) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'Required identity, transfer, and clinical fields are missing.' }
      });
    }

    // Compute canonical request hash
    const canonicalPayload = JSON.stringify({ pid, nam, age, bg, fh, th, rt, pd });
    const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    if (idempotencyKey) {
      const existingKeyRecord = await IdempotencyRecord.findOne({ idempotencyKey });
      if (existingKeyRecord) {
        // Test 2: Same key + different authenticated doctor -> rejected with HTTP 403
        if (existingKeyRecord.userId.toString() !== req.user.userId.toString()) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN_IDEMPOTENCY_KEY', message: 'Idempotency key belongs to a different doctor account.' }
          });
        }

        // Test 3: Same doctor + same key + materially different payload -> rejected with HTTP 409
        if (existingKeyRecord.requestHash !== requestHash) {
          return res.status(409).json({
            success: false,
            error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key reused with materially different transfer payload.' }
          });
        }

        // Test 1: Same doctor + same key + same request -> return stored original result
        return res.status(201).json(existingKeyRecord.responsePayload);
      }
    }

    const initialCriticality = computeCriticalityFromVitals(vit || {}, priority);
    const normalizedEms = {
      ambulanceId: emsDispatch?.ambulanceId || '',
      ambulanceCrewName: emsDispatch?.ambulanceCrewName || '',
      ambulancePhone: emsDispatch?.ambulancePhone || '',
      referringHospitalPhone: emsDispatch?.referringHospitalPhone || '',
      receivingHospitalPhone: emsDispatch?.receivingHospitalPhone || '',
      dispatchStatus: emsDispatch?.dispatchStatus || (priority === 'Emergency' ? 'DISPATCHED' : 'PREPARING'),
      currentLocation: emsDispatch?.currentLocation ? {
        lat: emsDispatch.currentLocation.lat !== undefined && emsDispatch.currentLocation.lat !== '' ? Number(emsDispatch.currentLocation.lat) : null,
        lng: emsDispatch.currentLocation.lng !== undefined && emsDispatch.currentLocation.lng !== '' ? Number(emsDispatch.currentLocation.lng) : null,
        address: emsDispatch.currentLocation.address || '',
        landmark: emsDispatch.currentLocation.landmark || '',
        speedKmh: Number(emsDispatch.currentLocation.speedKmh || 0),
        accuracyMeters: emsDispatch.currentLocation.accuracyMeters ? Number(emsDispatch.currentLocation.accuracyMeters) : null,
        updatedAt: new Date()
      } : {},
      destinationLocation: emsDispatch?.destinationLocation || {},
      etaMinutes: emsDispatch?.etaMinutes !== undefined && emsDispatch?.etaMinutes !== '' ? Number(emsDispatch.etaMinutes) : null,
      distanceKm: emsDispatch?.distanceKm !== undefined && emsDispatch?.distanceKm !== '' ? Number(emsDispatch.distanceKm) : null,
      criticality: initialCriticality,
      locationHistory: (emsDispatch?.currentLocation?.lat !== undefined && emsDispatch?.currentLocation?.lat !== null && emsDispatch?.currentLocation?.lat !== '') ? [{
        lat: Number(emsDispatch.currentLocation.lat),
        lng: Number(emsDispatch.currentLocation.lng),
        address: emsDispatch.currentLocation.address || '',
        landmark: emsDispatch.currentLocation.landmark || '',
        speedKmh: Number(emsDispatch.currentLocation.speedKmh || 0),
        criticalityLevel: initialCriticality.level,
        news2Score: initialCriticality.news2Score,
        timestamp: new Date()
      }] : [],
      incidentMessages: [{
        senderName: req.user.name || req.user.username || 'Referring Doctor',
        senderRole: 'Referring Hospital',
        channel: 'IN_APP',
        text: `Transfer folio initiated from ${fh} to ${th} (${priority}). ${initialCriticality.acuitySummary}`,
        timestamp: new Date()
      }]
    };

    const newTransfer = new Transfer({
      pid, nam, age, gender, bg, dob, contactNumber, emergencyContact, address,
      fh, th, rt, priority, referringDoctor, receivingDepartment,
      transferDateTime: transferDateTime ? new Date(transferDateTime) : new Date(),
      pd, secondaryDiagnosis, currentCondition, sum,
      alg, noKnownAllergies, med, vit, pi, otherDetails,
      emsDispatch: normalizedEms,
      issuerUserId: req.user.userId,
      issuerUsername: req.user.username,
      status: 'IN_TRANSIT',
      acknowledgementStatus: 'PENDING',
      isCurrent: true,
      version: 1,
      history: [{
        action: 'TRANSFER_CREATED',
        timestamp: new Date(),
        doctorUsername: req.user.username,
        hospital: fh,
        version: 1,
        notes: `Transfer created with priority ${priority}`
      }]
    });

    await newTransfer.save();

    // Update monthly subscription quota usage (non-blocking; emergency transfers never blocked)
    await recordTransferUsage(req.user, { isEmergency: priority === 'Emergency' });

    await AuditLog.create({
      action: 'TRANSFER_CREATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { transferId: newTransfer._id, pid: newTransfer.pid, priority }
    });

    const responsePayload = {
      success: true,
      transfer: newTransfer
    };

    if (idempotencyKey) {
      try {
        await IdempotencyRecord.create({
          idempotencyKey,
          userId: req.user.userId,
          requestHash,
          responsePayload,
          transferId: newTransfer._id
        });
      } catch (idempotencyErr) {
        // Race condition handling: clean up redundant transfer created concurrently
        await Transfer.findByIdAndDelete(newTransfer._id);
        
        let racerRecord = await IdempotencyRecord.findOne({ idempotencyKey, userId: req.user.userId });
        let attempts = 0;
        while (!racerRecord && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 50));
          racerRecord = await IdempotencyRecord.findOne({ idempotencyKey, userId: req.user.userId });
          attempts++;
        }
        if (racerRecord) {
          return res.status(201).json(racerRecord.responsePayload);
        }
      }
    }

    return res.status(201).json(responsePayload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Retrieve single transfer by ID (with authorization check)
exports.getTransferById = async (req, res) => {
  try {
    const { id } = req.params;
    const transfer = await Transfer.findById(id);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    // Patient IDOR protection check
    if (!isAuthorizedForPatient(req.user, transfer.pid)) {
      await AuditLog.create({
        action: 'UNAUTHORIZED_TRANSFER_ACCESS',
        actorId: req.user ? req.user.userId : null,
        actorRole: req.user ? req.user.role : 'anonymous',
        details: { targetPid: transfer.pid, transferId: transfer._id, reason: 'Patient IDOR access violation' }
      });
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Unauthorized access to target patient record.' }
      });
    }

    // Doctor consent & relationship verification (Phase 7 Access Control Hardening)
    if (req.user && req.user.role === 'doctor') {
      const isRecipient = (transfer.recipientUserIds || []).some(id => id.toString() === req.user.userId.toString());
      const consentCheck = await consentService.verifyAccessConsent({
        patientId: transfer.pid,
        requestingUser: req.user,
        hospital: req.user.hospitalName,
        authorUserId: transfer.issuerUserId,
        assignedDoctorId: isRecipient ? req.user.userId : null,
        purpose: 'EMERGENCY_TRANSFER',
        category: 'REFERRAL_DETAILS'
      });

      if (!consentCheck.authorized) {
        await AuditLog.create({
          action: 'UNAUTHORIZED_TRANSFER_ACCESS',
          actorId: req.user.userId,
          actorRole: req.user.role,
          details: { transferId: transfer._id, targetPid: transfer.pid, reason: consentCheck.reason }
        });
        return res.status(403).json({
          success: false,
          error: { code: consentCheck.code || 'FORBIDDEN_ACCESS', message: consentCheck.reason }
        });
      }
    }

    return res.status(200).json({
      success: true,
      transfer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Immutable Version Update (Doctor only)
exports.updateTransfer = async (req, res) => {
  try {
    const { id } = req.params;
    const oldTransfer = await Transfer.findById(id);

    if (!oldTransfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Target transfer record not found.' }
      });
    }

    if (!oldTransfer.isCurrent) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_VERSION', message: 'Cannot update a non-current historical version.' }
      });
    }

    // Consent & authorization check
    if (req.user && req.user.role === 'doctor') {
      const isRecipient = (oldTransfer.recipientUserIds || []).some(id => id.toString() === req.user.userId.toString());
      const consentCheck = await consentService.verifyAccessConsent({
        patientId: oldTransfer.pid,
        requestingUser: req.user,
        hospital: req.user.hospitalName,
        authorUserId: oldTransfer.issuerUserId,
        assignedDoctorId: isRecipient ? req.user.userId : null,
        purpose: 'EMERGENCY_TRANSFER',
        category: 'REFERRAL_DETAILS'
      });

      if (!consentCheck.authorized) {
        await AuditLog.create({
          action: 'UNAUTHORIZED_TRANSFER_ACCESS',
          actorId: req.user.userId,
          actorRole: req.user.role,
          details: { transferId: oldTransfer._id, targetPid: oldTransfer.pid, reason: consentCheck.reason }
        });
        return res.status(403).json({
          success: false,
          error: { code: consentCheck.code || 'FORBIDDEN_ACCESS', message: consentCheck.reason }
        });
      }
    }

    // Set old transfer isCurrent to false
    oldTransfer.isCurrent = false;
    await oldTransfer.save();

    const updateData = req.body;
    const newVersionNumber = oldTransfer.version + 1;

    const recipientUserIds = oldTransfer.recipientUserIds || [];
    const recipientUsernames = oldTransfer.recipientUsernames || [];

    const newHistory = [
      ...oldTransfer.history,
      {
        action: 'TRANSFER_UPDATED',
        timestamp: new Date(),
        doctorUsername: req.user.username,
        hospital: updateData.fh || oldTransfer.fh,
        version: newVersionNumber,
        notes: 'Transfer medical record updated'
      }
    ];

    const updatedTransfer = new Transfer({
      ...oldTransfer.toObject(),
      ...updateData,
      _id: undefined,
      version: newVersionNumber,
      previousVersionId: oldTransfer._id,
      isCurrent: true,
      status: 'UPDATED',
      history: newHistory,
      recipientUserIds,
      recipientUsernames,
      submittedAt: new Date()
    });

    await updatedTransfer.save();

    await AuditLog.create({
      action: 'TRANSFER_UPDATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { previousVersionId: oldTransfer._id, newVersionId: updatedTransfer._id, version: newVersionNumber }
    });

    await AuditLog.create({
      action: 'TRANSFER_VERSION_CREATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { transferId: updatedTransfer._id, version: newVersionNumber, previousVersionId: oldTransfer._id }
    });

    return res.status(200).json({
      success: true,
      transfer: updatedTransfer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Receiver Acknowledgement (Doctor only)
exports.acknowledgeTransfer = async (req, res) => {
  try {
    const { id } = req.params;
    const { arrivalCondition, arrivalNotes = '', discrepancies = [] } = req.body;

    if (!arrivalCondition || !['Stable', 'Unstable'].includes(arrivalCondition)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Arrival condition must be "Stable" or "Unstable".' }
      });
    }

    const transfer = await Transfer.findById(id);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    // Consent & authorization check
    if (req.user && req.user.role === 'doctor') {
      const consentCheck = await consentService.verifyAccessConsent({
        patientId: transfer.pid,
        requestingUser: req.user,
        hospital: req.user.hospitalName,
        authorUserId: transfer.issuerUserId,
        assignedDoctorId: req.user.userId,
        purpose: 'EMERGENCY_TRANSFER',
        category: 'REFERRAL_DETAILS'
      });

      if (!consentCheck.authorized) {
        await AuditLog.create({
          action: 'UNAUTHORIZED_TRANSFER_ACCESS',
          actorId: req.user.userId,
          actorRole: req.user.role,
          details: { transferId: transfer._id, targetPid: transfer.pid, reason: consentCheck.reason }
        });
        return res.status(403).json({
          success: false,
          error: { code: consentCheck.code || 'FORBIDDEN_ACCESS', message: consentCheck.reason }
        });
      }
    }

    const hasDiscrepancies = discrepancies && discrepancies.length > 0;
    const newStatus = hasDiscrepancies ? 'DISCREPANCY' : 'RECEIVED';

    transfer.status = newStatus;
    transfer.acknowledgementStatus = 'ACKNOWLEDGED';
    transfer.acknowledgement = {
      acknowledgedByUserId: req.user.userId,
      acknowledgedByUsername: req.user.username,
      arrivalCondition,
      arrivalNotes,
      discrepancies,
      acknowledgedAt: new Date()
    };

    if (!transfer.recipientUserIds.includes(req.user.userId)) {
      transfer.recipientUserIds.push(req.user.userId);
    }
    if (!transfer.recipientUsernames.includes(req.user.username)) {
      transfer.recipientUsernames.push(req.user.username);
    }

    transfer.history.push({
      action: hasDiscrepancies ? 'ACKNOWLEDGED_WITH_DISCREPANCY' : 'ACKNOWLEDGED_STABLE',
      timestamp: new Date(),
      doctorUsername: req.user.username,
      hospital: req.user.hospitalName || 'Receiving Hospital',
      version: transfer.version,
      notes: `Arrival condition: ${arrivalCondition}. ${hasDiscrepancies ? `Discrepancies: ${discrepancies.join(', ')}` : 'No discrepancies reported.'}`
    });

    await transfer.save();

    await AuditLog.create({
      action: 'TRANSFER_ACKNOWLEDGED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { transferId: transfer._id, status: newStatus, arrivalCondition, discrepancies }
    });

    return res.status(200).json({
      success: true,
      transfer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Scan Event Audit
exports.recordScanEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const transfer = await Transfer.findById(id);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    // Consent & authorization check
    if (req.user && req.user.role === 'doctor') {
      const consentCheck = await consentService.verifyAccessConsent({
        patientId: transfer.pid,
        requestingUser: req.user,
        hospital: req.user.hospitalName,
        authorUserId: transfer.issuerUserId,
        assignedDoctorId: req.user.userId,
        purpose: 'EMERGENCY_TRANSFER',
        category: 'REFERRAL_DETAILS'
      });

      if (!consentCheck.authorized) {
        await AuditLog.create({
          action: 'UNAUTHORIZED_TRANSFER_ACCESS',
          actorId: req.user.userId,
          actorRole: req.user.role,
          details: { transferId: transfer._id, targetPid: transfer.pid, reason: consentCheck.reason }
        });
        return res.status(403).json({
          success: false,
          error: { code: consentCheck.code || 'FORBIDDEN_ACCESS', message: consentCheck.reason }
        });
      }
    }

    if (req.user && req.user.role === 'doctor') {
      if (!transfer.recipientUserIds.includes(req.user.userId)) {
        transfer.recipientUserIds.push(req.user.userId);
      }
      if (!transfer.recipientUsernames.includes(req.user.username)) {
        transfer.recipientUsernames.push(req.user.username);
      }
      await transfer.save();
    }

    await AuditLog.create({
      action: 'QR_SCANNED_EVENT',
      actorId: req.user ? req.user.userId : null,
      actorRole: req.user ? req.user.role : 'anonymous',
      details: { transferId: transfer._id, pid: transfer.pid }
    });

    return res.status(200).json({
      success: true,
      message: 'Scan event logged.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Get current active version for patient ID (with IDOR protection)
exports.getCurrentByPid = async (req, res) => {
  try {
    const { pid } = req.params;

    if (!isAuthorizedForPatient(req.user, pid)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Unauthorized access to target patient record.' }
      });
    }

    if (req.user && req.user.role === 'doctor') {
      const consentCheck = await consentService.verifyAccessConsent({
        patientId: pid,
        requestingUser: req.user,
        hospital: req.user.hospitalName,
        purpose: 'EMERGENCY_TRANSFER',
        category: 'REFERRAL_DETAILS'
      });

      if (!consentCheck.authorized) {
        await AuditLog.create({
          action: 'UNAUTHORIZED_TRANSFER_ACCESS',
          actorId: req.user.userId,
          actorRole: req.user.role,
          details: { targetPid: pid, reason: consentCheck.reason }
        });
        return res.status(403).json({
          success: false,
          error: { code: consentCheck.code || 'FORBIDDEN_ACCESS', message: consentCheck.reason }
        });
      }
    }

    const currentTransfer = await Transfer.findOne({ pid, isCurrent: true }).sort({ createdAt: -1 });

    if (!currentTransfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `No active transfer found for Patient ID ${pid}.` }
      });
    }

    return res.status(200).json({
      success: true,
      transfer: currentTransfer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Patient Timeline (with IDOR protection)
exports.getPatientTimeline = async (req, res) => {
  try {
    const { pid } = req.params;

    if (!isAuthorizedForPatient(req.user, pid)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Unauthorized access to target patient record.' }
      });
    }

    if (req.user && req.user.role === 'doctor') {
      const consentCheck = await consentService.verifyAccessConsent({
        patientId: pid,
        requestingUser: req.user,
        hospital: req.user.hospitalName,
        purpose: 'EMERGENCY_TRANSFER',
        category: 'REFERRAL_DETAILS'
      });

      if (!consentCheck.authorized) {
        await AuditLog.create({
          action: 'UNAUTHORIZED_TRANSFER_ACCESS',
          actorId: req.user.userId,
          actorRole: req.user.role,
          details: { targetPid: pid, reason: consentCheck.reason }
        });
        return res.status(403).json({
          success: false,
          error: { code: consentCheck.code || 'FORBIDDEN_ACCESS', message: consentCheck.reason }
        });
      }
    }

    const transfers = await Transfer.find({ pid }).sort({ version: 1, submittedAt: 1 });

    return res.status(200).json({
      success: true,
      pid,
      totalVersions: transfers.length,
      timeline: transfers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Doctor Issued History
exports.getDoctorIssuedHistory = async (req, res) => {
  try {
    const transfers = await Transfer.find({ issuerUserId: req.user.userId }).sort({ updatedAt: -1 });
    return res.status(200).json({
      success: true,
      transfers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Recipient Scanned History
exports.getRecipientScannedHistory = async (req, res) => {
  try {
    const transfers = await Transfer.find({ recipientUserIds: req.user.userId }).sort({ updatedAt: -1 });
    return res.status(200).json({
      success: true,
      transfers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Get Live EMS Location, Criticality Examination & Ambulance/Hospital Contact Status
exports.getEmsStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const transfer = await Transfer.findById(id);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    const auth = await authorizeDoctorOrQRSession(req, transfer);
    if (!auth.authorized) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Doctor login or verified QR session required.' }
      });
    }

    const criticality = transfer.emsDispatch?.criticality?.updatedAt
      ? transfer.emsDispatch.criticality
      : computeCriticalityFromVitals(transfer.vit || {}, transfer.priority);

    return res.status(200).json({
      success: true,
      transferId: transfer._id,
      pid: transfer.pid,
      patientName: transfer.nam,
      priority: transfer.priority,
      status: transfer.status,
      fromHospital: transfer.fh,
      toHospital: transfer.th,
      vit: transfer.vit || {},
      contacts: {
        ambulancePhone: transfer.emsDispatch?.ambulancePhone || '',
        ambulanceId: transfer.emsDispatch?.ambulanceId || '',
        ambulanceCrewName: transfer.emsDispatch?.ambulanceCrewName || '',
        referringHospitalPhone: transfer.emsDispatch?.referringHospitalPhone || '',
        receivingHospitalPhone: transfer.emsDispatch?.receivingHospitalPhone || '',
        emergencyContact: transfer.emergencyContact || '',
        patientPhone: transfer.contactNumber || ''
      },
      emsDispatch: {
        ...(transfer.emsDispatch ? transfer.emsDispatch.toObject() : {}),
        criticality
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Update Live GPS Location, Dispatch Status, ETA & Criticality Vitals Snapshot
exports.updateEmsLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const transfer = await Transfer.findById(id);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    const auth = await authorizeDoctorOrQRSession(req, transfer);
    if (!auth.authorized) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Doctor login or verified QR session required.' }
      });
    }

    const {
      lat,
      lng,
      address,
      landmark,
      speedKmh,
      accuracyMeters,
      dispatchStatus,
      etaMinutes,
      distanceKm,
      ambulanceId,
      ambulanceCrewName,
      ambulancePhone,
      referringHospitalPhone,
      receivingHospitalPhone,
      vitals
    } = req.body;

    if (!transfer.emsDispatch) transfer.emsDispatch = {};

    if (ambulanceId !== undefined) transfer.emsDispatch.ambulanceId = String(ambulanceId).trim();
    if (ambulanceCrewName !== undefined) transfer.emsDispatch.ambulanceCrewName = String(ambulanceCrewName).trim();
    if (ambulancePhone !== undefined) transfer.emsDispatch.ambulancePhone = String(ambulancePhone).trim();
    if (referringHospitalPhone !== undefined) transfer.emsDispatch.referringHospitalPhone = String(referringHospitalPhone).trim();
    if (receivingHospitalPhone !== undefined) transfer.emsDispatch.receivingHospitalPhone = String(receivingHospitalPhone).trim();

    if (dispatchStatus && ['PREPARING', 'DISPATCHED', 'EN_ROUTE', 'CRITICAL_DIVERT', 'ARRIVING', 'ARRIVED'].includes(dispatchStatus)) {
      transfer.emsDispatch.dispatchStatus = dispatchStatus;
    }

    if (vitals && typeof vitals === 'object') {
      transfer.vit = { ...(transfer.vit ? transfer.vit.toObject() : {}), ...vitals, timestamp: new Date() };
    }

    const criticality = computeCriticalityFromVitals(transfer.vit || {}, transfer.priority);
    transfer.emsDispatch.criticality = criticality;

    const hasCoords = lat !== undefined && lat !== null && lng !== undefined && lng !== null && lat !== '' && lng !== '';
    if (hasCoords || address !== undefined || landmark !== undefined) {
      const prevLoc = transfer.emsDispatch.currentLocation || {};
      const nextLat = hasCoords ? Number(lat) : prevLoc.lat;
      const nextLng = hasCoords ? Number(lng) : prevLoc.lng;
      const nextAddr = address !== undefined ? String(address).trim() : (prevLoc.address || '');
      const nextLandmark = landmark !== undefined ? String(landmark).trim() : (prevLoc.landmark || '');
      const nextSpeed = speedKmh !== undefined ? Number(speedKmh) : (prevLoc.speedKmh || 0);

      transfer.emsDispatch.currentLocation = {
        lat: nextLat,
        lng: nextLng,
        address: nextAddr,
        landmark: nextLandmark,
        speedKmh: nextSpeed,
        accuracyMeters: accuracyMeters !== undefined ? Number(accuracyMeters) : prevLoc.accuracyMeters,
        updatedAt: new Date()
      };

      if (hasCoords) {
        if (!Array.isArray(transfer.emsDispatch.locationHistory)) {
          transfer.emsDispatch.locationHistory = [];
        }
        transfer.emsDispatch.locationHistory.push({
          lat: nextLat,
          lng: nextLng,
          address: nextAddr,
          landmark: nextLandmark,
          speedKmh: nextSpeed,
          criticalityLevel: criticality.level,
          news2Score: criticality.news2Score,
          timestamp: new Date()
        });
        // Keep last 50 trail points
        if (transfer.emsDispatch.locationHistory.length > 50) {
          transfer.emsDispatch.locationHistory = transfer.emsDispatch.locationHistory.slice(-50);
        }
      }
    }

    // Compute distance & ETA if destination coordinates exist
    const dest = transfer.emsDispatch.destinationLocation;
    const curr = transfer.emsDispatch.currentLocation;
    if (distanceKm !== undefined && distanceKm !== null) {
      transfer.emsDispatch.distanceKm = Number(distanceKm);
    } else if (curr?.lat != null && dest?.lat != null) {
      transfer.emsDispatch.distanceKm = haversineDistanceKm(curr.lat, curr.lng, dest.lat, dest.lng);
    }

    if (etaMinutes !== undefined && etaMinutes !== null) {
      transfer.emsDispatch.etaMinutes = Number(etaMinutes);
    } else if (transfer.emsDispatch.distanceKm != null) {
      const speed = Math.max(25, Number(curr?.speedKmh || 45));
      transfer.emsDispatch.etaMinutes = Math.max(1, Math.round((transfer.emsDispatch.distanceKm / speed) * 60));
    }

    await transfer.save();

    // If patient becomes CRITICAL, notify receiving & referring clinicians
    if (criticality.level === 'CRITICAL') {
      const recipients = [transfer.issuerUserId, ...(transfer.recipientUserIds || [])].filter(Boolean);
      for (const uid of recipients) {
        await createNotification({
          eventId: `ems_crit_${transfer._id}_${Math.floor(Date.now() / 60000)}`,
          recipientUserId: uid,
          recipientRole: 'doctor',
          notificationType: 'EMS_CRITICAL_ALERT',
          category: 'EMERGENCY_TRANSFER',
          title: `🚨 CRITICAL IN-TRANSIT PATIENT: ${transfer.nam}`,
          message: `Patient ${transfer.nam} (${transfer.pid}) criticality escalated (${criticality.acuitySummary}) en route to ${transfer.th}.`,
          isEssential: true
        });
      }
    }

    await AuditLog.create({
      action: 'EMS_LOCATION_UPDATED',
      actorId: req.user ? req.user.userId : null,
      actorRole: auth.actorRole,
      details: {
        transferId: transfer._id,
        dispatchStatus: transfer.emsDispatch.dispatchStatus,
        criticalityLevel: criticality.level,
        news2Score: criticality.news2Score
      }
    });

    return res.status(200).json({
      success: true,
      emsDispatch: transfer.emsDispatch,
      vit: transfer.vit
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Post Persistent EMS Incident Message or Call Log
exports.postEmsMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, channel = 'IN_APP', target = '' } = req.body;
    if (!text || !String(text).trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Message text is required.' }
      });
    }

    const transfer = await Transfer.findById(id);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    const auth = await authorizeDoctorOrQRSession(req, transfer);
    if (!auth.authorized) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Doctor login or verified QR session required.' }
      });
    }

    if (!transfer.emsDispatch) transfer.emsDispatch = {};
    if (!Array.isArray(transfer.emsDispatch.incidentMessages)) {
      transfer.emsDispatch.incidentMessages = [];
    }

    const entry = {
      senderName: auth.actorName,
      senderRole: req.user ? (req.user.hospitalName || 'Doctor') : 'Receiving Clinician',
      channel: ['IN_APP', 'SMS', 'CALL_LOG'].includes(channel) ? channel : 'IN_APP',
      target: String(target || ''),
      text: String(text).trim().slice(0, 1000),
      timestamp: new Date()
    };

    transfer.emsDispatch.incidentMessages.push(entry);
    await transfer.save();

    return res.status(201).json({
      success: true,
      message: entry,
      incidentMessages: transfer.emsDispatch.incidentMessages
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Dispatch Emergency SMS to Ambulance or Referring/Receiving Hospital directly from Transfer Folio
exports.sendEmergencySms = async (req, res) => {
  try {
    const { id } = req.params;
    const { target = 'ambulance', customPhone = '', customMessage = '' } = req.body;

    const transfer = await Transfer.findById(id);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    const auth = await authorizeDoctorOrQRSession(req, transfer);
    if (!auth.authorized) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Doctor login or verified QR session required.' }
      });
    }

    const ems = transfer.emsDispatch || {};
    let resolvedPhone = customPhone ? String(customPhone).trim() : '';
    let targetLabel = 'Ambulance Crew';

    if (!resolvedPhone) {
      if (target === 'ambulance') {
        resolvedPhone = ems.ambulancePhone || '';
        targetLabel = `Ambulance ${ems.ambulanceId || 'Unit'}`;
      } else if (target === 'referring_hospital') {
        resolvedPhone = ems.referringHospitalPhone || '';
        targetLabel = transfer.fh;
      } else if (target === 'receiving_hospital') {
        resolvedPhone = ems.receivingHospitalPhone || '';
        targetLabel = transfer.th;
      } else if (target === 'emergency_contact') {
        resolvedPhone = transfer.emergencyContact || transfer.contactNumber || '';
        targetLabel = 'Patient Emergency Contact';
      }
    }

    const crit = ems.criticality || computeCriticalityFromVitals(transfer.vit || {}, transfer.priority);
    const loc = ems.currentLocation;
    const locSnippet = loc?.lat != null ? `GPS: ${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}` : (loc?.address || 'GPS pending');

    const smsBody = (customMessage && String(customMessage).trim())
      ? String(customMessage).trim()
      : `[MEDIFORM EMERGENCY] Patient ${transfer.nam} (${transfer.pid}) | ${transfer.pd} | Criticality: ${crit.level} (NEWS2 ${crit.news2Score}) | Route: ${transfer.fh} -> ${transfer.th} | ${locSnippet}. Respond immediately.`;

    if (!transfer.emsDispatch) transfer.emsDispatch = {};
    if (!Array.isArray(transfer.emsDispatch.incidentMessages)) {
      transfer.emsDispatch.incidentMessages = [];
    }

    transfer.emsDispatch.incidentMessages.push({
      senderName: auth.actorName,
      senderRole: req.user ? (req.user.hospitalName || 'Doctor') : 'Receiving Clinician',
      channel: 'SMS',
      target: resolvedPhone || targetLabel,
      text: `Emergency SMS to ${targetLabel}${resolvedPhone ? ` (${resolvedPhone})` : ''}: ${smsBody}`,
      timestamp: new Date()
    });
    await transfer.save();

    if (req.user) {
      await recordSmsUsage(req.user);
    }

    if (transfer.issuerUserId) {
      await createNotification({
        eventId: `ems_sms_${transfer._id}_${Date.now()}`,
        recipientUserId: transfer.issuerUserId,
        recipientRole: 'doctor',
        notificationType: 'EMERGENCY_SMS_SENT',
        category: 'EMERGENCY_TRANSFER',
        title: `📲 Emergency SMS Sent (${targetLabel})`,
        message: smsBody,
        isEssential: true
      });
    }

    await AuditLog.create({
      action: 'EMERGENCY_SMS_DISPATCHED',
      actorId: req.user ? req.user.userId : null,
      actorRole: auth.actorRole,
      details: { transferId: transfer._id, target, hasPhone: Boolean(resolvedPhone) }
    });

    const smsUri = resolvedPhone
      ? `sms:${encodeURIComponent(resolvedPhone)}?body=${encodeURIComponent(smsBody)}`
      : `sms:?body=${encodeURIComponent(smsBody)}`;

    return res.status(200).json({
      success: true,
      target: targetLabel,
      phone: resolvedPhone,
      smsBody,
      smsUri,
      gatewayMode: process.env.TWILIO_ACCOUNT_SID ? 'CARRIER_GATEWAY' : 'NATIVE_SMS_BRIDGE_AND_IN_APP',
      incidentMessages: transfer.emsDispatch.incidentMessages
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};
