const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');
const Transfer = require('../models/Transfer');
const AuditLog = require('../models/AuditLog');

jest.setTimeout(60000);

let mongoServer;
let doctorToken;
let doctorUser;
let patientToken;
let patientUser;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // 1. Create Verified Doctor Account
  const docReg = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.referral@metropolitan.health',
      name: 'Dr. Jane Referral',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital'
    });

  const docVerify = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docReg.body.challengeId, otp: docReg.body.devOtp });

  doctorToken = docVerify.body.token;
  doctorUser = docVerify.body.user;

  // 2. Create Patient Account
  patientUser = await User.create({
    email: 'patient.referral@mediform.org',
    username: 'PAT-REF-2026',
    password: 'password123',
    role: 'patient',
    isEmailVerified: true
  });

  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';
  patientToken = jwt.sign(
    { userId: patientUser._id, username: patientUser.username, role: 'patient', tokenVersion: 0 },
    secret,
    { expiresIn: '1h' }
  );
}, 60000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}, 60000);

describe('Phase 1: Screening-to-Referral Integration Test Suite', () => {

  let normalScreening;
  let flaggedScreening;
  let noConsentScreening;

  describe('1. Screening Creation & Automated CDS Flagging', () => {
    test('Normal screening is classified as LOW risk, isFlagged: false, and does NOT auto-create a referral', async () => {
      const res = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-REF-2026',
          patientName: 'John Normal',
          age: 35,
          gender: 'Male',
          bloodGroup: 'O+',
          vitals: {
            hr: 75,
            bp: '120/80',
            rr: 16,
            spo2: 98,
            temp: 36.8,
            gcs: 15
          },
          investigations: [
            { name: 'CBC', status: 'Completed', notes: 'Normal counts' }
          ],
          clinicalNotes: 'Routine wellness screening.'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.screening.evaluation.isFlagged).toBe(false);
      expect(res.body.screening.evaluation.riskLevel).toBe('LOW');
      expect(res.body.screening.evaluation.news2Score).toBe(0);
      expect(res.body.screening.activeReferralId).toBeNull();

      normalScreening = res.body.screening;

      // Verify no referral was automatically created in the database
      const referralCount = await Referral.countDocuments({ sourceScreeningRef: normalScreening._id });
      expect(referralCount).toBe(0);
    });

    test('Screening with high NEWS2 (score >= 7) is classified as HIGH RISK and isFlagged: true', async () => {
      const res = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-REF-2026',
          patientName: 'Jane Severe',
          age: 62,
          gender: 'Female',
          bloodGroup: 'A+',
          vitals: {
            hr: 135,       // +3
            bp: '85/55',    // SBP 85 -> +3
            rr: 26,        // +3
            spo2: 90,      // +3
            temp: 39.2,    // +2
            gcs: 13        // < 15 -> +3
          },
          investigations: [
            { name: 'Chest X-Ray', status: 'Abnormal', notes: 'Bilateral infiltrate in lower lobes' }
          ],
          clinicalNotes: 'Acute respiratory distress and hypotension.'
        });

      expect(res.status).toBe(201);
      expect(res.body.screening.evaluation.isFlagged).toBe(true);
      expect(res.body.screening.evaluation.riskLevel).toBe('HIGH');
      expect(res.body.screening.evaluation.news2Score).toBeGreaterThanOrEqual(7);
      expect(res.body.screening.evaluation.flagReasons.length).toBeGreaterThan(0);
      expect(res.body.screening.evaluation.recommendedPriority).toBe('Emergency');

      flaggedScreening = res.body.screening;
    });

    test('Phase 8.1 NEWS2 Regression: Standard synthetic vitals profile produces exact aggregate score 12', async () => {
      // Synthetic Input Profile:
      // - Respiratory rate: 28 (Score 3)
      // - SpO2: 91% (Score 3)
      // - Supplemental oxygen: No (Score 0)
      // - Heart rate: 122 (Score 2)
      // - Systolic BP: 88 (Score 3)
      // - Temperature: 38.8°C (Score 1)
      // - Consciousness: Alert (Score 0)
      // - SpO2 Scale: 1
      // Expected Aggregate Score: 3 + 3 + 0 + 2 + 3 + 1 + 0 = 12

      const res = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-NEWS2-EXACT',
          patientName: 'NEWS2 Verification Patient',
          age: 50,
          gender: 'Female',
          vitals: {
            rr: 28,
            spo2: 91,
            hr: 122,
            bp: '88/58',
            temp: 38.8,
            consciousness: 'Alert'
          },
          clinicalNotes: 'NEWS2 verification screening'
        });

      expect(res.status).toBe(201);
      const evalData = res.body.screening.evaluation;
      expect(evalData.isFlagged).toBe(true);
      expect(evalData.riskLevel).toBe('HIGH');
      expect(evalData.news2Score).toBe(12);

      // Verify individual component breakdown via cdsService directly
      const cdsService = require('../services/cdsService');
      const directEval = cdsService.calculateNEWS2({
        rr: 28,
        spo2: 91,
        hr: 122,
        bp: '88/58',
        temp: 38.8,
        consciousness: 'Alert'
      });
      expect(directEval.score).toBe(12);
      expect(directEval.riskLevel).toBe('HIGH');

      const rrItem = directEval.breakdown.find(b => b.metric === 'Resp Rate');
      expect(rrItem).toBeDefined();
      expect(rrItem.score).toBe(3);

      const spo2Item = directEval.breakdown.find(b => b.metric === 'SpO2');
      expect(spo2Item).toBeDefined();
      expect(spo2Item.score).toBe(3);

      const bpItem = directEval.breakdown.find(b => b.metric === 'Systolic BP');
      expect(bpItem).toBeDefined();
      expect(bpItem.score).toBe(3);

      const hrItem = directEval.breakdown.find(b => b.metric === 'Heart Rate');
      expect(hrItem).toBeDefined();
      expect(hrItem.score).toBe(2);

      const tempItem = directEval.breakdown.find(b => b.metric === 'Temp');
      expect(tempItem).toBeDefined();
      expect(tempItem.score).toBe(1);

      const consciousnessItem = directEval.breakdown.find(b => b.metric === 'Consciousness' || b.metric === 'GCS');
      expect(consciousnessItem).toBeDefined();
      expect(consciousnessItem.score).toBe(0);
    });

    test('Screening with abnormal investigation is flagged even with normal vitals', async () => {
      const res = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-LAB-99',
          patientName: 'Mark Lab',
          age: 44,
          vitals: { hr: 72, bp: '120/80', rr: 16, spo2: 98, temp: 36.6, gcs: 15 },
          investigations: [
            { name: 'CT Head', status: 'Abnormal', notes: 'Subdural hematoma suspected' }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.screening.evaluation.isFlagged).toBe(true);
      expect(res.body.screening.evaluation.flagReasons).toEqual(
        expect.arrayContaining([expect.stringContaining('Abnormal Investigation: CT Head')])
      );
    });

    test('Screening with patient consent withheld is recorded as consentGiven: false', async () => {
      const res = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-NOCONSENT',
          patientName: 'No Consent Patient',
          age: 50,
          vitals: { hr: 135, bp: '85/55', rr: 26, spo2: 90, temp: 39.2, gcs: 13 },
          patientConsent: { consentGiven: false }
        });

      expect(res.status).toBe(201);
      expect(res.body.screening.patientConsent.consentGiven).toBe(false);
      noConsentScreening = res.body.screening;
    });
  });

  describe('2. Reviewing Screenings', () => {
    test('Authorized doctor can review flagged screenings via /api/screenings/flagged', async () => {
      const res = await request(app)
        .get('/api/screenings/flagged')
        .set('Authorization', `Bearer ${doctorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.screenings.length).toBeGreaterThan(0);
      res.body.screenings.forEach(s => {
        expect(s.evaluation.isFlagged).toBe(true);
      });
    });

    test('Authorized doctor can retrieve single screening and audit review is recorded', async () => {
      const res = await request(app)
        .get(`/api/screenings/${flaggedScreening.screeningId}`)
        .set('Authorization', `Bearer ${doctorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.screening.screeningId).toBe(flaggedScreening.screeningId);

      const reviewAudit = await AuditLog.findOne({
        action: 'SCREENING_REVIEWED',
        'details.screeningId': flaggedScreening.screeningId
      });
      expect(reviewAudit).not.toBeNull();
    });
  });

  describe('3. Referral Creation & Relationship to Screening', () => {
    let createdReferral;

    test('Attempting to create referral from a normal (unflagged) screening is rejected (HTTP 400)', async () => {
      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          sourceScreeningId: normalScreening.screeningId,
          clinicalReason: 'Unnecessary transfer for normal patient'
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SCREENING_NOT_FLAGGED');
    });

    test('Attempting to create referral without patient consent is rejected (HTTP 403 CONSENT_REQUIRED)', async () => {
      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          sourceScreeningId: noConsentScreening.screeningId,
          clinicalReason: 'Transfer without patient consent'
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    });

    test('Unauthorized user (patient role) cannot create a referral (HTTP 403 FORBIDDEN_ROLE)', async () => {
      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          sourceScreeningId: flaggedScreening.screeningId,
          clinicalReason: 'Patient attempting to self-refer'
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    });

    test('Unauthenticated user cannot create a referral (HTTP 401 UNAUTHORIZED)', async () => {
      const res = await request(app)
        .post('/api/referrals')
        .send({
          sourceScreeningId: flaggedScreening.screeningId,
          clinicalReason: 'Anonymous referral'
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('Authorized doctor successfully creates referral directly from flagged screening', async () => {
      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          sourceScreeningId: flaggedScreening.screeningId,
          clinicalReason: 'Acute sepsis secondary to severe bilateral pneumonia with hemodynamic instability',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Academic Medical Center',
          receivingDepartment: 'Medical ICU'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const ref = res.body.referral;
      expect(ref.referralId).toMatch(/^REF-\d{4}-\d{6}$/);
      expect(ref.patientId).toBe(flaggedScreening.pid);
      expect(ref.sourceScreeningId).toBe(flaggedScreening.screeningId);
      expect(ref.referringDoctorId).toBe((doctorUser.id || doctorUser._id).toString());
      expect(ref.clinicalReason).toContain('Acute sepsis');
      expect(ref.priority).toBe('Emergency');
      expect(ref.status).toBe('PENDING');
      expect(ref.relevantScreeningResult.news2Score).toBe(flaggedScreening.evaluation.news2Score);
      expect(ref.createdAt).toBeDefined();

      // Check linked transfer record created for existing handoff
      expect(res.body.transfer).toBeDefined();
      expect(res.body.transfer.pid).toBe(flaggedScreening.pid);
      expect(res.body.transfer.priority).toBe('Emergency');

      createdReferral = ref;
    });

    test('Originating screening maintains verifiable relationship with active referral', async () => {
      const updatedScreening = await Screening.findOne({ screeningId: flaggedScreening.screeningId });

      expect(updatedScreening.activeReferralId.toString()).toBe(createdReferral._id.toString());
      expect(updatedScreening.referralHistory.map(id => id.toString())).toContain(createdReferral._id.toString());
    });

    test('Duplicate active referral for the same screening is rejected by default (HTTP 409 ACTIVE_REFERRAL_EXISTS)', async () => {
      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          sourceScreeningId: flaggedScreening.screeningId,
          clinicalReason: 'Attempting duplicate referral without authorization'
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ACTIVE_REFERRAL_EXISTS');
      expect(res.body.error.existingReferralId).toBe(createdReferral.referralId);
    });

    test('Duplicate referral can be created when explicitly authorized (allowDuplicate: true)', async () => {
      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          sourceScreeningId: flaggedScreening.screeningId,
          clinicalReason: 'Secondary concurrent referral to ECMO center requested by attending intensivist',
          allowDuplicate: true,
          duplicateAuthorizationReason: 'Patient requires simultaneous cardiothoracic ECMO evaluation'
        });

      expect(res.status).toBe(201);
      expect(res.body.referral.isDuplicateAuthorized).toBe(true);

      const audit = await AuditLog.findOne({
        action: 'DUPLICATE_REFERRAL_EXPLICITLY_AUTHORIZED',
        'details.sourceScreeningId': flaggedScreening.screeningId
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('4. Handoff QR/PIN Integration & Access Controls', () => {
    let testReferral;

    beforeAll(async () => {
      // Create a fresh flagged screening and referral for QR test
      const scrRes = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          pid: 'PAT-QR-TEST',
          patientName: 'QR Test Patient',
          age: 49,
          vitals: { hr: 130, bp: '85/50', rr: 28, spo2: 89, temp: 39.5, gcs: 14 },
          clinicalNotes: 'Severe sepsis'
        });

      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          sourceScreeningId: scrRes.body.screening.screeningId,
          clinicalReason: 'Septic shock requiring intensive care',
          priority: 'Emergency'
        });

      testReferral = refRes.body.referral;
    });

    test('Doctor can generate encrypted Handoff QR for referral with custom or auto PIN', async () => {
      const res = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ pin: '556677' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.qrSession.uuid).toBeDefined();
      expect(res.body.qrSession.pin).toBe('556677');
      expect(res.body.qrSession.shareUrl).toContain(res.body.qrSession.uuid);

      // Verify QR audit trail
      const audit = await AuditLog.findOne({
        action: 'REFERRAL_QR_GENERATED',
        'details.referralId': testReferral.referralId
      });
      expect(audit).not.toBeNull();
    });

    test('Receiving doctor validates QR using UUID and 6-digit PIN to access clinical DTO', async () => {
      const qrRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/qr`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ pin: '889900' });

      const uuid = qrRes.body.qrSession.uuid;

      // Receiving doctor validates PIN
      const valRes = await request(app)
        .post(`/api/qr/validate/${uuid}`)
        .send({ pin: '889900' });

      expect(valRes.status).toBe(200);
      expect(valRes.body.success).toBe(true);
      expect(valRes.body.transfer.pid).toBe('PAT-QR-TEST');
      expect(valRes.body.transfer.nam).toBe('QR Test Patient');
      expect(valRes.body.transfer.rt).toContain('Septic shock');
      expect(valRes.body.transfer.priority).toBe('Emergency');

      // Verify patient-safe view also works without disclosing doctor user credentials
      const patRes = await request(app)
        .post(`/api/qr/validate-patient/${uuid}`)
        .send({ pin: '889900' });

      expect(patRes.status).toBe(200);
      expect(patRes.body.patientView.patientName).toBe('QR Test Patient');
      expect(patRes.body.patientView.issuerUserId).toBeUndefined();
    });
  });

  describe('5. IDOR & Access Control Security Tests', () => {
    test('Patient cannot view another patient screening record (IDOR Protection)', async () => {
      // Patient has username PAT-REF-2026. Try to view PAT-LAB-99
      const otherScreening = await Screening.findOne({ pid: 'PAT-LAB-99' });

      const res = await request(app)
        .get(`/api/screenings/${otherScreening.screeningId}`)
        .set('Authorization', `Bearer ${patientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_RECORD_ACCESS');
    });

    test('Patient can view their own screening record', async () => {
      const myScreening = await Screening.findOne({ pid: 'PAT-REF-2026' });

      const res = await request(app)
        .get(`/api/screenings/${myScreening.screeningId}`)
        .set('Authorization', `Bearer ${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.screening.pid).toBe('PAT-REF-2026');
    });

    test('Patient cannot view another patient referral record (IDOR Protection)', async () => {
      const otherReferral = await Referral.findOne({ patientId: 'PAT-QR-TEST' });

      const res = await request(app)
        .get(`/api/referrals/${otherReferral.referralId}`)
        .set('Authorization', `Bearer ${patientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_RECORD_ACCESS');
    });
  });

  describe('6. Referral Status Workflow', () => {
    test('Authorized doctor can update referral status to ACCEPTED or COMPLETED', async () => {
      const ref = await Referral.findOne();

      const res = await request(app)
        .patch(`/api/referrals/${ref.referralId}/status`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ status: 'ACCEPTED', notes: 'Bed confirmed in ICU' });

      expect(res.status).toBe(200);
      expect(res.body.referral.status).toBe('ACCEPTED');

      const audit = await AuditLog.findOne({
        action: 'REFERRAL_STATUS_UPDATED',
        'details.referralId': ref.referralId,
        'details.newStatus': 'ACCEPTED'
      });
      expect(audit).not.toBeNull();
    });
  });

});
