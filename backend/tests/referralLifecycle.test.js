const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');
const Transfer = require('../models/Transfer');
const QRSession = require('../models/QRSession');
const AuditLog = require('../models/AuditLog');

jest.setTimeout(60000);

let mongoServer;
let doctorTokenA; // Referring Doctor (Metropolitan)
let doctorUserA;
let doctorTokenB; // Receiving Doctor (St. Jude)
let doctorUserB;
let doctorTokenC; // Second Receiving Doctor for Reassignment (St. Jude)
let doctorUserC;
let doctorTokenUnrelated; // Doctor at Unaffiliated Clinic
let doctorUserUnrelated;
let patientToken;
let patientUser;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // 1. Doctor A: Metropolitan Hospital (Referring Doctor)
  const docRegA = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.alice.phase3@metropolitan.health',
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

  // 2. Doctor B: St. Jude Hospital (Assigned Receiving Doctor)
  const docRegB = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.bob.phase3@stjude.health',
      name: 'Dr. Robert Vance',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital'
    });
  const docVerifyB = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegB.body.challengeId, otp: docRegB.body.devOtp });
  doctorTokenB = docVerifyB.body.token;
  doctorUserB = docVerifyB.body.user;

  // 3. Doctor C: St. Jude Hospital (Colleague / Reassigned Doctor)
  const docRegC = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.clara.phase3@stjude.health',
      name: 'Dr. Clara Oswald',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital'
    });
  const docVerifyC = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegC.body.challengeId, otp: docRegC.body.devOtp });
  doctorTokenC = docVerifyC.body.token;
  doctorUserC = docVerifyC.body.user;

  // 4. Doctor Unrelated: General City Clinic
  const docRegUnrelated = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.outsider.phase3@ruralclinic.org',
      name: 'Dr. Oscar Outsider',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'Unaffiliated Rural Clinic'
    });
  const docVerifyUnrelated = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegUnrelated.body.challengeId, otp: docRegUnrelated.body.devOtp });
  doctorTokenUnrelated = docVerifyUnrelated.body.token;
  doctorUserUnrelated = docVerifyUnrelated.body.user;

  // 5. Patient User
  patientUser = await User.create({
    email: 'pat.phase3@test.org',
    username: 'PAT-PHASE3-01',
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

describe('Phase 3: Referral Lifecycle & Doctor Acknowledgement Test Suite', () => {

  let testScreening;
  let testReferral;

  beforeEach(async () => {
    // Create a fresh flagged screening and referral for each test cycle
    const screeningRes = await request(app)
      .post('/api/screenings')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        pid: 'PAT-PHASE3-01',
        patientName: 'Arthur Dent',
        age: 42,
        gender: 'Male',
        bloodGroup: 'B+',
        vitals: { hr: 125, bp: '85/50', rr: 28, spo2: 89, temp: 39.1, gcs: 14 },
        clinicalNotes: 'Suspected severe sepsis with hemodynamic instability',
        patientConsent: { consentGiven: true, consentMethod: 'Digital Written Signature' }
      });

    testScreening = screeningRes.body.screening;

    const referralRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: testScreening.screeningId,
        clinicalReason: 'Severe sepsis refractory to initial resuscitation. Needs ICU step-up.',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDepartment: 'Cardiothoracic ICU',
        receivingDoctorId: doctorUserB.id
      });

    testReferral = referralRes.body.referral;
  });

  describe('1. Referral Acknowledgement', () => {
    test('Assigned receiving doctor can explicitly acknowledge receipt of referral', async () => {
      const res = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Bed secured in CTICU. Team notified.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.referral.status).toBe('ACKNOWLEDGED');
      expect(res.body.referral.acknowledgement.acknowledgedByDoctorUsername).toBe(doctorUserB.username);
      expect(res.body.referral.acknowledgement.decision).toBe('ACKNOWLEDGED');
      expect(res.body.referral.acknowledgement.notes).toBe('Bed secured in CTICU. Team notified.');

      // Timeline event recorded
      const updatedRef = await Referral.findOne({ referralId: testReferral.referralId });
      const ackEvent = updatedRef.timeline.find(e => e.eventType === 'REFERRAL_ACKNOWLEDGED');
      expect(ackEvent).toBeDefined();
      expect(ackEvent.previousStatus).toBe('PENDING');
      expect(ackEvent.newStatus).toBe('ACKNOWLEDGED');
    });

    test('Unauthorized users cannot acknowledge referral', async () => {
      // Referring doctor cannot acknowledge (they are the sender, not the receiver)
      const resSender = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ notes: 'Sender trying to acknowledge' });

      expect(resSender.status).toBe(403);
      expect(resSender.body.error.code).toBe('FORBIDDEN_RECEIVING_DOCTOR');

      // Unaffiliated doctor cannot acknowledge
      const resOutsider = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenUnrelated}`)
        .send({ notes: 'Outsider trying to acknowledge' });

      expect(resOutsider.status).toBe(403);
      expect(resOutsider.body.error.code).toBe('FORBIDDEN_RECEIVING_DOCTOR');

      // Patient cannot acknowledge
      const resPat = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/acknowledge`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ notes: 'Patient trying to acknowledge' });

      expect(resPat.status).toBe(403);
    });
  });

  describe('2. Referral Acceptance & Rejection', () => {
    test('Receiving doctor can accept the referral', async () => {
      // First acknowledge
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Reviewing clinical vitals' });

      // Then accept
      const res = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Patient accepted for immediate transfer' });

      expect(res.status).toBe(200);
      expect(res.body.referral.status).toBe('ACCEPTED');

      const updatedRef = await Referral.findOne({ referralId: testReferral.referralId });
      const acceptEvent = updatedRef.timeline.find(e => e.eventType === 'REFERRAL_ACCEPTED');
      expect(acceptEvent).toBeDefined();
      expect(acceptEvent.newStatus).toBe('ACCEPTED');
    });

    test('Referral rejection requires a mandatory clinical justification reason', async () => {
      // Rejection with empty reason fails with 400
      const failRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/reject`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ reason: '   ' });

      expect(failRes.status).toBe(400);
      expect(failRes.body.error.code).toBe('MISSING_REJECTION_REASON');

      // Rejection with valid justification succeeds
      const successRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/reject`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ reason: 'ICU capacity full; no available ECMO machines. Escalate to Regional Trauma Centre.' });

      expect(successRes.status).toBe(200);
      expect(successRes.body.referral.status).toBe('REJECTED');
      expect(successRes.body.referral.rejection.reason).toContain('ICU capacity full');
      expect(successRes.body.referral.rejection.rejectedByDoctorUsername).toBe(doctorUserB.username);

      // Audit and timeline verified
      const updatedRef = await Referral.findOne({ referralId: testReferral.referralId });
      const rejEvent = updatedRef.timeline.find(e => e.eventType === 'REFERRAL_REJECTED');
      expect(rejEvent).toBeDefined();
      expect(rejEvent.newStatus).toBe('REJECTED');
    });

    test('Rejected referral can be reassigned to another doctor (escalation path)', async () => {
      // Reject referral
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/reject`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ reason: 'Bed shortage' });

      // Reassign to Dr. Clara
      const reassignRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          receivingDoctorId: doctorUserC.id,
          reason: 'Escalated reassignment following Dr. Bob bed shortage'
        });

      expect(reassignRes.status).toBe(200);
      // Status resets to PENDING for the newly assigned clinician
      expect(reassignRes.body.referral.status).toBe('PENDING');
      expect(reassignRes.body.referral.receivingDoctorUsername).toBe(doctorUserC.username);

      // Now Dr. Clara can acknowledge
      const ackRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({ notes: 'Dr Clara acknowledged reassigned referral' });

      expect(ackRes.status).toBe(200);
      expect(ackRes.body.referral.status).toBe('ACKNOWLEDGED');
    });
  });

  describe('3. Status Lifecycle & Transition Validation', () => {
    test('Prevents arbitrary status transition from PENDING directly to COMPLETED', async () => {
      const res = await request(app)
        .patch(`/api/referrals/${testReferral.referralId}/status`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    test('Prevents status transition from PENDING directly to IN_PROGRESS', async () => {
      const res = await request(app)
        .patch(`/api/referrals/${testReferral.referralId}/status`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ status: 'IN_PROGRESS' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    test('Starting treatment requires referral to be in ACCEPTED status', async () => {
      // Still in PENDING
      const failRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/start-treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Attempting to start treatment prematurely' });

      expect(failRes.status).toBe(400);
      expect(failRes.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      // Accept referral
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Accepted' });

      // Now starting treatment succeeds
      const startRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/start-treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'IV antibiotics and arterial line placed' });

      expect(startRes.status).toBe(200);
      expect(startRes.body.referral.status).toBe('IN_PROGRESS');
    });
  });

  describe('4. Treatment Documentation & Follow-Up', () => {
    beforeEach(async () => {
      // Move referral to ACCEPTED -> IN_PROGRESS
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Accepted' });
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/start-treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Started' });
    });

    test('Treatment documentation requires non-empty treatmentSummary', async () => {
      const res = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ treatmentSummary: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_TREATMENT_SUMMARY');
    });

    test('Requires follow-up instructions when followUpRequired is true', async () => {
      const res = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          treatmentSummary: 'Central line placed, fluid resuscitated',
          followUpRequired: true,
          followUpInstructions: ''
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_FOLLOW_UP_INSTRUCTIONS');
    });

    test('Successfully documents treatment with procedures and medications', async () => {
      const res = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          treatmentSummary: 'Stabilized in CTICU with Norepinephrine infusion and broad-spectrum antibiotics.',
          clinicalObservations: 'Lactate decreased from 4.8 to 1.9 mmol/L over 6 hours.',
          proceduresPerformed: ['Arterial line insertion', 'Central venous catheterization'],
          medicationsAdministered: [
            { name: 'Norepinephrine', dose: '0.08 mcg/kg/min', route: 'IV Infusion', frequency: 'Continuous' },
            { name: 'Meropenem', dose: '1g', route: 'IV', frequency: 'TDS' }
          ],
          followUpRequired: true,
          followUpInstructions: 'Repeat blood gas and inflammatory markers in 12 hours.'
        });

      expect(res.status).toBe(200);
      expect(res.body.referral.status).toBe('FOLLOW_UP_REQUIRED');
      expect(res.body.referral.treatmentDocumentation.treatmentSummary).toContain('Stabilized in CTICU');
      expect(res.body.referral.treatmentDocumentation.proceduresPerformed).toHaveLength(2);
      expect(res.body.referral.treatmentDocumentation.medicationsAdministered).toHaveLength(2);
      expect(res.body.referral.treatmentDocumentation.followUpRequired).toBe(true);

      // Verify audit timeline
      const updatedRef = await Referral.findOne({ referralId: testReferral.referralId });
      const treatEvent = updatedRef.timeline.find(e => e.eventType === 'TREATMENT_DOCUMENTED');
      const followUpEvent = updatedRef.timeline.find(e => e.eventType === 'FOLLOW_UP_REQUIRED');
      expect(treatEvent).toBeDefined();
      expect(followUpEvent).toBeDefined();
    });
  });

  describe('5. Care Confirmation & Referral Closure', () => {
    beforeEach(async () => {
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Accepted' });
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/start-treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Started' });
    });

    test('Care cannot be confirmed before treatment is documented', async () => {
      const res = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ confirmationSummary: 'Patient looks fine' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TREATMENT_NOT_DOCUMENTED');
    });

    test('Referral cannot be closed without treatment documentation', async () => {
      const res = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Trying to close prematurely' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TREATMENT_NOT_DOCUMENTED');
    });

    test('Referral cannot be closed if care confirmation is missing', async () => {
      // Document treatment with no follow-up required
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          treatmentSummary: 'Observed and discharged from acute bay.',
          followUpRequired: false
        });

      // Attempt close without confirm-care
      const res = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Closing without care confirmation' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CARE_NOT_CONFIRMED');
    });

    test('Referral cannot be closed with unresolved required follow-up', async () => {
      // Document treatment with follow-up required
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          treatmentSummary: 'Post-op observation',
          followUpRequired: true,
          followUpInstructions: 'Suture removal in 7 days'
        });

      // Confirm care without addressing follow-up plan
      const failConfirm = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          confirmationSummary: 'Condition satisfactory',
          followUpAddressed: false
        });

      expect(failConfirm.status).toBe(400);
      expect(failConfirm.body.error.code).toBe('UNRESOLVED_FOLLOW_UP');

      // Confirm care WITH follow-up addressed
      const successConfirm = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          confirmationSummary: 'Condition stable and suture plan booked with outpatient clinic.',
          followUpAddressed: true,
          followUpPlan: 'Outpatient clinic appointment scheduled for 25th Nov 2026.'
        });

      expect(successConfirm.status).toBe(200);
      expect(successConfirm.body.referral.careConfirmation.isConfirmed).toBe(true);

      // Now close referral
      const closeRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Patient safely stepped down to step-down ward. Referral closed.' });

      expect(closeRes.status).toBe(200);
      expect(closeRes.body.referral.status).toBe('COMPLETED');
      expect(closeRes.body.referral.closure.isClosed).toBe(true);
      expect(closeRes.body.referral.closure.closureNotes).toContain('safely stepped down');

      // Verify source screening activeReferralId cleared
      const updatedScreening = await Screening.findById(testScreening._id);
      expect(updatedScreening.activeReferralId).toBeNull();
    });
  });

  describe('6. Security & Decoupled QR/PIN Handoff', () => {
    test('QR code generation and PIN access does NOT automatically acknowledge referral', async () => {
      // 1. Generate referral QR
      const qrRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/qr`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ pin: '456789' });

      expect(qrRes.status).toBe(200);
      const { uuid, pin } = qrRes.body.qrSession;

      // 2. Validate QR / PIN
      const scanRes = await request(app)
        .post(`/api/qr/validate/${uuid}`)
        .send({ pin });

      expect(scanRes.status).toBe(200);
      expect(scanRes.body.transfer).toBeDefined();

      // 3. Referral must STILL be in PENDING status (not automatically acknowledged)
      const refCheck = await Referral.findOne({ referralId: testReferral.referralId });
      expect(refCheck.status).toBe('PENDING');
      expect(refCheck.acknowledgement.acknowledgedAt).toBeNull();
    });

    test('Complete referral lifecycle timeline is immutable and captures all lifecycle events', async () => {
      // Run complete lifecycle: Acknowledge -> Accept -> Start -> Document -> Confirm -> Close
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Step 1' });

      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Step 2' });

      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/start-treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Step 3' });

      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          treatmentSummary: 'Completed clinical protocol',
          followUpRequired: false
        });

      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ confirmationSummary: 'Verified protocol complete' });

      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Final complete closure' });

      // Fetch timeline endpoint
      const timelineRes = await request(app)
        .get(`/api/referrals/${testReferral.referralId}/timeline`)
        .set('Authorization', `Bearer ${doctorTokenB}`);

      expect(timelineRes.status).toBe(200);
      const events = timelineRes.body.timeline.map(e => e.eventType);

      expect(events).toContain('REFERRAL_CREATED');
      expect(events).toContain('DOCTOR_ASSIGNED');
      expect(events).toContain('HANDOFF_INITIATED');
      expect(events).toContain('REFERRAL_ACKNOWLEDGED');
      expect(events).toContain('REFERRAL_ACCEPTED');
      expect(events).toContain('TREATMENT_STARTED');
      expect(events).toContain('TREATMENT_DOCUMENTED');
      expect(events).toContain('CARE_CONFIRMED');
      expect(events).toContain('REFERRAL_CLOSED');

      // Verify event payload structure
      timelineRes.body.timeline.forEach(event => {
        expect(event.performingUserId).toBeDefined();
        expect(event.performingUsername).toBeDefined();
        expect(event.timestamp).toBeDefined();
      });
    });

    test('Completed referral cannot be cancelled or reopened', async () => {
      // Move to completed
      await request(app).post(`/api/referrals/${testReferral.referralId}/accept`).set('Authorization', `Bearer ${doctorTokenB}`).send();
      await request(app).post(`/api/referrals/${testReferral.referralId}/start-treatment`).set('Authorization', `Bearer ${doctorTokenB}`).send();
      await request(app).post(`/api/referrals/${testReferral.referralId}/treatment`).set('Authorization', `Bearer ${doctorTokenB}`).send({ treatmentSummary: 'Done', followUpRequired: false });
      await request(app).post(`/api/referrals/${testReferral.referralId}/confirm-care`).set('Authorization', `Bearer ${doctorTokenB}`).send({ confirmationSummary: 'Confirmed' });
      await request(app).post(`/api/referrals/${testReferral.referralId}/close`).set('Authorization', `Bearer ${doctorTokenB}`).send({ closureNotes: 'Closed' });

      // Attempt cancel on completed referral
      const cancelRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/cancel`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ reason: 'Trying to cancel completed referral' });

      expect(cancelRes.status).toBe(400);
      expect(cancelRes.body.error.code).toBe('CANNOT_CANCEL_COMPLETED');
    });
  });
});
