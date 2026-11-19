const Consent = require('../models/Consent');
const consentService = require('../services/consentService');
const { recordAuditLog } = require('../services/auditService');

/**
 * List Consents
 * Patient: views their own active and historical consents
 * Doctor: views consents granted to them or their hospital
 */
exports.getConsents = async (req, res) => {
  try {
    if (req.user.role === 'patient') {
      const consents = await consentService.getActiveConsentsForPatient(req.user.userId, req.user.username);
      return res.status(200).json({
        success: true,
        consents,
        count: consents.length
      });
    }

    if (req.user.role === 'doctor') {
      const userHospital = req.user.hospitalName || (req.currentUser && req.currentUser.hospitalName) || '';
      const consents = await consentService.getConsentsForDoctor(req.user.userId, userHospital);
      return res.status(200).json({
        success: true,
        consents,
        count: consents.length
      });
    }

    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN_ROLE', message: 'Unauthorized role.' }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving consents.' }
    });
  }
};

/**
 * Get Consent by ID
 */
exports.getConsentById = async (req, res) => {
  try {
    const { id } = req.params;
    let consent = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      consent = await Consent.findById(id);
    }
    if (!consent) {
      consent = await Consent.findOne({ consentId: id });
    }

    if (!consent) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Consent record not found.' }
      });
    }

    // IDOR / Access Authorization
    if (req.user.role === 'patient') {
      const userPid = (req.user.username || '').toLowerCase();
      const targetPid = (consent.patientId || '').toLowerCase();
      const userIdStr = (req.user.userId || '').toString();
      const consentUserIdStr = (consent.patientUserId || '').toString();

      if (userPid !== targetPid && userIdStr !== consentUserIdStr) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN_ACCESS', message: 'Unauthorized to view another patient consent record.' }
        });
      }
    } else if (req.user.role === 'doctor') {
      const userHospital = (req.user.hospitalName || (req.currentUser && req.currentUser.hospitalName) || '').toLowerCase();
      const userIdStr = (req.user.userId || '').toString();
      const isTargetDoc = consent.authorizedDoctorId && consent.authorizedDoctorId.toString() === userIdStr;
      const isTargetHospital = consent.authorizedHospital && consent.authorizedHospital.toLowerCase() === userHospital;

      if (!isTargetDoc && !isTargetHospital) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN_ACCESS', message: 'Consent was not granted to your account or hospital.' }
        });
      }
    }

    return res.status(200).json({
      success: true,
      consent
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving consent.' }
    });
  }
};

/**
 * Grant New Patient Consent
 */
exports.grantConsent = async (req, res) => {
  try {
    const {
      authorizedHospital,
      authorizedDoctorId,
      authorizedDoctorName,
      purpose = 'SPECIALIST_REFERRAL',
      permittedCategories,
      expiresAt,
      durationDays = 30
    } = req.body;

    if (!authorizedHospital || !authorizedHospital.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'authorizedHospital is required.' }
      });
    }

    // Patient identity is derived directly from authenticated session
    const patientUserId = req.user.role === 'patient'
      ? req.user.userId
      : req.body.patientUserId || req.user.userId;
    const patientId = req.user.role === 'patient'
      ? req.user.username
      : req.body.patientId || req.user.username;
    const patientName = req.user.name || req.body.patientName || '';

    const consent = await consentService.createConsentRecord({
      patientUserId,
      patientId,
      patientName,
      purpose,
      authorizedDoctorId: authorizedDoctorId || null,
      authorizedDoctorName: authorizedDoctorName || '',
      authorizedHospital: authorizedHospital.trim(),
      permittedCategories,
      expiresAt,
      durationDays,
      actorId: req.user.userId,
      actorRole: req.user.role
    });

    return res.status(201).json({
      success: true,
      message: 'Consent granted successfully.',
      consent
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error granting consent.' }
    });
  }
};

/**
 * Revoke Consent
 */
exports.revokeConsent = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await consentService.revokeConsent(id, req.user, reason);

    if (!result.success) {
      const statusCode = result.code === 'NOT_FOUND' ? 404
        : result.code === 'FORBIDDEN' ? 403
        : 400;

      return res.status(statusCode).json({
        success: false,
        error: { code: result.code, message: result.message }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Consent successfully revoked.',
      consent: result.consent
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error revoking consent.' }
    });
  }
};

/**
 * Prevent Modification of Revoked Consent (Security Requirement 4)
 */
exports.updateConsent = async (req, res) => {
  try {
    const { id } = req.params;
    let consent = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      consent = await Consent.findById(id);
    }
    if (!consent) {
      consent = await Consent.findOne({ consentId: id });
    }

    if (!consent) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Consent record not found.' }
      });
    }

    // Security check: Modification of a revoked consent is forbidden
    if (consent.status === 'REVOKED') {
      await recordAuditLog({
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: {
          consentId: consent.consentId,
          reason: 'Attempted to modify a revoked consent'
        }
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'CONSENT_ALREADY_REVOKED',
          message: 'Cannot modify a revoked consent record. A new consent must be granted.'
        }
      });
    }

    // Check ownership
    if (req.user.role === 'patient') {
      const userPid = (req.user.username || '').toLowerCase();
      const targetPid = (consent.patientId || '').toLowerCase();
      if (userPid !== targetPid) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN_ACCESS', message: 'Unauthorized to modify another patient consent.' }
        });
      }
    }

    const { permittedCategories, durationDays, expiresAt } = req.body;
    if (permittedCategories) consent.permittedCategories = permittedCategories;
    if (expiresAt) consent.expiresAt = new Date(expiresAt);
    else if (durationDays) consent.expiresAt = new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000);

    consent.version = (consent.version || 1) + 1;
    await consent.save();

    return res.status(200).json({
      success: true,
      message: 'Consent updated successfully.',
      consent
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error updating consent.' }
    });
  }
};
