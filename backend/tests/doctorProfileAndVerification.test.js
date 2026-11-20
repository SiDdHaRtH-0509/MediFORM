const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const DoctorCredentialVerification = require('../models/DoctorCredentialVerification');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');

jest.setTimeout(60000);

let mongoServer;
let doctorTokenA;
let doctorUserA;
let doctorTokenB;
let doctorUserB;
let verifierToken;
let verifierUser;
let patientToken;
let patientUser;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // 1. Doctor A: Dr. Alice Carter (Practicing Doctor)
  const docRegA = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.alice@metropolitan.health',
      name: 'Dr. Alice Carter',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital'
    });
  const docVerifyA = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegA.body.challengeId, otp: docRegA.body.devOtp });
  doctorTokenA = docVerifyA.body.token;
  doctorUserA = docVerifyA.body.user;

  // 2. Doctor B: Dr. Bob Vance (Second Doctor)
  const docRegB = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.bob@stjude.org',
      name: 'Dr. Bob Vance',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude General Hospital'
    });
  const docVerifyB = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegB.body.challengeId, otp: docRegB.body.devOtp });
  doctorTokenB = docVerifyB.body.token;
  doctorUserB = docVerifyB.body.user;

  // 3. Verifier: Dr. Victor Stone (Authorized Institutional Verifier)
  const verifierReg = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'verifier.victor@medicalboard.org',
      name: 'Dr. Victor Stone (Chief Verifier)',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'National Medical Credentialing Board'
    });
  const verifierVerify = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: verifierReg.body.challengeId, otp: verifierReg.body.devOtp });
  verifierToken = verifierVerify.body.token;
  verifierUser = verifierVerify.body.user;

  // Grant Institutional Verifier privilege
  await User.findByIdAndUpdate(verifierUser.id, {
    isInstitutionalVerifier: true,
    verificationStatus: 'VERIFIED'
  });

  // 4. Patient: John Doe
  const patReg = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'patient.john@example.com',
      username: 'PAT-2026-9901',
      name: 'John Doe',
      password: 'password123',
      role: 'patient',
      hospitalName: 'Metropolitan Trauma Hospital'
    });
  const patVerify = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: patReg.body.challengeId, otp: patReg.body.devOtp });
  patientToken = patVerify.body.token;
  patientUser = patVerify.body.user;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Phase 9: Doctor Profile, Credentials & Account Verification Tests', () => {

  // =========================================================================
  // SUBSECTION 1: DOCTOR PROFILE
  // =========================================================================

  test('1. Doctor can retrieve their own profile', async () => {
    const res = await request(app)
      .get('/api/doctors/profile')
      .set('Authorization', `Bearer ${doctorTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.profile).toBeDefined();
    expect(res.body.profile.email).toBe('dr.alice@metropolitan.health');
    expect(res.body.profile.name).toBe('Dr. Alice Carter');
    expect(res.body.profile.verificationStatus).toBe('UNVERIFIED');
    expect(res.body.profile.yearsOfExperience).toBe(0);
  });

  test('2. Doctor can update permitted fields (bio, phone, experience, designation)', async () => {
    const res = await request(app)
      .patch('/api/doctors/profile')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        phone: '+1-555-019-2834',
        bio: 'Senior Emergency Physician specializing in acute resuscitation and trauma stabilization.',
        yearsOfExperience: 12,
        professionalDesignation: 'Attending Emergency Physician',
        department: 'Trauma & Critical Care',
        specialization: 'Emergency Medicine'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.profile.phone).toBe('+1-555-019-2834');
    expect(res.body.profile.bio).toContain('Senior Emergency Physician');
    expect(res.body.profile.yearsOfExperience).toBe(12);
    expect(res.body.profile.professionalDesignation).toBe('Attending Emergency Physician');

    // Verify DB update
    const userInDb = await User.findById(doctorUserA.id);
    expect(userInDb.phone).toBe('+1-555-019-2834');
    expect(userInDb.yearsOfExperience).toBe(12);
    expect(userInDb.lastProfileUpdate).toBeDefined();
  });

  test('3. Doctor cannot update another doctor profile (strict identity ownership)', async () => {
    // Attempting to send someone else's ID or modifying profile modifies only authenticated user
    const res = await request(app)
      .patch('/api/doctors/profile')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        userId: doctorUserB.id,
        _id: doctorUserB.id,
        bio: 'Malicious overwrite attempt'
      });

    expect(res.status).toBe(200);
    // Doctor B profile in DB must remain unaffected
    const docB = await User.findById(doctorUserB.id);
    expect(docB.bio).not.toBe('Malicious overwrite attempt');
  });

  test('4. Doctor cannot change their role through profile editing', async () => {
    const res = await request(app)
      .patch('/api/doctors/profile')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        role: 'admin',
        isInstitutionalVerifier: true
      });

    expect(res.status).toBe(200);
    const userInDb = await User.findById(doctorUserA.id);
    expect(userInDb.role).toBe('doctor');
    expect(userInDb.isInstitutionalVerifier).toBe(false);
  });

  test('5. Doctor cannot manually manipulate verification status directly', async () => {
    const res = await request(app)
      .patch('/api/doctors/profile')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        verificationStatus: 'VERIFIED',
        isVerified: true
      });

    expect(res.status).toBe(200);
    const userInDb = await User.findById(doctorUserA.id);
    expect(userInDb.verificationStatus).toBe('UNVERIFIED');
  });

  // =========================================================================
  // SUBSECTION 2: CREDENTIAL SUBMISSION & SECURITY
  // =========================================================================

  test('6. Doctor can submit professional credentials with valid document', async () => {
    const sampleCertificateBase64 = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test certificate binary').toString('base64');

    const res = await request(app)
      .post('/api/doctors/credentials/submit')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        medicalRegistrationNumber: 'MED-REG-2026-88192',
        registrationAuthority: 'National Medical Commission',
        registrationJurisdiction: 'New York State Board of Medicine',
        professionalDesignation: 'Attending Emergency Physician',
        hospitalAffiliation: 'Metropolitan Trauma Hospital',
        documents: [
          {
            fileName: 'medical_registration_certificate.pdf',
            fileType: 'application/pdf',
            fileSize: 1024,
            fileData: sampleCertificateBase64,
            documentType: 'REGISTRATION_CERTIFICATE'
          }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verification).toBeDefined();
    expect(res.body.verification.status).toBe('PENDING');
    expect(res.body.verification.medicalRegistrationNumber).toBe('MED-REG-2026-88192');
    expect(res.body.verification.documents.length).toBe(1);

    // Verify User model updated to PENDING
    const userInDb = await User.findById(doctorUserA.id);
    expect(userInDb.verificationStatus).toBe('PENDING');

    // Verify submission audit log was created
    const audit = await AuditLog.findOne({
      action: 'CREDENTIALS_SUBMITTED',
      actorId: doctorUserA.id
    });
    expect(audit).toBeDefined();
    expect(audit.details.outcome).toBe('SUCCESS');
  });

  test('7. Invalid registration details are rejected according to validation rules', async () => {
    // Missing registration number
    const res1 = await request(app)
      .post('/api/doctors/credentials/submit')
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        medicalRegistrationNumber: '  ',
        registrationAuthority: 'Medical Council',
        registrationJurisdiction: 'California',
        documents: [{ fileName: 'doc.pdf', fileType: 'application/pdf', fileData: 'data:pdf' }]
      });
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe('INVALID_REGISTRATION_NUMBER');

    // Missing documents
    const res2 = await request(app)
      .post('/api/doctors/credentials/submit')
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        medicalRegistrationNumber: 'MED-12345',
        registrationAuthority: 'Medical Council',
        registrationJurisdiction: 'California',
        documents: []
      });
    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('DOCUMENTS_REQUIRED');

    // Unsupported document file type
    const res3 = await request(app)
      .post('/api/doctors/credentials/submit')
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        medicalRegistrationNumber: 'MED-12345',
        registrationAuthority: 'Medical Council',
        registrationJurisdiction: 'California',
        documents: [{ fileName: 'bad.exe', fileType: 'application/x-msdownload', fileData: 'malware' }]
      });
    expect(res3.status).toBe(400);
    expect(res3.body.error.code).toBe('UNSUPPORTED_DOCUMENT_TYPE');
  });

  test('8. Unauthorized document access is strictly blocked (privacy & access control)', async () => {
    // Fetch Alice's verification to get documentId
    const verif = await DoctorCredentialVerification.findOne({ doctorId: doctorUserA.id });
    expect(verif).toBeDefined();
    const docId = verif.documents[0].documentId;

    // Doctor B tries to access Doctor A's credential document
    const resUnauthorized = await request(app)
      .get(`/api/verifications/document/${docId}`)
      .set('Authorization', `Bearer ${doctorTokenB}`);

    expect(resUnauthorized.status).toBe(403);
    expect(resUnauthorized.body.error.code).toBe('FORBIDDEN_DOCUMENT_ACCESS');

    // Patient tries to access credential document
    const resPatUnauthorized = await request(app)
      .get(`/api/verifications/document/${docId}`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(resPatUnauthorized.status).toBe(403);

    // Authorized Verifier CAN access document
    const resVerifier = await request(app)
      .get(`/api/verifications/document/${docId}`)
      .set('Authorization', `Bearer ${verifierToken}`);

    expect(resVerifier.status).toBe(200);

    // Document owner (Doctor A) CAN access own document
    const resOwner = await request(app)
      .get(`/api/doctors/credentials/document/${docId}`)
      .set('Authorization', `Bearer ${doctorTokenA}`);

    expect(resOwner.status).toBe(200);
  });

  // =========================================================================
  // SUBSECTION 3: VERIFICATION AUTHORITY WORKFLOW
  // =========================================================================

  test('10. Authorized verifier can review pending submissions', async () => {
    const res = await request(app)
      .get('/api/verifications/pending?status=PENDING')
      .set('Authorization', `Bearer ${verifierToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);

    const targetVerif = res.body.verifications.find(v => v.doctorId.toString() === doctorUserA.id.toString());
    expect(targetVerif).toBeDefined();
    expect(targetVerif.medicalRegistrationNumber).toBe('MED-REG-2026-88192');
    expect(targetVerif.status).toBe('PENDING');
  });

  test('11. Ordinary doctor cannot review or approve verification', async () => {
    const verif = await DoctorCredentialVerification.findOne({ doctorId: doctorUserA.id });

    const res = await request(app)
      .post(`/api/verifications/${verif._id}/review`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        decision: 'VERIFIED',
        notes: 'Attempted approval by peer doctor'
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_VERIFIER_ROLE');
  });

  test('12. Doctor CANNOT approve their own verification (Strict self-verification prohibition)', async () => {
    // If Verifier Victor tries to submit own credentials and verify himself
    const sampleCert = 'data:application/pdf;base64,' + Buffer.from('%PDF victor').toString('base64');
    await request(app)
      .post('/api/doctors/credentials/submit')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        medicalRegistrationNumber: 'MED-VICTOR-001',
        registrationAuthority: 'Board of Examiners',
        registrationJurisdiction: 'California',
        documents: [{ fileName: 'victor.pdf', fileType: 'application/pdf', fileSize: 500, fileData: sampleCert }]
      });

    const victorVerif = await DoctorCredentialVerification.findOne({ doctorId: verifierUser.id });
    expect(victorVerif).toBeDefined();

    // Victor attempts to approve his own verification record
    const resSelfReview = await request(app)
      .post(`/api/verifications/${victorVerif._id}/review`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        decision: 'VERIFIED',
        notes: 'Self-approval attempt'
      });

    expect(resSelfReview.status).toBe(403);
    expect(resSelfReview.body.error.code).toBe('SELF_VERIFICATION_PROHIBITED');

    // Self verification audit attempt recorded
    const auditSelf = await AuditLog.findOne({
      action: 'UNAUTHORIZED_VERIFICATION_ATTEMPT',
      actorId: verifierUser.id
    });
    expect(auditSelf).toBeDefined();
  });

  test('13. Approval updates the verification status and doctor profile', async () => {
    const verif = await DoctorCredentialVerification.findOne({ doctorId: doctorUserA.id });

    const res = await request(app)
      .post(`/api/verifications/${verif._id}/review`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        decision: 'VERIFIED',
        notes: 'Medical board registration and active standing verified successfully.'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verification.status).toBe('VERIFIED');

    // Verify Doctor A's User record is now VERIFIED
    const docA = await User.findById(doctorUserA.id);
    expect(docA.verificationStatus).toBe('VERIFIED');
    expect(docA.medicalRegistrationNumber).toBe('MED-REG-2026-88192');

    // Check AuditLog
    const audit = await AuditLog.findOne({
      action: 'VERIFICATION_APPROVED',
      actorId: verifierUser.id
    });
    expect(audit).toBeDefined();
    expect(audit.details.outcome).toBe('SUCCESS');
  });

  test('14. Rejection requires a mandatory reason', async () => {
    // Setup Doctor B with submission
    const sampleCert = 'data:application/pdf;base64,' + Buffer.from('%PDF bob').toString('base64');
    await request(app)
      .post('/api/doctors/credentials/submit')
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        medicalRegistrationNumber: 'MED-BOB-9988',
        registrationAuthority: 'State Board',
        registrationJurisdiction: 'Texas',
        documents: [{ fileName: 'bob.pdf', fileType: 'application/pdf', fileSize: 500, fileData: sampleCert }]
      });

    const bobVerif = await DoctorCredentialVerification.findOne({ doctorId: doctorUserB.id });

    // Missing notes on rejection
    const resNoNotes = await request(app)
      .post(`/api/verifications/${bobVerif._id}/review`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        decision: 'REJECTED',
        notes: ''
      });

    expect(resNoNotes.status).toBe(400);
    expect(resNoNotes.body.error.code).toBe('MISSING_REVIEW_NOTES');

    // Valid rejection with notes
    const resRejected = await request(app)
      .post(`/api/verifications/${bobVerif._id}/review`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        decision: 'REJECTED',
        notes: 'License expired in 2024 and cannot be verified with the state medical board.'
      });

    expect(resRejected.status).toBe(200);
    expect(resRejected.body.verification.status).toBe('REJECTED');

    const docB = await User.findById(doctorUserB.id);
    expect(docB.verificationStatus).toBe('REJECTED');
  });

  test('15. Resubmission works correctly when additional information requested or after rejection', async () => {
    // Doctor B resubmits updated credentials
    const sampleCertV2 = 'data:application/pdf;base64,' + Buffer.from('%PDF bob renewed 2026').toString('base64');
    const resResubmit = await request(app)
      .post('/api/doctors/credentials/submit')
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        medicalRegistrationNumber: 'MED-BOB-9988-RENEWED',
        registrationAuthority: 'Texas State Medical Board',
        registrationJurisdiction: 'Texas',
        documents: [{ fileName: 'bob_renewed_license.pdf', fileType: 'application/pdf', fileSize: 800, fileData: sampleCertV2 }]
      });

    expect(resResubmit.status).toBe(200);
    expect(resResubmit.body.verification.status).toBe('PENDING');

    const docB = await User.findById(doctorUserB.id);
    expect(docB.verificationStatus).toBe('PENDING');
  });

  test('16. Verification history is preserved across resubmissions and reviews', async () => {
    const bobVerif = await DoctorCredentialVerification.findOne({ doctorId: doctorUserB.id });
    expect(bobVerif.resubmissionHistory).toBeDefined();
    expect(bobVerif.resubmissionHistory.length).toBeGreaterThanOrEqual(1);

    const prevEntry = bobVerif.resubmissionHistory[0];
    expect(prevEntry.decision).toBe('REJECTED');
    expect(prevEntry.decisionNotes).toContain('License expired');
    expect(prevEntry.medicalRegistrationNumber).toBe('MED-BOB-9988');
  });

  test('9. Credential changes trigger appropriate re-verification (Phase 7 Re-Verification Rules)', async () => {
    // Doctor A is currently VERIFIED
    let docA = await User.findById(doctorUserA.id);
    expect(docA.verificationStatus).toBe('VERIFIED');

    // Doctor A updates bio and phone (non-material) -> Should NOT trigger re-verification
    const resNonMaterial = await request(app)
      .patch('/api/doctors/profile')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        bio: 'Updated bio with new research publications.'
      });

    expect(resNonMaterial.status).toBe(200);
    expect(resNonMaterial.body.reverificationTriggered).toBe(false);
    docA = await User.findById(doctorUserA.id);
    expect(docA.verificationStatus).toBe('VERIFIED');

    // Doctor A updates hospital affiliation / registration number (material credential) -> MUST trigger re-verification
    const resMaterial = await request(app)
      .patch('/api/doctors/profile')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        hospitalName: 'Mercy Heart & Vascular Institute',
        medicalRegistrationNumber: 'MED-REG-NEW-9921'
      });

    expect(resMaterial.status).toBe(200);
    expect(resMaterial.body.reverificationTriggered).toBe(true);

    // Current badge is invalidated to RESUBMISSION_REQUIRED
    docA = await User.findById(doctorUserA.id);
    expect(docA.verificationStatus).toBe('RESUBMISSION_REQUIRED');

    // Re-verification audit log recorded
    const auditReverif = await AuditLog.findOne({
      action: 'CREDENTIALS_REVERIFICATION_TRIGGERED',
      actorId: doctorUserA.id
    });
    expect(auditReverif).toBeDefined();

    // Doctor A re-submits credentials and Verifier approves
    const sampleCert = 'data:application/pdf;base64,' + Buffer.from('%PDF renewed').toString('base64');
    await request(app)
      .post('/api/doctors/credentials/submit')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        medicalRegistrationNumber: 'MED-REG-NEW-9921',
        registrationAuthority: 'National Medical Commission',
        registrationJurisdiction: 'New York State Board of Medicine',
        documents: [{ fileName: 'new_cert.pdf', fileType: 'application/pdf', fileSize: 500, fileData: sampleCert }]
      });

    const verifA = await DoctorCredentialVerification.findOne({ doctorId: doctorUserA.id });
    await request(app)
      .post(`/api/verifications/${verifA._id}/review`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        decision: 'VERIFIED',
        notes: 'Transfer of hospital and new registration number verified.'
      });

    docA = await User.findById(doctorUserA.id);
    expect(docA.verificationStatus).toBe('VERIFIED');
  });

  // =========================================================================
  // SUBSECTION 4: DIRECTORY, ASSIGNMENT & INTEGRATION
  // =========================================================================

  test('17. Verified status appears correctly in the doctor directory without leaking documents', async () => {
    const res = await request(app)
      .get('/api/user/doctors')
      .set('Authorization', `Bearer ${doctorTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const docA = res.body.doctors.find(d => d.doctorId.toString() === doctorUserA.id.toString());
    expect(docA).toBeDefined();
    expect(docA.verificationStatus).toBe('VERIFIED');
    expect(docA.isVerified).toBe(true);

    const docB = res.body.doctors.find(d => d.doctorId.toString() === doctorUserB.id.toString());
    expect(docB).toBeDefined();
    expect(docB.verificationStatus).toBe('PENDING');
    expect(docB.isVerified).toBe(false);

    // STRICT: Documents, credentials certificates, and rejection notes MUST NOT be in public directory
    res.body.doctors.forEach(doc => {
      expect(doc.documents).toBeUndefined();
      expect(doc.fileData).toBeUndefined();
      expect(doc.reviewNotes).toBeUndefined();
    });
  });

  test('18. Referral assignment rules enforce verified status when requireVerifiedDoctor is set', async () => {
    // 1. Create a flagged screening
    const screening = await Screening.create({
      screeningId: `SCR-2026-${Date.now()}`,
      pid: 'PAT-2026-TEST-VERIF',
      patientName: 'Jane Smith',
      age: 45,
      gender: 'Female',
      hospital: 'Metropolitan Trauma Hospital',
      vitals: { hr: 135, bp: '85/55', rr: 28, temp: 39.2, spo2: 89 },
      evaluation: {
        isFlagged: true,
        riskLevel: 'HIGH',
        recommendedPriority: 'Emergency',
        primaryReason: 'Severe sepsis with hypotension and tachycardia'
      },
      patientConsent: { consentGiven: true, consentTimestamp: new Date() },
      recordedByUserId: doctorUserA.id,
      recordedByUsername: 'dr.alice@metropolitan.health'
    });

    // 2. Attempt to assign to unverified/pending Doctor B with requireVerifiedDoctor: true -> Must FAIL
    const resBlocked = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        receivingDoctorId: doctorUserB.id,
        requireVerifiedDoctor: true,
        clinicalReason: 'Requires urgent specialist intervention at receiving hospital'
      });

    expect(resBlocked.status).toBe(400);
    expect(resBlocked.body.error.code).toBe('DOCTOR_NOT_VERIFIED');

    // 3. Assigning to VERIFIED Doctor Victor with requireVerifiedDoctor: true -> Must SUCCEED
    await User.findByIdAndUpdate(verifierUser.id, { verificationStatus: 'VERIFIED' });

    const resSuccess = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        receivingDoctorId: verifierUser.id,
        requireVerifiedDoctor: true,
        clinicalReason: 'Critical transfer assigned to verified clinician'
      });

    expect(resSuccess.status).toBe(201);
    expect(resSuccess.body.success).toBe(true);
    expect(resSuccess.body.referral.receivingDoctorId.toString()).toBe(verifierUser.id.toString());
  });

  test('19. Verification notifications are generated with event idempotency', async () => {
    // Check notifications for Doctor A (should have VERIFICATION_APPROVED)
    const notifs = await Notification.find({
      recipientUserId: doctorUserA.id,
      category: 'ACCOUNT_VERIFICATION'
    });

    expect(notifs.length).toBeGreaterThanOrEqual(1);
    const approvedNotif = notifs.find(n => n.notificationType === 'VERIFICATION_APPROVED');
    expect(approvedNotif).toBeDefined();
    expect(approvedNotif.title).toContain('Professional Account Verified');
    expect(approvedNotif.message).toContain('verified');
  });

  test('20. Existing referral and authentication workflows remain fully functional', async () => {
    // Basic health check
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('OK');

    // Check auth getMe returns profile with verificationStatus
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${doctorTokenA}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.verificationStatus).toBe('VERIFIED');
    expect(meRes.body.user.role).toBe('doctor');
  });

});
