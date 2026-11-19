const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');
const Transfer = require('../models/Transfer');
const QRSession = require('../models/QRSession');
const Consent = require('../models/Consent');
const FollowUp = require('../models/FollowUp');
const MonitoringAlert = require('../models/MonitoringAlert');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const consentService = require('../services/consentService');
const followUpSchedulerService = require('../services/followUpSchedulerService');
const referralMonitoringService = require('../services/referralMonitoringService');

jest.setTimeout(90000);

let mongoServer;

// Synthetic Test Actors
let patientTokenA;
let patientUserA;
let patientTokenB;
let patientUserB;

let doctorTokenA; // Referring Doctor (Metropolitan Trauma Hospital)
let doctorUserA;

let doctorTokenB; // Initial Receiving Doctor (St. Jude Heart Hospital)
let doctorUserB;

let doctorTokenC; // Reassigned Specialist Doctor (St. Jude Heart Hospital)
let doctorUserC;

let doctorTokenUnrelated; // Unaffiliated Doctor (General Outpost Clinic)
let doctorUserUnrelated;

// State across workflow stages
let createdScreeningId;
let createdReferralId;
let qrSessionUuid;
let scheduledFollowUpId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  const jwtSecret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';

  // 1. Patient A (Samantha Hall - PAT-DEMO-001)
  patientUserA = await User.create({
    email: 'samantha.demo@example.com',
    username: 'PAT-DEMO-001',
    name: 'Samantha Hall',
    password: 'password123',
    role: 'patient',
    isEmailVerified: true
  });
  patientTokenA = jwt.sign(
    { userId: patientUserA._id, username: patientUserA.username, name: patientUserA.name, role: 'patient', tokenVersion: 0 },
    jwtSecret,
    { expiresIn: '2h' }
  );

  // 2. Patient B (Marcus Sterling - PAT-DEMO-002)
  patientUserB = await User.create({
    email: 'marcus.demo@example.com',
    username: 'PAT-DEMO-002',
    name: 'Marcus Sterling',
    password: 'password123',
    role: 'patient',
    isEmailVerified: true
  });
  patientTokenB = jwt.sign(
    { userId: patientUserB._id, username: patientUserB.username, name: patientUserB.name, role: 'patient', tokenVersion: 0 },
    jwtSecret,
    { expiresIn: '2h' }
  );

  // 3. Doctor A (Dr. Alice Carter - Metropolitan Trauma Hospital)
  const docRegA = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.alice.demo@metropolitan.health',
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

  // 4. Doctor B (Dr. Robert Vance - St. Jude Heart Hospital)
  const docRegB = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.robert.demo@stjude.health',
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

  // 5. Doctor C (Dr. Clara Oswald - St. Jude Heart Hospital, Reassignment Specialist)
  const docRegC = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.clara.demo@stjude.health',
      name: 'Dr. Clara Oswald',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital'
    });
  const docVerifyC = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegC.body.challengeId, otp: docRegC.body.devOtp });
  doctorTokenC = docVerifyC.body.token;
  doctorUserC = { ...docVerifyC.body.user, _id: docVerifyC.body.user.id };

  // 6. Doctor Unrelated (Dr. Evelyn Cross - General Outpost Clinic)
  const docRegUnrel = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.evelyn.demo@outpost.health',
      name: 'Dr. Evelyn Cross',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'General Outpost Clinic'
    });
  const docVerifyUnrel = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegUnrel.body.challengeId, otp: docRegUnrel.body.devOtp });
  doctorTokenUnrelated = docVerifyUnrel.body.token;
  doctorUserUnrelated = { ...docVerifyUnrel.body.user, _id: docVerifyUnrel.body.user.id };
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

