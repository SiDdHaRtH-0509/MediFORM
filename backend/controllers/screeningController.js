const Screening = require('../models/Screening');
const AuditLog = require('../models/AuditLog');
const Consent = require('../models/Consent');
const User = require('../models/User');
const cdsService = require('../services/cdsService');
const consentService = require('../services/consentService');

// Helper for patient ownership / IDOR check
function isAuthorizedForPatient(user, pid) {
  if (user.role === 'doctor') return true;
  if (user.role === 'patient') {
    const userPid = (user.username || '').toLowerCase();
    const targetPid = (pid || '').toLowerCase();
    return userPid === targetPid || targetPid.includes(userPid);
  }
  return false;
}

// Generate unique, readable Screening ID: SCR-YYYY-XXXXXX
function generateScreeningId() {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  return `SCR-${year}-${randomSuffix}`;
}

/**
 * Record a new Patient Screening assessment (Doctor only)
 */
exports.createScreening = async (req, res) => {
  try {
    const {
      pid, patientName, age, gender = 'Other', bloodGroup = 'Unknown',
      contactNumber, emergencyContact, vitals = {}, investigations = [],
      allergies = [], medications = [], clinicalNotes = '',
      patientConsent = { consentGiven: true, consentTimestamp: new Date(), consentedBy: 'Patient' }
    } = req.body;

    if (!pid || !patientName || age === undefined || age === null) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'Patient ID (pid), patient name, and age are required.' }
      });
    }

    // Evaluate screening using existing MediFORM CDS classification logic
    const evaluation = cdsService.evaluateScreening({
      vitals,
      investigations,
      allergies,
      medications
    });

    let uniqueId = generateScreeningId();
    let collisionCheck = await Screening.findOne({ screeningId: uniqueId });
    while (collisionCheck) {
      uniqueId = generateScreeningId();
      collisionCheck = await Screening.findOne({ screeningId: uniqueId });
    }

    const hospitalName = req.user.hospitalName || (req.currentUser && req.currentUser.hospitalName) || 'General Hospital';

    const screening = new Screening({
      screeningId: uniqueId,
      pid: pid.trim(),
      patientName: patientName.trim(),
      age: Number(age),
      gender,
      bloodGroup: bloodGroup.trim(),
      contactNumber,
      emergencyContact,
      vitals,
      investigations,
      allergies,
      medications,
      clinicalNotes,
      evaluation: {
        isFlagged: evaluation.isFlagged,
        riskLevel: evaluation.riskLevel,
        news2Score: evaluation.news2Score,
        flagReasons: evaluation.flagReasons,
        recommendedPriority: evaluation.recommendedPriority,
        summary: evaluation.summary
      },
      patientConsent: {
        consentGiven: patientConsent.consentGiven !== false,
        consentTimestamp: patientConsent.consentTimestamp || new Date(),
        consentedBy: patientConsent.consentedBy || 'Patient'
      },
      recordedByUserId: req.user.userId,
      recordedByUsername: req.user.username,
      hospital: hospitalName,
      screeningDateTime: new Date()
    });

    await screening.save();

    // Audit Trail
    await AuditLog.create({
      action: 'SCREENING_RECORDED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        screeningId: screening.screeningId,
        pid: screening.pid,
        isFlagged: screening.evaluation.isFlagged,
        riskLevel: screening.evaluation.riskLevel,
        news2Score: screening.evaluation.news2Score
      }
    });

    if (screening.evaluation.isFlagged) {
      await AuditLog.create({
        action: 'SCREENING_FLAGGED',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: {
          screeningId: screening.screeningId,
          pid: screening.pid,
          riskLevel: screening.evaluation.riskLevel,
          flagReasons: screening.evaluation.flagReasons
        }
      });
    }

    // Initialize explicit Consent record for clinical review if patient consented
    if (screening.patientConsent && screening.patientConsent.consentGiven !== false) {
      try {
        let patientUserObj = await User.findOne({
          $or: [
            { username: pid.trim().toLowerCase() },
            { email: pid.trim().toLowerCase() }
          ]
        });
        if (!patientUserObj) {
          try {
            patientUserObj = await User.create({
              username: pid.trim(),
              email: `${pid.trim().toLowerCase()}@mediform.internal`,
              name: patientName.trim(),
              role: 'patient',
              isEmailVerified: true
            });
          } catch (uErr) {
            patientUserObj = await User.findOne({ username: pid.trim() });
          }
        }
        if (patientUserObj) {
          const existingConsent = await Consent.findOne({
            patientUserId: patientUserObj._id,
            authorizedHospital: new RegExp(`^${hospitalName}$`, 'i'),
            status: 'GRANTED',
            expiresAt: { $gt: new Date() }
          });
          if (!existingConsent) {
            await consentService.createConsentRecord({
              patientUserId: patientUserObj._id,
              patientId: pid.trim(),
              patientName: patientName.trim(),
              purpose: 'CLINICAL_REVIEW',
              authorizedDoctorId: req.user.userId,
              authorizedDoctorName: req.user.name || req.user.username,
              authorizedHospital: hospitalName,
              durationDays: 30,
              metadata: { sourceScreeningId: screening.screeningId },
              actorId: req.user.userId,
              actorRole: 'doctor'
            });
          }
        }
      } catch (consentErr) {
        // Log but do not block screening creation
      }
    }

    return res.status(201).json({
      success: true,
      screening,
      message: screening.evaluation.isFlagged
        ? 'Screening recorded. Physiological or diagnostic flags detected.'
        : 'Screening recorded. Results within normal parameters.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error recording screening.' }
    });
  }
};

