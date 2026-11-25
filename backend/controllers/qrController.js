const crypto = require('crypto');
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  nodemailer = null;
}
const QRSession = require('../models/QRSession');
const Transfer = require('../models/Transfer');
const User = require('../models/User');
const Consent = require('../models/Consent');
const AuditLog = require('../models/AuditLog');
const cryptoService = require('../services/cryptoService');
const { createNotification } = require('../services/notificationService');

const { generateSecurePIN } = cryptoService;

function generateRandomPin() {
  return generateSecurePIN();
}

/**
 * Constructs an explicit Clinical Receiver DTO from decrypted transfer object.
 * Contains complete clinical handoff information for receiving healthcare professionals while excluding authentication secrets.
 */
function buildClinicalDTO(transferObj) {
  return {
    _id: transferObj._id,
    pid: transferObj.pid,
    nam: transferObj.nam,
    age: transferObj.age,
    gender: transferObj.gender || 'Other',
    bg: transferObj.bg,
    dob: transferObj.dob || null,
    contactNumber: transferObj.contactNumber || null,
    emergencyContact: transferObj.emergencyContact || null,
    address: transferObj.address || null,
    fh: transferObj.fh,
    th: transferObj.th,
    rt: transferObj.rt,
    priority: transferObj.priority || 'Routine',
    referringDoctor: transferObj.referringDoctor || null,
    receivingDepartment: transferObj.receivingDepartment || null,
    transferDateTime: transferObj.transferDateTime,
    pd: transferObj.pd,
    secondaryDiagnosis: transferObj.secondaryDiagnosis || null,
    currentCondition: transferObj.currentCondition || null,
    sum: transferObj.sum || null,
    alg: transferObj.alg || [],
    noKnownAllergies: Boolean(transferObj.noKnownAllergies),
    med: transferObj.med || [],
    vit: transferObj.vit || null,
    pi: transferObj.pi || [],
    otherDetails: transferObj.otherDetails || [],
    emsDispatch: transferObj.emsDispatch || {},
    issuerUserId: transferObj.issuerUserId,
    issuerUsername: transferObj.issuerUsername,
    recipientUserIds: transferObj.recipientUserIds || [],
    recipientUsernames: transferObj.recipientUsernames || [],
    status: transferObj.status || 'IN_TRANSIT',
    acknowledgementStatus: transferObj.acknowledgementStatus || 'PENDING',
    acknowledgement: transferObj.acknowledgement || null,
    version: transferObj.version || 1,
    previousVersionId: transferObj.previousVersionId || null,
    isCurrent: transferObj.isCurrent !== undefined ? transferObj.isCurrent : true,
    history: transferObj.history || [],
    submittedAt: transferObj.submittedAt
  };
}

/**
 * Constructs an explicit Patient-Safe Read-Only DTO from decrypted transfer object.
 * Excludes internal clinician user IDs, internal audit history logs, secrets, or administrative notes.
 */
function buildPatientSafeDTO(transferObj) {
  return {
    patientName: transferObj.nam,
    patientId: transferObj.pid,
    age: transferObj.age,
    gender: transferObj.gender,
    bloodGroup: transferObj.bg,
    fromHospital: transferObj.fh,
    toHospital: transferObj.th,
    transferReason: transferObj.rt,
    priority: transferObj.priority,
    transferStatus: transferObj.status,
    submittedAt: transferObj.submittedAt,
    primaryDiagnosis: transferObj.pd,
    clinicalSummary: transferObj.sum || 'N/A',
    allergies: transferObj.alg || [],
    medications: (transferObj.med || []).map(m => ({
      drugName: m.n,
      dose: m.d,
      route: m.r,
      frequency: m.frequency,
      notes: m.notes
    })),
    vitals: transferObj.vit ? {
      heartRate: transferObj.vit.hr,
      bloodPressure: transferObj.vit.bp,
      respRate: transferObj.vit.rr,
      spO2: transferObj.vit.spo2,
      temp: transferObj.vit.temp,
      gcs: transferObj.vit.gcs,
      measuredAt: transferObj.vit.timestamp
    } : null,
    investigations: transferObj.pi || [],
    otherDetails: (transferObj.otherDetails || []).map(od => ({
      title: od.title,
      value: od.value,
      category: od.category,
      priority: od.priority,
      timestamp: od.timestamp
    }))
  };
}