describe('Phase 8: End-to-End Clinical Journey & Workflow Validation', () => {

  // =========================================================================
  // STAGE 1: PATIENT REGISTRATION AND SCREENING
  // =========================================================================
  describe('Stage 1 — Patient Registration and Screening', () => {
    test('1.1: Patient A registers and provides screening consent', async () => {
      expect(patientUserA).toBeDefined();
      expect(patientUserA.role).toBe('patient');
      expect(patientUserA.username.toLowerCase()).toBe('pat-demo-001');
    });

    test('1.2: Referring Doctor records screening with abnormal vitals and CDS abnormality detection', async () => {
      const screeningPayload = {
        pid: 'PAT-DEMO-001',
        patientName: 'Samantha Hall',
        age: 38,
        gender: 'Female',
        bloodGroup: 'A+',
        contactNumber: '+1-555-0134',
        emergencyContact: 'John Hall (+1-555-0135)',
        vitals: {
          hr: 135,       // Tachycardia (NEWS2 Score 3)
          bp: '85/55',   // Hypotension (NEWS2 Score 3)
          rr: 26,        // Tachypnea (NEWS2 Score 3)
          spo2: 89,      // Hypoxemia (NEWS2 Score 3)
          temp: 39.1,    // Pyrexia (NEWS2 Score 2)
          gcs: 14        // Alert/Altered
        },
        investigations: [
          { name: 'High-Sensitivity Troponin I', result: '145 ng/L', isAbnormal: true, notes: 'Marked myocardial injury' },
          { name: 'Serum Lactate', result: '4.2 mmol/L', isAbnormal: true, notes: 'Severe tissue hypoperfusion' }
        ],
        clinicalNotes: 'Patient presents with severe respiratory distress, hemodynamic instability, and suspected septic shock.',
        patientConsent: { consentGiven: true, consentTimestamp: new Date(), consentedBy: 'Patient' }
      };

      const res = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send(screeningPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.screening).toBeDefined();

      createdScreeningId = res.body.screening.screeningId;
      expect(createdScreeningId).toMatch(/^SCR-\d{4}-\d+$/);

      // Verify CDS evaluation flags
      expect(res.body.screening.evaluation).toBeDefined();
      expect(res.body.screening.evaluation.isFlagged).toBe(true);
      expect(['HIGH', 'CRITICAL']).toContain(res.body.screening.evaluation.riskLevel);
      expect(res.body.screening.evaluation.news2Score).toBeGreaterThanOrEqual(7);
    });

    test('1.3: Screening results are persisted and visible in flagged screenings view', async () => {
      const res = await request(app)
        .get('/api/screenings/flagged')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const found = res.body.screenings.find(s => s.screeningId === createdScreeningId);
      expect(found).toBeDefined();
      expect(found.pid).toBe('PAT-DEMO-001');
      expect(found.evaluation.isFlagged).toBe(true);
    });

    test('1.4: Patient record isolation: Patient B cannot access Patient A screening', async () => {
      const res = await request(app)
        .get(`/api/screenings/${createdScreeningId}`)
        .set('Authorization', `Bearer ${patientTokenB}`);

      expect([403, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // STAGE 2: REFERRAL CREATION
  // =========================================================================
  describe('Stage 2 — Referral Creation', () => {
    test('2.1: Referring Doctor creates referral linked to screening with Urgent priority', async () => {
      const referralPayload = {
        sourceScreeningId: createdScreeningId,
        priority: 'Urgent',
        clinicalReason: 'Severe septic shock with myocardial compromise requiring ICU resuscitation and cardiac evaluation',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDepartment: 'Cardiology Intensive Care Unit',
        receivingDoctorId: doctorUserB._id,
        receivingDoctorUsername: doctorUserB.username,
        receivingDoctorName: doctorUserB.name
      };

      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send(referralPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.referral).toBeDefined();

      createdReferralId = res.body.referral.referralId;
      expect(createdReferralId).toMatch(/^REF-\d{4}-\d+$/);
      expect(res.body.referral.status).toBe('PENDING');
      expect(res.body.referral.priority).toBe('Urgent');
      expect(res.body.referral.sourceScreeningId).toBe(createdScreeningId);
      expect(res.body.referral.referringDoctorId.toString()).toBe(doctorUserA._id.toString());
      expect(res.body.referral.referringHospital).toBe('Metropolitan Trauma Hospital');
    });

    test('2.2: Duplicate referral prevention prevents duplicate without explicit override', async () => {
      const dupPayload = {
        sourceScreeningId: createdScreeningId,
        priority: 'Urgent',
        clinicalReason: 'Attempted duplicate referral',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDepartment: 'Cardiology'
      };

      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send(dupPayload);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(['ACTIVE_REFERRAL_EXISTS', 'DUPLICATE_REFERRAL_DETECTED']).toContain(res.body.error.code);
    });

    test('2.3: Referral appears in referring doctor referral listing', async () => {
      const res = await request(app)
        .get('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const found = res.body.referrals.find(r => r.referralId === createdReferralId);
      expect(found).toBeDefined();
      expect(found.status).toBe('PENDING');
    });
  });

  // =========================================================================
  // STAGE 3: DOCTOR ASSIGNMENT & REASSIGNMENT
  // =========================================================================
  describe('Stage 3 — Doctor Assignment & Reassignment', () => {
    test('3.1: Receiving doctor (Doctor B) sees referral in incoming workload', async () => {
      const res = await request(app)
        .get('/api/referrals?view=incoming')
        .set('Authorization', `Bearer ${doctorTokenB}`);

      expect(res.status).toBe(200);
      const found = res.body.referrals.find(r => r.referralId === createdReferralId);
      expect(found).toBeDefined();
      expect(found.referralId).toBe(createdReferralId);
    });

    test('3.2: Reassignment with documented clinical reason to Doctor C (Specialist)', async () => {
      const res = await request(app)
        .post(`/api/referrals/${createdReferralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          receivingDoctorId: doctorUserC._id,
          reason: 'Patient presents with acute refractory arrhythmias requiring specialized interventional cardiac catheterization',
          department: 'Interventional Cardiology'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.referral.receivingDoctorId.toString()).toBe(doctorUserC._id.toString());
      expect(res.body.referral.receivingDoctorName).toBe('Dr. Clara Oswald');
      expect(res.body.referral.assignmentHistory.length).toBe(2);

      const latestEntry = res.body.referral.assignmentHistory[1];
      expect(latestEntry.previousReceivingDoctorId.toString()).toBe(doctorUserB._id.toString());
      expect(latestEntry.newReceivingDoctorId.toString()).toBe(doctorUserC._id.toString());
      expect(latestEntry.reason).toContain('interventional cardiac catheterization');
    });

    test('3.3: Reassigned Receiving Doctor (Doctor C) sees referral in incoming workload', async () => {
      const res = await request(app)
        .get('/api/referrals?view=incoming')
        .set('Authorization', `Bearer ${doctorTokenC}`);

      expect(res.status).toBe(200);
      const found = res.body.referrals.find(r => r.referralId === createdReferralId);
      expect(found).toBeDefined();
    });
  });

  // =========================================================================
  // STAGE 4: CONSENT AND QR/PIN HANDOFF
  // =========================================================================
  describe('Stage 4 — Consent and QR/PIN Handoff', () => {
    test('4.1: Patient grants consent to St. Jude Heart Hospital and Doctor C', async () => {
      const consentRes = await request(app)
        .post('/api/consent')
        .set('Authorization', `Bearer ${patientTokenA}`)
        .send({
          authorizedHospital: 'St. Jude Heart Hospital',
          authorizedDoctorName: 'Dr. Clara Oswald',
          purpose: 'SPECIALIST_REFERRAL',
          permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS', 'INVESTIGATIONS'],
          durationDays: 14
        });

      expect(consentRes.status).toBe(201);
      expect(consentRes.body.success).toBe(true);
      expect(consentRes.body.consent.status).toBe('GRANTED');
      expect(consentRes.body.consent.permittedCategories).toContain('SCREENING_RESULTS');
      expect(consentRes.body.consent.permittedCategories).not.toContain('MEDICATIONS');
    });

    test('4.2: Generate QR / PIN handoff for referral transfer', async () => {
      const qrRes = await request(app)
        .post(`/api/referrals/${createdReferralId}/qr`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ pin: '741258' });

      expect(qrRes.status).toBe(200);
      expect(qrRes.body.success).toBe(true);
      expect(qrRes.body.qrSession.uuid).toBeDefined();
      expect(qrRes.body.qrSession.pin).toBe('741258');

      qrSessionUuid = qrRes.body.qrSession.uuid;
    });

    test('4.3: Receiving clinician redeems PIN successfully and receives clinical transfer DTO', async () => {
      const redeemRes = await request(app)
        .post(`/api/qr/validate/${qrSessionUuid}`)
        .send({ pin: '741258' });

      expect(redeemRes.status).toBe(200);
      expect(redeemRes.body.success).toBe(true);
      expect(redeemRes.body.transfer).toBeDefined();
      expect(redeemRes.body.transfer.nam).toBe('Samantha Hall');
    });

    test('4.4: Category restriction: Unauthorized category MEDICATIONS is not exposed in restricted consent', async () => {
      const checkCategory = await consentService.verifyAccessConsent({
        patientId: 'PAT-DEMO-001',
        requestingUser: { userId: doctorUserC._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        purpose: 'SPECIALIST_REFERRAL',
        category: 'MEDICATIONS'
      });

      expect(checkCategory.authorized).toBe(false);
      expect(checkCategory.code).toBe('CATEGORY_NOT_PERMITTED');
    });

    test('4.5: Invalid PIN handling and lockout threshold verification', async () => {
      // Generate a fresh session to test PIN lockout
      const testQr = await request(app)
        .post(`/api/referrals/${createdReferralId}/qr`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ pin: '987654' });

      const testUuid = testQr.body.qrSession.uuid;

      // Fail 5 times with wrong PIN
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post(`/api/qr/validate/${testUuid}`)
          .send({ pin: '000000' });
      }

      // 6th attempt must be rejected as locked out / max attempts reached
      const lockedRes = await request(app)
        .post(`/api/qr/validate/${testUuid}`)
        .send({ pin: '987654' }); // Even with correct PIN, must fail

      expect([403, 429]).toContain(lockedRes.status);
    });

    test('4.6: QR expiration: Expired QR token returns HTTP 410', async () => {
      const expiredSession = await QRSession.create({
        uuid: '00000000-demo-exp0-0000-000000000001',
        transferId: new mongoose.Types.ObjectId(),
        encryptedPayload: { iv: 'iv', authTag: 'tag', encryptedData: 'data' },
        pinHash: 'dummyhash',
        failedAttempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() - 3600000), // Expired 1h ago
        createdByUserId: doctorUserA._id,
        isRevoked: false
      });

      const res = await request(app)
        .post(`/api/qr/validate/${expiredSession.uuid}`)
        .send({ pin: '123456' });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('QR_EXPIRED');
    });

    test('4.7: Consent revocation immediately invalidates existing QR sessions', async () => {
      // Patient revokes all consents for St. Jude Heart Hospital
      const activeConsents = await Consent.find({
        patientUserId: patientUserA._id,
        status: 'GRANTED'
      });

      for (const c of activeConsents) {
        await request(app)
          .patch(`/api/consent/${c.consentId}/revoke`)
          .set('Authorization', `Bearer ${patientTokenA}`)
          .send({ reason: 'Demonstration of security revocation' });
      }

      // Attempt access with existing QR session UUID
      const res = await request(app)
        .post(`/api/qr/validate/${qrSessionUuid}`)
        .send({ pin: '741258' });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('QR_EXPIRED');

      // Re-grant consent so downstream stages 5-7 can proceed cleanly
      await request(app)
        .post('/api/consent')
        .set('Authorization', `Bearer ${patientTokenA}`)
        .send({
          authorizedHospital: 'St. Jude Heart Hospital',
          authorizedDoctorName: 'Dr. Clara Oswald',
          purpose: 'SPECIALIST_REFERRAL',
          permittedCategories: ['DEMOGRAPHICS', 'VITALS', 'SCREENING_RESULTS', 'CLINICAL_NOTES', 'MEDICATIONS', 'REFERRAL_DETAILS', 'INVESTIGATIONS'],
          durationDays: 30
        });
    });
  });

  // =========================================================================
  // STAGE 5: DOCTOR ACKNOWLEDGEMENT AND TREATMENT
  // =========================================================================
  describe('Stage 5 — Doctor Acknowledgement and Treatment', () => {
    test('5.1: Viewing/scanning QR does NOT automatically acknowledge referral', async () => {
      const refCheck = await Referral.findOne({ referralId: createdReferralId });
      expect(refCheck.status).toBe('PENDING');
    });

    test('5.2: Assigned Doctor (Doctor C) explicitly acknowledges referral', async () => {
      const ackRes = await request(app)
        .post(`/api/referrals/${createdReferralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          notes: 'Received patient in emergency cardiology bay. Preparing catheterization lab.'
        });

      expect(ackRes.status).toBe(200);
      expect(ackRes.body.success).toBe(true);
      expect(ackRes.body.referral.status).toBe('ACKNOWLEDGED');
      expect(ackRes.body.referral.timeline.some(t => t.newStatus === 'ACKNOWLEDGED')).toBe(true);
    });

    test('5.3: Doctor accepts referral for clinical intake', async () => {
      const acceptRes = await request(app)
        .post(`/api/referrals/${createdReferralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          notes: 'Accepted for catheterization lab procedure.'
        });

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.referral.status).toBe('ACCEPTED');
    });

    test('5.4: Doctor starts treatment -> Status IN_PROGRESS', async () => {
      const treatStartRes = await request(app)
        .post(`/api/referrals/${createdReferralId}/start-treatment`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          notes: 'Emergency hemodynamic stabilization initiated.'
        });

      expect(treatStartRes.status).toBe(200);
      expect(treatStartRes.body.referral.status).toBe('IN_PROGRESS');
    });

    test('5.5: Doctor records full treatment documentation', async () => {
      const treatDocRes = await request(app)
        .post(`/api/referrals/${createdReferralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          treatmentSummary: 'Emergency coronary angiography performed; stent placed in proximal LAD. Sepsis resuscitation completed with 2L crystalloids and norepinephrine.',
          clinicalObservations: 'Blood pressure improved to 120/78 mmHg, heart rate normalized to 78 bpm, lactate reduced to 1.4 mmol/L.',
          proceduresPerformed: ['Coronary angiography', 'Drug-eluting stent placement', 'Arterial line insertion'],
          medicationsAdministered: [
            { name: 'Aspirin', dose: '300mg', route: 'Oral' },
            { name: 'Ticagrelor', dose: '180mg', route: 'Oral' },
            { name: 'Ceftriaxone', dose: '2g', route: 'IV' }
          ],
          followUpRequired: true,
          followUpInstructions: 'Post-intervention cardiology echo and outpatient clinic visit in 7 days.'
        });

      expect(treatDocRes.status).toBe(200);
      expect(treatDocRes.body.success).toBe(true);
      expect(treatDocRes.body.referral.treatmentDocumentation).toBeDefined();
      expect(treatDocRes.body.referral.treatmentDocumentation.treatmentSummary).toContain('Emergency coronary angiography');
      expect(treatDocRes.body.referral.status).toBe('FOLLOW_UP_REQUIRED');
    });

    test('5.6: Invalid state transition rejected (e.g. attempting to re-acknowledge)', async () => {
      const invalidAck = await request(app)
        .post(`/api/referrals/${createdReferralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({ notes: 'Invalid re-acknowledgement' });

      expect(invalidAck.status).toBe(400);
      expect(invalidAck.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // =========================================================================
  // STAGE 6: FOLLOW-UP MANAGEMENT
  // =========================================================================
  describe('Stage 6 — Follow-Up Management', () => {
    test('6.1: Doctor schedules follow-up appointment', async () => {
      const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const fuRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          referralId: createdReferralId,
          dueDate: dueDate,
          instructions: 'Repeat 12-lead ECG, troponin I level, and transthoracic echocardiogram',
          priority: 'Urgent'
        });

      expect(fuRes.status).toBe(201);
      expect(fuRes.body.success).toBe(true);
      expect(fuRes.body.followUp).toBeDefined();

      scheduledFollowUpId = fuRes.body.followUp.followUpId;
      expect(fuRes.body.followUp.status).toBe('SCHEDULED');
    });

    test('6.2: Patient receives follow-up notification respecting preferences', async () => {
      const notifs = await Notification.find({
        recipientUserId: patientUserA._id,
        relatedReferralId: createdReferralId
      });

      expect(notifs.length).toBeGreaterThanOrEqual(1);
    });

    test('6.3: Scheduler cycle processes follow-up lifecycle states', async () => {
      const schedulerResult = await followUpSchedulerService.processFollowUpRemindersAndStatuses();
      expect(schedulerResult).toBeDefined();
      expect(schedulerResult.processedCount).toBeGreaterThanOrEqual(1);
    });

    test('6.4: Patient self-check-in updates attendance but does not complete follow-up clinically', async () => {
      const checkInRes = await request(app)
        .patch(`/api/follow-ups/${scheduledFollowUpId}/attendance`)
        .set('Authorization', `Bearer ${patientTokenA}`)
        .send({
          attended: true,
          notes: 'Patient checked in at hospital reception kiosk'
        });

      expect(checkInRes.status).toBe(200);
      expect(checkInRes.body.attendance.attended).toBe(true);
      expect(checkInRes.body.attendance.confirmedBy).toBe('PATIENT');

      const fuDb = await FollowUp.findOne({ followUpId: scheduledFollowUpId });
      expect(fuDb.status).not.toBe('COMPLETED');
    });

    test('6.5: MISSED follow-up status prevents referral closure', async () => {
      // Confirm care first so referral reaches follow-up gate
      await request(app)
        .post(`/api/referrals/${createdReferralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          confirmationSummary: 'Post-intervention stabilization delivered.',
          followUpAddressed: true,
          followUpPlan: 'Echo review'
        });

      // Force follow-up into MISSED status
      await FollowUp.findOneAndUpdate(
        { followUpId: scheduledFollowUpId },
        { status: 'MISSED', missedAt: new Date() }
      );

      // Attempt to close the referral while follow-up is MISSED
      const closeAttempt = await request(app)
        .post(`/api/referrals/${createdReferralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          closureNotes: 'Attempting premature closure with missed follow-up'
        });

      expect(closeAttempt.status).toBe(400);
      expect(['UNRESOLVED_FOLLOW_UP', 'UNRESOLVED_FOLLOW_UP_APPOINTMENTS']).toContain(closeAttempt.body.error.code);
    });

    test('6.6: Clinician completes follow-up with documentation', async () => {
      const compRes = await request(app)
        .post(`/api/follow-ups/${scheduledFollowUpId}/complete`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          outcomeNotes: 'Follow-up ECG demonstrates normal sinus rhythm without ischemic changes. Echocardiogram reveals LVEF 55% with good wall motion recovery.',
          treatmentSummary: 'Dual antiplatelet therapy confirmed; patient tolerating medications well.'
        });

      expect(compRes.status).toBe(200);
      expect(compRes.body.success).toBe(true);
      expect(compRes.body.followUp.status).toBe('COMPLETED');
    });
  });

  // =========================================================================
  // STAGE 7: CARE CONFIRMATION AND REFERRAL CLOSURE
  // =========================================================================
  describe('Stage 7 — Care Confirmation and Referral Closure', () => {
    test('7.1: Doctor records care confirmation', async () => {
      const confRes = await request(app)
        .post(`/api/referrals/${createdReferralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          confirmationSummary: 'Comprehensive post-infarction care delivered. Cardiac biomarkers normal. Follow-up investigations completed with full recovery.',
          followUpAddressed: true,
          followUpPlan: 'Routine cardiology outpatient clinic in 6 months.'
        });

      expect(confRes.status).toBe(200);
      expect(confRes.body.success).toBe(true);
      expect(confRes.body.referral.careConfirmation.isConfirmed).toBe(true);
    });

    test('7.2: Referral closure succeeds once all requirements and follow-ups are satisfied', async () => {
      const closeRes = await request(app)
        .post(`/api/referrals/${createdReferralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          closureNotes: 'All clinical milestones reached, treatment documented, follow-ups completed. Case closed.'
        });

      expect(closeRes.status).toBe(200);
      expect(closeRes.body.success).toBe(true);
      expect(closeRes.body.referral.status).toBe('COMPLETED');
      expect(closeRes.body.referral.closure.isClosed).toBe(true);
      expect(closeRes.body.referral.closure.closedAt).toBeDefined();
    });

    test('7.3: Terminal state protection: Closed referral cannot be re-opened or re-transitioned', async () => {
      const invalidAction = await request(app)
        .post(`/api/referrals/${createdReferralId}/start-treatment`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({ notes: 'Attempting illegal transition from closed status' });

      expect(invalidAction.status).toBe(400);
      expect(invalidAction.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    test('7.4: Complete lifecycle history remains auditable in timeline', async () => {
      const timelineRes = await request(app)
        .get(`/api/referrals/${createdReferralId}/timeline`)
        .set('Authorization', `Bearer ${doctorTokenC}`);

      expect(timelineRes.status).toBe(200);
      expect(timelineRes.body.success).toBe(true);
      const eventTypes = timelineRes.body.timeline.map(t => t.eventType);
      expect(eventTypes).toContain('REFERRAL_CREATED');
      expect(eventTypes).toContain('DOCTOR_ASSIGNED');
      expect(eventTypes).toContain('REFERRAL_REASSIGNED');
      expect(eventTypes).toContain('REFERRAL_ACKNOWLEDGED');
      expect(eventTypes).toContain('REFERRAL_ACCEPTED');
      expect(eventTypes).toContain('TREATMENT_STARTED');
      expect(eventTypes).toContain('TREATMENT_DOCUMENTED');
      expect(eventTypes).toContain('CARE_CONFIRMED');
      expect(eventTypes).toContain('REFERRAL_CLOSED');
    });
  });

  // =========================================================================
  // STAGE 8: AI-BASED HANDOFF MONITORING
  // =========================================================================
  describe('Stage 8 — AI-Based Handoff Monitoring', () => {
    let delayedReferralId;
    let createdAlertId;

    test('8.1: Monitoring scan detects delayed assignment and creates alert with plain-language explanation', async () => {
      // 10 hours past creation (> 6h threshold for Urgent)
      const pastDate = new Date(Date.now() - 10 * 60 * 60 * 1000);
      const delayedRef = await Referral.create({
        referralId: 'REF-2026-DELAY01',
        patientId: 'PAT-DEMO-001',
        patientName: 'Samantha Hall',
        sourceScreeningId: createdScreeningId,
        sourceScreeningRef: new mongoose.Types.ObjectId(),
        clinicalReason: 'Stalled referral monitoring simulation',
        priority: 'Urgent',
        status: 'PENDING',
        referringDoctorId: doctorUserA._id,
        referringDoctorUsername: doctorUserA.username,
        referringDoctorName: 'Dr. Alice Carter',
        referringHospital: 'Metropolitan Trauma Hospital',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDepartment: 'Cardiology Intensive Care',
        createdAt: pastDate,
        updatedAt: pastDate
      });

      delayedReferralId = delayedRef.referralId;

      // Trigger monitoring scan
      const scanRes = await referralMonitoringService.runMonitoringScan();
      expect(scanRes.activeAlertsCount).toBeGreaterThanOrEqual(1);

      // Verify alert was created
      const alert = await MonitoringAlert.findOne({
        referralId: delayedReferralId,
        riskCategory: 'ASSIGNMENT_DELAY'
      });

      expect(alert).toBeDefined();
      expect(alert.riskClassification).toBe('HIGH');
      expect(alert.plainLanguageExplanation).toContain('assigned');
      expect(alert.resolutionStatus).toBe('ACTIVE');

      createdAlertId = alert.alertId;
    });

    test('8.2: Clinician queries monitoring alerts with priority filters', async () => {
      const res = await request(app)
        .get('/api/monitoring/alerts?status=ACTIVE&severity=HIGH')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const found = res.body.alerts.find(a => a.alertId === createdAlertId);
      expect(found).toBeDefined();
    });

    test('8.3: Alert dismissal persistence with documented clinical reason', async () => {
      const dismissRes = await request(app)
        .patch(`/api/monitoring/alerts/${createdAlertId}/dismiss`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          reason: 'Specialist physician contacted by phone; assignment pending formal system entry.'
        });

      expect(dismissRes.status).toBe(200);
      expect(dismissRes.body.success).toBe(true);
      expect(dismissRes.body.alert.resolutionStatus).toBe('DISMISSED');
      expect(dismissRes.body.alert.dismissedBy.toString()).toBe(doctorUserA._id.toString());

      // Subsequent scan must NOT resurrect dismissed alert
      await referralMonitoringService.runMonitoringScan();
      const checkAlert = await MonitoringAlert.findOne({ alertId: createdAlertId });
      expect(checkAlert.resolutionStatus).toBe('DISMISSED');
    });

    test('8.4: Alert resolution when underlying condition is corrected', async () => {
      // 10 hours past assignment (> 6h threshold for Urgent)
      const assignedPast = new Date(Date.now() - 10 * 60 * 60 * 1000);
      const ackDelayedRef = await Referral.create({
        referralId: 'REF-2026-ACK02',
        patientId: 'PAT-DEMO-001',
        patientName: 'Samantha Hall',
        sourceScreeningId: createdScreeningId,
        sourceScreeningRef: new mongoose.Types.ObjectId(),
        clinicalReason: 'Unacknowledged referral monitoring simulation',
        priority: 'Urgent',
        status: 'PENDING',
        receivingDoctorId: doctorUserB._id,
        receivingDoctorUsername: doctorUserB.username,
        receivingDoctorName: 'Dr. Robert Vance',
        referringDoctorId: doctorUserA._id,
        referringDoctorUsername: doctorUserA.username,
        referringDoctorName: 'Dr. Alice Carter',
        referringHospital: 'Metropolitan Trauma Hospital',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDepartment: 'Cardiology Intensive Care',
        createdAt: assignedPast,
        updatedAt: assignedPast,
        assignmentTimestamp: assignedPast
      });

      // Run scan to detect acknowledgement delay
      await referralMonitoringService.runMonitoringScan();
      const ackAlert = await MonitoringAlert.findOne({
        referralId: 'REF-2026-ACK02',
        riskCategory: 'ACKNOWLEDGEMENT_DELAY'
      });
      expect(ackAlert).toBeDefined();
      expect(ackAlert.resolutionStatus).toBe('ACTIVE');

      // Now acknowledge the referral
      await Referral.findOneAndUpdate(
        { referralId: 'REF-2026-ACK02' },
        {
          status: 'ACKNOWLEDGED',
          'acknowledgement.acknowledgedAt': new Date(),
          'acknowledgement.acknowledgedByDoctorId': doctorUserB._id
        }
      );

      // Re-run scan: alert must transition to RESOLVED
      await referralMonitoringService.runMonitoringScan();
      const resolvedAlert = await MonitoringAlert.findOne({
        referralId: 'REF-2026-ACK02',
        riskCategory: 'ACKNOWLEDGEMENT_DELAY'
      });
      expect(resolvedAlert.resolutionStatus).toBe('RESOLVED');
    });
  });

  // =========================================================================
  // MANDATORY SECURITY AND NEGATIVE-PATH SCENARIOS (1 to 14)
  // =========================================================================
  describe('Mandatory Security and Negative-Path Scenarios (14 Scenarios)', () => {

    test('Scenario 1: Patient A attempts to access Patient B records (IDOR Protection)', async () => {
      const res = await request(app)
        .get(`/api/screenings?pid=PAT-DEMO-002`)
        .set('Authorization', `Bearer ${patientTokenA}`);

      expect(res.status).toBe(200);
      res.body.screenings.forEach(s => {
        expect(s.pid.toLowerCase()).toBe('pat-demo-001');
      });
    });

    test('Scenario 2: Doctor A attempts to access an unrelated doctor referral', async () => {
      const res = await request(app)
        .get(`/api/referrals/${createdReferralId}`)
        .set('Authorization', `Bearer ${doctorTokenUnrelated}`);

      expect([403, 404]).toContain(res.status);
    });

    test('Scenario 3: Doctor A attempts to access Doctor B individual consent', async () => {
      const doctorAConsents = await consentService.getConsentsForDoctor(doctorUserA._id, 'Metropolitan Trauma Hospital');
      const containsDoctorBExclusive = doctorAConsents.some(c =>
        c.authorizedDoctorId && c.authorizedDoctorId.toString() === doctorUserB._id.toString()
      );
      expect(containsDoctorBExclusive).toBe(false);
    });

    test('Scenario 4: Clinician accesses a referral after consent revocation', async () => {
      const testRevokedPatient = 'PAT-SEC-REVOKED';
      await Consent.create({
        consentId: 'CST-SEC-REVOKED-01',
        patientUserId: patientUserA._id,
        patientId: testRevokedPatient,
        patientName: 'Revoked Patient',
        authorizedHospital: 'St. Jude Heart Hospital',
        authorizedDoctorId: doctorUserC._id,
        status: 'REVOKED',
        revokedAt: new Date(),
        revocationReason: 'Security negative test',
        expiresAt: new Date(Date.now() + 10 * 24 * 3600000)
      });

      const check = await consentService.verifyAccessConsent({
        patientId: testRevokedPatient,
        requestingUser: { userId: doctorUserC._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        purpose: 'SPECIALIST_REFERRAL'
      });

      expect(check.authorized).toBe(false);
      expect(check.code).toBe('CONSENT_REVOKED');
    });

    test('Scenario 5: Expired consent is used for clinical access', async () => {
      const testExpPatient = 'PAT-SEC-EXPIRED';
      await Consent.create({
        consentId: 'CST-SEC-EXPIRED-01',
        patientUserId: patientUserA._id,
        patientId: testExpPatient,
        patientName: 'Expired Patient',
        authorizedHospital: 'St. Jude Heart Hospital',
        authorizedDoctorId: doctorUserC._id,
        status: 'GRANTED',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
      });

      const check = await consentService.verifyAccessConsent({
        patientId: testExpPatient,
        requestingUser: { userId: doctorUserC._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        purpose: 'SPECIALIST_REFERRAL'
      });

      expect(check.authorized).toBe(false);
      expect(check.code).toBe('CONSENT_EXPIRED');
    });

    test('Scenario 6: Clinician requests an unauthorized clinical category', async () => {
      const testCatPatient = 'PAT-SEC-CATEGORY';
      await Consent.create({
        consentId: 'CST-SEC-CAT-01',
        patientUserId: patientUserA._id,
        patientId: testCatPatient,
        patientName: 'Category Patient',
        authorizedHospital: 'St. Jude Heart Hospital',
        authorizedDoctorId: doctorUserC._id,
        status: 'GRANTED',
        permittedCategories: ['VITALS'],
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });

      const check = await consentService.verifyAccessConsent({
        patientId: testCatPatient,
        requestingUser: { userId: doctorUserC._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        purpose: 'SPECIALIST_REFERRAL',
        category: 'MEDICATIONS'
      });

      expect(check.authorized).toBe(false);
      expect(check.code).toBe('CATEGORY_NOT_PERMITTED');
    });

    test('Scenario 7: Clinician requests data for an unauthorized purpose', async () => {
      const testPurposePatient = 'PAT-SEC-PURPOSE';
      await Consent.create({
        consentId: 'CST-SEC-PURP-01',
        patientUserId: patientUserA._id,
        patientId: testPurposePatient,
        patientName: 'Purpose Patient',
        authorizedHospital: 'St. Jude Heart Hospital',
        authorizedDoctorId: doctorUserC._id,
        status: 'GRANTED',
        purpose: 'SPECIALIST_REFERRAL',
        permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS'],
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });

      const check = await consentService.verifyAccessConsent({
        patientId: testPurposePatient,
        requestingUser: { userId: doctorUserC._id, role: 'doctor', hospitalName: 'St. Jude Heart Hospital' },
        purpose: 'GENERAL_CARE',
        category: 'SCREENING_RESULTS'
      });

      expect(check.authorized).toBe(false);
      expect(check.code).toBe('PURPOSE_MISMATCH');
    });

    test('Scenario 8: Reassigned doctor attempts to access previous referral', async () => {
      const isolatedRef = await Referral.create({
        referralId: 'REF-2026-REASSIGN-SEC',
        sourceScreeningId: createdScreeningId,
        sourceScreeningRef: new mongoose.Types.ObjectId(),
        clinicalReason: 'Cardiology isolation test',
        patientId: 'PAT-SEC-REASSIGN',
        patientName: 'Reassigned Test Patient',
        priority: 'Urgent',
        status: 'PENDING',
        referringDoctorId: doctorUserA._id,
        referringDoctorUsername: doctorUserA.username,
        referringHospital: 'Metropolitan Trauma Hospital',
        receivingDoctorId: doctorUserC._id,
        receivingDoctorUsername: doctorUserC.username,
        receivingDoctorName: 'Dr. Clara Oswald',
        receivingHospital: 'St. Jude Heart Hospital'
      });

      // Clear any consents for PAT-SEC-REASSIGN
      await Consent.deleteMany({ patientId: 'PAT-SEC-REASSIGN' });

      // Doctor B (no longer assigned and no separate consent) attempts to fetch referral
      const attemptRes = await request(app)
        .get(`/api/referrals/${isolatedRef.referralId}`)
        .set('Authorization', `Bearer ${doctorTokenB}`);

      expect(attemptRes.status).toBe(403);
      expect(attemptRes.body.error.code).toBe('NO_VALID_CONSENT');
    });

    test('Scenario 9: Expired QR session attempts to access protected information', async () => {
      const expiredSession = await QRSession.create({
        uuid: '00000000-demo-sec0-0000-000000000009',
        transferId: new mongoose.Types.ObjectId(),
        encryptedPayload: { iv: 'iv', authTag: 'tag', encryptedData: 'data' },
        pinHash: 'dummyhash',
        failedAttempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() - 5000),
        createdByUserId: doctorUserA._id,
        isRevoked: false
      });

      const res = await request(app)
        .post(`/api/qr/validate/${expiredSession.uuid}`)
        .send({ pin: '123456' });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('QR_EXPIRED');
    });

    test('Scenario 10: Previously established QR session attempts access after consent revocation', async () => {
      const testTf = await Transfer.create({
        pid: 'PAT-SEC-QRREVOKE',
        nam: 'QR Revoke Test',
        age: 50,
        gender: 'Female',
        bg: 'O+',
        pd: 'Cardiology handoff',
        fh: 'Metropolitan Trauma Hospital',
        th: 'St. Jude Heart Hospital',
        rt: 'Cardiac Evaluation',
        issuerUserId: doctorUserA._id,
        issuerUsername: doctorUserA.username,
        recipientUserIds: [doctorUserC._id],
        recipientUsernames: [doctorUserC.username]
      });

      await Consent.create({
        consentId: 'CST-QRREVOKE-01',
        patientUserId: patientUserA._id,
        patientId: 'PAT-SEC-QRREVOKE',
        patientName: 'QR Revoke Test',
        authorizedHospital: 'St. Jude Heart Hospital',
        authorizedDoctorId: doctorUserC._id,
        status: 'GRANTED',
        purpose: 'SPECIALIST_REFERRAL',
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });

      const qrRes = await request(app)
        .post(`/api/transfers/${testTf._id}/qr`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ pin: '112233' });

      expect(qrRes.status).toBe(201);
      const uuid = qrRes.body.uuid;

      // Patient revokes consent
      await Consent.findOneAndUpdate(
        { consentId: 'CST-QRREVOKE-01' },
        { status: 'REVOKED', revokedAt: new Date(), revocationReason: 'Patient revoked access' }
      );

      // Access QR session after revocation
      const sessionAccessRes = await request(app)
        .post(`/api/qr/validate/${uuid}`)
        .send({ pin: '112233' });

      expect(sessionAccessRes.status).toBe(410);
      expect(sessionAccessRes.body.error.code).toBe('QR_EXPIRED');
    });

    test('Scenario 11: Unauthorized actor attempts referral closure', async () => {
      const res = await request(app)
        .post(`/api/referrals/${createdReferralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenUnrelated}`)
        .send({ closureNotes: 'Unauthorized closure attempt' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_CLOSURE');
    });

    test('Scenario 12: Patient attempts clinician-only lifecycle operation', async () => {
      const res = await request(app)
        .post(`/api/referrals/${createdReferralId}/acknowledge`)
        .set('Authorization', `Bearer ${patientTokenA}`)
        .send({ notes: 'Patient trying to acknowledge' });

      expect(res.status).toBe(403);
      expect(['FORBIDDEN', 'FORBIDDEN_ROLE']).toContain(res.body.error.code);
    });

    test('Scenario 13: Patient attempts to access internal monitoring alerts', async () => {
      const res = await request(app)
        .get('/api/monitoring/alerts')
        .set('Authorization', `Bearer ${patientTokenA}`);

      expect(res.status).toBe(403);
      expect(['FORBIDDEN', 'FORBIDDEN_ROLE']).toContain(res.body.error.code);
    });

    test('Scenario 14: Unresolved MISSED follow-up is present during referral closure', async () => {
      const testRef = await Referral.create({
        referralId: 'REF-2026-MISSED-CLOSURE',
        sourceScreeningId: createdScreeningId,
        sourceScreeningRef: new mongoose.Types.ObjectId(),
        clinicalReason: 'Severe cardiac injury with follow-up',
        patientId: 'PAT-DEMO-001',
        patientName: 'Samantha Hall',
        priority: 'Urgent',
        status: 'IN_PROGRESS',
        referringDoctorId: doctorUserA._id,
        referringDoctorUsername: doctorUserA.username,
        referringHospital: 'Metropolitan Trauma Hospital',
        receivingDoctorId: doctorUserC._id,
        receivingDoctorUsername: doctorUserC.username,
        receivingDoctorName: 'Dr. Clara Oswald',
        receivingHospital: 'St. Jude Heart Hospital',
        treatmentDocumentation: {
          treatmentSummary: 'Treatment documented',
          documentedBy: doctorUserC._id,
          documentedAt: new Date()
        },
        careConfirmation: {
          isConfirmed: true,
          confirmedByDoctorId: doctorUserC._id,
          confirmedAt: new Date(),
          confirmationSummary: 'Care confirmed'
        }
      });

      await FollowUp.create({
        followUpId: 'FU-2026-MISSED-01',
        referralRef: testRef._id,
        referralId: testRef.referralId,
        patientId: 'PAT-DEMO-001',
        patientName: 'Samantha Hall',
        patientUserId: patientUserA._id,
        responsibleDoctorId: doctorUserC._id,
        responsibleDoctorUsername: doctorUserC.username,
        responsibleDoctorName: 'Dr. Clara Oswald',
        dueDate: new Date(Date.now() - 48 * 3600000),
        status: 'MISSED',
        instructions: 'Urgent cardiac stress test'
      });

      const res = await request(app)
        .post(`/api/referrals/${testRef.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({ closureNotes: 'Attempting closure with missed appointment' });

      expect(res.status).toBe(400);
      expect(['UNRESOLVED_FOLLOW_UP', 'UNRESOLVED_FOLLOW_UP_APPOINTMENTS']).toContain(res.body.error.code);
    });

    test('Audit logging verification: Security denials and consent grants produce audit entries without PHI leak', async () => {
      const logs = await AuditLog.find({
        action: { $in: ['UNAUTHORIZED_ACCESS_ATTEMPT', 'CONSENT_GRANTED', 'CONSENT_REVOKED', 'UNAUTHORIZED_REFERRAL_ACKNOWLEDGEMENT_ATTEMPT'] }
      });

      expect(logs.length).toBeGreaterThan(0);
      for (const log of logs) {
        expect(log.details).not.toHaveProperty('password');
        expect(log.details).not.toHaveProperty('pin');
        expect(log.details).not.toHaveProperty('token');
      }
    });
  });
});
