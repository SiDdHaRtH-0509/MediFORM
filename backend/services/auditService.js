const AuditLog = require('../models/AuditLog');

// Credential and token keys that must NEVER appear in audit records
const FORBIDDEN_CREDENTIAL_KEYS = ['password', 'pin', 'token', 'jwt', 'secret', 'authorization', 'hash'];

// PHI and free-text clinical data keys that must NEVER be copied into audit records
const FORBIDDEN_PHI_KEYS = [
  'clinicalnotes', 'notes', 'diagnosis', 'pd', 'secondarydiagnosis',
  'currentcondition', 'sum', 'summary', 'vitals', 'measurements',
  'arrivalnotes', 'closurenotes', 'confirmationsummary', 'outcomenotes',
  'payload', 'encryptedpayload', 'rawpayload', 'details_freetext'
];

/**
 * Event-Specific Allowlist Schemas
 * Each security and operational event only stores necessary, non-PHI metadata.
 */
const AUDIT_EVENT_SCHEMAS = {
  // Consent Events
  'CONSENT_GRANTED': ['consentId', 'patientId', 'purpose', 'authorizedHospital', 'authorizedDoctorId', 'expiresAt', 'permittedCategories', 'outcome'],
  'CONSENT_REVOKED': ['consentId', 'patientId', 'authorizedHospital', 'authorizedDoctorId', 'revocationReasonCode', 'revocationReason', 'outcome'],
  'CONSENT_EXPIRED': ['consentId', 'patientId', 'expiresAt', 'outcome'],
  'UNAUTHORIZED_ACCESS_ATTEMPT': ['patientId', 'resourceType', 'resourceId', 'denialCode', 'consentId', 'outcome'],

  // Access & Security Events
  'UNAUTHORIZED_SCREENING_ACCESS': ['screeningId', 'patientId', 'denialCode', 'outcome'],
  'UNAUTHORIZED_REFERRAL_ACCESS': ['referralId', 'patientId', 'denialCode', 'outcome'],
  'UNAUTHORIZED_TRANSFER_ACCESS': ['transferId', 'patientId', 'denialCode', 'outcome'],
  'UNAUTHORIZED_QR_ACCESS': ['uuid', 'transferId', 'denialCode', 'outcome'],
  'UNAUTHORIZED_REASSIGNMENT_ATTEMPT': ['referralId', 'targetDoctorId', 'denialCode', 'outcome'],
  'QR_ACCESS_DENIED': ['uuid', 'transferId', 'denialCode', 'outcome'],
  'QR_PIN_FAILURE': ['uuid', 'failedAttempts', 'remainingAttempts', 'outcome'],
  'QR_SHARE_REVOKED_ACCESS': ['uuid', 'outcome'],
  'QR_ACCESS_SUCCESS': ['uuid', 'transferId', 'viewType', 'outcome'],
  'QR_GENERATED': ['uuid', 'transferId', 'expiresAt', 'outcome'],
  'QR_SHARE_CREATED': ['uuid', 'transferId', 'expiresAt', 'outcome'],
  'QR_SESSION_CREATED': ['uuid', 'transferId', 'expiresAt', 'outcome'],
  'QR_SHARE_REVOKED': ['uuid', 'transferId', 'outcome'],

  // Referral Lifecycle Events
  'REFERRAL_CREATED': ['referralId', 'sourceScreeningId', 'patientId', 'priority', 'transferId', 'receivingDoctorId', 'receivingHospital', 'isDuplicateAuthorized', 'outcome'],
  'REFERRAL_ACKNOWLEDGED': ['referralId', 'previousStatus', 'newStatus', 'decision', 'outcome'],
  'REFERRAL_ACCEPTED': ['referralId', 'previousStatus', 'newStatus', 'outcome'],
  'REFERRAL_REJECTED': ['referralId', 'previousStatus', 'newStatus', 'rejectionReasonCode', 'outcome'],
  'REFERRAL_REASSIGNED': ['referralId', 'previousReceivingDoctorId', 'newReceivingDoctorId', 'reassignmentReasonCode', 'outcome'],
  'REFERRAL_CLOSED': ['referralId', 'closureReasonCode', 'outcome'],
  'REFERRAL_CANCELLED': ['referralId', 'cancellationReasonCode', 'outcome'],
  'TREATMENT_STARTED': ['referralId', 'outcome'],
  'TREATMENT_DOCUMENTED': ['referralId', 'followUpRequired', 'outcome'],
  'CARE_CONFIRMED': ['referralId', 'isConfirmed', 'outcome'],

  // Screening Events
  'SCREENING_RECORDED': ['screeningId', 'patientId', 'isFlagged', 'riskLevel', 'news2Score', 'outcome'],
  'SCREENING_FLAGGED': ['screeningId', 'patientId', 'riskLevel', 'flagReasons', 'outcome'],
  'SCREENING_REVIEWED': ['screeningId', 'patientId', 'outcome'],

  // Transfer Events
  'TRANSFER_CREATED': ['transferId', 'patientId', 'priority', 'fromHospital', 'toHospital', 'outcome'],
  'TRANSFER_UPDATED': ['transferId', 'previousVersionId', 'version', 'outcome'],
  'TRANSFER_VERSION_CREATED': ['transferId', 'previousVersionId', 'version', 'outcome'],
  'TRANSFER_ACKNOWLEDGED': ['transferId', 'status', 'arrivalCondition', 'outcome'],
  'QR_SCANNED_EVENT': ['transferId', 'patientId', 'outcome'],

  // Follow-Up Events
  'FOLLOW_UP_SCHEDULED': ['followUpId', 'referralId', 'patientId', 'dueDate', 'specialty', 'outcome'],
  'FOLLOW_UP_COMPLETED': ['followUpId', 'referralId', 'patientId', 'outcome'],
  'FOLLOW_UP_CANCELLED': ['followUpId', 'referralId', 'reasonCode', 'outcome'],
  'FOLLOW_UP_ATTENDANCE': ['followUpId', 'patientId', 'attended', 'outcome'],

  // Monitoring Events
  'MONITORING_ALERT_DISMISSED': ['alertId', 'referralId', 'dismissalReasonCode', 'outcome']
};