exports.generateQR = async (req, res) => {
  try {
    const targetTransferId = req.params.id || req.body.transferId;

    if (!targetTransferId) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Transfer ID is required for QR generation.' }
      });
    }

    const transfer = await Transfer.findById(targetTransferId);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    // Authorization Check: Must be Doctor role and either issuer or authorized recipient
    const userIdStr = (req.user.userId || '').toString();
    const usernameStr = (req.user.username || '').toString().toLowerCase();

    const isIssuer = (transfer.issuerUserId && transfer.issuerUserId.toString() === userIdStr) ||
                     (transfer.issuerUsername && transfer.issuerUsername.toLowerCase() === usernameStr);
                     
    const isRecipient = (transfer.recipientUserIds || []).some(id => id.toString() === userIdStr) ||
                        (transfer.recipientUsernames || []).some(uname => uname.toLowerCase() === usernameStr);

    if (!isIssuer && !isRecipient) {
      await AuditLog.create({
        action: 'UNAUTHORIZED_QR_GENERATION_ATTEMPT',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { transferId: transfer._id, reason: 'User is neither issuer nor recipient of target transfer' }
      });
      return res.status(403).json({
        success: false,
        error: { code: 'TRANSFER_ACCESS_DENIED', message: 'Unauthorized access to target transfer QR code.' }
      });
    }

    // 6-digit PIN validation or generation
    const customPin = req.body.pin;
    const pin = customPin && /^\d{6}$/.test(customPin) ? customPin : generateRandomPin();

    const payloadObj = transfer.toObject();

    // Compress & Encrypt payload with AES-256-GCM
    const encryptedPayload = cryptoService.encryptPayload(payloadObj);

    // Hash PIN securely
    const pinHash = await cryptoService.hashPIN(pin);

    // Set Configurable Share Session TTL (Default 120 mins for inter-hospital transport)
    const ttlMinutes = parseInt(process.env.QR_SHARE_TTL_MINUTES || process.env.QR_TTL_MINUTES || '120', 10);
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

    await AuditLog.create({
      action: 'QR_GENERATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { uuid, transferId: transfer._id, expiresAt }
    });

    await AuditLog.create({
      action: 'QR_SHARE_CREATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { uuid, transferId: transfer._id, expiresAt }
    });

    await AuditLog.create({
      action: 'QR_SESSION_CREATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { uuid, transferId: transfer._id, expiresAt }
    });

    const baseUrl = process.env.APP_PUBLIC_URL || 'https://mediform.health';
    const shareUrl = `${baseUrl}/handoff/${uuid}`;
    const deepLinkUrl = `mediform://handoff/${uuid}`;

    return res.status(201).json({
      success: true,
      uuid,
      pin, // Returned once for issuing doctor display
      expiresAt,
      shareUrl,
      deepLinkUrl,
      transferId: transfer._id,
      patientId: transfer.pid,
      patientName: transfer.nam,
      fromHospital: transfer.fh,
      toHospital: transfer.th,
      priority: transfer.priority
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Public endpoint for Direct Link Handoff Landing (zero PHI returned)
exports.getShareInfo = async (req, res) => {
  try {
    // Enforce No-Store & Privacy Headers for public metadata endpoint
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const { uuid } = req.params;
    const session = await QRSession.findOne({ uuid });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Handoff session not found or invalid.' }
      });
    }

    const isExpired = new Date() > new Date(session.expiresAt);
    let isRevoked = Boolean(session.isRevoked);

    const transfer = await Transfer.findById(session.transferId);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Target transfer record not found.' }
      });
    }

    // Verify if consent was revoked for this patient and receiving hospital
    if (!isRevoked && transfer.pid) {
      const revokedConsent = await Consent.findOne({
        patientId: new RegExp(`^${transfer.pid}$`, 'i'),
        status: 'REVOKED',
        $or: [
          { authorizedHospital: new RegExp(`^${transfer.th}$`, 'i') },
          { authorizedHospital: null }
        ]
      }).sort({ revokedAt: -1, updatedAt: -1 });

      const activeConsent = await Consent.findOne({
        patientId: new RegExp(`^${transfer.pid}$`, 'i'),
        status: 'GRANTED',
        expiresAt: { $gt: new Date() },
        $or: [
          { authorizedHospital: new RegExp(`^${transfer.th}$`, 'i') },
          { authorizedHospital: null }
        ]
      }).sort({ createdAt: -1 });

      if (revokedConsent && (!activeConsent || activeConsent.createdAt < (revokedConsent.revokedAt || revokedConsent.updatedAt))) {
        isRevoked = true;
      }
    }

    // Return unauthenticated share header metadata (STRICT ZERO PHI)
    return res.status(200).json({
      success: true,
      uuid,
      fromHospital: transfer.fh,
      toHospital: transfer.th,
      priority: transfer.priority,
      expiresAt: session.expiresAt,
      isExpired,
      isRevoked
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Revoke Shared Access (Doctor only)
exports.revokeQR = async (req, res) => {
  try {
    const { uuid } = req.params;
    const session = await QRSession.findOne({ uuid });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'QR share session not found.' }
      });
    }

    const transfer = await Transfer.findById(session.transferId);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Target transfer record not found.' }
      });
    }

    // Authorization check: Only issuer doctor can revoke
    const userIdStr = (req.user.userId || '').toString();
    const usernameStr = (req.user.username || '').toString().toLowerCase();

    const isIssuer = (transfer.issuerUserId && transfer.issuerUserId.toString() === userIdStr) ||
                     (transfer.issuerUsername && transfer.issuerUsername.toLowerCase() === usernameStr);

    if (!isIssuer) {
      await AuditLog.create({
        action: 'UNAUTHORIZED_QR_REVOCATION_ATTEMPT',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { uuid, transferId: transfer._id }
      });
      return res.status(403).json({
        success: false,
        error: { code: 'TRANSFER_ACCESS_DENIED', message: 'Only the issuing doctor can revoke this share session.' }
      });
    }

    session.isRevoked = true;
    session.expiresAt = new Date(0);
    await session.save();

    await AuditLog.create({
      action: 'QR_SHARE_REVOKED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { uuid, transferId: transfer._id }
    });

    return res.status(200).json({
      success: true,
      message: 'Share session revoked successfully.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Full Clinical Receiver View Validation
exports.validateQR = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { pin } = req.body;

    if (!uuid || !pin) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'UUID and 6-digit PIN are required.' }
      });
    }

    if (!/^\d{6}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PIN_FORMAT', message: 'PIN must be exactly 6 numeric digits.' }
      });
    }

    const session = await QRSession.findOne({ uuid });

    if (!session) {
      await AuditLog.create({
        action: 'QR_ACCESS_DENIED',
        actorId: req.user ? req.user.userId : null,
        actorRole: req.user ? req.user.role : 'anonymous',
        details: { uuid, reason: 'Session not found or invalid' }
      });
      return res.status(404).json({
        success: false,
        error: { code: 'EXPIRED_OR_INVALID_QR', message: 'Unable to verify this transfer. The QR code may have expired or is invalid.' }
      });
    }

    if (session.isRevoked || new Date() > new Date(session.expiresAt)) {
      await AuditLog.create({
        action: session.isRevoked ? 'QR_SHARE_REVOKED_ACCESS' : 'QR_ACCESS_DENIED',
        actorId: req.user ? req.user.userId : null,
        actorRole: req.user ? req.user.role : 'anonymous',
        details: { uuid, reason: session.isRevoked ? 'Session revoked' : 'Session expired' }
      });
      return res.status(410).json({
        success: false,
        error: {
          code: 'QR_EXPIRED',
          message: session.isRevoked
            ? 'This transfer share link or QR code has been revoked by the issuing hospital.'
            : 'This QR code has expired. Please ask the issuing hospital to generate a new QR code.'
        }
      });
    }

    // Verify linked consent validity before PIN processing
    const transferRec = await Transfer.findById(session.transferId);
    if (transferRec && transferRec.pid) {
      const revokedConsent = await Consent.findOne({
        patientId: new RegExp(`^${transferRec.pid}$`, 'i'),
        status: 'REVOKED',
        $or: [
          { authorizedHospital: new RegExp(`^${transferRec.th}$`, 'i') },
          { authorizedHospital: null }
        ]
      }).sort({ revokedAt: -1, updatedAt: -1 });

      const activeConsent = await Consent.findOne({
        patientId: new RegExp(`^${transferRec.pid}$`, 'i'),
        status: 'GRANTED',
        expiresAt: { $gt: new Date() },
        $or: [
          { authorizedHospital: new RegExp(`^${transferRec.th}$`, 'i') },
          { authorizedHospital: null }
        ]
      }).sort({ createdAt: -1 });

      if (revokedConsent && (!activeConsent || activeConsent.createdAt < (revokedConsent.revokedAt || revokedConsent.updatedAt))) {
        session.isRevoked = true;
        session.expiresAt = new Date(0);
        await session.save();

        await AuditLog.create({
          action: 'QR_ACCESS_DENIED',
          actorId: req.user ? req.user.userId : null,
          actorRole: req.user ? req.user.role : 'anonymous',
          details: { uuid, reason: 'Consent revoked for receiving hospital' }
        });

        return res.status(410).json({
          success: false,
          error: {
            code: 'QR_EXPIRED',
            message: 'This transfer share link or QR code has been revoked due to patient consent withdrawal.'
          }
        });
      }
    }

    if (session.failedAttempts >= session.maxAttempts) {
      await AuditLog.create({
        action: 'QR_ACCESS_DENIED',
        actorId: req.user ? req.user.userId : null,
        actorRole: req.user ? req.user.role : 'anonymous',
        details: { uuid, reason: 'Max PIN attempts exceeded' }
      });
      return res.status(429).json({
        success: false,
        error: { code: 'MAX_PIN_ATTEMPTS_EXCEEDED', message: 'Maximum PIN validation attempts exceeded. Access has been locked for security.' }
      });
    }

    const isPinValid = await cryptoService.verifyPIN(pin, session.pinHash);

    if (!isPinValid) {
      session.failedAttempts += 1;
      await session.save();

      const remaining = session.maxAttempts - session.failedAttempts;

      await AuditLog.create({
        action: 'QR_PIN_FAILURE',
        actorId: req.user ? req.user.userId : null,
        actorRole: req.user ? req.user.role : 'anonymous',
        details: { uuid, failedAttempts: session.failedAttempts }
      });

      return res.status(401).json({
        success: false,
        error: {
          code: 'INCORRECT_PIN',
          message: `Incorrect PIN. ${remaining > 0 ? `${remaining} attempts remaining.` : 'Access locked.'}`,
          attemptsRemaining: Math.max(0, remaining)
        }
      });
    }

    // Decrypt full AES payload for receiving doctor
    const decryptedPayload = cryptoService.decryptPayload(session.encryptedPayload);

    // Enrich with live EMS location, criticality & arrival status from DB if available
    if (transferRec) {
      decryptedPayload.emsDispatch = transferRec.emsDispatch || decryptedPayload.emsDispatch;
      decryptedPayload.status = transferRec.status || decryptedPayload.status;
      decryptedPayload.acknowledgementStatus = transferRec.acknowledgementStatus || decryptedPayload.acknowledgementStatus;
      decryptedPayload.acknowledgement = transferRec.acknowledgement || decryptedPayload.acknowledgement;
    }

    await AuditLog.create({
      action: 'QR_ACCESS_SUCCESS',
      actorId: req.user ? req.user.userId : null,
      actorRole: req.user ? req.user.role : 'anonymous',
      details: { uuid, transferId: session.transferId, viewType: 'clinical' }
    });

    const clinicalDTO = buildClinicalDTO(decryptedPayload);

    return res.status(200).json({
      success: true,
      transfer: clinicalDTO
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'QR_DECRYPTION_FAILED', message: 'Unable to decrypt transfer payload. The QR data may be corrupted or tampered.' }
    });
  }
};

