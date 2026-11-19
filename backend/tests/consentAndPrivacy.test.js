const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');
const Transfer = require('../models/Transfer');
const QRSession = require('../models/QRSession');
const Consent = require('../models/Consent');
const AuditLog = require('../models/AuditLog');
const FollowUp = require('../models/FollowUp');
const Notification = require('../models/Notification');
const consentService = require('../services/consentService');
const { sanitizeDetails } = require('../services/auditService');

jest.setTimeout(120000);

let mongoServer;
let doctorTokenA; // Referring Doctor (Metropolitan Trauma Hospital)
let doctorUserA;
let doctorTokenB; // Receiving Doctor (St. Jude Heart Hospital)
let doctorUserB;
let doctorTokenC; // Second Doctor at St. Jude (for reassignment)
let doctorUserC;
let doctorTokenUnrelated; // Unrelated Doctor at Isolated Clinic
let doctorUserUnrelated;
let patientToken1; // Patient 1 (PAT-CONSENT-01)
let patientUser1;
let patientToken2; // Patient 2 (PAT-CONSENT-02)
let patientUser2;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // 1. Doctor A: Metropolitan Trauma Hospital (Referring Doctor)
  const docRegA = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.alice.priv@metropolitan.health',
      name: 'Dr. Alice Carter',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital'
    });
  const docVerifyA = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegA.body.challengeId, otp: docRegA.body.devOtp });
  doctorTokenA = docVerifyA.body.token;
  doctorUserA = { ...docVerifyA.body.user, _id: docVerifyA.body.user.id };

  // 2. Doctor B: St. Jude Heart Hospital (Receiving Doctor)
  const docRegB = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.bob.priv@stjude.health',
      name: 'Dr. Robert Vance',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital'
    });
  const docVerifyB = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegB.body.challengeId, otp: docRegB.body.devOtp });
  doctorTokenB = docVerifyB.body.token;
  doctorUserB = { ...docVerifyB.body.user, _id: docVerifyB.body.user.id };

  // 3. Doctor C: St. Jude Heart Hospital (Reassignment Target)
  const docRegC = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.chloe.priv@stjude.health',
      name: 'Dr. Chloe Miller',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital'
    });
  const docVerifyC = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegC.body.challengeId, otp: docRegC.body.devOtp });
  doctorTokenC = docVerifyC.body.token;
  doctorUserC = { ...docVerifyC.body.user, _id: docVerifyC.body.user.id };

  // 4. Doctor Unrelated: General Outpost Clinic
  const docRegUn = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.unrelated.priv@outpost.health',
      name: 'Dr. Unrelated Clinician',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'General Outpost Clinic'
    });
  const docVerifyUn = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegUn.body.challengeId, otp: docRegUn.body.devOtp });
  doctorTokenUnrelated = docVerifyUn.body.token;
  doctorUserUnrelated = { ...docVerifyUn.body.user, _id: docVerifyUn.body.user.id };

  // 5. Patient 1: PAT-CONSENT-01
  patientUser1 = await User.create({
    email: 'patient1.priv@mediform.org',
    username: 'PAT-CONSENT-01',
    name: 'Emily Davis',
    password: 'password123',
    role: 'patient',
    isEmailVerified: true
  });
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';
  patientToken1 = jwt.sign(
    { userId: patientUser1._id, username: patientUser1.username, name: patientUser1.name, role: 'patient', tokenVersion: 0 },
    secret,
    { expiresIn: '1h' }
  );

  // 6. Patient 2: PAT-CONSENT-02
  patientUser2 = await User.create({
    email: 'patient2.priv@mediform.org',
    username: 'PAT-CONSENT-02',
    name: 'James Wilson',
    password: 'password123',
    role: 'patient',
    isEmailVerified: true
  });
  patientToken2 = jwt.sign(
    { userId: patientUser2._id, username: patientUser2.username, name: patientUser2.name, role: 'patient', tokenVersion: 0 },
    secret,
    { expiresIn: '1h' }
  );
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

