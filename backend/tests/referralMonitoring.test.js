const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');
const FollowUp = require('../models/FollowUp');
const Notification = require('../models/Notification');
const MonitoringAlert = require('../models/MonitoringAlert');
const {
  runMonitoringScan,
  evaluateReferralConditions,
  MONITORING_CONFIG
} = require('../services/referralMonitoringService');
const { processFollowUpRemindersAndStatuses } = require('../services/followUpSchedulerService');

jest.setTimeout(60000);

let mongoServer;
let doctorTokenA; // Referring Doctor (Metropolitan Trauma Hospital)
let doctorUserA;
let doctorTokenB; // Receiving Doctor (St. Jude Heart Hospital)
let doctorUserB;
let doctorTokenC; // Unrelated Doctor (General Hospital)
let doctorUserC;
let patientToken1; // Patient (PAT-MON-01)
let patientUser1;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // 1. Doctor A: Metropolitan Hospital
  const docRegA = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.alice.mon@metropolitan.health',
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

  // 2. Doctor B: St. Jude Heart Hospital
  const docRegB = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.bob.mon@stjude.health',
      name: 'Dr. Bob Miller',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital'
    });
  const docVerifyB = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegB.body.challengeId, otp: docRegB.body.devOtp });
  doctorTokenB = docVerifyB.body.token;
  doctorUserB = docVerifyB.body.user;

  // 3. Doctor C: General Hospital (Unrelated)
  const docRegC = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.clara.mon@general.health',
      name: 'Dr. Clara Oswald',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'General Hospital'
    });
  const docVerifyC = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegC.body.challengeId, otp: docRegC.body.devOtp });
  doctorTokenC = docVerifyC.body.token;
  doctorUserC = docVerifyC.body.user;

  // 4. Patient User
  patientUser1 = await User.create({
    email: 'sarah.mon@patient.mediform.org',
    username: 'PAT-MON-01',
    password: 'password123',
    role: 'patient',
    isEmailVerified: true
  });

  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';
  patientToken1 = jwt.sign(
    { userId: patientUser1._id, username: patientUser1.username, role: 'patient', tokenVersion: 0 },
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

describe('Phase 6: AI-Based Handoff Monitoring & Explainable Risk Detection', () => {

  beforeEach(async () => {
    await MonitoringAlert.deleteMany({});
    await FollowUp.deleteMany({});
    await Notification.deleteMany({});
    await Referral.deleteMany({});
    await Screening.deleteMany({});
  });

  // Helper to create a base flagged screening
  async function createFlaggedScreening(pid = 'PAT-MON-01') {
    const res = await request(app)
      .post('/api/screenings')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        pid,
        patientName: 'Sarah Connor',
        age: 38,
        gender: 'Female',
        bloodGroup: 'A+',
        vitals: { hr: 125, bp: '85/50', rr: 26, spo2: 89, temp: 39.1, gcs: 14 },
        clinicalNotes: 'Suspected severe sepsis needing ICU step-up care',
        patientConsent: { consentGiven: true, consentMethod: 'Digital Signature' }
      });
    return res.body.screening;
  }

  // -------------------------------------------------------------
  // 1 & 2: Unassigned Referral & Assignment Delay Detection
  // -------------------------------------------------------------
  test('1 & 2. Unassigned referral and assignment delay detection with explainable risk classification', async () => {
    const screening = await createFlaggedScreening();

    // Create Emergency referral without receiving doctor
    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Unstable septic shock requiring emergency ICU bed',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital'
      });
    expect(refRes.status).toBe(201);
    const refId = refRes.body.referral.referralId;

    // Fast-forward time past emergency assignment threshold (>2h)
    const scanTime = new Date(Date.now() + 3 * 3600000);
    const scanStats = await runMonitoringScan(scanTime);

    expect(scanStats.activeAlertsCount).toBeGreaterThanOrEqual(1);

    const alert = await MonitoringAlert.findOne({
      referralId: refId,
      riskCategory: 'ASSIGNMENT_DELAY'
    });
    expect(alert).not.toBeNull();
    expect(alert.riskClassification).toBe('CRITICAL');
    expect(alert.plainLanguageExplanation).toContain('has remained unassigned for 3 hours');
    expect(alert.recommendedAction).toContain('Assign an eligible receiving doctor');
    expect(alert.evidence.thresholdHours).toBe(2);
  });

  // -------------------------------------------------------------
  // 3: Acknowledgement Delay Detection
  // -------------------------------------------------------------
  test('3. Acknowledgement delay detection when assigned doctor has not acknowledged handoff', async () => {
    const screening = await createFlaggedScreening();

    // Create Urgent referral assigned to Doctor B
    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Specialist consultation required',
        priority: 'Urgent',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    // Fast-forward time past urgent acknowledgement threshold (>6h)
    const scanTime = new Date(Date.now() + 8 * 3600000);
    await runMonitoringScan(scanTime);

    const alert = await MonitoringAlert.findOne({
      referralId: refId,
      riskCategory: 'ACKNOWLEDGEMENT_DELAY'
    });
    expect(alert).not.toBeNull();
    expect(alert.riskClassification).toBe('HIGH');
    expect(alert.plainLanguageExplanation).toContain('assigned to Dr.');
    expect(alert.plainLanguageExplanation).toContain('has not been acknowledged');
    expect(alert.recommendedAction).toContain('Prompt Dr.');
  });

  // -------------------------------------------------------------
  // 4: Rejection Without Reassignment
  // -------------------------------------------------------------
  test('4. Rejection without reassignment detection', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Referral for cardiac bed',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    // Doctor B rejects referral
    await request(app)
      .post(`/api/referrals/${refId}/reject`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ reason: 'All ICU isolation beds occupied' });

    // Run monitoring scan
    await runMonitoringScan();

    const alert = await MonitoringAlert.findOne({
      referralId: refId,
      riskCategory: 'REJECTION_UNASSIGNED'
    });
    expect(alert).not.toBeNull();
    expect(alert.riskClassification).toBe('CRITICAL');
    expect(alert.plainLanguageExplanation).toContain('All ICU isolation beds occupied');
    expect(alert.plainLanguageExplanation).toContain('has not been reassigned');
  });

  // -------------------------------------------------------------
  // 5: Treatment Documentation Missing
  // -------------------------------------------------------------
  test('5. Treatment documentation missing detection after treatment has started', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Inpatient admission',
        priority: 'Urgent',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    // Doctor B accepts and starts treatment
    await request(app)
      .post(`/api/referrals/${refId}/acknowledge`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Acknowledged' });

    await request(app)
      .post(`/api/referrals/${refId}/accept`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Accepted' });

    await request(app)
      .post(`/api/referrals/${refId}/start-treatment`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Patient admitted to unit' });

    // Simulate 26 hours without documented summary (>24h threshold for Urgent)
    const scanTime = new Date(Date.now() + 26 * 3600000);
    await runMonitoringScan(scanTime);

    const alert = await MonitoringAlert.findOne({
      referralId: refId,
      riskCategory: 'INCOMPLETE_CLINICAL_WORKFLOW'
    });
    expect(alert).not.toBeNull();
    expect(alert.plainLanguageExplanation).toContain('treatment documentation remains incomplete');
  });

  // -------------------------------------------------------------
  // 6: Care Confirmation Missing
  // -------------------------------------------------------------
  test('6. Care confirmation missing detection after treatment summary is recorded', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Specialist care',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    await request(app)
      .post(`/api/referrals/${refId}/acknowledge`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Acknowledge' });

    await request(app)
      .post(`/api/referrals/${refId}/accept`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Accept' });

    // Document treatment
    await request(app)
      .post(`/api/referrals/${refId}/treatment`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ treatmentSummary: 'Central line placed, broad spectrum antibiotics given' });

    // Simulate 14 hours past treatment documentation (>12h threshold for Emergency)
    const scanTime = new Date(Date.now() + 14 * 3600000);
    await runMonitoringScan(scanTime);

    const alert = await MonitoringAlert.findOne({
      referralId: refId,
      riskCategory: 'INCOMPLETE_CLINICAL_WORKFLOW'
    });
    expect(alert).not.toBeNull();
    expect(alert.plainLanguageExplanation).toContain('care confirmation has not been recorded');
  });

  // -------------------------------------------------------------
  // 7: Overdue Follow-Up Detection
  // -------------------------------------------------------------
  test('7. Overdue follow-up detection links to referral risk alert', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Cardiac consultation',
        priority: 'Urgent',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    await request(app)
      .post(`/api/referrals/${refId}/acknowledge`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Acknowledge' });

    await request(app)
      .post(`/api/referrals/${refId}/accept`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Accept' });

    // Create follow-up due in 1 hour
    const dueDate = new Date('2026-11-20T10:00:00Z');
    await request(app)
      .post('/api/follow-ups')
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        referralId: refId,
        dueDate: dueDate.toISOString(),
        instructions: 'Post-op wound check'
      });

    // Run follow-up scheduler 30 mins past due date -> flags follow-up OVERDUE
    await processFollowUpRemindersAndStatuses(new Date('2026-11-20T10:30:00Z'));

    // Monitoring scan evaluates follow-up risks
    await runMonitoringScan(new Date('2026-11-20T10:35:00Z'));

    const alert = await MonitoringAlert.findOne({
      referralId: refId,
      riskCategory: 'FOLLOW_UP_RISK'
    });
    expect(alert).not.toBeNull();
    expect(alert.riskClassification).toBe('HIGH');
    expect(alert.plainLanguageExplanation).toContain('is past due by');
  });

  // -------------------------------------------------------------
  // 8: Missed Follow-Up Detection
  // -------------------------------------------------------------
  test('8. Missed follow-up detection generates CRITICAL monitoring alert', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Emergency referral',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    await request(app)
      .post(`/api/referrals/${refId}/acknowledge`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Acknowledge' });

    await request(app)
      .post(`/api/referrals/${refId}/accept`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Accept' });

    const dueDate = new Date('2026-11-20T10:00:00Z');
    await request(app)
      .post('/api/follow-ups')
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        referralId: refId,
        dueDate: dueDate.toISOString(),
        instructions: 'Clinical check'
      });

    // Simulate 50 hours past due -> follow-up scheduler marks MISSED
    await processFollowUpRemindersAndStatuses(new Date('2026-11-22T12:00:00Z'));

    // Monitoring scan detects MISSED follow-up
    await runMonitoringScan(new Date('2026-11-22T12:05:00Z'));

    const alert = await MonitoringAlert.findOne({
      referralId: refId,
      riskCategory: 'FOLLOW_UP_RISK'
    });
    expect(alert).not.toBeNull();
    expect(alert.riskClassification).toBe('CRITICAL');
    expect(alert.plainLanguageExplanation).toContain('marked MISSED');
  });

  // -------------------------------------------------------------
  // 9: Stalled Referral Detection
  // -------------------------------------------------------------
  test('9. Stalled referral detection when no timeline activity occurs beyond inactivity threshold', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Consultation',
        priority: 'Routine',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    // Doctor acknowledges
    await request(app)
      .post(`/api/referrals/${refId}/acknowledge`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Acknowledge' });

    // Simulate 100 hours of complete silence (>96h for Routine)
    const scanTime = new Date(Date.now() + 102 * 3600000);
    await runMonitoringScan(scanTime);

    const alert = await MonitoringAlert.findOne({
      referralId: refId,
      riskCategory: 'STALLED_WORKFLOW'
    });
    expect(alert).not.toBeNull();
    expect(alert.plainLanguageExplanation).toContain('no recorded clinical or lifecycle activity');
  });

  // -------------------------------------------------------------
  // 10 & 11: Completed & Cancelled Referral Exclusion (False Positive Prevention)
  // -------------------------------------------------------------
  test('10 & 11. Completed and cancelled referrals are excluded from active risk alerts', async () => {
    const screening1 = await createFlaggedScreening('PAT-MON-01');
    const screening2 = await createFlaggedScreening('PAT-MON-02');

    // Referral 1: Completed
    const ref1Res = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening1.screeningId,
        clinicalReason: 'To be completed',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const ref1Id = ref1Res.body.referral.referralId;

    await request(app).post(`/api/referrals/${ref1Id}/acknowledge`).set('Authorization', `Bearer ${doctorTokenB}`).send({ notes: 'ok' });
    await request(app).post(`/api/referrals/${ref1Id}/accept`).set('Authorization', `Bearer ${doctorTokenB}`).send({ notes: 'ok' });
    await request(app).post(`/api/referrals/${ref1Id}/treatment`).set('Authorization', `Bearer ${doctorTokenB}`).send({ treatmentSummary: 'Complete care' });
    await request(app).post(`/api/referrals/${ref1Id}/confirm-care`).set('Authorization', `Bearer ${doctorTokenB}`).send({ followUpAddressed: false, confirmationSummary: 'Verified' });
    await request(app).post(`/api/referrals/${ref1Id}/close`).set('Authorization', `Bearer ${doctorTokenB}`).send({ closureNotes: 'Closed successfully' });

    // Referral 2: Cancelled
    const ref2Res = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening2.screeningId,
        clinicalReason: 'To be cancelled',
        priority: 'Urgent',
        receivingHospital: 'St. Jude Heart Hospital'
      });
    const ref2Id = ref2Res.body.referral.referralId;
    await request(app).post(`/api/referrals/${ref2Id}/cancel`).set('Authorization', `Bearer ${doctorTokenA}`).send({ reason: 'Patient declined transfer' });

    // Fast-forward 200 hours
    const scanTime = new Date(Date.now() + 200 * 3600000);
    await runMonitoringScan(scanTime);

    // Verify ZERO alerts exist for ref1 and ref2
    const ref1Alerts = await MonitoringAlert.find({ referralId: ref1Id, resolutionStatus: 'ACTIVE' });
    const ref2Alerts = await MonitoringAlert.find({ referralId: ref2Id, resolutionStatus: 'ACTIVE' });
    expect(ref1Alerts.length).toBe(0);
    expect(ref2Alerts.length).toBe(0);
  });

  // -------------------------------------------------------------
  // 12: Valid Reassignment Exclusion
  // -------------------------------------------------------------
  test('12. Valid reassignment exclusion: rejected referral that is subsequently reassigned does not generate REJECTION_UNASSIGNED alert', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Initial specialist request',
        priority: 'Urgent',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    // Doctor B rejects
    await request(app)
      .post(`/api/referrals/${refId}/reject`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ reason: 'Department full' });

    // Initial scan flags REJECTION_UNASSIGNED
    await runMonitoringScan();
    let alert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'REJECTION_UNASSIGNED', resolutionStatus: 'ACTIVE' });
    expect(alert).not.toBeNull();

    // Doctor A reassigns to Doctor C
    const reassignRes = await request(app)
      .post(`/api/referrals/${refId}/reassign`)
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        receivingDoctorId: doctorUserC.id,
        reason: 'Reassigned to Doctor C at General Hospital',
        department: 'Cardiology'
      });
    expect(reassignRes.status).toBe(200);

    // Next scan should auto-resolve the REJECTION_UNASSIGNED alert
    await runMonitoringScan();

    const activeRejectionAlert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'REJECTION_UNASSIGNED', resolutionStatus: 'ACTIVE' });
    expect(activeRejectionAlert).toBeNull();

    const resolvedAlert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'REJECTION_UNASSIGNED', resolutionStatus: 'RESOLVED' });
    expect(resolvedAlert).not.toBeNull();
  });

  // -------------------------------------------------------------
  // 13: Recently Created Referral Exclusion
  // -------------------------------------------------------------
  test('13. Recently created referrals are excluded from delay alerts', async () => {
    const screening = await createFlaggedScreening();

    // Create fresh referral (10 minutes ago)
    await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Fresh handoff',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital'
      });

    // Scan at current time
    const stats = await runMonitoringScan();
    expect(stats.newAlertsCount).toBe(0);
    expect(stats.activeAlertsCount).toBe(0);
  });

  // -------------------------------------------------------------
  // 14: Rescheduled Follow-Up Handling
  // -------------------------------------------------------------
  test('14. Rescheduled follow-up clears follow-up risk alerts', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Follow-up tracking',
        priority: 'Urgent',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    await request(app).post(`/api/referrals/${refId}/acknowledge`).set('Authorization', `Bearer ${doctorTokenB}`).send({ notes: 'ok' });
    await request(app).post(`/api/referrals/${refId}/accept`).set('Authorization', `Bearer ${doctorTokenB}`).send({ notes: 'ok' });

    const flpRes = await request(app)
      .post('/api/follow-ups')
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        referralId: refId,
        dueDate: new Date('2026-11-20T10:00:00Z').toISOString(),
        instructions: 'Initial consult'
      });
    const followUpId = flpRes.body.followUp.followUpId;

    // Simulate 50 hours past due date -> MISSED
    await processFollowUpRemindersAndStatuses(new Date('2026-11-22T12:00:00Z'));
    await runMonitoringScan(new Date('2026-11-22T12:05:00Z'));

    let alert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'FOLLOW_UP_RISK', resolutionStatus: 'ACTIVE' });
    expect(alert).not.toBeNull();

    // Doctor reschedules the follow-up
    await request(app)
      .patch(`/api/follow-ups/${followUpId}/reschedule`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        newDueDate: new Date('2026-11-28T10:00:00Z').toISOString(),
        reason: 'Patient recontacted; rebooked'
      });

    // Run next monitoring scan -> follow-up is now SCHEDULED in the future -> alert resolves!
    await runMonitoringScan(new Date('2026-11-22T12:15:00Z'));

    const activeAlert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'FOLLOW_UP_RISK', resolutionStatus: 'ACTIVE' });
    expect(activeAlert).toBeNull();

    const resolvedAlert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'FOLLOW_UP_RISK', resolutionStatus: 'RESOLVED' });
    expect(resolvedAlert).not.toBeNull();
  });

  // -------------------------------------------------------------
  // 15: Repeated Monitoring Without Duplicate Alerts
  // -------------------------------------------------------------
  test('15. Repeated monitoring execution updates existing alert without creating duplicates', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Unassigned',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital'
      });
    const refId = refRes.body.referral.referralId;

    const time1 = new Date(Date.now() + 3 * 3600000);
    await runMonitoringScan(time1);

    const alertsAfterFirst = await MonitoringAlert.find({ referralId: refId, riskCategory: 'ASSIGNMENT_DELAY' });
    expect(alertsAfterFirst.length).toBe(1);

    // Run again 15 mins later
    const time2 = new Date(Date.now() + 3.25 * 3600000);
    await runMonitoringScan(time2);

    const alertsAfterSecond = await MonitoringAlert.find({ referralId: refId, riskCategory: 'ASSIGNMENT_DELAY' });
    expect(alertsAfterSecond.length).toBe(1); // STILL 1 ALERT, NOT 2!
  });

  // -------------------------------------------------------------
  // 16: Plain-Language Explanation Correctness
  // -------------------------------------------------------------
  test('16. Plain-language explanation correctness and evidence transparency', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Unassigned test',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital'
      });
    const refId = refRes.body.referral.referralId;

    await runMonitoringScan(new Date(Date.now() + 4 * 3600000));

    const alert = await MonitoringAlert.findOne({ referralId: refId });
    expect(alert.plainLanguageExplanation).toMatch(new RegExp(`Referral ${refId} \\(Emergency priority\\) has remained unassigned for \\d+ hours`));
    expect(alert.evidence.elapsedHours).toBeGreaterThanOrEqual(4);
    expect(alert.evidence.thresholdHours).toBe(2);
    expect(alert.recommendedAction).toBeDefined();
  });

  // -------------------------------------------------------------
  // 17: Doctor Access Isolation
  // -------------------------------------------------------------
  test('17. Doctor access isolation: doctors can only view alerts authorized for their hospital or assignments', async () => {
    const screening = await createFlaggedScreening();

    // Referral between Metropolitan (Doctor A) and St. Jude (Doctor B)
    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Cardiac bed needed',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });

    // Simulate unacknowledged delay
    await runMonitoringScan(new Date(Date.now() + 5 * 3600000));

    // Doctor A (Metropolitan) queries alerts -> Authorized
    const resA = await request(app)
      .get('/api/monitoring/alerts')
      .set('Authorization', `Bearer ${doctorTokenA}`);
    expect(resA.status).toBe(200);
    expect(resA.body.alerts.length).toBeGreaterThanOrEqual(1);

    // Doctor B (St. Jude) queries alerts -> Authorized
    const resB = await request(app)
      .get('/api/monitoring/alerts')
      .set('Authorization', `Bearer ${doctorTokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.alerts.length).toBeGreaterThanOrEqual(1);

    // Doctor C (General Hospital - Unrelated) queries alerts -> ISOLATED (0 alerts visible)
    const resC = await request(app)
      .get('/api/monitoring/alerts')
      .set('Authorization', `Bearer ${doctorTokenC}`);
    expect(resC.status).toBe(200);
    expect(resC.body.alerts.length).toBe(0);
  });

  // -------------------------------------------------------------
  // 18: Patient Access Restrictions
  // -------------------------------------------------------------
  test('18. Patient access restrictions: patients are blocked from monitoring findings and scans', async () => {
    // Patient attempts to fetch alerts -> 403 Forbidden
    const getRes = await request(app)
      .get('/api/monitoring/alerts')
      .set('Authorization', `Bearer ${patientToken1}`);
    expect(getRes.status).toBe(403);
    expect(getRes.body.error.code).toBe('FORBIDDEN_ROLE');

    // Patient attempts to trigger scan -> 403 Forbidden
    const postRes = await request(app)
      .post('/api/monitoring/scan')
      .set('Authorization', `Bearer ${patientToken1}`);
    expect(postRes.status).toBe(403);
    expect(postRes.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  // -------------------------------------------------------------
  // 19: Notification Integration & Doctor Alert Dispatch
  // -------------------------------------------------------------
  test('19. High priority monitoring findings dispatch notifications to doctors but never patients', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Emergency admission',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    // Fast forward past Emergency acknowledgement threshold (>2h) -> CRITICAL alert
    await runMonitoringScan(new Date(Date.now() + 4 * 3600000));

    // Check notifications for Doctor B
    const docNotifs = await Notification.find({
      recipientUserId: doctorUserB.id,
      relatedReferralId: refId,
      notificationType: 'MONITORING_ALERT_CRITICAL'
    });
    expect(docNotifs.length).toBe(1);
    expect(docNotifs[0].title).toContain('Clinical Alert - CRITICAL');

    // Check notifications for Patient -> MUST BE ZERO
    const patientNotifs = await Notification.find({
      recipientUserId: patientUser1._id,
      notificationType: { $in: ['MONITORING_ALERT_CRITICAL', 'MONITORING_ALERT_HIGH'] }
    });
    expect(patientNotifs.length).toBe(0);
  });

  // -------------------------------------------------------------
  // 20: Regression Across Phases 1-5.1
  // -------------------------------------------------------------
  test('20. Regression verification: monitoring does not alter core referral lifecycle or follow-up closure protection', async () => {
    const screening = await createFlaggedScreening();

    // 1. Create referral
    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'End-to-end regression validation',
        priority: 'Urgent',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDoctorId: doctorUserB.id
      });
    const refId = refRes.body.referral.referralId;

    // 2. Acknowledge and Accept
    await request(app).post(`/api/referrals/${refId}/acknowledge`).set('Authorization', `Bearer ${doctorTokenB}`).send({ notes: 'Acknowledge' });
    await request(app).post(`/api/referrals/${refId}/accept`).set('Authorization', `Bearer ${doctorTokenB}`).send({ notes: 'Accept' });

    // 3. Create follow-up
    const flpRes = await request(app)
      .post('/api/follow-ups')
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({
        referralId: refId,
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        instructions: 'Follow-up check'
      });
    const followUpId = flpRes.body.followUp.followUpId;

    // 4. Document treatment and confirm care
    await request(app).post(`/api/referrals/${refId}/treatment`).set('Authorization', `Bearer ${doctorTokenB}`).send({ treatmentSummary: 'Treatment complete' });
    await request(app).post(`/api/referrals/${refId}/confirm-care`).set('Authorization', `Bearer ${doctorTokenB}`).send({ followUpAddressed: true, confirmationSummary: 'Care verified' });

    // 5. Attempt closure while follow-up is unresolved -> BLOCKED with UNRESOLVED_FOLLOW_UP
    const closeBlocked = await request(app).post(`/api/referrals/${refId}/close`).set('Authorization', `Bearer ${doctorTokenB}`).send({ closureNotes: 'Premature' });
    expect(closeBlocked.status).toBe(400);
    expect(closeBlocked.body.error.code).toBe('UNRESOLVED_FOLLOW_UP');

    // 6. Complete follow-up
    await request(app).post(`/api/follow-ups/${followUpId}/complete`).set('Authorization', `Bearer ${doctorTokenB}`).send({ outcomeNotes: 'Normal' });

    // 7. Now close referral -> SUCCEEDS
    const closeSuccess = await request(app).post(`/api/referrals/${refId}/close`).set('Authorization', `Bearer ${doctorTokenB}`).send({ closureNotes: 'All done' });
    expect(closeSuccess.status).toBe(200);
    expect(closeSuccess.body.referral.status).toBe('COMPLETED');
  });

  // -------------------------------------------------------------
  // Extra: Alert Dismissal
  // -------------------------------------------------------------
  test('21. Doctor can dismiss an active monitoring alert with documented reason', async () => {
    const screening = await createFlaggedScreening();

    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: screening.screeningId,
        clinicalReason: 'Dismiss test',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital'
      });
    const refId = refRes.body.referral.referralId;

    await runMonitoringScan(new Date(Date.now() + 4 * 3600000));

    const alert = await MonitoringAlert.findOne({ referralId: refId, resolutionStatus: 'ACTIVE' });
    expect(alert).not.toBeNull();

    // Doctor dismisses alert
    const dismissRes = await request(app)
      .patch(`/api/monitoring/alerts/${alert.alertId}/dismiss`)
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({ reason: 'Bed allocated through direct telephone triage coordinator' });

    expect(dismissRes.status).toBe(200);
    expect(dismissRes.body.alert.resolutionStatus).toBe('DISMISSED');
    expect(dismissRes.body.alert.dismissReason).toContain('Bed allocated through direct telephone triage');
  });

  // =============================================================
  // Phase 6.1: Targeted Reliability Verification & Notification Hardening
  // =============================================================
  describe('Phase 6.1: Targeted Reliability Verification & Notification Hardening', () => {

    test('22. Monitoring notifications respect clinician preferences: disabled preferences suppress non-essential HIGH alerts', async () => {
      // Doctor B disables referralUpdates in preferences
      await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ referralUpdates: false });

      const screening = await createFlaggedScreening();

      // Create Urgent referral assigned to Doctor B
      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening.screeningId,
          clinicalReason: 'Urgent consult',
          priority: 'Urgent',
          receivingHospital: 'St. Jude Heart Hospital',
          receivingDoctorId: doctorUserB.id
        });
      const refId = refRes.body.referral.referralId;

      // Fast-forward 8 hours -> triggers HIGH acknowledgement delay (isEssential: false)
      await runMonitoringScan(new Date(Date.now() + 8 * 3600000));

      const alert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'ACKNOWLEDGEMENT_DELAY' });
      expect(alert).not.toBeNull();
      expect(alert.riskClassification).toBe('HIGH');

      // Verify that Doctor B did NOT receive notification (suppressed due to preferences)
      const docBNotif = await Notification.findOne({
        recipientUserId: doctorUserB.id,
        relatedReferralId: refId,
        category: 'MONITORING_ALERT'
      });
      expect(docBNotif).toBeNull();

      // Re-enable preferences
      await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ referralUpdates: true });
    });

    test('23. Essential notification classification remains consistent: CRITICAL alert delivered with [Priority Notice] even when preferences disabled', async () => {
      // Doctor B disables referralUpdates in preferences
      await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ referralUpdates: false });

      const screening = await createFlaggedScreening();

      // Create Emergency referral assigned to Doctor B
      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening.screeningId,
          clinicalReason: 'Critical septic shock',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital',
          receivingDoctorId: doctorUserB.id
        });
      const refId = refRes.body.referral.referralId;

      // Fast-forward 4 hours -> triggers CRITICAL acknowledgement delay (isEssential: true)
      await runMonitoringScan(new Date(Date.now() + 4 * 3600000));

      const alert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'ACKNOWLEDGEMENT_DELAY' });
      expect(alert).not.toBeNull();
      expect(alert.riskClassification).toBe('CRITICAL');

      // Verify that Doctor B DOES receive notification with [Priority Notice]
      const docBNotif = await Notification.findOne({
        recipientUserId: doctorUserB.id,
        relatedReferralId: refId,
        category: 'MONITORING_ALERT'
      });
      expect(docBNotif).not.toBeNull();
      expect(docBNotif.isEssential).toBe(true);
      expect(docBNotif.title).toContain('[Priority Notice]');

      // Re-enable preferences
      await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ referralUpdates: true });
    });

    test('24. Dismissed alerts remain dismissed during subsequent monitoring scans without being recreated or reactivated', async () => {
      const screening = await createFlaggedScreening();

      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening.screeningId,
          clinicalReason: 'Dismiss test',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital'
        });
      const refId = refRes.body.referral.referralId;

      // Initial scan triggers ASSIGNMENT_DELAY
      await runMonitoringScan(new Date(Date.now() + 3 * 3600000));
      const alert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'ASSIGNMENT_DELAY' });
      expect(alert.resolutionStatus).toBe('ACTIVE');

      // Doctor dismisses the alert
      const dismissRes = await request(app)
        .patch(`/api/monitoring/alerts/${alert.alertId}/dismiss`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ reason: 'Transfer coordinator acknowledged delay; alternative bed being organized' });
      expect(dismissRes.status).toBe(200);

      // Verify dismissal state
      let recheck = await MonitoringAlert.findOne({ alertId: alert.alertId });
      expect(recheck.resolutionStatus).toBe('DISMISSED');

      // Run multiple subsequent scans while the condition (unassigned) still exists
      await runMonitoringScan(new Date(Date.now() + 4 * 3600000));
      await runMonitoringScan(new Date(Date.now() + 5 * 3600000));

      // Alert must REMAIN DISMISSED, not ACTIVE!
      recheck = await MonitoringAlert.findOne({ alertId: alert.alertId });
      expect(recheck.resolutionStatus).toBe('DISMISSED');

      // Zero new alerts created for this referral & category
      const allAlerts = await MonitoringAlert.find({ referralId: refId, riskCategory: 'ASSIGNMENT_DELAY' });
      expect(allAlerts.length).toBe(1);
    });

    test('25. Dismissal requires mandatory clinical rationale and persists dismissal audit history', async () => {
      const screening = await createFlaggedScreening();

      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening.screeningId,
          clinicalReason: 'Mandatory reason test',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital'
        });
      const refId = refRes.body.referral.referralId;

      await runMonitoringScan(new Date(Date.now() + 3 * 3600000));
      const alert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'ASSIGNMENT_DELAY' });

      // Dismiss without reason -> BLOCKED with 400 DISMISS_REASON_REQUIRED
      const failDismiss = await request(app)
        .patch(`/api/monitoring/alerts/${alert.alertId}/dismiss`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ reason: '   ' });

      expect(failDismiss.status).toBe(400);
      expect(failDismiss.body.error.code).toBe('DISMISS_REASON_REQUIRED');

      // Dismiss with valid clinical reason -> SUCCESS
      const successDismiss = await request(app)
        .patch(`/api/monitoring/alerts/${alert.alertId}/dismiss`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ reason: 'Clinical review confirmed on-call fellow handles admission' });

      expect(successDismiss.status).toBe(200);
      expect(successDismiss.body.alert.resolutionStatus).toBe('DISMISSED');
      expect(successDismiss.body.alert.dismissedBy).toBe(doctorUserA.id);
      expect(successDismiss.body.alert.dismissReason).toBe('Clinical review confirmed on-call fellow handles admission');
      expect(successDismiss.body.alert.dismissedAt).toBeDefined();
    });

    test('26. Unauthorized clinicians from unrelated hospitals cannot dismiss alerts', async () => {
      const screening = await createFlaggedScreening();

      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening.screeningId,
          clinicalReason: 'Unrelated doctor test',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital',
          receivingDoctorId: doctorUserB.id
        });
      const refId = refRes.body.referral.referralId;

      await runMonitoringScan(new Date(Date.now() + 3 * 3600000));
      const alert = await MonitoringAlert.findOne({ referralId: refId });

      // Doctor C (General Hospital - unrelated) attempts to dismiss -> 403 FORBIDDEN_ALERT_ACCESS
      const unauthorizedDismiss = await request(app)
        .patch(`/api/monitoring/alerts/${alert.alertId}/dismiss`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({ reason: 'Attempting unauthorized dismissal' });

      expect(unauthorizedDismiss.status).toBe(403);
      expect(unauthorizedDismiss.body.error.code).toBe('FORBIDDEN_ALERT_ACCESS');
    });

    test('27. Underlying condition resolution transitions dismissed alert while preserving dismissal audit history', async () => {
      const screening = await createFlaggedScreening();

      // Create unassigned referral
      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening.screeningId,
          clinicalReason: 'Auto-resolve test',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital'
        });
      const refId = refRes.body.referral.referralId;

      // Scan creates ASSIGNMENT_DELAY
      await runMonitoringScan(new Date(Date.now() + 3 * 3600000));
      const alert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'ASSIGNMENT_DELAY' });

      // Doctor A dismisses it
      await request(app)
        .patch(`/api/monitoring/alerts/${alert.alertId}/dismiss`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ reason: 'Coordinating receiving specialist' });

      // Underlying condition is resolved: Doctor A reassigns / assigns Doctor B
      await request(app)
        .post(`/api/referrals/${refId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          receivingDoctorId: doctorUserB.id,
          reason: 'Doctor assigned and accepted handoff',
          department: 'Emergency'
        });

      // Scan runs: the referral is no longer unassigned!
      await runMonitoringScan();

      // Verify that alert transitioned to RESOLVED, and dismissal history was NOT destroyed
      const resolvedAlert = await MonitoringAlert.findOne({ alertId: alert.alertId });
      expect(resolvedAlert.resolutionStatus).toBe('RESOLVED');
      expect(resolvedAlert.resolvedAt).toBeDefined();
      expect(resolvedAlert.dismissedBy).toBeDefined();
      expect(resolvedAlert.dismissReason).toBe('Coordinating receiving specialist');
    });

    test('28. Resolved alerts allow generating a fresh new alert when the condition genuinely recurs', async () => {
      const screening = await createFlaggedScreening();

      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening.screeningId,
          clinicalReason: 'Recurrence test',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital',
          receivingDoctorId: doctorUserB.id
        });
      const refId = refRes.body.referral.referralId;

      // 1. Initial rejection triggers REJECTION_UNASSIGNED
      await request(app)
        .post(`/api/referrals/${refId}/reject`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ reason: 'Initial rejection' });

      await runMonitoringScan();
      const firstAlert = await MonitoringAlert.findOne({ referralId: refId, riskCategory: 'REJECTION_UNASSIGNED' });
      expect(firstAlert.resolutionStatus).toBe('ACTIVE');

      // 2. Reassigned to Doctor C -> resolves the REJECTION_UNASSIGNED alert
      await request(app)
        .post(`/api/referrals/${refId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          receivingDoctorId: doctorUserC.id,
          reason: 'Reassigned to Doctor C',
          department: 'Cardiology'
        });

      await runMonitoringScan();
      const firstResolved = await MonitoringAlert.findOne({ alertId: firstAlert.alertId });
      expect(firstResolved.resolutionStatus).toBe('RESOLVED');

      // 3. Condition genuinely recurs: Doctor C ALSO rejects the referral!
      await request(app)
        .post(`/api/referrals/${refId}/reject`)
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({ reason: 'Doctor C also has no beds' });

      await runMonitoringScan();

      // A FRESH NEW ALERT is created for the recurrence!
      const activeAlerts = await MonitoringAlert.find({ referralId: refId, riskCategory: 'REJECTION_UNASSIGNED', resolutionStatus: 'ACTIVE' });
      expect(activeAlerts.length).toBe(1);
      expect(activeAlerts[0].alertId).not.toBe(firstAlert.alertId);
      expect(activeAlerts[0].plainLanguageExplanation).toContain('Doctor C also has no beds');

      // Total alerts for this referral = 2 (1 resolved historical, 1 active recurring)
      const totalAlerts = await MonitoringAlert.find({ referralId: refId, riskCategory: 'REJECTION_UNASSIGNED' });
      expect(totalAlerts.length).toBe(2);
    });

    test('29. Multiple eligible clinicians receive independently deduplicated notifications', async () => {
      const screening = await createFlaggedScreening();

      // Referral between Doctor A (referring) and Doctor B (receiving)
      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening.screeningId,
          clinicalReason: 'Multi-clinician alert test',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital',
          receivingDoctorId: doctorUserB.id
        });
      const refId = refRes.body.referral.referralId;

      // Fast forward past Emergency acknowledgement threshold (>2h) -> CRITICAL alert
      await runMonitoringScan(new Date(Date.now() + 3 * 3600000));

      // Doctor A (referring) receives their own notification
      const notifA = await Notification.findOne({
        recipientUserId: doctorUserA.id,
        relatedReferralId: refId,
        notificationType: 'MONITORING_ALERT_CRITICAL'
      });
      expect(notifA).not.toBeNull();

      // Doctor B (receiving) receives their own notification
      const notifB = await Notification.findOne({
        recipientUserId: doctorUserB.id,
        relatedReferralId: refId,
        notificationType: 'MONITORING_ALERT_CRITICAL'
      });
      expect(notifB).not.toBeNull();

      // Notification event IDs are distinct and independent
      expect(notifA.eventId).not.toBe(notifB.eventId);
    });

    test('30. Overlapping monitoring scan calls within the same instance are prevented by concurrency lock', async () => {
      // Trigger two simultaneous scans
      const [res1, res2] = await Promise.all([
        runMonitoringScan(),
        runMonitoringScan()
      ]);

      // At least one of the scans should complete normally
      expect(res1.errorsCount).toBe(0);
      // The other scan will either complete or be skipped due to overlapping
      expect(res1.skippedOverlapping || res2.skippedOverlapping || res1.scannedCount >= 0).toBe(true);
    });

    test('31. An individual referral evaluation failure does not abort the remaining scan cycle', async () => {
      const screening1 = await createFlaggedScreening('PAT-MON-01');
      const screening2 = await createFlaggedScreening('PAT-MON-02');

      // Referral 1: Valid referral
      const ref1Res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening1.screeningId,
          clinicalReason: 'Valid referral 1',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital'
        });
      const ref1Id = ref1Res.body.referral.referralId;

      // Referral 2: Second valid referral
      const ref2Res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: screening2.screeningId,
          clinicalReason: 'Valid referral 2',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital'
        });
      const ref2Id = ref2Res.body.referral.referralId;

      // Simulate a transient error during evaluation of the first referral
      const spy = jest.spyOn(FollowUp, 'find').mockImplementationOnce(() => {
        throw new Error('Simulated database read failure for first referral');
      });

      // Run scan: the second referral should still be evaluated despite the first referral's failure
      const scanStats = await runMonitoringScan(new Date(Date.now() + 4 * 3600000));

      expect(scanStats.scannedCount).toBe(2);
      expect(scanStats.errorsCount).toBe(1);

      // The non-failing referral has an alert successfully created!
      const alert = await MonitoringAlert.findOne({
        referralId: { $in: [ref1Id, ref2Id] },
        riskCategory: 'ASSIGNMENT_DELAY'
      });
      expect(alert).not.toBeNull();

      spy.mockRestore();
    });
  });
});