// Patient-Safe Read-Only View Validation
exports.validatePatientQR = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { pin } = req.body;

    if (!uuid || !pin) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'UUID and 6-digit PIN are required.' }
      });
    }

    const session = await QRSession.findOne({ uuid });
    if (!session) {
      await AuditLog.create({
        action: 'QR_ACCESS_DENIED',
        actorId: null,
        actorRole: 'patient_qr_viewer',
        details: { uuid, reason: 'Session not found or invalid' }
      });
      return res.status(404).json({
        success: false,
        error: { code: 'EXPIRED_OR_INVALID_QR', message: 'Unable to verify this transfer. The QR code may have expired or is invalid.' }
      });
    }

    if (session.isRevoked || new Date() > new Date(session.expiresAt)) {
      await AuditLog.create({
        action: session.isRevoked ? 'QR_SHARE_REVOKED_ACCESS' : 'QR_ACCESS_DENIED',
        actorId: null,
        actorRole: 'patient_qr_viewer',
        details: { uuid, reason: session.isRevoked ? 'Session revoked' : 'Session expired' }
      });
      return res.status(410).json({
        success: false,
        error: {
          code: 'QR_EXPIRED',
          message: session.isRevoked
            ? 'This transfer share link or QR code has been revoked.'
            : 'This QR code has expired.'
        }
      });
    }

    // Verify linked consent validity before PIN processing
    const transferPatRec = await Transfer.findById(session.transferId);
    if (transferPatRec && transferPatRec.pid) {
      const revokedConsent = await Consent.findOne({
        patientId: new RegExp(`^${transferPatRec.pid}$`, 'i'),
        status: 'REVOKED',
        $or: [
          { authorizedHospital: new RegExp(`^${transferPatRec.th}$`, 'i') },
          { authorizedHospital: null }
        ]
      }).sort({ revokedAt: -1, updatedAt: -1 });

      const activeConsent = await Consent.findOne({
        patientId: new RegExp(`^${transferPatRec.pid}$`, 'i'),
        status: 'GRANTED',
        expiresAt: { $gt: new Date() },
        $or: [
          { authorizedHospital: new RegExp(`^${transferPatRec.th}$`, 'i') },
          { authorizedHospital: null }
        ]
      }).sort({ createdAt: -1 });

      if (revokedConsent && (!activeConsent || activeConsent.createdAt < (revokedConsent.revokedAt || revokedConsent.updatedAt))) {
        session.isRevoked = true;
        session.expiresAt = new Date(0);
        await session.save();

        await AuditLog.create({
          action: 'QR_ACCESS_DENIED',
          actorId: null,
          actorRole: 'patient_qr_viewer',
          details: { uuid, reason: 'Consent revoked for receiving hospital' }
        });

        return res.status(410).json({
          success: false,
          error: {
            code: 'QR_EXPIRED',
            message: 'This transfer share link or QR code has been revoked due to patient consent withdrawal.'
          }
        });
      }
    }

    if (session.failedAttempts >= session.maxAttempts) {
      await AuditLog.create({
        action: 'QR_ACCESS_DENIED',
        actorId: null,
        actorRole: 'patient_qr_viewer',
        details: { uuid, reason: 'Max PIN attempts exceeded' }
      });
      return res.status(429).json({
        success: false,
        error: { code: 'MAX_PIN_ATTEMPTS_EXCEEDED', message: 'Maximum PIN attempts exceeded. Access locked.' }
      });
    }

    const isPinValid = await cryptoService.verifyPIN(pin, session.pinHash);

    if (!isPinValid) {
      session.failedAttempts += 1;
      await session.save();

      const remaining = session.maxAttempts - session.failedAttempts;

      await AuditLog.create({
        action: 'QR_PIN_FAILURE',
        actorId: null,
        actorRole: 'patient_qr_viewer',
        details: { uuid, failedAttempts: session.failedAttempts }
      });

      return res.status(401).json({
        success: false,
        error: { code: 'INCORRECT_PIN', message: `Incorrect PIN. ${remaining} attempts remaining.` }
      });
    }

    const decryptedPayload = cryptoService.decryptPayload(session.encryptedPayload);
    const patientDTO = buildPatientSafeDTO(decryptedPayload);

    await AuditLog.create({
      action: 'QR_ACCESS_SUCCESS',
      actorId: null,
      actorRole: 'patient_qr_viewer',
      details: { uuid, transferId: session.transferId, viewType: 'patient_safe' }
    });

    return res.status(200).json({
      success: true,
      patientView: patientDTO
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'QR_DECRYPTION_FAILED', message: 'Unable to decrypt transfer payload. The QR data may be corrupted or tampered.' }
    });
  }
};

