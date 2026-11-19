const Consent = require('../models/Consent');
const QRSession = require('../models/QRSession');
const Transfer = require('../models/Transfer');
const Referral = require('../models/Referral');
const { recordAuditLog } = require('./auditService');

function generateConsentId() {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  return `CST-${year}-${randomSuffix}`;
}

// Purpose-specific minimal defaults for least-privilege enforcement
const MINIMAL_PURPOSE_CATEGORIES = {
  'SPECIALIST_REFERRAL': ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS'],
  'EMERGENCY_TRANSFER': ['DEMOGRAPHICS', 'VITALS', 'MEDICATIONS', 'REFERRAL_DETAILS'],
  'CLINICAL_REVIEW': ['DEMOGRAPHICS', 'VITALS', 'SCREENING_RESULTS'],
  'GENERAL_CARE': ['DEMOGRAPHICS'],
  'SECOND_OPINION': ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'INVESTIGATIONS', 'REFERRAL_DETAILS']
};

/**
 * Create a new Patient Consent Record
 */
async function createConsentRecord({
  patientUserId,
  patientId,
  patientName = '',
  purpose = 'SPECIALIST_REFERRAL',
  authorizedDoctorId = null,
  authorizedDoctorName = '',
  authorizedHospital,
  permittedCategories,
  expiresAt,
  durationDays = 30,
  metadata = {},
  actorId = null,
  actorRole = 'patient'
}) {
  if (!patientUserId || !patientId || !authorizedHospital) {
    throw new Error('patientUserId, patientId, and authorizedHospital are required to create a consent record.');
  }

  let finalExpiresAt = expiresAt ? new Date(expiresAt) : null;
  if (!finalExpiresAt || isNaN(finalExpiresAt.getTime())) {
    const days = Number(durationDays) || 30;
    finalExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  let uniqueId = generateConsentId();
  let collision = await Consent.findOne({ consentId: uniqueId });
  while (collision) {
    uniqueId = generateConsentId();
    collision = await Consent.findOne({ consentId: uniqueId });
  }

  // Least-privilege defaults: if patient specified categories, use them;
  // otherwise apply minimal categories tailored to the purpose rather than silently granting all
  const finalCategories = permittedCategories && permittedCategories.length > 0
    ? permittedCategories
    : (MINIMAL_PURPOSE_CATEGORIES[purpose] || ['DEMOGRAPHICS', 'REFERRAL_DETAILS']);

  const consent = new Consent({
    consentId: uniqueId,
    patientUserId,
    patientId: patientId.trim(),
    patientName: patientName ? patientName.trim() : '',
    purpose,
    authorizedDoctorId: authorizedDoctorId || null,
    authorizedDoctorName: authorizedDoctorName ? authorizedDoctorName.trim() : '',
    authorizedHospital: authorizedHospital.trim(),
    permittedCategories: finalCategories,
    status: 'GRANTED',
    grantedAt: new Date(),
    expiresAt: finalExpiresAt,
    metadata
  });

  await consent.save();

  await recordAuditLog({
    action: 'CONSENT_GRANTED',
    actorId: actorId || patientUserId,
    actorRole: actorRole || 'patient',
    details: {
      consentId: consent.consentId,
      patientId: consent.patientId,
      purpose: consent.purpose,
      authorizedHospital: consent.authorizedHospital,
      authorizedDoctorId: consent.authorizedDoctorId,
      expiresAt: consent.expiresAt,
      permittedCategories: consent.permittedCategories
    }
  });

  return consent;
}

/**
 * Revoke Consent & Invalidate Linked Active Sessions
 */
async function revokeConsent(consentIdOrObjectId, requestingUser, reason) {
  let consent = null;
  if (typeof consentIdOrObjectId === 'string' && consentIdOrObjectId.match(/^[0-9a-fA-F]{24}$/)) {
    consent = await Consent.findById(consentIdOrObjectId);
  }
  if (!consent) {
    consent = await Consent.findOne({ consentId: consentIdOrObjectId });
  }

  if (!consent) {
    return {
      success: false,
      code: 'NOT_FOUND',
      message: 'Consent record not found.'
    };
  }

  // Authorization check: Patient must own this consent
  if (requestingUser.role === 'patient') {
    const userPid = (requestingUser.username || '').toLowerCase();
    const targetPid = (consent.patientId || '').toLowerCase();
    const userIdStr = (requestingUser.userId || '').toString();
    const consentUserIdStr = (consent.patientUserId || '').toString();

    if (userPid !== targetPid && userIdStr !== consentUserIdStr) {
      return {
        success: false,
        code: 'FORBIDDEN',
        message: 'You are not authorized to revoke another patient consent.'
      };
    }
  }

  // Idempotency / state check: cannot revoke already revoked consent
  if (consent.status === 'REVOKED') {
    return {
      success: false,
      code: 'ALREADY_REVOKED',
      message: 'This consent record has already been revoked.'
    };
  }

  consent.status = 'REVOKED';
  consent.revokedAt = new Date();
  consent.revocationReason = reason && reason.trim() ? reason.trim() : 'Patient revoked consent';
  consent.revokedByUserId = requestingUser.userId || null;
  consent.version = (consent.version || 1) + 1;

  await consent.save();

  // Invalidate any active QR share sessions for this patient's transfers
  try {
    const targetPid = consent.patientId;
    const transfers = await Transfer.find({ pid: targetPid });
    const transferIds = transfers.map(t => t._id);

    if (transferIds.length > 0) {
      await QRSession.updateMany(
        { transferId: { $in: transferIds }, isRevoked: false },
        { $set: { isRevoked: true, expiresAt: new Date(0) } }
      );
    }
  } catch (err) {
    console.error('Error invalidating linked QR sessions on consent revocation:', err.message);
  }

  await recordAuditLog({
    action: 'CONSENT_REVOKED',
    actorId: requestingUser.userId || null,
    actorRole: requestingUser.role || 'patient',
    details: {
      consentId: consent.consentId,
      patientId: consent.patientId,
      authorizedHospital: consent.authorizedHospital,
      authorizedDoctorId: consent.authorizedDoctorId,
      revocationReason: consent.revocationReason,
      revocationReasonCode: consent.revocationReason
    }
  });

  return {
    success: true,
    consent
  };
}

/**
 * Central Gatekeeper: Verify Access Consent
 */
async function verifyAccessConsent({
  patientId,
  patientUserId = null,
  requestingUser,
  purpose = null,
  hospital = null,
  doctorId = null,
  category = null,
  authorUserId = null,
  assignedDoctorId = null
}) {
  if (!requestingUser) {
    return { authorized: false, code: 'UNAUTHENTICATED', reason: 'Authentication required for clinical data access.' };
  }

  const targetPid = (patientId || '').toLowerCase().trim();

  // 1. Patient Self-Access
  if (requestingUser.role === 'patient') {
    const userPid = (requestingUser.username || '').toLowerCase().trim();
    const userIdStr = (requestingUser.userId || '').toString();
    const patientUserIdStr = patientUserId ? patientUserId.toString() : '';

    if (userPid === targetPid || (patientUserIdStr && userIdStr === patientUserIdStr)) {
      return { authorized: true, reason: 'PATIENT_SELF_ACCESS' };
    }

    await recordAuditLog({
      action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      actorId: requestingUser.userId,
      actorRole: 'patient',
      details: {
        patientId: targetPid,
        denialCode: 'FORBIDDEN_ACCESS'
      }
    });

    return {
      authorized: false,
      code: 'FORBIDDEN_ACCESS',
      reason: 'Unauthorized access to target patient record.'
    };
  }

  // 2. Doctor Access
  if (requestingUser.role === 'doctor') {
    const userHospital = (requestingUser.hospitalName || (requestingUser.currentUser && requestingUser.currentUser.hospitalName) || hospital || '').toLowerCase().trim();
    const facilityOfRecord = (hospital || '').toLowerCase().trim();
    const userDocId = doctorId || requestingUser.userId;
    const userDocIdStr = userDocId ? userDocId.toString() : '';

    // A. Authoring Clinician Boundary Evaluation:
    // Narrowly scoped to the specific chart record the author legitimately recorded at their facility
    if (authorUserId && authorUserId.toString() === userDocIdStr) {
      // 1. Hospital / organizational boundary check
      if (userHospital && facilityOfRecord && userHospital !== facilityOfRecord) {
        await recordAuditLog({
          action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
          actorId: requestingUser.userId,
          actorRole: 'doctor',
          details: {
            patientId: targetPid,
            denialCode: 'FORBIDDEN_HOSPITAL_ACCESS'
          }
        });
        return {
          authorized: false,
          code: 'FORBIDDEN_HOSPITAL_ACCESS',
          reason: 'Access denied: Authoring clinician hospital credential does not match the facility of record.'
        };
      }

      // 2. Check if patient has explicitly revoked sharing authorization for this clinician/hospital
      if (purpose === 'SPECIALIST_REFERRAL' || purpose === 'EMERGENCY_TRANSFER') {
        const revocation = await Consent.findOne({
          patientId: new RegExp(`^${targetPid}$`, 'i'),
          status: 'REVOKED',
          $or: [
            ...(userDocId ? [{ authorizedDoctorId: userDocId }] : []),
            ...(userHospital ? [{ authorizedHospital: new RegExp(`^${userHospital}$`, 'i') }] : [])
          ]
        }).sort({ revokedAt: -1 });

        const reGrant = await Consent.findOne({
          patientId: new RegExp(`^${targetPid}$`, 'i'),
          status: 'GRANTED',
          expiresAt: { $gt: new Date() },
          $or: [
            ...(userDocId ? [{ authorizedDoctorId: userDocId }] : []),
            ...(userHospital ? [{ authorizedHospital: new RegExp(`^${userHospital}$`, 'i') }] : [])
          ]
        }).sort({ createdAt: -1 });

        if (revocation && (!reGrant || reGrant.createdAt < revocation.revokedAt)) {
          await recordAuditLog({
            action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
            actorId: requestingUser.userId,
            actorRole: 'doctor',
            details: {
              patientId: targetPid,
              denialCode: 'CONSENT_REVOKED',
              consentId: revocation.consentId
            }
          });
          return {
            authorized: false,
            code: 'CONSENT_REVOKED',
            reason: 'Patient has explicitly revoked consent for external data sharing with this clinician or hospital.'
          };
        }
      }

      // Valid authoring clinician chart record access
      return {
        authorized: true,
        reason: 'AUTHORING_CLINICIAN_RECORD_ACCESS',
        independentClinicalBasis: true
      };
    }

    // B. Build Strict Provider Matching Clauses for Recipient Restriction:
    // Case 1: Consent granted specifically to this doctor (authorizedDoctorId == userDocId)
    // Case 2: Consent is hospital-scoped (authorizedDoctorId == null AND authorizedHospital == userHospital)
    // CRITICAL: Consent granted to Doctor A never authorizes Doctor B at the same hospital!
    const doctorConsentQuery = [];
    if (userDocId) {
      doctorConsentQuery.push({ authorizedDoctorId: userDocId });
    }
    if (userHospital) {
      doctorConsentQuery.push({
        authorizedDoctorId: null,
        authorizedHospital: new RegExp(`^${userHospital}$`, 'i')
      });
    }

    if (doctorConsentQuery.length === 0) {
      return {
        authorized: false,
        code: 'NO_VALID_CONSENT',
        reason: 'Provider identification (hospital or doctor ID) is required to evaluate consent.'
      };
    }

    // Provider matching for revocation check (applies if doctor OR hospital was revoked)
    const revocationMatcher = [];
    if (userDocId) {
      revocationMatcher.push({ authorizedDoctorId: userDocId });
    }
    if (userHospital) {
      revocationMatcher.push({
        authorizedDoctorId: null,
        authorizedHospital: new RegExp(`^${userHospital}$`, 'i')
      });
    }

    // C. Explicit active REVOCATION check
    // Revocation takes precedence if newer than any active grant or if no active grant exists
    const explicitRevocation = await Consent.findOne({
      patientId: new RegExp(`^${targetPid}$`, 'i'),
      status: 'REVOKED',
      $or: revocationMatcher
    }).sort({ revokedAt: -1 });

    // D. Retrieve any active consent for this doctor/hospital (regardless of purpose)
    const anyPurposeConsent = await Consent.findOne({
      patientId: new RegExp(`^${targetPid}$`, 'i'),
      status: 'GRANTED',
      expiresAt: { $gt: new Date() },
      $or: doctorConsentQuery
    }).sort({ createdAt: -1 });

    const activeGrantTime = anyPurposeConsent && anyPurposeConsent.createdAt ? anyPurposeConsent.createdAt.getTime() : 0;
    if (explicitRevocation && explicitRevocation.revokedAt && explicitRevocation.revokedAt.getTime() > activeGrantTime) {
      await recordAuditLog({
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        actorId: requestingUser.userId,
        actorRole: 'doctor',
        details: {
          patientId: targetPid,
          denialCode: 'CONSENT_REVOKED',
          consentId: explicitRevocation.consentId
        }
      });
      return {
        authorized: false,
        code: 'CONSENT_REVOKED',
        reason: 'Patient has explicitly revoked consent for this healthcare provider or hospital.'
      };
    }

    // E. Purpose Check: if purpose was specified, match against active consent
    let activeConsent = anyPurposeConsent;
    if (purpose && anyPurposeConsent) {
      if (anyPurposeConsent.purpose !== purpose) {
        const matchingPurposeConsent = await Consent.findOne({
          patientId: new RegExp(`^${targetPid}$`, 'i'),
          status: 'GRANTED',
          purpose: purpose,
          expiresAt: { $gt: new Date() },
          $or: doctorConsentQuery
        }).sort({ createdAt: -1 });

        if (matchingPurposeConsent) {
          activeConsent = matchingPurposeConsent;
        } else {
          await recordAuditLog({
            action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
            actorId: requestingUser.userId,
            actorRole: 'doctor',
            details: {
              patientId: targetPid,
              denialCode: 'PURPOSE_MISMATCH',
              consentId: anyPurposeConsent.consentId
            }
          });
          return {
            authorized: false,
            code: 'PURPOSE_MISMATCH',
            reason: `Patient consent was granted for purpose '${anyPurposeConsent.purpose}', which does not authorize requested purpose '${purpose}'.`
          };
        }
      }
    }

    // F. Active Consent Found: Validate Category Restriction
    if (activeConsent) {
      if (category) {
        const permitted = activeConsent.permittedCategories || [];
        if (!permitted.includes(category)) {
          await recordAuditLog({
            action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
            actorId: requestingUser.userId,
            actorRole: 'doctor',
            details: {
              patientId: targetPid,
              denialCode: 'CATEGORY_NOT_PERMITTED',
              consentId: activeConsent.consentId
            }
          });
          return {
            authorized: false,
            code: 'CATEGORY_NOT_PERMITTED',
            reason: `Patient consent does not authorize disclosure of data category '${category}'. Permitted: [${permitted.join(', ')}]`
          };
        }
      }
      return {
        authorized: true,
        consent: activeConsent,
        reason: 'VALID_CONSENT_GRANTED'
      };
    }

    // G. Check if consent existed but has EXPIRED
    const expiredConsent = await Consent.findOne({
      patientId: new RegExp(`^${targetPid}$`, 'i'),
      status: { $in: ['GRANTED', 'EXPIRED'] },
      expiresAt: { $lte: new Date() },
      $or: doctorConsentQuery
    }).sort({ expiresAt: -1 });

    if (expiredConsent) {
      if (expiredConsent.status === 'GRANTED') {
        expiredConsent.status = 'EXPIRED';
        await expiredConsent.save();
        await recordAuditLog({
          action: 'CONSENT_EXPIRED',
          actorId: requestingUser.userId,
          actorRole: 'doctor',
          details: {
            consentId: expiredConsent.consentId,
            patientId: expiredConsent.patientId,
            expiresAt: expiredConsent.expiresAt
          }
        });
      }

      await recordAuditLog({
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        actorId: requestingUser.userId,
        actorRole: 'doctor',
        details: {
          patientId: targetPid,
          denialCode: 'CONSENT_EXPIRED',
          consentId: expiredConsent.consentId
        }
      });

      return {
        authorized: false,
        code: 'CONSENT_EXPIRED',
        reason: 'Patient consent for this healthcare provider or hospital has expired.'
      };
    }

    // H. Hospital isolation check: check if consent exists for a different hospital
    const otherHospitalConsent = await Consent.findOne({
      patientId: new RegExp(`^${targetPid}$`, 'i'),
      status: 'GRANTED',
      expiresAt: { $gt: new Date() }
    });

    if (otherHospitalConsent && otherHospitalConsent.authorizedHospital && userHospital &&
        otherHospitalConsent.authorizedHospital.toLowerCase() !== userHospital) {
      await recordAuditLog({
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        actorId: requestingUser.userId,
        actorRole: 'doctor',
        details: {
          patientId: targetPid,
          denialCode: 'FORBIDDEN_HOSPITAL_ACCESS',
          consentId: otherHospitalConsent.consentId
        }
      });
      return {
        authorized: false,
        code: 'FORBIDDEN_HOSPITAL_ACCESS',
        reason: `Access denied: Patient consent is scoped to '${otherHospitalConsent.authorizedHospital}', not requesting facility '${userHospital}'.`
      };
    }

    // Fallback: No valid consent found for this provider/hospital
    await recordAuditLog({
      action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      actorId: requestingUser.userId,
      actorRole: 'doctor',
      details: {
        patientId: targetPid,
        denialCode: 'NO_VALID_CONSENT'
      }
    });

    return {
      authorized: false,
      code: 'NO_VALID_CONSENT',
      reason: 'No active consent found for this patient record with the requesting healthcare provider or hospital.'
    };
  }

  return {
    authorized: false,
    code: 'FORBIDDEN_ROLE',
    reason: 'Role is not authorized for clinical record access.'
  };
}

/**
 * Get active & historical consents for patient
 */
async function getActiveConsentsForPatient(patientUserId, patientId) {
  const query = {};
  if (patientUserId) {
    query.$or = [{ patientUserId }, { patientId: new RegExp(`^${patientId}$`, 'i') }];
  } else if (patientId) {
    query.patientId = new RegExp(`^${patientId}$`, 'i');
  }

  const consents = await Consent.find(query).sort({ createdAt: -1 });

  // Check and update any expired
  const now = new Date();
  for (const c of consents) {
    if (c.status === 'GRANTED' && c.expiresAt && new Date(c.expiresAt) <= now) {
      c.status = 'EXPIRED';
      await c.save();
    }
  }

  return consents;
}

/**
 * Get consents granted to a specific doctor or hospital
 */
async function getConsentsForDoctor(doctorId, hospitalName) {
  const orConditions = [];
  if (doctorId) {
    orConditions.push({ authorizedDoctorId: doctorId });
  }
  if (hospitalName) {
    orConditions.push({
      authorizedDoctorId: null,
      authorizedHospital: new RegExp(`^${hospitalName.trim()}$`, 'i')
    });
  }

  if (orConditions.length === 0) return [];

  return await Consent.find({ $or: orConditions }).sort({ createdAt: -1 });
}

module.exports = {
  createConsentRecord,
  revokeConsent,
  verifyAccessConsent,
  getActiveConsentsForPatient,
  getConsentsForDoctor,
  generateConsentId
};
