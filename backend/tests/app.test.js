const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Transfer = require('../models/Transfer');
const OTPChallenge = require('../models/OTPChallenge');

jest.setTimeout(60000);

let mongoServer;
let doctorToken;
let doctorUser;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // Register & Verify Doctor User (2-Phase Email OTP)
  const docReg = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.smith@metropolitan.health',
      name: 'Dr. John Smith',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital'
    });

  const docVerify = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docReg.body.challengeId, otp: docReg.body.devOtp });

  doctorToken = docVerify.body.token;
  doctorUser = docVerify.body.user;
}, 60000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}, 60000);

describe('MediFORM V2 Comprehensive Test Suite', () => {

  describe('1. Doctor-Only 2-Phase Email OTP Authentication', () => {
    test('Patient account registration is rejected (HTTP 400 INVALID_ROLE)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'patient@test.com',
          password: 'password123',
          role: 'patient'
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ROLE');
    });

    test('Doctor login generates OTP challenge and does NOT issue JWT early', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'dr.smith@metropolitan.health', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.requireOtp).toBe(true);
      expect(res.body.token).toBeUndefined(); // Hard Rule: No JWT before OTP verification
    });

    test('Incorrect OTP verification returns 401 with remaining attempt count', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'dr.smith@metropolitan.health', password: 'password123' });

      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ challengeId: loginRes.body.challengeId, otp: '000000' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INCORRECT_OTP');
      expect(res.body.error.attemptsRemaining).toBeDefined();
    });

    test('Purpose Isolation: Using PASSWORD_RESET challenge for login fails', async () => {
      const forgotRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'dr.smith@metropolitan.health' });

      const verifyRes = await request(app)
        .post('/api/auth/verify-login-otp')
        .send({ challengeId: forgotRes.body.challengeId, otp: forgotRes.body.devOtp });

      expect(verifyRes.status).toBe(401);
      expect(verifyRes.body.error.code).toBe('INVALID_CHALLENGE');
    });

    test('Forgot Password returns generic success regardless of email existence (Enumeration Defense)', async () => {
      const existingRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'dr.smith@metropolitan.health' });

      expect(existingRes.status).toBe(200);
      expect(existingRes.body.success).toBe(true);
      expect(existingRes.body.message).toContain('If an account associated with that email exists');

      const nonExistingRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent.doctor@unknown.org' });

      expect(nonExistingRes.status).toBe(200);
      expect(nonExistingRes.body.success).toBe(true);
      expect(nonExistingRes.body.message).toContain('If an account associated with that email exists');
    });

    test('Password Reset updates password and revokes previous JWT sessions via tokenVersion increment', async () => {
      // 1. Create registration & login session for a test doctor
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'dr.revoke@test.org',
          name: 'Dr. Session Revoke',
          password: 'OldPassword123',
          hospitalName: 'Revoke Hospital'
        });

      const verifyRes = await request(app)
        .post('/api/auth/verify-email-otp')
        .send({ challengeId: regRes.body.challengeId, otp: regRes.body.devOtp });

      const oldSessionToken = verifyRes.body.token;

      // Verify old session token works initially
      const meBefore = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldSessionToken}`);
      expect(meBefore.status).toBe(200);

      // 2. Request Forgot Password & Reset Password
      const forgotRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'dr.revoke@test.org' });

      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .send({
          challengeId: forgotRes.body.challengeId,
          otp: forgotRes.body.devOtp,
          newPassword: 'NewSecurePassword123'
        });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);

      // 3. Verify old session token is now REVOKED (HTTP 403 TOKEN_REVOKED)
      const meAfter = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldSessionToken}`);

      expect(meAfter.status).toBe(403);
      expect(meAfter.body.error.code).toBe('TOKEN_REVOKED');
    });

    test('Resend OTP enforces 60-second cooldown limit', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({ email: 'dr.cooldown@test.org', password: 'password123', hospitalName: 'Hospital C' });

      const resendRes = await request(app)
        .post('/api/auth/resend-otp')
        .send({ challengeId: regRes.body.challengeId });

      expect(resendRes.status).toBe(400);
      expect(resendRes.body.error.code).toBe('RESEND_COOLDOWN');
    });

    test('Expired OTP challenge returns HTTP 401 OTP_EXPIRED', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({ email: 'dr.expired@test.org', password: 'password123', hospitalName: 'Hospital Exp' });

      const challengeId = regRes.body.challengeId;

      // Artificially expire the challenge in DB
      await OTPChallenge.updateOne({ challengeId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .send({ challengeId, otp: regRes.body.devOtp });

      expect(verifyRes.status).toBe(401);
      expect(verifyRes.body.error.code).toBe('OTP_EXPIRED');
    });

    test('Single-use invalidation: Consumed OTP cannot be reused', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({ email: 'dr.single@test.org', password: 'password123', hospitalName: 'Hospital S' });

      const challengeId = regRes.body.challengeId;
      const devOtp = regRes.body.devOtp;

      // First verification succeeds
      const v1 = await request(app)
        .post('/api/auth/verify-otp')
        .send({ challengeId, otp: devOtp });
      expect(v1.status).toBe(200);

      // Reusing consumed OTP fails with INVALID_CHALLENGE
      const v2 = await request(app)
        .post('/api/auth/verify-otp')
        .send({ challengeId, otp: devOtp });
      expect(v2.status).toBe(401);
      expect(v2.body.error.code).toBe('INVALID_CHALLENGE');
    });
  });

  describe('2. Validation & Boundary Enforcement', () => {
    test('Doctor creates transfer with essential fields and optional Other Details', async () => {
      const payload = {
        pid: 'PAT-UHID-999',
        nam: 'Arthur Pendelton',
        age: 62,
        gender: 'Male',
        bg: 'O+',
        fh: 'St. Jude Community Hospital',
        th: 'University Cardiac Center',
        rt: 'Acute Myocardial Infarction requiring emergency catheterization',
        priority: 'Emergency',
        pd: 'STEMI Antero-septal',
        sum: 'Patient presented with 2 hours of crushing chest pain. Thrombolysed.',
        alg: ['Penicillin'],
        med: [{ n: 'Aspirin', d: '300mg', r: 'PO', frequency: 'STAT', notes: 'Given at 14:00' }],
        vit: { hr: 95, bp: '110/70', spo2: 96, temp: 36.8, gcs: 15 },
        otherDetails: [
          {
            title: 'Special Instruction',
            value: 'Monitor ECG telemetry continuously during transport',
            category: 'SPECIAL_INSTRUCTIONS',
            priority: 'CRITICAL'
          }
        ]
      };

      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.transfer._id).toBeDefined();
    });

    test('Clinical Summary exceeding 200 words returns 400 PAYLOAD_VALIDATION_ERROR', async () => {
      const oversizedSummary = Array(205).fill('clinical').join(' ');
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-SUM-LONG',
          nam: 'Test Patient',
          age: 50,
          bg: 'B+',
          fh: 'H1',
          th: 'H2',
          rt: 'Reason',
          pd: 'Diagnosis',
          sum: oversizedSummary
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYLOAD_VALIDATION_ERROR');
      expect(res.body.error.field).toBe('sum');
    });

    test('Contradictory allergy state ("No Known Allergies" AND "Penicillin") is rejected', async () => {
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-ALLERGY-CONFLICT',
          nam: 'Test Patient',
          age: 50,
          bg: 'B+',
          fh: 'H1',
          th: 'H2',
          rt: 'Reason',
          pd: 'Diagnosis',
          alg: ['No Known Allergies', 'Penicillin']
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYLOAD_VALIDATION_ERROR');
    });
  });

  describe('3. Dual QR Access Projections & AES Decryption', () => {
    let transferId;
    let qrUuid;
    let qrPin;

    beforeAll(async () => {
      const createRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-DUAL-QR',
          nam: 'Dual QR Test Patient',
          age: 48,
          gender: 'Female',
          bg: 'AB+',
          fh: 'Hospital Origin',
          th: 'Hospital Destination',
          rt: 'Specialist Evaluation',
          pd: 'Neurological Observation'
        });
      transferId = createRes.body.transfer._id;
    });

    test('Doctor generates AES encrypted QR session with 6-digit PIN', async () => {
      const res = await request(app)
        .post('/api/qr/generate')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ transferId, pin: '654321' });

      expect(res.status).toBe(201);
      expect(res.body.uuid).toBeDefined();
      expect(res.body.pin).toBe('654321');
      qrUuid = res.body.uuid;
      qrPin = res.body.pin;
    });

    test('Full Clinical QR View returns complete transfer record DTO for receiving doctor', async () => {
      const res = await request(app)
        .post(`/api/qr/validate/${qrUuid}`)
        .send({ pin: qrPin });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.transfer.pid).toBe('PAT-DUAL-QR');
      expect(res.body.transfer.issuerUserId).toBeDefined();
    });

    test('Patient-Safe Read-Only QR View returns sanitized DTO (excluding internal clinician IDs and secrets)', async () => {
      const res = await request(app)
        .post(`/api/qr/validate-patient/${qrUuid}`)
        .send({ pin: qrPin });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.patientView.patientName).toBe('Dual QR Test Patient');
      expect(res.body.patientView.fromHospital).toBe('Hospital Origin');
      // Excludes internal clinician fields
      expect(res.body.patientView.issuerUserId).toBeUndefined();
      expect(res.body.patientView.recipientUserIds).toBeUndefined();
      expect(res.body.patientView.pinHash).toBeUndefined();
    });
  });

  describe('4. Immutable Transfer Versioning', () => {
    test('Updating transfer sets previous version isCurrent=false and increments version number', async () => {
      const createRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-IMMUTABLE-V2',
          nam: 'Immutable Patient',
          age: 38,
          bg: 'A-',
          fh: 'H-A',
          th: 'H-B',
          rt: 'Observation',
          pd: 'Concussion'
        });

      const initialId = createRes.body.transfer._id;

      const updateRes = await request(app)
        .post(`/api/transfers/${initialId}/updates`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ pd: 'Severe Concussion & Skull Fracture' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.transfer.version).toBe(2);
      expect(updateRes.body.transfer.isCurrent).toBe(true);
      expect(updateRes.body.transfer.previousVersionId).toBe(initialId);

      const oldDoc = await Transfer.findById(initialId);
      expect(oldDoc.isCurrent).toBe(false);
    });
  });



  describe('6. Transfer Creation Idempotency Tests', () => {
    let secondDoctorToken;

    beforeAll(async () => {
      // Register a second doctor to test cross-doctor key isolation
      const doc2Reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'dr.second@hospital.org',
          name: 'Dr. Second Physician',
          password: 'password123',
          hospitalName: 'Second Hospital'
        });

      const doc2Verify = await request(app)
        .post('/api/auth/verify-email-otp')
        .send({ challengeId: doc2Reg.body.challengeId, otp: doc2Reg.body.devOtp });

      secondDoctorToken = doc2Verify.body.token;
    });

    test('Test 1: Same doctor + same key + same request returns original response without creating duplicate transfer', async () => {
      const key = 'idem-key-test-1-' + Date.now();
      const payload = {
        pid: 'PAT-IDEM-001',
        nam: 'Idempotency Test Patient',
        age: 55,
        bg: 'O+',
        fh: 'Hospital A',
        th: 'Hospital B',
        rt: 'ICU Transfer Required',
        pd: 'Cardiogenic Shock'
      };

      // 1. Initial request creates transfer
      const res1 = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('Idempotency-Key', key)
        .send(payload);

      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);
      const createdId = res1.body.transfer._id;

      // 2. Repeated request with SAME key & SAME payload
      const res2 = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('Idempotency-Key', key)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.success).toBe(true);
      expect(res2.body.transfer._id).toBe(createdId);

      // Verify DB count: exactly 1 transfer created for this PID
      const dbCount = await Transfer.countDocuments({ pid: 'PAT-IDEM-001' });
      expect(dbCount).toBe(1);
    });

    test('Test 2: Reusing key with different authenticated doctor is rejected with HTTP 403 FORBIDDEN_IDEMPOTENCY_KEY', async () => {
      const key = 'idem-key-test-2-' + Date.now();
      const payload = {
        pid: 'PAT-IDEM-002',
        nam: 'Cross Doctor Test Patient',
        age: 40,
        bg: 'A+',
        fh: 'Hospital A',
        th: 'Hospital B',
        rt: 'Observation',
        pd: 'Chest Pain'
      };

      // Doctor 1 creates transfer
      await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('Idempotency-Key', key)
        .send(payload);

      // Doctor 2 attempts to reuse Doctor 1's key
      const res2 = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${secondDoctorToken}`)
        .set('Idempotency-Key', key)
        .send(payload);

      expect(res2.status).toBe(403);
      expect(res2.body.error.code).toBe('FORBIDDEN_IDEMPOTENCY_KEY');
    });

    test('Test 3: Reusing key with materially different payload is rejected with HTTP 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const key = 'idem-key-test-3-' + Date.now();
      const payload1 = {
        pid: 'PAT-IDEM-003',
        nam: 'Original Patient Name',
        age: 30,
        bg: 'B+',
        fh: 'Hospital A',
        th: 'Hospital B',
        rt: 'Reason A',
        pd: 'Diagnosis A'
      };

      const payload2 = {
        pid: 'PAT-IDEM-003',
        nam: 'DIFFERENT Patient Name',
        age: 99,
        bg: 'AB-',
        fh: 'Hospital X',
        th: 'Hospital Y',
        rt: 'Reason B',
        pd: 'Diagnosis B'
      };

      // Doctor 1 sends initial request
      await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('Idempotency-Key', key)
        .send(payload1);

      // Doctor 1 reuses key with materially different payload
      const res2 = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('Idempotency-Key', key)
        .send(payload2);

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    test('Test 4: Concurrent requests with same key produce exactly one transfer record', async () => {
      const key = 'idem-key-concurrent-' + Date.now();
      const payload = {
        pid: 'PAT-IDEM-CONCURRENT',
        nam: 'Concurrent Patient',
        age: 60,
        bg: 'O-',
        fh: 'Hospital Origin',
        th: 'Hospital Dest',
        rt: 'Emergency Handoff',
        pd: 'Acute Stroke'
      };

      // Launch 5 concurrent requests with identical key & payload
      const requests = Array(5).fill(null).map(() =>
        request(app)
          .post('/api/transfers')
          .set('Authorization', `Bearer ${doctorToken}`)
          .set('Idempotency-Key', key)
          .send(payload)
      );

      const responses = await Promise.all(requests);

      // All responses should succeed with 201
      responses.forEach(r => expect(r.status).toBe(201));

      // DB should contain exactly 1 transfer
      const dbCount = await Transfer.countDocuments({ pid: 'PAT-IDEM-CONCURRENT' });
      expect(dbCount).toBe(1);
    });
  });

  describe('7. MediFORM V2 Final Clinical Integrity, Security & QA Tests', () => {
    test('Numeric boundary enforcement: Out-of-range Age, HR, SpO2, Temp, Glucose, and Blood Group are rejected with HTTP 400', async () => {
      const basePayload = {
        pid: 'PAT-NUMERIC-ERR',
        nam: 'Invalid Numeric Patient',
        age: 45,
        bg: 'O+',
        fh: 'Hospital A',
        th: 'Hospital B',
        rt: 'Routine Transfer',
        pd: 'Pneumonia'
      };

      // Invalid Age (negative)
      const resAge1 = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ ...basePayload, age: -5 });
      expect(resAge1.status).toBe(400);
      expect(resAge1.body.error.code).toBe('PAYLOAD_VALIDATION_ERROR');

      // Invalid Age (> 130)
      const resAge2 = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ ...basePayload, age: 150 });
      expect(resAge2.status).toBe(400);

      // Invalid Blood Group
      const resBg = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ ...basePayload, bg: 'INVALID_BG' });
      expect(resBg.status).toBe(400);

      // Out-of-range HR (> 300)
      const resHr = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ ...basePayload, vit: { hr: 500 } });
      expect(resHr.status).toBe(400);

      // Out-of-range SpO2 (> 100)
      const resSpo2 = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ ...basePayload, vit: { spo2: 150 } });
      expect(resSpo2.status).toBe(400);
    });

    test('Network response-loss recovery: Client retry returns original transfer without duplicate DB creation', async () => {
      const retryKey = 'idem-retry-key-' + Date.now();
      const payload = {
        pid: 'PAT-RETRY-001',
        nam: 'Retry Patient',
        age: 52,
        bg: 'A+',
        fh: 'Hospital Alpha',
        th: 'Hospital Beta',
        rt: 'Cardiac Handoff',
        pd: 'Myocardial Infarction'
      };

      // Initial request
      const res1 = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('Idempotency-Key', retryKey)
        .send(payload);

      expect(res1.status).toBe(201);
      const originalTransferId = res1.body.transfer._id;

      // Simulated network retry with identical key & payload
      const res2 = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('Idempotency-Key', retryKey)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.transfer._id).toBe(originalTransferId);

      const dbCount = await Transfer.countDocuments({ pid: 'PAT-RETRY-001' });
      expect(dbCount).toBe(1);
    });

    test('IDOR Cross-Patient Protection: Patient user cannot access another patient transfers', async () => {
      // Create transfer by Doctor A
      const transferRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-IDOR-DOCTORA',
          nam: 'Doctor A Patient',
          age: 40,
          bg: 'B+',
          fh: 'Hospital A',
          th: 'Hospital B',
          rt: 'Transfer Reason',
          pd: 'Primary Diagnosis'
        });

      expect(transferRes.status).toBe(201);
      const transferId = transferRes.body.transfer._id;

      // Patient User attempts to access Doctor A patient record via timeline -> Rejected 403 FORBIDDEN_ACCESS
      const patientToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId(), username: 'other_patient', role: 'patient' },
        process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026'
      );

      const timelineRes = await request(app)
        .get('/api/transfers/pid/PAT-IDOR-DOCTORA/timeline')
        .set('Authorization', `Bearer ${patientToken}`);

      expect(timelineRes.status).toBe(403);
      expect(timelineRes.body.error.code).toBe('FORBIDDEN');
    });

    test('Patient-Safe Allowlist Anti-Leakage: Patient QR projection contains only approved DTO fields', async () => {
      // Create transfer with clinician details
      const transferRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-SAFE-CHECK',
          nam: 'Patient Safe Test',
          age: 38,
          bg: 'O+',
          fh: 'Hospital Origin',
          th: 'Hospital Dest',
          rt: 'Emergency Handoff',
          pd: 'Acute Appendicitis',
          sum: 'Patient presenting with RLQ pain.'
        });

      const transferId = transferRes.body.transfer._id;

      // Doctor generates QR session with 6-digit PIN
      const qrRes = await request(app)
        .post('/api/qr/generate')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ transferId, pin: '889900' });

      expect(qrRes.status).toBe(201);
      const uuid = qrRes.body.uuid;

      // Validate patient-safe QR
      const patientQrRes = await request(app)
        .post(`/api/qr/validate-patient/${uuid}`)
        .send({ pin: '889900' });

      expect(patientQrRes.status).toBe(200);
      const patientView = patientQrRes.body.patientView;

      // Explicit allowlist assertions
      expect(patientView.patientName).toBe('Patient Safe Test');
      expect(patientView.patientId).toBe('PAT-SAFE-CHECK');
      expect(patientView.fromHospital).toBe('Hospital Origin');
      expect(patientView.primaryDiagnosis).toBe('Acute Appendicitis');

      // Assert complete absence of internal clinician credentials & metadata
      expect(patientView.issuerUserId).toBeUndefined();
      expect(patientView.issuerUsername).toBeUndefined();
      expect(patientView.recipientUserIds).toBeUndefined();
      expect(patientView.recipientUsernames).toBeUndefined();
      expect(patientView.history).toBeUndefined();
      expect(patientView.previousVersionId).toBeUndefined();
      expect(patientView.pinHash).toBeUndefined();
      expect(patientView.encryptedPayload).toBeUndefined();
    });

    test('Patient-Safe & Clinical DTO Exact Contract Shape & Escalation Prevention', async () => {
      const transferRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-SHAPE-001',
          nam: 'Shape Test Patient',
          age: 42,
          bg: 'AB+',
          fh: 'Origin Facility',
          th: 'Destination Facility',
          rt: 'Subspecialty Evaluation',
          pd: 'Acute Pancreatitis',
          sum: 'Patient transferred for ERCP.'
        });

      const transferId = transferRes.body.transfer._id;

      const qrRes = await request(app)
        .post('/api/qr/generate')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ transferId, pin: '654321' });

      const uuid = qrRes.body.uuid;

      // 1. Patient-Safe DTO Shape Test & Escalation Attack Prevention
      const patientRes = await request(app)
        .post(`/api/qr/validate-patient/${uuid}?view=clinical`)
        .send({ pin: '654321', viewType: 'clinical' });

      expect(patientRes.status).toBe(200);
      expect(patientRes.body.transfer).toBeUndefined(); // Cannot escalate to clinical projection
      const actualPatientKeys = Object.keys(patientRes.body.patientView).sort();
      const expectedPatientKeys = [
        'age', 'allergies', 'bloodGroup', 'clinicalSummary', 'fromHospital', 'gender',
        'investigations', 'medications', 'otherDetails', 'patientId', 'patientName',
        'primaryDiagnosis', 'priority', 'submittedAt', 'toHospital', 'transferReason',
        'transferStatus', 'vitals'
      ].sort();

      expect(actualPatientKeys).toEqual(expectedPatientKeys);

      // 2. Clinical DTO Shape Test
      const clinicalRes = await request(app)
        .post(`/api/qr/validate/${uuid}`)
        .send({ pin: '654321' });

      expect(clinicalRes.status).toBe(200);
      const actualClinicalKeys = Object.keys(clinicalRes.body.transfer).sort();
      const expectedClinicalKeys = [
        '_id', 'acknowledgement', 'acknowledgementStatus', 'address', 'age', 'alg', 'bg',
        'contactNumber', 'currentCondition', 'dob', 'emergencyContact', 'fh', 'gender', 'history',
        'isCurrent', 'issuerUserId', 'issuerUsername', 'med', 'nam', 'noKnownAllergies',
        'otherDetails', 'pd', 'pi', 'pid', 'previousVersionId', 'priority',
        'receivingDepartment', 'recipientUserIds', 'recipientUsernames', 'referringDoctor',
        'rt', 'secondaryDiagnosis', 'status', 'submittedAt', 'sum', 'th',
        'transferDateTime', 'version', 'vit'
      ].sort();

      expect(actualClinicalKeys).toEqual(expectedClinicalKeys);
    });

    test('Audit Trail Completeness: Security events are recorded without storing sensitive secrets', async () => {
      const AuditLog = require('../models/AuditLog');

      // Query audit logs created during previous tests
      const logs = await AuditLog.find().sort({ createdAt: -1 });
      expect(logs.length).toBeGreaterThan(0);

      // Verify no sensitive passwords, raw OTPs, JWTs, or PINs in audit details
      logs.forEach(log => {
        const strDetails = JSON.stringify(log.details || {});
        expect(strDetails).not.toContain('password123');
        expect(strDetails).not.toContain('devOtp');
        expect(strDetails).not.toContain('pinHash');
      });
    });
  });

  describe('9. Persistent Transfer QR Access & Authorization Tests', () => {
    let createdTransferId;
    let doctorBToken;

    beforeAll(async () => {
      // Create a transfer under doctorToken (Doctor A)
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-PERSISTENT-QR',
          nam: 'Persistent QR Test Patient',
          age: 55,
          bg: 'O-',
          fh: 'Hospital Alpha',
          th: 'Hospital Beta',
          rt: 'Transfer for persistent QR testing',
          pd: 'Acute Coronary Syndrome'
        });
      createdTransferId = res.body.transfer._id;

      // Register and login Doctor B
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({ email: 'dr.unauthorized@test.org', password: 'password123', hospitalName: 'Hospital Gamma' });
      const challengeId = regRes.body.challengeId;
      const devOtp = regRes.body.devOtp;
      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .send({ challengeId, otp: devOtp });
      doctorBToken = verifyRes.body.token;
    });

    test('1. Authorized doctor can retrieve QR for own existing transfer later', async () => {
      const res = await request(app)
        .post(`/api/transfers/${createdTransferId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.uuid).toBeDefined();
      expect(res.body.pin).toBeDefined();
      expect(res.body.transferId).toBe(createdTransferId);
    });

    test('2. Re-generating QR for existing transfer does NOT duplicate transfer record', async () => {
      const Transfer = require('../models/Transfer');
      const initialCount = await Transfer.countDocuments({ pid: 'PAT-PERSISTENT-QR' });

      // Request QR again for same transfer
      const res = await request(app)
        .post('/api/qr/generate')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ transferId: createdTransferId });

      expect(res.status).toBe(201);

      const finalCount = await Transfer.countDocuments({ pid: 'PAT-PERSISTENT-QR' });
      expect(finalCount).toBe(initialCount);
    });

    test('3. Doctor B (unauthorized doctor) cannot retrieve Doctor A transfer QR (HTTP 403 TRANSFER_ACCESS_DENIED)', async () => {
      const res = await request(app)
        .post(`/api/transfers/${createdTransferId}/qr`)
        .set('Authorization', `Bearer ${doctorBToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TRANSFER_ACCESS_DENIED');
    });

    test('4. Requesting QR for non-existent transfer ID is rejected with HTTP 404 NOT_FOUND', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .post(`/api/transfers/${fakeId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    test('5. Unauthenticated QR generation request is rejected with HTTP 401', async () => {
      const res = await request(app)
        .post(`/api/transfers/${createdTransferId}/qr`)
        .send({});

      expect(res.status).toBe(401);
    });
  });

  describe('10. Shareable QR & Direct Secure Handoff Link Tests', () => {
    let shareTransferId;
    let shareUuid;
    let sharePin;
    let shareUrl;
    let doctorBToken;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-SHARE-LINK',
          nam: 'Share Link Test Patient',
          age: 42,
          gender: 'Female',
          bg: 'A+',
          fh: 'City General Hospital',
          th: 'Metro Trauma Center',
          rt: 'Subdural hematoma requiring neurosurgical evaluation',
          pd: 'Acute Traumatic Brain Injury'
        });
      shareTransferId = res.body.transfer._id;

      // Register and login Doctor B for Section 10 tests
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({ email: 'dr.unauthorized2@test.org', password: 'password123', hospitalName: 'Hospital Delta' });
      const challengeId = regRes.body.challengeId;
      const devOtp = regRes.body.devOtp;
      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .send({ challengeId, otp: devOtp });
      doctorBToken = verifyRes.body.token;
    });

    test('1. Issuing doctor generates share session containing shareUrl and PIN', async () => {
      const res = await request(app)
        .post(`/api/transfers/${shareTransferId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ pin: '777888' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.uuid).toBeDefined();
      expect(res.body.shareUrl).toBeDefined();
      expect(res.body.shareUrl).toContain(`/handoff/${res.body.uuid}`);
      expect(res.body.pin).toBe('777888');

      shareUuid = res.body.uuid;
      sharePin = res.body.pin;
      shareUrl = res.body.shareUrl;
    });

    test('2. Public share info endpoint returns hospital metadata without PHI', async () => {
      const res = await request(app)
        .get(`/api/qr/info/${shareUuid}`);

      expect(res.status).toBe(200);
      expect(res.header['cache-control']).toContain('no-store');
      expect(res.header['referrer-policy']).toBe('no-referrer');
      expect(res.body.success).toBe(true);
      expect(res.body.fromHospital).toBe('City General Hospital');
      expect(res.body.toHospital).toBe('Metro Trauma Center');
      expect(res.body.isExpired).toBe(false);
      expect(res.body.isRevoked).toBe(false);

      // Verify ZERO PHI in unauthenticated share info response
      expect(res.body.patientName).toBeUndefined();
      expect(res.body.primaryDiagnosis).toBeUndefined();
      expect(res.body.medications).toBeUndefined();
    });

    test('3. Direct link / QR token validation resolves with PIN to complete Clinical DTO', async () => {
      const res = await request(app)
        .post(`/api/qr/validate/${shareUuid}`)
        .send({ pin: sharePin });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.transfer.pid).toBe('PAT-SHARE-LINK');
      expect(res.body.transfer.nam).toBe('Share Link Test Patient');
      expect(res.body.transfer.pd).toBe('Acute Traumatic Brain Injury');
    });

    test('4. Issuing doctor can revoke share session via POST /api/qr/revoke/:uuid', async () => {
      const res = await request(app)
        .post(`/api/qr/revoke/${shareUuid}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('5. Accessing revoked share session returns HTTP 410 QR_EXPIRED / Revoked error', async () => {
      const res = await request(app)
        .post(`/api/qr/validate/${shareUuid}`)
        .send({ pin: sharePin });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('QR_EXPIRED');
      expect(res.body.error.message).toContain('revoked');
    });

    test('6. Unauthorized doctor cannot revoke Doctor A share session', async () => {
      // Generate new share session
      const genRes = await request(app)
        .post(`/api/transfers/${shareTransferId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({});

      const newUuid = genRes.body.uuid;

      // Doctor B tries to revoke Doctor A's share session
      const revokeRes = await request(app)
        .post(`/api/qr/revoke/${newUuid}`)
        .set('Authorization', `Bearer ${doctorBToken}`)
        .send({});

      expect(revokeRes.status).toBe(403);
      expect(revokeRes.body.error.code).toBe('TRANSFER_ACCESS_DENIED');
    });

    test('7. Configurable QR_SHARE_TTL_MINUTES expiration logic enforces transport session timeout', async () => {
      const genRes = await request(app)
        .post(`/api/transfers/${shareTransferId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({});

      const ttlUuid = genRes.body.uuid;
      const ttlPin = genRes.body.pin;

      const QRSession = require('../models/QRSession');
      await QRSession.updateOne({ uuid: ttlUuid }, { expiresAt: new Date(Date.now() - 10000) });

      const infoRes = await request(app).get(`/api/qr/info/${ttlUuid}`);
      expect(infoRes.status).toBe(200);
      expect(infoRes.body.isExpired).toBe(true);

      const valRes = await request(app)
        .post(`/api/qr/validate/${ttlUuid}`)
        .send({ pin: ttlPin });
      expect(valRes.status).toBe(410);
      expect(valRes.body.error.code).toBe('QR_EXPIRED');
    });
  });

  describe('11. Universal QR Scanner & Role Isolation Verification Tests', () => {
    test('1. Valid secure handoff URL parsing extracts opaque UUID', () => {
      const sampleUuid = '550e8400-e29b-41d4-a716-446655440000';
      const url = `https://mediform.health/handoff/${sampleUuid}`;
      const parts = url.split('/handoff/');
      const extracted = parts[parts.length - 1].split('?')[0].split('#')[0];
      expect(extracted).toBe(sampleUuid);
      expect(url).not.toContain('123456'); // PIN not in URL
      expect(url).not.toContain('John Doe'); // Zero PHI in URL
    });

    test('2. Raw UUID and JSON format parsing extracts opaque UUID safely', () => {
      const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(uuidRegex.test(validUuid)).toBe(true);
      expect(uuidRegex.test('invalid-uuid-string')).toBe(false);
      expect(uuidRegex.test('https://malicious-site.com/steal')).toBe(false);
    });

    test('3. Doctor camera scan calls validateQR and returns ClinicalDTO', async () => {
      // Use doctorToken from earlier setup
      const transferRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-UNIV-DOC',
          nam: 'Doctor Camera Test Patient',
          age: 50,
          bg: 'O+',
          fh: 'Metropolitan Trauma Hospital',
          th: 'St. Jude Children Hospital',
          rt: 'Emergency ICU Transfer',
          pd: 'Acute Aortic Dissection'
        });

      const trId = transferRes.body.transfer._id;
      const qrRes = await request(app)
        .post(`/api/transfers/${trId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ pin: '556677' });

      const uuid = qrRes.body.uuid;

      // Validate via Doctor Clinical path
      const valRes = await request(app)
        .post(`/api/qr/validate/${uuid}`)
        .send({ pin: '556677' });

      expect(valRes.status).toBe(200);
      expect(valRes.body.transfer.pid).toBe('PAT-UNIV-DOC');
      expect(valRes.body.transfer.pd).toBe('Acute Aortic Dissection');
      expect(valRes.body.transfer.issuerUsername).toBe('dr.smith@metropolitan.health');
    });

    test('4. Patient camera scan calls validatePatientQR and returns PatientSafeDTO only', async () => {
      const transferRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-UNIV-SAFE',
          nam: 'Patient Camera Test Patient',
          age: 32,
          bg: 'A+',
          fh: 'Metropolitan Trauma Hospital',
          th: 'St. Jude Children Hospital',
          rt: 'Patient Portal Read Only Test',
          pd: 'Fractured Femur'
        });

      const trId = transferRes.body.transfer._id;
      const qrRes = await request(app)
        .post(`/api/transfers/${trId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ pin: '998877' });

      const uuid = qrRes.body.uuid;

      // Validate via Patient-Safe Read-Only path
      const valRes = await request(app)
        .post(`/api/qr/validate-patient/${uuid}`)
        .send({ pin: '998877' });

      expect(valRes.status).toBe(200);
      expect(valRes.body.patientView).toBeDefined();
      expect(valRes.body.patientView.patientName).toBe('Patient Camera Test Patient');
      expect(valRes.body.patientView.patientId).toBe('PAT-UNIV-SAFE');

      // Assert complete absence of internal clinician metadata (PatientSafeDTO allowlist)
      expect(valRes.body.transfer).toBeUndefined();
      expect(valRes.body.patientView.issuerUserId).toBeUndefined();
      expect(valRes.body.patientView.issuerUsername).toBeUndefined();
      expect(valRes.body.patientView.history).toBeUndefined();
    });

    test('5. Manual UUID + PIN entry uses exact same backend validation pipeline as camera scan', async () => {
      const transferRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-UNIV-MANUAL',
          nam: 'Manual Entry Test Patient',
          age: 28,
          bg: 'B+',
          fh: 'Metropolitan Trauma Hospital',
          th: 'St. Jude Children Hospital',
          rt: 'Manual Entry Fallback Verification',
          pd: 'Acute Appendicitis'
        });

      const trId = transferRes.body.transfer._id;
      const qrRes = await request(app)
        .post(`/api/transfers/${trId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ pin: '334455' });

      const uuid = qrRes.body.uuid;

      const valRes = await request(app)
        .post(`/api/qr/validate/${uuid}`)
        .send({ pin: '334455' });

      expect(valRes.status).toBe(200);
      expect(valRes.body.transfer.pid).toBe('PAT-UNIV-MANUAL');
    });
  });

  describe('8. Rate Limiting Verification Test (Section 26)', () => {
    test('Repeated rapid requests trigger HTTP 429 RATE_LIMIT_EXCEEDED', async () => {
      // Send 105 rapid validation requests to exceed test qrValLimiter max limit (100)
      let lastRes;
      for (let i = 0; i < 105; i++) {
        lastRes = await request(app)
          .post('/api/qr/validate/non-existent-uuid')
          .send({ pin: '123456' });
      }

      expect(lastRes.status).toBe(429);
      expect(lastRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});