/**
 * List Screenings with filters (Auth required, IDOR protected)
 */
exports.getAllScreenings = async (req, res) => {
  try {
    const { flagged, pid, limit = 50 } = req.query;
    const query = {};

    // IDOR protection: Patients can only retrieve their own screenings
    if (req.user.role === 'patient') {
      const patientPid = req.user.username;
      query.pid = new RegExp(`^${patientPid}$`, 'i');
    } else if (pid) {
      if (req.user.role === 'doctor') {
        const consentCheck = await consentService.verifyAccessConsent({
          patientId: pid.trim(),
          requestingUser: req.user,
          hospital: req.user.hospitalName,
          purpose: 'CLINICAL_REVIEW',
          category: 'SCREENING_RESULTS'
        });
        if (!consentCheck.authorized) {
          await AuditLog.create({
            action: 'UNAUTHORIZED_SCREENING_ACCESS',
            actorId: req.user.userId,
            actorRole: req.user.role,
            details: { pid: pid.trim(), reason: consentCheck.reason }
          });
          return res.status(403).json({
            success: false,
            error: { code: consentCheck.code || 'FORBIDDEN_RECORD_ACCESS', message: consentCheck.reason }
          });
        }
      }
      query.pid = new RegExp(`^${pid.trim()}$`, 'i');
    }

    if (flagged === 'true') {
      query['evaluation.isFlagged'] = true;
    } else if (flagged === 'false') {
      query['evaluation.isFlagged'] = false;
    }

    const screenings = await Screening.find(query)
      .populate('activeReferralId')
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    return res.status(200).json({
      success: true,
      screenings,
      count: screenings.length
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving screenings.' }
    });
  }
};

/**
 * Get Flagged Screenings requiring clinical review
 */
exports.getFlaggedScreenings = async (req, res) => {
  try {
    const query = { 'evaluation.isFlagged': true };

    if (req.user.role === 'patient') {
      query.pid = new RegExp(`^${req.user.username}$`, 'i');
    }

    const flaggedScreenings = await Screening.find(query)
      .populate('activeReferralId')
      .sort({ createdAt: -1 })
      .limit(50);

    return res.status(200).json({
      success: true,
      screenings: flaggedScreenings,
      count: flaggedScreenings.length
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving flagged screenings.' }
    });
  }
};

/**
 * Get Screening by ID (screeningId or Mongo _id)
 */
exports.getScreeningById = async (req, res) => {
  try {
    const { id } = req.params;

    let screening = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      screening = await Screening.findById(id).populate('activeReferralId').populate('referralHistory');
    }
    if (!screening) {
      screening = await Screening.findOne({ screeningId: id }).populate('activeReferralId').populate('referralHistory');
    }

    if (!screening) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Screening record not found.' }
      });
    }

    // IDOR check
    if (!isAuthorizedForPatient(req.user, screening.pid)) {
      await AuditLog.create({
        action: 'UNAUTHORIZED_SCREENING_ACCESS',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { screeningId: screening.screeningId, pid: screening.pid, reason: 'Patient IDOR access violation' }
      });
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_RECORD_ACCESS', message: 'Unauthorized to view this screening record.' }
      });
    }

    // Doctor consent & relationship verification (Phase 7 Access Control Hardening)
    if (req.user.role === 'doctor') {
      const consentCheck = await consentService.verifyAccessConsent({
        patientId: screening.pid,
        requestingUser: req.user,
        hospital: req.user.hospitalName,
        authorUserId: screening.recordedByUserId,
        purpose: 'CLINICAL_REVIEW',
        category: 'SCREENING_RESULTS'
      });

      if (!consentCheck.authorized) {
        await AuditLog.create({
          action: 'UNAUTHORIZED_SCREENING_ACCESS',
          actorId: req.user.userId,
          actorRole: req.user.role,
          details: { screeningId: screening.screeningId, pid: screening.pid, reason: consentCheck.reason }
        });
        return res.status(403).json({
          success: false,
          error: { code: consentCheck.code || 'FORBIDDEN_RECORD_ACCESS', message: consentCheck.reason }
        });
      }

      await AuditLog.create({
        action: 'SCREENING_REVIEWED',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { screeningId: screening.screeningId, pid: screening.pid }
      });
    }

    return res.status(200).json({
      success: true,
      screening
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving screening record.' }
    });
  }
};