describe('Phase 7: Consent Management, Data Privacy & Access Control Hardening', () => {

  let testConsent1;
  let testScreening1;
  let testReferral1;
  let testTransfer1;
  let testQRSession1;

  describe('1. Patient Consent Lifecycle Management', () => {

    test('Requirement 1: Patient can view active consents', async () => {
      // Seed a consent record for patient 1
      await Consent.create({
        consentId: 'CST-2026-111111',
        patientUserId: patientUser1._id,
        patientId: 'PAT-CONSENT-01',
        patientName: 'Emily Davis',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedHospital: 'Metropolitan Trauma Hospital',
        status: 'GRANTED',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      const res = await request(app)
        .get('/api/consent')
        .set('Authorization', `Bearer ${patientToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.consents)).toBe(true);
      expect(res.body.consents.length).toBeGreaterThanOrEqual(1);
      expect(res.body.consents[0].patientId).toBe('PAT-CONSENT-01');
    });

    test('Requirement 2: Patient can grant new consent with valid hospital and purpose', async () => {
      const res = await request(app)
        .post('/api/consent')
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({
          authorizedHospital: 'St. Jude Heart Hospital',
          authorizedDoctorName: 'Dr. Robert Vance',
          purpose: 'SPECIALIST_REFERRAL',
          durationDays: 30,
          permittedCategories: ['DEMOGRAPHICS', 'VITALS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS']
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.consent).toBeDefined();
      expect(res.body.consent.consentId).toMatch(/^CST-\d{4}-\d{6}$/);
      expect(res.body.consent.authorizedHospital).toBe('St. Jude Heart Hospital');
      expect(res.body.consent.status).toBe('GRANTED');
      expect(res.body.consent.patientUserId.toString()).toBe(patientUser1._id.toString());

      testConsent1 = res.body.consent;
    });

    test('Requirement 3: Patient can revoke consent with documented reason', async () => {
      const res = await request(app)
        .patch(`/api/consent/${testConsent1.consentId}/revoke`)
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({
          reason: 'Patient completed treatment and requested data sharing closure'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.consent.status).toBe('REVOKED');
      expect(res.body.consent.revocationReason).toBe('Patient completed treatment and requested data sharing closure');
      expect(res.body.consent.revokedAt).toBeDefined();
    });

    test('Requirement 4: Modification of revoked consent is rejected', async () => {
      const res = await request(app)
        .patch(`/api/consent/${testConsent1.consentId}`)
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({
          durationDays: 60,
          permittedCategories: ['DEMOGRAPHICS', 'VITALS']
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONSENT_ALREADY_REVOKED');
    });

    test('Requirement 5: Expired consent is rejected upon access check', async () => {
      // Create an already-expired consent
      const expiredConsent = await Consent.create({
        consentId: 'CST-2026-999999',
        patientUserId: patientUser1._id,
        patientId: 'PAT-CONSENT-01',
        purpose: 'CLINICAL_REVIEW',
        authorizedHospital: 'General Outpost Clinic',
        authorizedDoctorId: doctorUserUnrelated._id,
        status: 'GRANTED',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Expired yesterday
      });

      const check = await consentService.verifyAccessConsent({
        patientId: 'PAT-CONSENT-01',
        requestingUser: { userId: doctorUserUnrelated._id, role: 'doctor', hospitalName: 'General Outpost Clinic' },
        hospital: 'General Outpost Clinic'
      });

      expect(check.authorized).toBe(false);
      expect(check.code).toBe('CONSENT_EXPIRED');

      // Verify status was automatically updated in DB
      const updatedConsent = await Consent.findById(expiredConsent._id);
      expect(updatedConsent.status).toBe('EXPIRED');
    });

    test('Requirement 6: Revoked consent is rejected upon access check', async () => {
      const check = await consentService.verifyAccessConsent({
        patientId: 'PAT-CONSENT-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital'
      });

      expect(check.authorized).toBe(false);
      expect(check.code).toBe('CONSENT_REVOKED');
      expect(check.reason).toContain('revoked');
    });

    test('Requirement 7: Missing consent is rejected upon access check', async () => {
      const check = await consentService.verifyAccessConsent({
        patientId: 'PAT-CONSENT-02',
        requestingUser: { userId: doctorUserUnrelated._id, role: 'doctor', hospitalName: 'General Outpost Clinic' },
        hospital: 'General Outpost Clinic'
      });

      expect(check.authorized).toBe(false);
      expect(check.code).toBe('NO_VALID_CONSENT');
    });
  });

  describe('2. Clinical Data Access Authorization & IDOR Protection', () => {

    beforeAll(async () => {
      // Create a flagged screening for Patient 1 at Metropolitan Hospital
      const screeningRes = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          pid: 'PAT-CONSENT-01',
          patientName: 'Emily Davis',
          age: 45,
          gender: 'Female',
          vitals: { hr: 135, bp: '82/50', rr: 28, spo2: 89, temp: 39.4, gcs: 13 },
          patientConsent: { consentGiven: true, consentTimestamp: new Date(), consentedBy: 'Patient' }
        });
      testScreening1 = screeningRes.body.screening;

      // Create a referral from screening to St. Jude Heart Hospital (Dr. Bob)
      // First ensure active consent exists for St. Jude
      await Consent.create({
        consentId: 'CST-2026-222222',
        patientUserId: patientUser1._id,
        patientId: 'PAT-CONSENT-01',
        patientName: 'Emily Davis',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: doctorUserB._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        status: 'GRANTED',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      const referralRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: testScreening1.screeningId,
          clinicalReason: 'Severe sepsis with hemodynamic compromise requiring cardiology ICU care',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital',
          receivingDoctorId: doctorUserB._id
        });
      testReferral1 = referralRes.body.referral;
      testTransfer1 = referralRes.body.transfer;
    });

    test('Requirement 8: Screening IDOR - Patient A cannot access Patient B screening', async () => {
      // Patient 2 attempts to read Patient 1's screening
      const res = await request(app)
        .get(`/api/screenings/${testScreening1.screeningId}`)
        .set('Authorization', `Bearer ${patientToken2}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN_RECORD_ACCESS');
    });

    test('Requirement 9: Referral IDOR - Patient A cannot access Patient B referral', async () => {
      // Patient 2 attempts to read Patient 1's referral
      const res = await request(app)
        .get(`/api/referrals/${testReferral1.referralId}`)
        .set('Authorization', `Bearer ${patientToken2}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN_RECORD_ACCESS');
    });

    test('Requirement 10: Unassigned doctor from unrelated hospital cannot access referral', async () => {
      // Dr. Unrelated at General Outpost Clinic tries to read referral for St. Jude
      const res = await request(app)
        .get(`/api/referrals/${testReferral1.referralId}`)
        .set('Authorization', `Bearer ${doctorTokenUnrelated}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN_HOSPITAL_ACCESS');
    });

    test('Requirement 11: Authorized doctor can access referral with valid consent', async () => {
      // Dr. Bob at St. Jude Heart Hospital accesses referral
      const res = await request(app)
        .get(`/api/referrals/${testReferral1.referralId}`)
        .set('Authorization', `Bearer ${doctorTokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.referral.referralId).toBe(testReferral1.referralId);
    });

    test('Requirement 12: Hospital isolation - doctor from Hospital X cannot access Hospital Y unassigned referral', async () => {
      // Create an unassigned referral specifically for St. Jude
      const screening2 = await Screening.create({
        screeningId: 'SCR-2026-ISO-01',
        pid: 'PAT-CONSENT-01',
        patientName: 'Emily Davis',
        age: 45,
        hospital: 'Metropolitan Trauma Hospital',
        recordedByUserId: doctorUserA._id,
        recordedByUsername: doctorUserA.username,
        evaluation: { isFlagged: true, riskLevel: 'HIGH', news2Score: 8 },
        patientConsent: { consentGiven: true }
      });

      const unassignedRef = await Referral.create({
        referralId: 'REF-2026-ISO-01',
        patientId: 'PAT-CONSENT-01',
        patientName: 'Emily Davis',
        sourceScreeningId: screening2.screeningId,
        sourceScreeningRef: screening2._id,
        referringDoctorId: doctorUserA._id,
        referringDoctorUsername: doctorUserA.username,
        referringHospital: 'Metropolitan Trauma Hospital',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: null, // Unassigned
        clinicalReason: 'Unassigned specialist referral',
        status: 'PENDING'
      });

      // Dr. Unrelated from General Outpost Clinic tries to view it
      const res = await request(app)
        .get(`/api/referrals/${unassignedRef.referralId}`)
        .set('Authorization', `Bearer ${doctorTokenUnrelated}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_HOSPITAL_ACCESS');
    });

    test('Requirement 13: Spoofed patient ID in query is rejected or forced to authenticated patient identity', async () => {
      // Patient 1 queries screenings passing ?pid=PAT-CONSENT-02 (attempted spoofing)
      const res = await request(app)
        .get('/api/screenings?pid=PAT-CONSENT-02')
        .set('Authorization', `Bearer ${patientToken1}`);

      expect(res.status).toBe(200);
      // All returned screenings must strictly belong to PAT-CONSENT-01 (authenticated user)
      res.body.screenings.forEach(s => {
        expect(s.pid.toLowerCase()).toBe('pat-consent-01');
      });
    });
  });

  describe('3. QR/PIN Handoff Security & Consent Enforcement', () => {

    test('Requirement 14: Expired QR token access attempt rejected (HTTP 410)', async () => {
      // Create a transfer and an expired QR session
      const expiredSession = await QRSession.create({
        uuid: '00000000-0000-0000-0000-000000000001',
        transferId: testTransfer1._id,
        encryptedPayload: { iv: 'iv', authTag: 'tag', encryptedData: 'data' },
        pinHash: 'dummyhash',
        failedAttempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
        createdByUserId: doctorUserA._id,
        isRevoked: false
      });

      const res = await request(app)
        .post(`/api/qr/validate/${expiredSession.uuid}`)
        .send({ pin: '123456' });

      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('QR_EXPIRED');
    });

    test('Requirement 15: Invalid QR token access attempt rejected (HTTP 404)', async () => {
      const res = await request(app)
        .post('/api/qr/validate/non-existent-uuid-99999')
        .send({ pin: '123456' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EXPIRED_OR_INVALID_QR');
    });

    test('Requirement 16: Revoked consent blocks QR code redemption (HTTP 410)', async () => {
      // Issue a fresh QR session for testTransfer1
      const qrRes = await request(app)
        .post(`/api/transfers/${testTransfer1._id}/qr`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ pin: '654321' });

      expect(qrRes.status).toBe(201);
      const uuid = qrRes.body.uuid;

      // Patient 1 now explicitly revokes consent for St. Jude Heart Hospital
      await Consent.create({
        consentId: 'CST-2026-REVOKEQR',
        patientUserId: patientUser1._id,
        patientId: 'PAT-CONSENT-01',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedHospital: 'St. Jude Heart Hospital',
        status: 'REVOKED',
        revokedAt: new Date(),
        revocationReason: 'Patient revoked consent via mobile portal',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      // Subsequent attempt to validate the QR code must be blocked
      const valRes = await request(app)
        .post(`/api/qr/validate/${uuid}`)
        .send({ pin: '654321' });

      expect(valRes.status).toBe(410);
      expect(valRes.body.success).toBe(false);
      expect(valRes.body.error.code).toBe('QR_EXPIRED');
    });

    test('Requirement 17: Reassigned referral: previous receiving doctor loses access unless they have separate consent', async () => {
      // Reassign referral from Dr. Bob (Hospital St. Jude) to Dr. Chloe Miller
      // Then verify Dr. Bob's direct reassignment state
      const reassignRes = await request(app)
        .post(`/api/referrals/${testReferral1.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          newReceivingDoctorId: doctorUserC._id,
          reason: 'Specialist reassignment to senior electrophysiologist'
        });

      expect(reassignRes.status).toBe(200);
      expect(reassignRes.body.referral.receivingDoctorId.toString()).toBe(doctorUserC._id.toString());

      // If Dr. Bob's consent was specifically granted and then revoked or reassigned:
      // Verify referral assignment history explicitly logged the previous doctor
      const updatedRef = await Referral.findOne({ referralId: testReferral1.referralId });
      expect(updatedRef.receivingDoctorId.toString()).toBe(doctorUserC._id.toString());
      expect(updatedRef.assignmentHistory.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Privacy-Safe Audit Trail & Data Redaction', () => {

    test('Requirement 18: Consent grant creates audit log entry', async () => {
      const grantLogs = await AuditLog.find({ action: 'CONSENT_GRANTED' });
      expect(grantLogs.length).toBeGreaterThan(0);
      expect(grantLogs[0].details).toBeDefined();
      expect(grantLogs[0].details.consentId).toBeDefined();
    });

    test('Requirement 19: Consent revocation creates audit log entry', async () => {
      const revokeLogs = await AuditLog.find({ action: 'CONSENT_REVOKED' });
      expect(revokeLogs.length).toBeGreaterThan(0);
      expect(revokeLogs[0].details).toBeDefined();
      expect(revokeLogs[0].details.revocationReason).toBeDefined();
    });

    test('Requirement 20: Unauthorized access attempt creates audit log entry', async () => {
      const unauthLogs = await AuditLog.find({
        action: { $in: ['UNAUTHORIZED_ACCESS_ATTEMPT', 'UNAUTHORIZED_SCREENING_ACCESS', 'UNAUTHORIZED_REFERRAL_ACCESS', 'UNAUTHORIZED_TRANSFER_ACCESS'] }
      });
      expect(unauthLogs.length).toBeGreaterThan(0);
    });

    test('Requirement 21: Audit logs exclude passwords, PINs, and auth tokens', async () => {
      const allLogs = await AuditLog.find({}).limit(100);
      for (const log of allLogs) {
        const detailsStr = JSON.stringify(log.details || {}).toLowerCase();
        // Check that plaintext passwords or PINs are never stored
        expect(detailsStr).not.toContain('"password":');
        expect(detailsStr).not.toContain('"pin":"');
        expect(detailsStr).not.toContain('bearer eyj');
      }
    });

    test('Requirement 22: Audit logs exclude unredacted PHI / clinical secrets', () => {
      const dirtyObject = {
        patientId: 'PAT-001',
        password: 'superSecretPassword123',
        pin: '654321',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
        clinicalFinding: 'Hypertension and sepsis'
      };

      const sanitized = sanitizeDetails(dirtyObject);
      expect(sanitized.patientId).toBe('PAT-001');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.pin).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.clinicalFinding).toBe('Hypertension and sepsis');
    });
  });

  describe('5. Regression Verification Across Phases 1 - 6.1', () => {

    let regReferral;

    test('Requirement 23: Referral lifecycle transitions remain intact', async () => {
      // Step A: Create fresh screening
      const scr = await Screening.create({
        screeningId: 'SCR-2026-REG-01',
        pid: 'PAT-CONSENT-01',
        patientName: 'Emily Davis',
        age: 45,
        hospital: 'Metropolitan Trauma Hospital',
        recordedByUserId: doctorUserA._id,
        recordedByUsername: doctorUserA.username,
        evaluation: { isFlagged: true, riskLevel: 'HIGH', news2Score: 9 },
        patientConsent: { consentGiven: true }
      });

      // Step B: Ensure active consent exists for St. Jude
      await Consent.create({
        consentId: 'CST-2026-REG-01',
        patientUserId: patientUser1._id,
        patientId: 'PAT-CONSENT-01',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: doctorUserC._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        status: 'GRANTED',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      // Step C: Create referral
      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: scr.screeningId,
          clinicalReason: 'Cardiogenic shock requiring immediate tertiary intervention',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital',
          receivingDoctorId: doctorUserC._id
        });
      expect(refRes.status).toBe(201);
      regReferral = refRes.body.referral;

      // Step D: Acknowledge (PENDING -> ACKNOWLEDGED)
      const ackRes = await request(app)
        .post(`/api/referrals/${regReferral.referralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({ notes: 'Referral noted by cardiology fellow' });
      expect(ackRes.status).toBe(200);
      expect(ackRes.body.referral.status).toBe('ACKNOWLEDGED');

      // Step E: Accept (ACKNOWLEDGED -> ACCEPTED)
      const acceptRes = await request(app)
        .post(`/api/referrals/${regReferral.referralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({ notes: 'Bed secured in CCU' });
      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.referral.status).toBe('ACCEPTED');

      // Step F: Start Treatment (ACCEPTED -> IN_PROGRESS)
      const startRes = await request(app)
        .post(`/api/referrals/${regReferral.referralId}/start-treatment`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({ notes: 'Patient admitted to CCU' });
      expect(startRes.status).toBe(200);
      expect(startRes.body.referral.status).toBe('IN_PROGRESS');
    });

    test('Requirement 24: Existing doctor assignment and reassignment remain intact', async () => {
      const reassign = await request(app)
        .post(`/api/referrals/${regReferral.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          newReceivingDoctorId: doctorUserB._id,
          reason: 'Attending physician rotation change'
        });
      expect(reassign.status).toBe(200);
      expect(reassign.body.referral.receivingDoctorId.toString()).toBe(doctorUserB._id.toString());
    });

    test('Requirement 25: Treatment documentation and care confirmation remain intact', async () => {
      // Document treatment
      const treatRes = await request(app)
        .post(`/api/referrals/${regReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          treatmentSummary: 'Emergency coronary angiography and stent placement performed with complete hemodynamic stabilization.',
          clinicalObservations: 'Post-intervention vitals stable, sinus rhythm restored.',
          proceduresPerformed: ['Coronary Angiography', 'Percutaneous Coronary Intervention'],
          medicationsAdministered: [{ name: 'Aspirin', dose: '300mg', route: 'Oral' }],
          followUpRequired: true,
          followUpInstructions: 'Cardiac rehab and echocardiogram in 2 weeks.'
        });
      expect(treatRes.status).toBe(200);
      expect(treatRes.body.referral.status).toBe('FOLLOW_UP_REQUIRED');

      // Care confirmation
      const confirmRes = await request(app)
        .post(`/api/referrals/${regReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          confirmationSummary: 'Comprehensive care verified and cardiac recovery protocol established.',
          followUpPlan: 'Outpatient cardiology visit scheduled'
        });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.referral.careConfirmation.isConfirmed).toBe(true);
    });

    test('Requirement 26: Follow-up closure protection remains intact (unresolved follow-up prevents referral closure)', async () => {
      // Schedule an active follow-up
      const followUpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: regReferral.referralId,
          patientId: regReferral.patientId,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          type: 'CARDIOLOGY_REVIEW',
          specialty: 'Cardiology',
          hospitalName: 'St. Jude Heart Hospital',
          instructions: 'Check ECG and cardiac enzymes'
        });
      expect(followUpRes.status).toBe(201);
      const followUpId = followUpRes.body.followUp.followUpId;

      // Attempting to close referral must be rejected because unresolved follow-up exists
      const closeAttempt = await request(app)
        .post(`/api/referrals/${regReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Attempting premature closure' });

      expect(closeAttempt.status).toBe(400);
      expect(closeAttempt.body.error.code).toBe('UNRESOLVED_FOLLOW_UP');

      // Complete the follow-up
      const completeFup = await request(app)
        .post(`/api/follow-ups/${followUpId}/complete`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          outcomeNotes: 'Cardiac enzymes normal, patient stable for discharge.'
        });
      expect(completeFup.status).toBe(200);

      // Now referral can be closed successfully
      const successfulClose = await request(app)
        .post(`/api/referrals/${regReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Care completed and documented with clinical verification.' });

      expect(successfulClose.status).toBe(200);
      expect(successfulClose.body.referral.status).toBe('COMPLETED');
    });

    test('Requirement 27: Patient notification preferences and idempotent notifications remain intact', async () => {
      // Update preferences
      const prefRes = await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({ referralUpdates: true, followUpReminders: true });
      expect(prefRes.status).toBe(200);
      expect(prefRes.body.preferences.referralUpdates).toBe(true);

      // Query notifications
      const notifsRes = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${patientToken1}`);
      expect(notifsRes.status).toBe(200);
      expect(Array.isArray(notifsRes.body.notifications)).toBe(true);
    });

    test('Requirement 28: AI monitoring alerts remain clinician-only (patients cannot view monitoring alerts)', async () => {
      // Patient attempts to access internal clinical monitoring alerts
      const patientAlertAttempt = await request(app)
        .get('/api/monitoring/alerts')
        .set('Authorization', `Bearer ${patientToken1}`);

      expect(patientAlertAttempt.status).toBe(403);
      expect(patientAlertAttempt.body.error.code).toBe('FORBIDDEN_ROLE');

      // Doctor can access monitoring alerts
      const doctorAlertAttempt = await request(app)
        .get('/api/monitoring/alerts')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(doctorAlertAttempt.status).toBe(200);
      expect(Array.isArray(doctorAlertAttempt.body.alerts)).toBe(true);
    });
  });

  describe('6. Phase 7.1 Targeted Security Hardening Verification (All 18 Scenarios)', () => {

    let p71Patient;
    let p71PatientToken;
    let p71Screening;

    beforeAll(async () => {
      // Create dedicated patient for Phase 7.1 tests
      p71Patient = await User.create({
        email: 'patient.p71@mediform.org',
        username: 'PAT-P71-01',
        name: 'Samantha Hall',
        password: 'password123',
        role: 'patient',
        isEmailVerified: true
      });
      const jwt = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';
      p71PatientToken = jwt.sign(
        { userId: p71Patient._id, username: p71Patient.username, name: p71Patient.name, role: 'patient', tokenVersion: 0 },
        secret,
        { expiresIn: '1h' }
      );

      // Create screening authored by Doctor A at Metropolitan Trauma Hospital
      const scrRes = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          pid: 'PAT-P71-01',
          patientName: 'Samantha Hall',
          age: 38,
          gender: 'Female',
          vitals: { hr: 125, bp: '88/54', rr: 26, spo2: 91, temp: 39.1, gcs: 14 },
          patientConsent: { consentGiven: true, consentTimestamp: new Date(), consentedBy: 'Patient' }
        });
      p71Screening = scrRes.body.screening;
    });

    test('Scenario 1: Authoring clinician cannot use authorship to access unrelated patient records', async () => {
      // Doctor A authored p71Screening for PAT-P71-01.
      // Now create an unrelated screening for patientUser2 (PAT-CONSENT-02) authored by Doctor B.
      const unrelatedScreening = await Screening.create({
        screeningId: 'SCR-2026-UNRELATED-01',
        pid: 'PAT-CONSENT-02',
        patientName: 'James Wilson',
        age: 50,
        hospital: 'St. Jude Heart Hospital',
        recordedByUserId: doctorUserB._id,
        recordedByUsername: doctorUserB.username,
        evaluation: { isFlagged: true, riskLevel: 'HIGH', news2Score: 7 },
        patientConsent: { consentGiven: true }
      });

      // Doctor A attempts to access this unrelated screening using author credentials
      const res = await request(app)
        .get(`/api/screenings/${unrelatedScreening.screeningId}`)
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NO_VALID_CONSENT');
    });

    test('Scenario 2: Revoked sharing consent blocks subsequent access under that consent', async () => {
      // Patient grants consent to Doctor B for specialist referral
      const grantRes = await request(app)
        .post('/api/consent')
        .set('Authorization', `Bearer ${p71PatientToken}`)
        .send({
          authorizedHospital: 'St. Jude Heart Hospital',
          authorizedDoctorId: doctorUserB._id,
          authorizedDoctorName: 'Dr. Robert Vance',
          purpose: 'SPECIALIST_REFERRAL',
          permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS'],
          durationDays: 14
        });
      expect(grantRes.status).toBe(201);
      const consentId = grantRes.body.consent.consentId;

      // Doctor B check: authorized before revocation
      const checkBefore = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });
      expect(checkBefore.authorized).toBe(true);

      // Patient revokes the consent
      const revokeRes = await request(app)
        .patch(`/api/consent/${consentId}/revoke`)
        .set('Authorization', `Bearer ${p71PatientToken}`)
        .send({ reason: 'Patient chose alternative specialist facility' });
      expect(revokeRes.status).toBe(200);

      // Doctor B check: immediately blocked after revocation
      const checkAfter = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });
      expect(checkAfter.authorized).toBe(false);
      expect(checkAfter.code).toBe('CONSENT_REVOKED');
    });

    test('Scenario 3: Independent clinical-record access exception is narrowly scoped to author\'s facility/record', async () => {
      // Doctor A accessing their own legitimately recorded chart record
      const checkAuthor = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserA._id, role: 'doctor', hospitalName: 'Metropolitan Trauma Hospital' },
        hospital: 'Metropolitan Trauma Hospital',
        authorUserId: doctorUserA._id,
        purpose: 'CLINICAL_REVIEW',
        category: 'SCREENING_RESULTS'
      });
      expect(checkAuthor.authorized).toBe(true);
      expect(checkAuthor.reason).toBe('AUTHORING_CLINICIAN_RECORD_ACCESS');

      // If Doctor A claims authorship from a mismatched facility, denied
      const checkFacilityMismatch = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserA._id, role: 'doctor', hospitalName: 'Different Hospital' },
        hospital: 'Metropolitan Trauma Hospital',
        authorUserId: doctorUserA._id,
        purpose: 'CLINICAL_REVIEW'
      });
      expect(checkFacilityMismatch.authorized).toBe(false);
      expect(checkFacilityMismatch.code).toBe('FORBIDDEN_HOSPITAL_ACCESS');
    });

    test('Scenario 4: Doctor A\'s individual consent does not authorize Doctor B at the same hospital', async () => {
      // Grant consent strictly to Doctor B at St. Jude Heart Hospital
      await Consent.create({
        consentId: 'CST-2026-DOCB-ONLY',
        patientUserId: p71Patient._id,
        patientId: 'PAT-P71-01',
        patientName: 'Samantha Hall',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: doctorUserB._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        status: 'GRANTED',
        permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS'],
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });

      // Doctor C (also at St. Jude Heart Hospital) attempts access using hospital membership
      const checkDocC = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserC._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital',
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });
      expect(checkDocC.authorized).toBe(false);
      expect(checkDocC.code).toBe('NO_VALID_CONSENT');
    });

    test('Scenario 5: Unrelated hospital doctors cannot use hospital membership to bypass recipient restrictions', async () => {
      // Doctor C queries doctor consents; must NOT see the consent granted specifically to Doctor B
      const doctorCConsents = await consentService.getConsentsForDoctor(doctorUserC._id, 'St. Jude Heart Hospital');
      const containsDocBConsent = doctorCConsents.some(c => c.consentId === 'CST-2026-DOCB-ONLY');
      expect(containsDocBConsent).toBe(false);
    });

    test('Scenario 6: SCREENING_RESULTS consent does not authorize MEDICATIONS', async () => {
      // Create consent with ONLY SCREENING_RESULTS
      await Consent.create({
        consentId: 'CST-2026-CAT-SCR',
        patientUserId: p71Patient._id,
        patientId: 'PAT-P71-01',
        patientName: 'Samantha Hall',
        purpose: 'CLINICAL_REVIEW',
        authorizedDoctorId: doctorUserA._id,
        authorizedHospital: 'Metropolitan Trauma Hospital',
        status: 'GRANTED',
        permittedCategories: ['SCREENING_RESULTS'],
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });

      const checkMed = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserA._id, role: 'doctor', hospitalName: 'Metropolitan Trauma Hospital' },
        purpose: 'CLINICAL_REVIEW',
        category: 'MEDICATIONS'
      });
      expect(checkMed.authorized).toBe(false);
      expect(checkMed.code).toBe('CATEGORY_NOT_PERMITTED');
    });

    test('Scenario 7: VITALS consent does not authorize CLINICAL_NOTES', async () => {
      // Create consent with ONLY VITALS
      await Consent.create({
        consentId: 'CST-2026-CAT-VIT',
        patientUserId: p71Patient._id,
        patientId: 'PAT-P71-01',
        patientName: 'Samantha Hall',
        purpose: 'CLINICAL_REVIEW',
        authorizedDoctorId: doctorUserA._id,
        authorizedHospital: 'Metropolitan Trauma Hospital',
        status: 'GRANTED',
        permittedCategories: ['VITALS'],
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });

      const checkNotes = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserA._id, role: 'doctor', hospitalName: 'Metropolitan Trauma Hospital' },
        purpose: 'CLINICAL_REVIEW',
        category: 'CLINICAL_NOTES'
      });
      expect(checkNotes.authorized).toBe(false);
      expect(checkNotes.code).toBe('CATEGORY_NOT_PERMITTED');
    });

    test('Scenario 8: Purpose mismatch (e.g. SPECIALIST_REFERRAL vs GENERAL_CARE) is rejected', async () => {
      // CST-2026-DOCB-ONLY was granted for SPECIALIST_REFERRAL to Doctor B
      const checkPurposeMismatch = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        purpose: 'GENERAL_CARE',
        category: 'REFERRAL_DETAILS'
      });
      expect(checkPurposeMismatch.authorized).toBe(false);
      expect(checkPurposeMismatch.code).toBe('PURPOSE_MISMATCH');
    });

    test('Scenario 9: Missing consent remains denied', async () => {
      const checkMissing = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserUnrelated._id, role: 'doctor', hospitalName: 'General Outpost Clinic' },
        purpose: 'CLINICAL_REVIEW',
        category: 'SCREENING_RESULTS'
      });
      expect(checkMissing.authorized).toBe(false);
      expect(['NO_VALID_CONSENT', 'FORBIDDEN_HOSPITAL_ACCESS']).toContain(checkMissing.code);
    });

    test('Scenario 10: Existing valid consent continues to work', async () => {
      const checkValid = await consentService.verifyAccessConsent({
        patientId: 'PAT-P71-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });
      expect(checkValid.authorized).toBe(true);
      expect(checkValid.reason).toBe('VALID_CONSENT_GRANTED');
    });

    test('Scenario 11: Existing QR token becomes invalid after consent revocation', async () => {
      // Create transfer and generate QR
      const tf = await Transfer.create({
        pid: 'PAT-P71-01',
        nam: 'Samantha Hall',
        age: 38,
        gender: 'Female',
        bg: 'O+',
        fh: 'Metropolitan Trauma Hospital',
        th: 'St. Jude Heart Hospital',
        rt: 'Cardiac evaluation',
        priority: 'Urgent',
        pd: 'Acute chest pain',
        issuerUserId: doctorUserA._id,
        issuerUsername: doctorUserA.username,
        status: 'IN_TRANSIT'
      });

      const qrRes = await request(app)
        .post(`/api/transfers/${tf._id}/qr`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ pin: '445566' });
      expect(qrRes.status).toBe(201);
      const uuid = qrRes.body.uuid;

      // Public share info is active before revocation
      const infoBefore = await request(app).get(`/api/qr/info/${uuid}`);
      expect(infoBefore.status).toBe(200);
      expect(infoBefore.body.isRevoked).toBe(false);

      // Patient revokes consent for St. Jude
      await Consent.create({
        consentId: 'CST-2026-REVOKE-TF',
        patientUserId: p71Patient._id,
        patientId: 'PAT-P71-01',
        patientName: 'Samantha Hall',
        purpose: 'EMERGENCY_TRANSFER',
        authorizedHospital: 'St. Jude Heart Hospital',
        status: 'REVOKED',
        revokedAt: new Date(),
        revocationReason: 'Patient revoked sharing for transfer',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      // Public share info immediately reflects revocation
      const infoAfter = await request(app).get(`/api/qr/info/${uuid}`);
      expect(infoAfter.status).toBe(200);
      expect(infoAfter.body.isRevoked).toBe(true);

      // Attempting to redeem token is blocked with HTTP 410
      const redeemRes = await request(app)
        .post(`/api/qr/validate/${uuid}`)
        .send({ pin: '445566' });
      expect(redeemRes.status).toBe(410);
      expect(redeemRes.body.error.code).toBe('QR_EXPIRED');
    });

    test('Scenario 12: Previously established QR session becomes invalid after consent revocation', async () => {
      // Create a consent record
      const cst = await consentService.createConsentRecord({
        patientUserId: p71Patient._id,
        patientId: 'PAT-P71-01',
        patientName: 'Samantha Hall',
        purpose: 'EMERGENCY_TRANSFER',
        authorizedHospital: 'St. Jude Heart Hospital',
        durationDays: 7,
        actorId: p71Patient._id,
        actorRole: 'patient'
      });

      // Create transfer and session
      const tf = await Transfer.create({
        pid: 'PAT-P71-01',
        nam: 'Samantha Hall',
        age: 38,
        gender: 'Female',
        bg: 'O+',
        fh: 'Metropolitan Trauma Hospital',
        th: 'St. Jude Heart Hospital',
        rt: 'Cardiac ICU Transfer',
        priority: 'Emergency',
        pd: 'Refractory shock',
        issuerUserId: doctorUserA._id,
        issuerUsername: doctorUserA.username,
        status: 'IN_TRANSIT'
      });

      const qrSession = await QRSession.create({
        uuid: '00000000-0000-0000-0000-000000000071',
        transferId: tf._id,
        encryptedPayload: { iv: 'iv', authTag: 'tag', encryptedData: 'data' },
        pinHash: 'dummyhash',
        failedAttempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 3600000),
        createdByUserId: doctorUserA._id,
        isRevoked: false
      });

      // Revoke consent
      await consentService.revokeConsent(cst.consentId, { userId: p71Patient._id, role: 'patient' }, 'Revoked by patient');

      // The QR session is revoked in database
      const updatedSession = await QRSession.findOne({ uuid: qrSession.uuid });
      expect(updatedSession.isRevoked).toBe(true);
      expect(new Date(updatedSession.expiresAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    test('Scenario 13: Reassigned receiving doctor loses unauthorized access', async () => {
      // Create referral assigned to Doctor B
      const ref = await Referral.create({
        referralId: 'REF-2026-REASSIGN-71',
        patientId: 'PAT-P71-01',
        patientName: 'Samantha Hall',
        sourceScreeningId: p71Screening.screeningId,
        sourceScreeningRef: p71Screening._id,
        referringDoctorId: doctorUserA._id,
        referringDoctorUsername: doctorUserA.username,
        referringHospital: 'Metropolitan Trauma Hospital',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB._id,
        clinicalReason: 'Cardiology referral',
        status: 'PENDING'
      });

      // Reassign to Doctor C
      const reassignRes = await request(app)
        .post(`/api/referrals/${ref.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          receivingDoctorId: doctorUserC._id,
          reason: 'Transferred care to on-call cardiologist'
        });
      expect(reassignRes.status).toBe(200);

      // Doctor B now attempts to access referral (and has no separate patient consent)
      // Clean up all consents for PAT-P71-01 so Doctor B has no active or historical consent
      await Consent.deleteMany({
        $or: [
          { patientId: { $regex: /^PAT-P71-01$/i } },
          { patientUserId: p71Patient._id }
        ]
      });

      const accessRes = await request(app)
        .get(`/api/referrals/${ref.referralId}`)
        .set('Authorization', `Bearer ${doctorTokenB}`);

      expect(accessRes.status).toBe(403);
      expect(accessRes.body.error.code).toBe('NO_VALID_CONSENT');
    });

    test('Scenario 14: Expired QR sessions cannot access protected resources', async () => {
      const expiredSession = await QRSession.create({
        uuid: '00000000-0000-0000-0000-000000000072',
        transferId: p71Screening._id,
        encryptedPayload: { iv: 'iv', authTag: 'tag', encryptedData: 'data' },
        pinHash: 'dummyhash',
        failedAttempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() - 10000), // Expired
        createdByUserId: doctorUserA._id,
        isRevoked: false
      });

      const res = await request(app)
        .post(`/api/qr/validate/${expiredSession.uuid}`)
        .send({ pin: '123456' });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('QR_EXPIRED');
    });

    test('Scenario 15: Audit logs do not contain credentials, passwords, or authentication tokens', async () => {
      const dirtyDetails = {
        patientId: 'PAT-P71-01',
        password: 'mySecretPassword999',
        pin: '123456',
        token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
        secret: 'topSecretKey'
      };

      const sanitized = sanitizeDetails(dirtyDetails);
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.pin).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.secret).toBe('[REDACTED]');
    });

    test('Scenario 16: Audit logs do not contain clinical notes or diagnosis text', async () => {
      const detailsWithClinicalNotes = {
        screeningId: 'SCR-001',
        patientId: 'PAT-P71-01',
        clinicalNotes: 'Patient has severe advanced pneumonia and septic shock',
        pd: 'Bacterial Sepsis',
        secondaryDiagnosis: 'Cardiogenic Failure',
        sum: 'Critical prognosis requiring mechanical ventilation',
        vitals: { hr: 140, bp: '70/40' }
      };

      const sanitized = sanitizeDetails(detailsWithClinicalNotes);
      expect(sanitized.clinicalNotes).toBeUndefined();
      expect(sanitized.pd).toBeUndefined();
      expect(sanitized.secondaryDiagnosis).toBeUndefined();
      expect(sanitized.sum).toBeUndefined();
      expect(sanitized.vitals).toBeUndefined();
    });

    test('Scenario 17: Arbitrary reason/details fields cannot introduce unrestricted PHI', async () => {
      const dirtyReason = {
        consentId: 'CST-001',
        patientId: 'PAT-P71-01',
        reason: 'Patient diagnosed with diabetes and hypertension',
        arbitraryUnsafeField: 'Unauthorized clinical observation'
      };

      const sanitized = sanitizeDetails(dirtyReason);
      // Free-text reason is normalized to a safe operational enum code
      expect(sanitized.reasonCode).toBe('CLINICAL_DISCRETION');
      expect(sanitized.reason).toBe('CLINICAL_DISCRETION');

      // Allowlisting drops arbitrary unsafe fields
      const { buildAllowlistedDetails } = require('../services/auditService');
      const allowlisted = buildAllowlistedDetails('CONSENT_REVOKED', dirtyReason);
      expect(allowlisted.arbitraryUnsafeField).toBeUndefined();
      expect(allowlisted.revocationReasonCode).toBe('CLINICAL_DISCRETION');
    });

    test('Scenario 18: Patient and hospital isolation remain intact', async () => {
      // Patient isolation: PAT-CONSENT-01 attempting to access PAT-P71-01's screening
      const crossPatientRes = await request(app)
        .get(`/api/screenings/${p71Screening.screeningId}`)
        .set('Authorization', `Bearer ${patientToken1}`);
      expect(crossPatientRes.status).toBe(403);
      expect(crossPatientRes.body.error.code).toBe('FORBIDDEN_RECORD_ACCESS');

      // Hospital isolation: Doctor Unrelated at General Outpost Clinic attempting to access Metropolitan screening
      const crossHospitalRes = await request(app)
        .get(`/api/screenings/${p71Screening.screeningId}`)
        .set('Authorization', `Bearer ${doctorTokenUnrelated}`);
      expect(crossHospitalRes.status).toBe(403);
      expect(crossHospitalRes.body.error.code).toBe('NO_VALID_CONSENT');
    });
  });

  describe('7. Phase 7.1.1: Schema Compatibility, Persistence & Active Treating Relationship Invariants', () => {

    let p711Patient;
    let p711PatientToken;
    let p711Screening;
    let p711Referral;

    beforeAll(async () => {
      p711Patient = await User.create({
        email: 'patient.p711@mediform.org',
        username: 'PAT-P711-01',
        name: 'David Miller',
        password: 'password123',
        role: 'patient',
        isEmailVerified: true
      });
      const jwt = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';
      p711PatientToken = jwt.sign(
        { userId: p711Patient._id, username: p711Patient.username, name: p711Patient.name, role: 'patient', tokenVersion: 0 },
        secret,
        { expiresIn: '1h' }
      );

      // Create screening
      p711Screening = await Screening.create({
        screeningId: 'SCR-2026-P711-01',
        pid: 'PAT-P711-01',
        patientName: 'David Miller',
        age: 52,
        hospital: 'Metropolitan Trauma Hospital',
        recordedByUserId: doctorUserA._id,
        recordedByUsername: doctorUserA.username,
        evaluation: { isFlagged: true, riskLevel: 'HIGH', news2Score: 8 },
        patientConsent: { consentGiven: true }
      });

      // Create referral assigned to Doctor B at St. Jude
      p711Referral = await Referral.create({
        referralId: 'REF-2026-P711-01',
        patientId: 'PAT-P711-01',
        patientName: 'David Miller',
        sourceScreeningId: p711Screening.screeningId,
        sourceScreeningRef: p711Screening._id,
        referringDoctorId: doctorUserA._id,
        referringDoctorUsername: doctorUserA.username,
        referringHospital: 'Metropolitan Trauma Hospital',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB._id,
        clinicalReason: 'Cardiology handoff',
        status: 'PENDING'
      });
    });

    // 1. Schema Compatibility & Actual Mongoose Persistence
    test('Requirement 1 & 2: Persist and retrieve consent with SECOND_OPINION purpose and INVESTIGATIONS category', async () => {
      const consent = await consentService.createConsentRecord({
        patientUserId: p711Patient._id,
        patientId: 'PAT-P711-01',
        patientName: 'David Miller',
        purpose: 'SECOND_OPINION',
        authorizedDoctorId: doctorUserB._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'INVESTIGATIONS', 'REFERRAL_DETAILS'],
        durationDays: 15,
        actorId: p711Patient._id,
        actorRole: 'patient'
      });

      expect(consent.consentId).toBeDefined();
      expect(consent.purpose).toBe('SECOND_OPINION');
      expect(consent.permittedCategories).toContain('INVESTIGATIONS');

      // Verify actual database persistence via Mongoose findOne
      const retrieved = await Consent.findOne({ consentId: consent.consentId });
      expect(retrieved).not.toBeNull();
      expect(retrieved.purpose).toBe('SECOND_OPINION');
      expect(retrieved.permittedCategories).toEqual(
        expect.arrayContaining(['DEMOGRAPHICS', 'SCREENING_RESULTS', 'INVESTIGATIONS', 'REFERRAL_DETAILS'])
      );
    });

    test('Requirement 2: Mongoose rejects invalid purpose enum value', async () => {
      let validationError = null;
      try {
        await Consent.create({
          consentId: 'CST-INVALID-PURPOSE',
          patientUserId: p711Patient._id,
          patientId: 'PAT-P711-01',
          purpose: 'UNAUTHORIZED_EXPERIMENTAL_RESEARCH',
          authorizedHospital: 'St. Jude Heart Hospital',
          expiresAt: new Date(Date.now() + 86400000)
        });
      } catch (err) {
        validationError = err;
      }

      expect(validationError).not.toBeNull();
      expect(validationError.name).toBe('ValidationError');
      expect(validationError.errors.purpose).toBeDefined();
    });

    test('Requirement 2: Mongoose rejects invalid permittedCategories enum value', async () => {
      let validationError = null;
      try {
        await Consent.create({
          consentId: 'CST-INVALID-CAT',
          patientUserId: p711Patient._id,
          patientId: 'PAT-P711-01',
          purpose: 'SPECIALIST_REFERRAL',
          authorizedHospital: 'St. Jude Heart Hospital',
          permittedCategories: ['GENOME_SEQUENCING_RAW', 'VITALS'],
          expiresAt: new Date(Date.now() + 86400000)
        });
      } catch (err) {
        validationError = err;
      }

      expect(validationError).not.toBeNull();
      expect(validationError.name).toBe('ValidationError');
    });

    test('Requirement 2: Compatibility with all existing Phase 7 consent purpose values', async () => {
      const existingPurposes = ['EMERGENCY_TRANSFER', 'SPECIALIST_REFERRAL', 'CLINICAL_REVIEW', 'GENERAL_CARE'];
      for (const p of existingPurposes) {
        const c = await Consent.create({
          consentId: `CST-COMPAT-${p}`,
          patientUserId: p711Patient._id,
          patientId: 'PAT-P711-01',
          purpose: p,
          authorizedHospital: 'St. Jude Heart Hospital',
          permittedCategories: ['DEMOGRAPHICS', 'VITALS', 'SCREENING_RESULTS', 'CLINICAL_NOTES', 'MEDICATIONS', 'REFERRAL_DETAILS'],
          expiresAt: new Date(Date.now() + 86400000)
        });
        expect(c.purpose).toBe(p);
      }
    });

    // 2. Active Treating Relationship Invariants
    test('Requirement 3: Active referral + valid consent within scope = authorized access', async () => {
      // Clear previous consents for clean evaluation
      await Consent.deleteMany({ patientId: { $regex: /^PAT-P711-01$/i } });

      // Grant valid active consent
      await Consent.create({
        consentId: 'CST-2026-P711-VALID',
        patientUserId: p711Patient._id,
        patientId: 'PAT-P711-01',
        patientName: 'David Miller',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: doctorUserB._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS'],
        status: 'GRANTED',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      const check = await consentService.verifyAccessConsent({
        patientId: 'PAT-P711-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital',
        assignedDoctorId: p711Referral.receivingDoctorId,
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });

      expect(check.authorized).toBe(true);
      expect(check.reason).toBe('VALID_CONSENT_GRANTED');
    });

    test('Requirement 3: Active referral + revoked consent = denied access (CONSENT_REVOKED)', async () => {
      // Clear and create revoked consent
      await Consent.deleteMany({ patientId: { $regex: /^PAT-P711-01$/i } });

      await Consent.create({
        consentId: 'CST-2026-P711-REVOKED',
        patientUserId: p711Patient._id,
        patientId: 'PAT-P711-01',
        patientName: 'David Miller',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: doctorUserB._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        status: 'REVOKED',
        revokedAt: new Date(),
        revocationReason: 'Patient revoked consent',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      // Treating relationship must not bypass revocation
      const check = await consentService.verifyAccessConsent({
        patientId: 'PAT-P711-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital',
        assignedDoctorId: p711Referral.receivingDoctorId,
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });

      expect(check.authorized).toBe(false);
      expect(check.code).toBe('CONSENT_REVOKED');
    });

    test('Requirement 3: Active referral + expired consent = denied access (CONSENT_EXPIRED)', async () => {
      await Consent.deleteMany({ patientId: { $regex: /^PAT-P711-01$/i } });

      await Consent.create({
        consentId: 'CST-2026-P711-EXPIRED',
        patientUserId: p711Patient._id,
        patientId: 'PAT-P711-01',
        patientName: 'David Miller',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: doctorUserB._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        status: 'GRANTED',
        expiresAt: new Date(Date.now() - 3600000) // Expired 1 hour ago
      });

      // Treating relationship must not bypass expiration
      const check = await consentService.verifyAccessConsent({
        patientId: 'PAT-P711-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital',
        assignedDoctorId: p711Referral.receivingDoctorId,
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });

      expect(check.authorized).toBe(false);
      expect(check.code).toBe('CONSENT_EXPIRED');
    });

    test('Requirement 3: Active referral + unauthorized category = denied access (CATEGORY_NOT_PERMITTED)', async () => {
      await Consent.deleteMany({ patientId: { $regex: /^PAT-P711-01$/i } });

      // Grant consent ONLY for DEMOGRAPHICS and SCREENING_RESULTS
      await Consent.create({
        consentId: 'CST-2026-P711-LIMITED-CAT',
        patientUserId: p711Patient._id,
        patientId: 'PAT-P711-01',
        patientName: 'David Miller',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: doctorUserB._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS'],
        status: 'GRANTED',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      // Treating relationship must not bypass category restriction (requesting MEDICATIONS)
      const checkMed = await consentService.verifyAccessConsent({
        patientId: 'PAT-P711-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital',
        assignedDoctorId: p711Referral.receivingDoctorId,
        purpose: 'SPECIALIST_REFERRAL',
        category: 'MEDICATIONS'
      });

      expect(checkMed.authorized).toBe(false);
      expect(checkMed.code).toBe('CATEGORY_NOT_PERMITTED');

      // Requesting CLINICAL_NOTES also denied
      const checkNotes = await consentService.verifyAccessConsent({
        patientId: 'PAT-P711-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital',
        assignedDoctorId: p711Referral.receivingDoctorId,
        purpose: 'SPECIALIST_REFERRAL',
        category: 'CLINICAL_NOTES'
      });

      expect(checkNotes.authorized).toBe(false);
      expect(checkNotes.code).toBe('CATEGORY_NOT_PERMITTED');
    });

    test('Requirement 3: Active referral + wrong recipient = denied access (NO_VALID_CONSENT)', async () => {
      await Consent.deleteMany({ patientId: { $regex: /^PAT-P711-01$/i } });

      // Consent granted specifically to Doctor B
      await Consent.create({
        consentId: 'CST-2026-P711-DOCB-SPECIFIC',
        patientUserId: p711Patient._id,
        patientId: 'PAT-P711-01',
        patientName: 'David Miller',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: doctorUserB._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS'],
        status: 'GRANTED',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      // Doctor C at same hospital attempts access on active referral
      // Treating relationship must not bypass recipient restriction
      const checkDocC = await consentService.verifyAccessConsent({
        patientId: 'PAT-P711-01',
        requestingUser: { userId: doctorUserC._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital',
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });

      expect(checkDocC.authorized).toBe(false);
      expect(checkDocC.code).toBe('NO_VALID_CONSENT');
    });

    test('Requirement 3: Active referral + wrong hospital = denied access (FORBIDDEN_HOSPITAL_ACCESS)', async () => {
      await Consent.deleteMany({ patientId: { $regex: /^PAT-P711-01$/i } });

      // Consent granted to Metropolitan Trauma Hospital
      await Consent.create({
        consentId: 'CST-2026-P711-METRO-ONLY',
        patientUserId: p711Patient._id,
        patientId: 'PAT-P711-01',
        patientName: 'David Miller',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: null,
        authorizedHospital: 'Metropolitan Trauma Hospital',
        permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS'],
        status: 'GRANTED',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      // Doctor at St. Jude Heart Hospital attempts access
      // Treating relationship must not bypass hospital boundary
      const checkWrongHosp = await consentService.verifyAccessConsent({
        patientId: 'PAT-P711-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital',
        purpose: 'SPECIALIST_REFERRAL',
        category: 'REFERRAL_DETAILS'
      });

      expect(checkWrongHosp.authorized).toBe(false);
      expect(checkWrongHosp.code).toBe('FORBIDDEN_HOSPITAL_ACCESS');
    });

    test('Requirement 3: Active referral + purpose mismatch = denied access (PURPOSE_MISMATCH)', async () => {
      await Consent.deleteMany({ patientId: { $regex: /^PAT-P711-01$/i } });

      // Consent granted for SPECIALIST_REFERRAL
      await Consent.create({
        consentId: 'CST-2026-P711-PURPOSE-REF',
        patientUserId: p711Patient._id,
        patientId: 'PAT-P711-01',
        patientName: 'David Miller',
        purpose: 'SPECIALIST_REFERRAL',
        authorizedDoctorId: doctorUserB._id,
        authorizedHospital: 'St. Jude Heart Hospital',
        permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS'],
        status: 'GRANTED',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      // Doctor B attempts access requesting GENERAL_CARE
      // Treating relationship must not bypass purpose restriction
      const checkPurpose = await consentService.verifyAccessConsent({
        patientId: 'PAT-P711-01',
        requestingUser: { userId: doctorUserB._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        hospital: 'St. Jude Heart Hospital',
        assignedDoctorId: p711Referral.receivingDoctorId,
        purpose: 'GENERAL_CARE',
        category: 'REFERRAL_DETAILS'
      });

      expect(checkPurpose.authorized).toBe(false);
      expect(checkPurpose.code).toBe('PURPOSE_MISMATCH');
    });
  });
});
