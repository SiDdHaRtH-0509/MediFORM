const crypto = require('crypto');
const QRSession = require('../models/QRSession');
const Transfer = require('../models/Transfer');
const AuditLog = require('../models/AuditLog');
const cryptoService = require('../services/cryptoService');

function generateRandomPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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

    return res.status(201).json({
      success: true,
      uuid,
      pin, // Returned once for issuing doctor display
      expiresAt,
      shareUrl,
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
    const isRevoked = Boolean(session.isRevoked);

    const transfer = await Transfer.findById(session.transferId);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Target transfer record not found.' }
      });
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
