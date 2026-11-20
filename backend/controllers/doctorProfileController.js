const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const DoctorCredentialVerification = require('../models/DoctorCredentialVerification');
const auditService = require('../services/auditService');
const notificationService = require('../services/notificationService');

/**
 * Checks if current authenticated user has verifier authority
 */
function isAuthorizedVerifier(user) {
  if (!user) return false;
  return Boolean(user.isInstitutionalVerifier || user.role === 'admin' || user.role === 'verifier');
}

/**
 * Strips heavy fileData out of document lists for lightweight API responses
 */
function sanitizeDocuments(documents = []) {
  return documents.map(doc => ({
    documentId: doc.documentId,
    documentType: doc.documentType,
    fileName: doc.fileName,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    uploadedAt: doc.uploadedAt
  }));
}

/**
 * GET /api/doctors/profile
 * Retrieves full doctor profile for the authenticated doctor
 */
exports.getDoctorProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Doctor account not found.' }
      });
    }

    // Fetch verification status & submission details
    const verification = await DoctorCredentialVerification.findOne({ doctorId: user._id });

    const profile = {
      id: user._id,
      doctorId: user._id,
      username: user.username,
      email: user.email,
      name: user.name || '',
      phone: user.phone || '',
      bio: user.bio || '',
      profilePhoto: user.profilePhoto || '',
      specialization: user.specialization || 'General Medicine',
      department: user.department || 'Emergency / Triage',
      yearsOfExperience: user.yearsOfExperience || 0,
      medicalRegistrationNumber: user.medicalRegistrationNumber || (verification ? verification.medicalRegistrationNumber : ''),
      registrationAuthority: user.registrationAuthority || (verification ? verification.registrationAuthority : ''),
      registrationJurisdiction: user.registrationJurisdiction || (verification ? verification.registrationJurisdiction : ''),
      professionalDesignation: user.professionalDesignation || '',
      hospitalName: user.hospitalName || '',
      institutionalAffiliationDetails: user.institutionalAffiliationDetails || '',
      isEmailVerified: Boolean(user.isEmailVerified),
      isPhoneVerified: Boolean(user.isPhoneVerified),
      verificationStatus: user.verificationStatus || 'UNVERIFIED',
      isInstitutionalVerifier: Boolean(user.isInstitutionalVerifier),
      createdAt: user.createdAt,
      lastProfileUpdate: user.lastProfileUpdate || user.updatedAt || user.createdAt,
      verificationDetails: verification ? {
        id: verification._id,
        status: verification.status,
        submissionTimestamp: verification.submissionTimestamp,
        reviewerName: verification.reviewerName,
        reviewTimestamp: verification.reviewTimestamp,
        reviewNotes: verification.reviewNotes,
        documents: sanitizeDocuments(verification.documents),
        resubmissionHistory: verification.resubmissionHistory || []
      } : null
    };

    return res.status(200).json({
      success: true,
      profile
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error fetching doctor profile.' }
    });
  }
};

/**
 * PATCH /api/doctors/profile
 * Allows a doctor to update their permitted profile fields.
 * If material credentials change on a VERIFIED account, triggers professional re-verification.
 */