// Generic fallback allowlist for unexpected or ad-hoc events
const DEFAULT_ALLOWED_KEYS = [
  'resourceId', 'resourceType', 'patientId', 'pid', 'consentId',
  'referralId', 'transferId', 'screeningId', 'uuid', 'status',
  'outcome', 'denialCode', 'code', 'expiresAt', 'version'
];

/**
 * Normalizes free-text reasons into safe, non-PHI classification codes
 */
function normalizeToSafeReasonCode(text) {
  if (!text || typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // If text already looks like a code (uppercase with underscores), keep it
  if (/^[A-Z0-9_]{3,40}$/.test(trimmed)) {
    return trimmed;
  }

  // Common mapping for safe operational reason codes
  const lower = trimmed.toLowerCase();
  if (lower.includes('complete') || lower.includes('finish') || lower.includes('close')) return 'CARE_COMPLETED';
  if (lower.includes('switch') || lower.includes('transfer')) return 'PROVIDER_TRANSFER';
  if (lower.includes('privacy') || lower.includes('withdraw') || lower.includes('revoke')) return 'PATIENT_PRIVACY_CHOICE';
  if (lower.includes('duplicate')) return 'DUPLICATE_ENTRY';
  if (lower.includes('error') || lower.includes('mistake')) return 'CLERICAL_ERROR';
  if (lower.includes('reassign') || lower.includes('rotation')) return 'CLINICAL_REASSIGNMENT';
  if (lower.includes('unauthorized') || lower.includes('idor') || lower.includes('denied')) return 'ACCESS_DENIED';
  if (lower.includes('expired') || lower.includes('timeout')) return 'SESSION_EXPIRED';
  if (lower.includes('diagnos') || lower.includes('clini') || lower.includes('treatment') || lower.includes('patient') || lower.includes('medical') || lower.includes('condition')) return 'CLINICAL_DISCRETION';

  return 'CLINICAL_DISCRETION';
}

/**
 * Recursively sanitizes an object against credentials and raw clinical data
 */
function sanitizeDetails(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeDetails);

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Redact credential keys
    if (FORBIDDEN_CREDENTIAL_KEYS.some(k => lowerKey.includes(k))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Strip PHI and clinical note keys
    if (FORBIDDEN_PHI_KEYS.some(k => lowerKey.includes(k))) {
      continue;
    }

    // Sanitize reason fields into safe normalized operational codes
    if (lowerKey === 'reason' || lowerKey.includes('reason') || lowerKey === 'notes') {
      const code = normalizeToSafeReasonCode(typeof value === 'string' ? value : String(value));
      if (code) {
        sanitized[`${key}Code`] = code;
        sanitized[key] = code;
      }
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeDetails(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Enforces explicit schema allowlisting on audit event details
 */
function buildAllowlistedDetails(action, rawDetails = {}) {
  const allowedKeys = AUDIT_EVENT_SCHEMAS[action] || DEFAULT_ALLOWED_KEYS;
  const allowlistMap = new Set(allowedKeys.map(k => k.toLowerCase()));

  const sanitized = sanitizeDetails(rawDetails);
  const allowlisted = {};

  for (const [key, value] of Object.entries(sanitized)) {
    const lowerKey = key.toLowerCase();

    // Check if key is explicitly allowlisted
    if (allowlistMap.has(lowerKey)) {
      allowlisted[key] = value;
    } else if (lowerKey.includes('reason')) {
      // Map any passed reason to the event's allowlisted reason code
      const matchingAllowlistedReasonKey = allowedKeys.find(k => k.toLowerCase().includes('reason'));
      if (matchingAllowlistedReasonKey) {
        allowlisted[matchingAllowlistedReasonKey] = normalizeToSafeReasonCode(value);
      }
    } else if (lowerKey === 'pid' && allowlistMap.has('patientid')) {
      allowlisted['patientId'] = value;
    }
  }

  // Ensure outcome is always set
  if (!allowlisted.outcome) {
    allowlisted.outcome = action.includes('DENIED') || action.includes('FAILURE') || action.includes('BLOCKED')
      ? 'DENIED'
      : 'SUCCESS';
  }

  return allowlisted;
}

/**
 * Record an unalterable, privacy-safe audit event
 */
async function recordAuditLog({ action, actorId, actorRole, details }) {
  try {
    const allowlistedDetails = buildAllowlistedDetails(action, details || {});

    return await AuditLog.create({
      action,
      actorId: actorId || null,
      actorRole: actorRole || 'system',
      details: allowlistedDetails
    });
  } catch (err) {
    console.error('AuditLog creation error:', err.message);
  }
}

module.exports = {
  recordAuditLog,
  sanitizeDetails,
  buildAllowlistedDetails,
  AUDIT_EVENT_SCHEMAS
};