// Direct Inter-Hospital QR Handoff Dispatch (Notifies receiving doctor/hospital in-app + optional email)
exports.dispatchQR = async (req, res) => {
  try {
    const {
      uuid,
      recipientEmail = '',
      recipientHospital = '',
      recipientPhone = '',
      shareUrl = '',
      includePinNotice = false,
      pin = ''
    } = req.body;

    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'QR session UUID is required.' }
      });
    }

    const session = await QRSession.findOne({ uuid });
    if (!session || session.isRevoked || new Date() > new Date(session.expiresAt)) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Active QR handoff session not found.' }
      });
    }

    const transfer = await Transfer.findById(session.transferId);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    const effectiveUrl = shareUrl || `${process.env.APP_PUBLIC_URL || 'https://mediform.health'}/handoff/${uuid}`;
    const targetHospital = (recipientHospital || transfer.th || '').trim();
    const targetEmail = (recipientEmail || '').trim().toLowerCase();

    // Find matching doctors in MediFORM by email or receiving hospital name
    const recipientQuery = { role: 'doctor', $or: [] };
    if (targetEmail) {
      recipientQuery.$or.push({ email: targetEmail }, { username: targetEmail });
    }
    if (targetHospital) {
      recipientQuery.$or.push({ hospitalName: new RegExp(`^${targetHospital}$`, 'i') });
    }

    let matchedDoctors = [];
    if (recipientQuery.$or.length > 0) {
      matchedDoctors = await User.find(recipientQuery).select('_id email name hospitalName');
    }

    for (const doc of matchedDoctors) {
      if (doc._id.toString() === req.user.userId.toString()) continue;
      if (!transfer.recipientUserIds.some(id => id.toString() === doc._id.toString())) {
        transfer.recipientUserIds.push(doc._id);
      }
      if (doc.email && !transfer.recipientUsernames.includes(doc.email)) {
        transfer.recipientUsernames.push(doc.email);
      }

      await createNotification({
        eventId: `qr_dispatch_${uuid}_${doc._id}`,
        recipientUserId: doc._id,
        recipientRole: 'doctor',
        notificationType: 'TRANSFER_DISPATCHED',
        category: 'EMERGENCY_TRANSFER',
        title: `🚑 Incoming ${transfer.priority} Handoff from ${transfer.fh}`,
        message: `Handoff QR dispatched for ${transfer.fh} -> ${transfer.th}. Open link: ${effectiveUrl}${includePinNotice && pin ? ` | Access PIN: ${pin}` : ' (Contact referring doctor for 6-digit PIN)'}`,
        isEssential: true
      });
    }

    if (matchedDoctors.length > 0) {
      await transfer.save();
    }

    // Optional SMTP email dispatch (Zero PHI - link + hospital route only)
    let emailDispatched = false;
    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
    if (nodemailer && targetEmail && smtpUser && smtpPass && !smtpUser.includes('YOUR_')) {
      try {
        const transporter = nodemailer.createTransport({
          service: (process.env.SMTP_HOST || '').includes('gmail') ? 'gmail' : undefined,
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: process.env.SMTP_SECURE === 'true',
          auth: { user: smtpUser, pass: smtpPass }
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || `MediFORM Dispatch <${smtpUser}>`,
          to: targetEmail,
          subject: `[MediFORM ${transfer.priority.toUpperCase()}] Secure Patient Handoff: ${transfer.fh} -> ${transfer.th}`,
          text: `You have received a MediFORM Secure Patient Handoff.\nRoute: ${transfer.fh} -> ${transfer.th}\nPriority: ${transfer.priority}\nOpen Secure Handoff Folio: ${effectiveUrl}\n${includePinNotice && pin ? `6-Digit Access PIN: ${pin}\n` : 'Obtain the 6-digit PIN from the referring physician via phone/SMS.'}`
        });
        emailDispatched = true;
      } catch (mailErr) {
        console.warn('QR dispatch email skipped:', mailErr.message);
      }
    }

    await AuditLog.create({
      action: 'QR_HANDOFF_DISPATCHED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        uuid,
        transferId: transfer._id,
        notifiedDoctorsCount: matchedDoctors.length,
        emailDispatched,
        hasPhoneTarget: Boolean(recipientPhone)
      }
    });

    return res.status(200).json({
      success: true,
      notifiedDoctorsCount: matchedDoctors.length,
      emailDispatched,
      shareUrl: effectiveUrl,
      message: matchedDoctors.length > 0 || emailDispatched
        ? `Dispatched handoff alert to ${matchedDoctors.length} hospital clinician(s)${emailDispatched ? ' & sent email' : ''}.`
        : 'Handoff dispatch prepared. Use SMS, WhatsApp, or Copy Packet below to send directly to the receiving doctor.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};