exports.updateDoctorProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Doctor profile not found.' }
      });
    }

    const {
      name,
      phone,
      bio,
      yearsOfExperience,
      professionalDesignation,
      specialization,
      department,
      hospitalName,
      institutionalAffiliationDetails,
      medicalRegistrationNumber,
      registrationAuthority,
      registrationJurisdiction
    } = req.body;

    // Field-level validation
    if (phone !== undefined && phone !== null && phone.trim() !== '') {
      const cleanPhone = phone.trim();
      if (!/^[0-9+()-\s]{7,20}$/.test(cleanPhone)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_PHONE_FORMAT', message: 'Phone number format is invalid.' }
        });
      }
      user.phone = cleanPhone;
    }

    if (yearsOfExperience !== undefined && yearsOfExperience !== null) {
      const exp = Number(yearsOfExperience);
      if (isNaN(exp) || exp < 0 || exp > 70) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_EXPERIENCE', message: 'Years of experience must be a valid number between 0 and 70.' }
        });
      }
      user.yearsOfExperience = exp;
    }

    if (name !== undefined) user.name = String(name).trim();
    if (bio !== undefined) user.bio = String(bio).trim();
    if (professionalDesignation !== undefined) user.professionalDesignation = String(professionalDesignation).trim();
    if (specialization !== undefined) user.specialization = String(specialization).trim();
    if (department !== undefined) user.department = String(department).trim();
    if (institutionalAffiliationDetails !== undefined) user.institutionalAffiliationDetails = String(institutionalAffiliationDetails).trim();

    // Check material credential changes on a VERIFIED doctor (Phase 7 Re-Verification Rules)
    const isCurrentlyVerified = user.verificationStatus === 'VERIFIED';
    const changedMaterialFields = [];

    if (hospitalName !== undefined && hospitalName.trim() !== user.hospitalName) {
      if (isCurrentlyVerified) changedMaterialFields.push('Hospital Affiliation');
      user.hospitalName = hospitalName.trim();
    }

    if (medicalRegistrationNumber !== undefined && medicalRegistrationNumber.trim() !== user.medicalRegistrationNumber) {
      if (isCurrentlyVerified) changedMaterialFields.push('Medical Registration Number');
      user.medicalRegistrationNumber = medicalRegistrationNumber.trim();
    }

    if (registrationAuthority !== undefined && registrationAuthority.trim() !== user.registrationAuthority) {
      if (isCurrentlyVerified) changedMaterialFields.push('Registration Authority');
      user.registrationAuthority = registrationAuthority.trim();
    }

    if (registrationJurisdiction !== undefined && registrationJurisdiction.trim() !== user.registrationJurisdiction) {
      if (isCurrentlyVerified) changedMaterialFields.push('Registration Jurisdiction');
      user.registrationJurisdiction = registrationJurisdiction.trim();
    }

    let reverificationTriggered = false;
    if (isCurrentlyVerified && changedMaterialFields.length > 0) {
      // Invalidate current verified status and require review
      user.verificationStatus = 'RESUBMISSION_REQUIRED';
      reverificationTriggered = true;

      // Update existing verification record history
      const verification = await DoctorCredentialVerification.findOne({ doctorId: user._id });
      if (verification) {
        verification.resubmissionHistory.push({
          submissionTimestamp: verification.submissionTimestamp,
          medicalRegistrationNumber: verification.medicalRegistrationNumber,
          registrationAuthority: verification.registrationAuthority,
          registrationJurisdiction: verification.registrationJurisdiction,
          professionalDesignation: verification.professionalDesignation,
          hospitalAffiliation: verification.hospitalAffiliation,
          documentsSummary: sanitizeDocuments(verification.documents),
          decision: verification.status,
          decisionNotes: `Re-verification required due to changes in: ${changedMaterialFields.join(', ')}`,
          reviewerId: null,
          reviewerName: 'System / Audit Rule',
          reviewedAt: new Date()
        });

        verification.status = 'RESUBMISSION_REQUIRED';
        verification.reviewNotes = `Material credential changes detected (${changedMaterialFields.join(', ')}). Please submit updated documentation for review.`;
        await verification.save();
      }

      // Record audit log
      await auditService.recordAuditLog({
        action: 'CREDENTIALS_REVERIFICATION_TRIGGERED',
        actorId: user._id,
        actorRole: user.role,
        details: {
          doctorId: user._id,
          changedField: changedMaterialFields.join(', '),
          outcome: 'SUCCESS'
        }
      });

      // Dispatch notification to doctor
      await notificationService.notifyVerificationEvent({
        doctorId: user._id,
        eventType: 'REVERIFICATION_REQUIRED',
        changedFields: changedMaterialFields
      });
    }

    user.lastProfileUpdate = new Date();
    await user.save();

    // Standard Profile Updated Audit
    await auditService.recordAuditLog({
      action: 'PROFILE_UPDATED',
      actorId: user._id,
      actorRole: user.role,
      details: {
        doctorId: user._id,
        updatedFields: Object.keys(req.body).filter(k => k !== 'password' && k !== 'role').join(', '),
        outcome: 'SUCCESS'
      }
    });

    return res.status(200).json({
      success: true,
      message: reverificationTriggered
        ? 'Profile updated. Note: Professional re-verification is required due to material credential changes.'
        : 'Doctor profile updated successfully.',
      reverificationTriggered,
      profile: {
        id: user._id,
        doctorId: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        bio: user.bio,
        specialization: user.specialization,
        department: user.department,
        hospitalName: user.hospitalName,
        yearsOfExperience: user.yearsOfExperience,
        professionalDesignation: user.professionalDesignation,
        institutionalAffiliationDetails: user.institutionalAffiliationDetails,
        verificationStatus: user.verificationStatus,
        lastProfileUpdate: user.lastProfileUpdate
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error updating doctor profile.' }
    });
  }
};

/**
 * POST /api/doctors/profile/photo
 * Updates doctor profile photo (Base64 data URI or image URL)
 */
exports.updateProfilePhoto = async (req, res) => {
  try {
    const { profilePhoto, photoData } = req.body;
    const photo = profilePhoto || photoData;

    if (!photo || typeof photo !== 'string' || photo.trim() === '') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PHOTO', message: 'Profile photo data is required.' }
      });
    }

    // Security check on image payload size (max 2MB)
    if (photo.length > 2.5 * 1024 * 1024) {
      return res.status(413).json({
        success: false,
        error: { code: 'PHOTO_TOO_LARGE', message: 'Profile photo exceeds maximum limit of 2MB.' }
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Doctor profile not found.' }
      });
    }

    user.profilePhoto = photo;
    user.lastProfileUpdate = new Date();
    await user.save();

    await auditService.recordAuditLog({
      action: 'PROFILE_PHOTO_UPDATED',
      actorId: user._id,
      actorRole: user.role,
      details: { doctorId: user._id, outcome: 'SUCCESS' }
    });

    return res.status(200).json({
      success: true,
      message: 'Profile photo updated successfully.',
      profilePhoto: user.profilePhoto
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error updating profile photo.' }
    });
  }
};

/**
 * POST /api/doctors/credentials/submit
 * Doctor submits professional credentials and supporting documentation for verification
 */
exports.submitCredentials = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Doctor profile not found.' }
      });
    }

    const {
      medicalRegistrationNumber,
      registrationAuthority,
      registrationJurisdiction,
      professionalDesignation,
      hospitalAffiliation,
      documents
    } = req.body;

    // Strict Input Validation (Phase 4 & Phase 10)
    if (!medicalRegistrationNumber || typeof medicalRegistrationNumber !== 'string' || medicalRegistrationNumber.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REGISTRATION_NUMBER', message: 'Medical registration number must be at least 3 characters long.' }
      });
    }

    if (!registrationAuthority || typeof registrationAuthority !== 'string' || registrationAuthority.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REGISTRATION_AUTHORITY', message: 'Medical registration authority name is required.' }
      });
    }

    if (!registrationJurisdiction || typeof registrationJurisdiction !== 'string' || registrationJurisdiction.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REGISTRATION_JURISDICTION', message: 'Registration jurisdiction / state is required.' }
      });
    }

    // Document Validation
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'DOCUMENTS_REQUIRED', message: 'At least one professional credential document (e.g. registration certificate) is required.' }
      });
    }

    const validatedDocs = [];
    const allowedMimeTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    const maxDocSizeBytes = 5 * 1024 * 1024; // 5MB

    for (let i = 0; i < documents.length; i++) {
      const d = documents[i];
      if (!d.fileName || !d.fileType || !d.fileData) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_DOCUMENT_PAYLOAD', message: `Document at position ${i + 1} has missing fileName, fileType, or fileData.` }
        });
      }

      const cleanMime = d.fileType.toLowerCase().trim();
      if (!allowedMimeTypes.includes(cleanMime)) {
        return res.status(400).json({
          success: false,
          error: { code: 'UNSUPPORTED_DOCUMENT_TYPE', message: `Document "${d.fileName}" format (${d.fileType}) is not supported. Allowed formats: PDF, PNG, JPG.` }
        });
      }

      const size = d.fileSize || d.fileData.length;
      if (size > maxDocSizeBytes * 1.4) { // Accounting for base64 expansion
        return res.status(413).json({
          success: false,
          error: { code: 'DOCUMENT_TOO_LARGE', message: `Document "${d.fileName}" exceeds the 5MB size limit.` }
        });
      }

      validatedDocs.push({
        documentId: d.documentId || `DOC-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        documentType: d.documentType || 'REGISTRATION_CERTIFICATE',
        fileName: String(d.fileName).trim(),
        fileType: cleanMime,
        fileSize: size,
        fileData: d.fileData,
        uploadedAt: new Date()
      });
    }

    let verification = await DoctorCredentialVerification.findOne({ doctorId: user._id });

    if (verification) {
      // Archive previous review into resubmissionHistory if previous state was determined
      if (['REJECTED', 'RESUBMISSION_REQUIRED', 'VERIFIED'].includes(verification.status)) {
        verification.resubmissionHistory.push({
          submissionTimestamp: verification.submissionTimestamp,
          medicalRegistrationNumber: verification.medicalRegistrationNumber,
          registrationAuthority: verification.registrationAuthority,
          registrationJurisdiction: verification.registrationJurisdiction,
          professionalDesignation: verification.professionalDesignation,
          hospitalAffiliation: verification.hospitalAffiliation,
          documentsSummary: sanitizeDocuments(verification.documents),
          decision: verification.status,
          decisionNotes: verification.reviewNotes,
          reviewerId: verification.reviewerId,
          reviewerName: verification.reviewerName,
          reviewedAt: verification.reviewTimestamp
        });
      }

      verification.medicalRegistrationNumber = medicalRegistrationNumber.trim();
      verification.registrationAuthority = registrationAuthority.trim();
      verification.registrationJurisdiction = registrationJurisdiction.trim();
      if (professionalDesignation) verification.professionalDesignation = professionalDesignation.trim();
      if (hospitalAffiliation) verification.hospitalAffiliation = hospitalAffiliation.trim();
      verification.documents = validatedDocs;
      verification.status = 'PENDING';
      verification.submissionTimestamp = new Date();
      verification.reviewerId = null;
      verification.reviewerName = '';
      verification.reviewTimestamp = null;
      verification.reviewNotes = '';

      verification.auditHistory.push({
        eventType: 'CREDENTIALS_RESUBMITTED',
        timestamp: new Date(),
        actorId: user._id,
        actorName: user.name || user.username,
        actorRole: user.role,
        details: { docCount: validatedDocs.length }
      });

      await verification.save();
    } else {
      verification = new DoctorCredentialVerification({
        doctorId: user._id,
        medicalRegistrationNumber: medicalRegistrationNumber.trim(),
        registrationAuthority: registrationAuthority.trim(),
        registrationJurisdiction: registrationJurisdiction.trim(),
        professionalDesignation: professionalDesignation ? professionalDesignation.trim() : '',
        hospitalAffiliation: hospitalAffiliation ? hospitalAffiliation.trim() : (user.hospitalName || ''),
        status: 'PENDING',
        documents: validatedDocs,
        submissionTimestamp: new Date(),
        auditHistory: [{
          eventType: 'CREDENTIALS_INITIAL_SUBMISSION',
          timestamp: new Date(),
          actorId: user._id,
          actorName: user.name || user.username,
          actorRole: user.role,
          details: { docCount: validatedDocs.length }
        }]
      });
      await verification.save();
    }

    // Update user profile fields
    user.verificationStatus = 'PENDING';
    user.medicalRegistrationNumber = medicalRegistrationNumber.trim();
    user.registrationAuthority = registrationAuthority.trim();
    user.registrationJurisdiction = registrationJurisdiction.trim();
    if (professionalDesignation) user.professionalDesignation = professionalDesignation.trim();
    user.lastProfileUpdate = new Date();
    await user.save();

    // Audit Logging
    await auditService.recordAuditLog({
      action: 'CREDENTIALS_SUBMITTED',
      actorId: user._id,
      actorRole: user.role,
      details: {
        doctorId: user._id,
        verificationId: verification._id,
        submissionTimestamp: verification.submissionTimestamp,
        outcome: 'SUCCESS'
      }
    });

    // Notify doctor
    await notificationService.notifyVerificationEvent({
      doctorId: user._id,
      eventType: 'VERIFICATION_SUBMITTED',
      verificationId: verification._id
    });

    return res.status(200).json({
      success: true,
      message: 'Professional credentials submitted successfully. Your account is pending institutional verification.',
      verification: {
        id: verification._id,
        status: verification.status,
        medicalRegistrationNumber: verification.medicalRegistrationNumber,
        registrationAuthority: verification.registrationAuthority,
        registrationJurisdiction: verification.registrationJurisdiction,
        submissionTimestamp: verification.submissionTimestamp,
        documents: sanitizeDocuments(verification.documents)
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error submitting credentials.' }
    });
  }
};

/**
 * GET /api/doctors/credentials/status
 * Doctor checks their own credentials status & history
 */
exports.getCredentialsStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Doctor profile not found.' }
      });
    }

    const verification = await DoctorCredentialVerification.findOne({ doctorId: user._id });
    if (!verification) {
      return res.status(200).json({
        success: true,
        verificationStatus: user.verificationStatus || 'UNVERIFIED',
        verification: null
      });
    }

    return res.status(200).json({
      success: true,
      verificationStatus: user.verificationStatus || verification.status,
      verification: {
        id: verification._id,
        doctorId: verification.doctorId,
        status: verification.status,
        medicalRegistrationNumber: verification.medicalRegistrationNumber,
        registrationAuthority: verification.registrationAuthority,
        registrationJurisdiction: verification.registrationJurisdiction,
        professionalDesignation: verification.professionalDesignation,
        hospitalAffiliation: verification.hospitalAffiliation,
        submissionTimestamp: verification.submissionTimestamp,
        reviewerName: verification.reviewerName,
        reviewTimestamp: verification.reviewTimestamp,
        reviewNotes: verification.reviewNotes,
        documents: sanitizeDocuments(verification.documents),
        resubmissionHistory: verification.resubmissionHistory || []
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving credential status.' }
    });
  }
};

/**
 * GET /api/verifications/pending
 * Institutional verifier dashboard endpoint to list verification requests
 */
exports.getPendingVerifications = async (req, res) => {
  try {
    // Verifier Authorization Enforcement
    const currentUser = req.currentUser || await User.findById(req.user.userId);
    if (!isAuthorizedVerifier(currentUser)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_VERIFIER_ROLE', message: 'Access restricted to authorized institutional verifiers only.' }
      });
    }

    const { status, search } = req.query;
    const query = {};

    if (status && status !== 'ALL') {
      query.status = status;
    } else if (!status) {
      // Default to PENDING requests if unspecified
      query.status = 'PENDING';
    }

    const verifications = await DoctorCredentialVerification.find(query)
      .populate('doctorId', 'name username email hospitalName department specialization phone verificationStatus createdAt')
      .sort({ submissionTimestamp: -1 });

    let filtered = verifications;
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      filtered = verifications.filter(v => {
        const doc = v.doctorId || {};
        return (
          (doc.name && doc.name.toLowerCase().includes(term)) ||
          (doc.username && doc.username.toLowerCase().includes(term)) ||
          (doc.email && doc.email.toLowerCase().includes(term)) ||
          (doc.hospitalName && doc.hospitalName.toLowerCase().includes(term)) ||
          (v.medicalRegistrationNumber && v.medicalRegistrationNumber.toLowerCase().includes(term))
        );
      });
    }

    const results = filtered.map(v => {
      const doc = v.doctorId || {};
      return {
        id: v._id,
        verificationId: v._id,
        doctorId: doc._id || v.doctorId,
        doctorName: doc.name || doc.username || 'Doctor',
        doctorEmail: doc.email,
        hospital: doc.hospitalName || v.hospitalAffiliation,
        department: doc.department || 'General Medicine',
        specialization: doc.specialization,
        medicalRegistrationNumber: v.medicalRegistrationNumber,
        registrationAuthority: v.registrationAuthority,
        registrationJurisdiction: v.registrationJurisdiction,
        professionalDesignation: v.professionalDesignation,
        status: v.status,
        submissionTimestamp: v.submissionTimestamp,
        reviewerName: v.reviewerName,
        reviewTimestamp: v.reviewTimestamp,
        reviewNotes: v.reviewNotes,
        documentsCount: v.documents ? v.documents.length : 0,
        documents: sanitizeDocuments(v.documents)
      };
    });

    return res.status(200).json({
      success: true,
      count: results.length,
      verifications: results
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error listing verifications.' }
    });
  }
};

/**
 * GET /api/verifications/:id
 * Retrieve specific verification details for authorized inspection
 */
exports.getVerificationDetails = async (req, res) => {
  try {
    const { id } = req.params;
    let verification = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      verification = await DoctorCredentialVerification.findById(id).populate('doctorId', 'name username email hospitalName department specialization phone verificationStatus');
    }
    if (!verification) {
      verification = await DoctorCredentialVerification.findOne({ doctorId: id }).populate('doctorId', 'name username email hospitalName department specialization phone verificationStatus');
    }

    if (!verification) {
      return res.status(404).json({
        success: false,
        error: { code: 'VERIFICATION_NOT_FOUND', message: 'Verification record not found.' }
      });
    }

    // Access check: Owning doctor OR authorized verifier
    const currentUser = req.currentUser || await User.findById(req.user.userId);
    const isOwner = verification.doctorId && verification.doctorId._id.toString() === req.user.userId.toString();
    const isVerifier = isAuthorizedVerifier(currentUser);

    if (!isOwner && !isVerifier) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_VERIFICATION_ACCESS', message: 'You are not authorized to view this verification record.' }
      });
    }

    return res.status(200).json({
      success: true,
      verification: {
        id: verification._id,
        doctorId: verification.doctorId,
        status: verification.status,
        medicalRegistrationNumber: verification.medicalRegistrationNumber,
        registrationAuthority: verification.registrationAuthority,
        registrationJurisdiction: verification.registrationJurisdiction,
        professionalDesignation: verification.professionalDesignation,
        hospitalAffiliation: verification.hospitalAffiliation,
        submissionTimestamp: verification.submissionTimestamp,
        reviewerId: verification.reviewerId,
        reviewerName: verification.reviewerName,
        reviewTimestamp: verification.reviewTimestamp,
        reviewNotes: verification.reviewNotes,
        documents: sanitizeDocuments(verification.documents),
        resubmissionHistory: verification.resubmissionHistory || [],
        auditHistory: verification.auditHistory || []
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving verification details.' }
    });
  }
};

/**
 * POST /api/verifications/:id/review
 * Authorized verifier makes a decision: VERIFIED, REJECTED, or RESUBMISSION_REQUIRED.
 * STRICT: A doctor CANNOT review or verify their own credentials.
 */
exports.reviewVerification = async (req, res) => {
  try {
    const currentUser = req.currentUser || await User.findById(req.user.userId);
    if (!isAuthorizedVerifier(currentUser)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_VERIFIER_ROLE', message: 'Access restricted to authorized institutional verifiers only.' }
      });
    }

    const { id } = req.params;
    const { decision, notes } = req.body;

    if (!['VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED'].includes(decision)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DECISION', message: 'Decision must be VERIFIED, REJECTED, or RESUBMISSION_REQUIRED.' }
      });
    }

    if ((decision === 'REJECTED' || decision === 'RESUBMISSION_REQUIRED') && (!notes || !notes.trim())) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_REVIEW_NOTES', message: 'Mandatory explanatory reason notes are required when rejecting or requesting resubmission.' }
      });
    }

    let verification = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      verification = await DoctorCredentialVerification.findById(id);
    }
    if (!verification) {
      verification = await DoctorCredentialVerification.findOne({ doctorId: id });
    }

    if (!verification) {
      return res.status(404).json({
        success: false,
        error: { code: 'VERIFICATION_NOT_FOUND', message: 'Verification record not found.' }
      });
    }

    // STRICT ANTI-SELF-VERIFICATION RULE (Phase 5, 9, 10)
    if (verification.doctorId.toString() === req.user.userId.toString()) {
      await auditService.recordAuditLog({
        action: 'UNAUTHORIZED_VERIFICATION_ATTEMPT',
        actorId: req.user.userId,
        actorRole: currentUser.role,
        details: {
          doctorId: verification.doctorId,
          verificationId: verification._id,
          denialCode: 'SELF_VERIFICATION_PROHIBITED',
          outcome: 'DENIED'
        }
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'SELF_VERIFICATION_PROHIBITED',
          message: 'Conflict of interest: A doctor is strictly prohibited from approving, rejecting, or verifying their own credentials.'
        }
      });
    }

    const reviewerName = currentUser.name || currentUser.username || 'Institutional Verifier';
    const reviewTimestamp = new Date();

    // Update Verification Record
    verification.status = decision;
    verification.reviewerId = currentUser._id;
    verification.reviewerName = reviewerName;
    verification.reviewTimestamp = reviewTimestamp;
    verification.reviewNotes = notes ? notes.trim() : '';

    verification.auditHistory.push({
      eventType: `VERIFICATION_${decision}`,
      timestamp: reviewTimestamp,
      actorId: currentUser._id,
      actorName: reviewerName,
      actorRole: currentUser.role,
      details: { decision, notes: notes ? notes.trim() : '' }
    });

    await verification.save();

    // Synchronize to Doctor's User Profile
    const doctorUser = await User.findById(verification.doctorId);
    if (doctorUser) {
      doctorUser.verificationStatus = decision;
      if (decision === 'VERIFIED') {
        doctorUser.medicalRegistrationNumber = verification.medicalRegistrationNumber;
        doctorUser.registrationAuthority = verification.registrationAuthority;
        doctorUser.registrationJurisdiction = verification.registrationJurisdiction;
        if (verification.professionalDesignation) doctorUser.professionalDesignation = verification.professionalDesignation;
      }
      doctorUser.lastProfileUpdate = reviewTimestamp;
      await doctorUser.save();
    }

    // Record Structured Privacy-Safe Audit Log
    const auditAction = decision === 'VERIFIED'
      ? 'VERIFICATION_APPROVED'
      : decision === 'REJECTED'
        ? 'VERIFICATION_REJECTED'
        : 'VERIFICATION_RESUBMISSION_REQUESTED';

    await auditService.recordAuditLog({
      action: auditAction,
      actorId: currentUser._id,
      actorRole: currentUser.role,
      details: {
        doctorId: verification.doctorId,
        verificationId: verification._id,
        reviewerId: currentUser._id,
        rejectionReasonCode: decision === 'REJECTED' ? notes : undefined,
        resubmissionReasonCode: decision === 'RESUBMISSION_REQUIRED' ? notes : undefined,
        outcome: 'SUCCESS'
      }
    });

    // Notify Doctor of Institutional Decision
    const notifEventType = decision === 'VERIFIED'
      ? 'VERIFICATION_APPROVED'
      : decision === 'REJECTED'
        ? 'VERIFICATION_REJECTED'
        : 'VERIFICATION_RESUBMISSION_REQUIRED';

    await notificationService.notifyVerificationEvent({
      doctorId: verification.doctorId,
      eventType: notifEventType,
      reviewerName,
      notes: notes ? notes.trim() : '',
      verificationId: verification._id
    });

    return res.status(200).json({
      success: true,
      message: `Verification decision recorded: ${decision}.`,
      verification: {
        id: verification._id,
        doctorId: verification.doctorId,
        status: verification.status,
        reviewerName: verification.reviewerName,
        reviewTimestamp: verification.reviewTimestamp,
        reviewNotes: verification.reviewNotes
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error recording verification review decision.' }
    });
  }
};

/**
 * GET /api/doctors/credentials/document/:docId
 * GET /api/verifications/document/:docId
 * Securely streams/downloads uploaded credential document.
 * Accessible ONLY by the document owner or an authorized verifier.
 */
exports.getDocument = async (req, res) => {
  try {
    const { docId } = req.params;
    if (!docId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_DOC_ID', message: 'Document ID is required.' }
      });
    }

    const verification = await DoctorCredentialVerification.findOne({
      'documents.documentId': docId
    });

    if (!verification) {
      return res.status(404).json({
        success: false,
        error: { code: 'DOCUMENT_NOT_FOUND', message: 'Requested document does not exist.' }
      });
    }

    // Access Authorization Check: Owning Doctor OR Authorized Verifier
    const currentUser = req.currentUser || await User.findById(req.user.userId);
    const isOwner = verification.doctorId.toString() === req.user.userId.toString();
    const isVerifier = isAuthorizedVerifier(currentUser);

    if (!isOwner && !isVerifier) {
      await auditService.recordAuditLog({
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        actorId: req.user.userId,
        actorRole: currentUser.role,
        details: {
          resourceType: 'CREDENTIAL_DOCUMENT',
          resourceId: docId,
          denialCode: 'FORBIDDEN_DOCUMENT_ACCESS',
          outcome: 'DENIED'
        }
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_DOCUMENT_ACCESS',
          message: 'You are not authorized to access this professional credential document.'
        }
      });
    }

    const document = verification.documents.find(d => d.documentId === docId);
    if (!document || !document.fileData) {
      return res.status(404).json({
        success: false,
        error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document content is missing or corrupted.' }
      });
    }

    // Record audit event
    await auditService.recordAuditLog({
      action: 'DOCUMENT_ACCESSED',
      actorId: req.user.userId,
      actorRole: currentUser.role,
      details: {
        documentId: docId,
        doctorId: verification.doctorId,
        accessorId: req.user.userId,
        outcome: 'SUCCESS'
      }
    });

    // Check if fileData is a Base64 Data URL (e.g., data:application/pdf;base64,....)
    const matches = document.fileData.match(/^data:([A-Za-z0-9-+\/]+);base64,(.+)$/);
    if (matches) {
      const mimeType = matches[1] || document.fileType || 'application/octet-stream';
      const fileBuffer = Buffer.from(matches[2], 'base64');

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${document.fileName}"`);
      res.setHeader('Content-Length', fileBuffer.length);
      return res.status(200).send(fileBuffer);
    }

    // Otherwise return as JSON with base64 payload
    return res.status(200).json({
      success: true,
      document: {
        documentId: document.documentId,
        fileName: document.fileName,
        fileType: document.fileType,
        fileSize: document.fileSize,
        fileData: document.fileData
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error fetching document.' }
    });
  }
};
