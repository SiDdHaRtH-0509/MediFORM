const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');
const FollowUp = require('../models/FollowUp');
const Notification = require('../models/Notification');
const { processFollowUpRemindersAndStatuses } = require('../services/followUpSchedulerService');

jest.setTimeout(60000);

let mongoServer;
let doctorTokenA; // Referring Doctor (Metropolitan)
let doctorUserA;
let doctorTokenB; // Receiving Doctor (St. Jude)
let doctorUserB;
let doctorTokenC; // Unrelated Doctor (General Hospital)
let doctorUserC;
let patientToken1; // Patient 1 (PAT-FLP-01)
let patientUser1;
let patientToken2; // Patient 2 (PAT-FLP-02)
let patientUser2;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // 1. Doctor A: Metropolitan Hospital
  const docRegA = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.alice.flp@metropolitan.health',
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

  // 2. Doctor B: St. Jude Hospital
  const docRegB = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.bob.flp@stjude.health',
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
      email: 'dr.clara.flp@general.health',
      name: 'Dr. Clara Oswald',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'General Community Clinic'
    });
  const docVerifyC = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegC.body.challengeId, otp: docRegC.body.devOtp });
  doctorTokenC = docVerifyC.body.token;
  doctorUserC = docVerifyC.body.user;

  // 4. Patient 1 & Patient 2
  patientUser1 = await User.create({
    email: 'sarah.flp@patient.mediform.org',
    username: 'PAT-FLP-01',
    password: 'password123',
    role: 'patient',
    isEmailVerified: true,
    notificationPreferences: {
      referralUpdates: true,
      appointmentReminders: true,
      followUpReminders: true,
      generalCareUpdates: true
    }
  });

  patientUser2 = await User.create({
    email: 'john.flp@patient.mediform.org',
    username: 'PAT-FLP-02',
    password: 'password123',
    role: 'patient',
    isEmailVerified: true,
    notificationPreferences: {
      referralUpdates: true,
      appointmentReminders: true,
      followUpReminders: true,
      generalCareUpdates: true
    }
  });

  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';
  patientToken1 = jwt.sign(
    { userId: patientUser1._id, username: patientUser1.username, role: 'patient', tokenVersion: 0 },
    secret,
    { expiresIn: '1h' }
  );
  patientToken2 = jwt.sign(
    { userId: patientUser2._id, username: patientUser2.username, role: 'patient', tokenVersion: 0 },
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

describe('Phase 5: Follow-Up & Missed Appointment Management Test Suite', () => {

  let testScreening;
  let testReferral;

  beforeEach(async () => {
    await FollowUp.deleteMany({});
    await Notification.deleteMany({});

    // Fresh flagged screening and referral for Patient 1
    const screeningRes = await request(app)
      .post('/api/screenings')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        pid: 'PAT-FLP-01',
        patientName: 'Sarah Connor',
        age: 38,
        gender: 'Female',
        bloodGroup: 'A+',
        vitals: { hr: 125, bp: '85/50', rr: 26, spo2: 89, temp: 39.1, gcs: 14 },
        clinicalNotes: 'Suspected severe sepsis needing ICU care',
        patientConsent: { consentGiven: true, consentMethod: 'Digital Signature' }
      });

    testScreening = screeningRes.body.screening;

    const referralRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: testScreening.screeningId,
        clinicalReason: 'Severe sepsis refractory to resuscitation; requires urgent step-up',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDepartment: 'Cardiothoracic ICU',
        receivingDoctorId: doctorUserB.id
      });

    testReferral = referralRes.body.referral;

    // Doctor B acknowledges & accepts referral
    await request(app)
      .post(`/api/referrals/${testReferral.referralId}/acknowledge`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Bed reserved' });

    await request(app)
      .post(`/api/referrals/${testReferral.referralId}/accept`)
      .set('Authorization', `Bearer ${doctorTokenB}`)
      .send({ notes: 'Accepted into ICU' });
  });

  describe('1. Follow-Up Creation & Authorization', () => {
    test('1. Authorized doctor can create a follow-up for an active referral', async () => {
      const dueDate = new Date(Date.now() + 86400000 * 3).toISOString(); // 3 days in future

      const res = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate,
          instructions: 'Repeat arterial blood gas and renal profile in 3 days',
          priority: 'Urgent'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.followUp).toBeDefined();
      expect(res.body.followUp.followUpId).toMatch(/^FLP-\d{4}-\d{6}$/);
      expect(res.body.followUp.status).toBe('SCHEDULED');
      expect(res.body.followUp.patientId).toBe('PAT-FLP-01');

      // Verify referral status transitioned to FOLLOW_UP_REQUIRED
      const updatedRef = await Referral.findById(testReferral._id);
      expect(updatedRef.status).toBe('FOLLOW_UP_REQUIRED');
      expect(updatedRef.treatmentDocumentation.followUpRequired).toBe(true);

      // Verify patient received FOLLOW_UP_SCHEDULED notification
      const patientNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        notificationType: 'FOLLOW_UP_SCHEDULED'
      });
      expect(patientNotif).not.toBeNull();
      expect(patientNotif.title).toBe('Follow-Up Visit Scheduled');
      expect(patientNotif.isEssential).toBe(true);
    });

    test('2. Unauthorized doctor cannot create follow-up for another hospital referral', async () => {
      const res = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenC}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
          instructions: 'Unauthorized follow-up'
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_FOLLOW_UP_CREATION');
    });

    test('3. Non-doctor (patient) cannot create follow-up', async () => {
      const res = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date().toISOString()
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    });
  });

  describe('2. Rescheduling & Invalidation of Obsolete Reminders', () => {
    test('4. Rescheduling updates due date, resets status, and records audit history', async () => {
      // Create initial follow-up
      const initialRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000 * 2).toISOString(),
          instructions: 'Initial review'
        });

      const followUpId = initialRes.body.followUp.followUpId;
      const newDueDate = new Date(Date.now() + 86400000 * 5).toISOString();

      // Attempt reschedule without reason -> blocked
      const failRes = await request(app)
        .patch(`/api/follow-ups/${followUpId}/reschedule`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ newDueDate, reason: '' });
      expect(failRes.status).toBe(400);
      expect(failRes.body.error.code).toBe('RESCHEDULE_REASON_REQUIRED');

      // Reschedule with clinical reason
      const rescheduleRes = await request(app)
        .patch(`/api/follow-ups/${followUpId}/reschedule`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          newDueDate,
          reason: 'Patient unwell with secondary fever; consultation delayed'
        });

      expect(rescheduleRes.status).toBe(200);
      expect(rescheduleRes.body.followUp.status).toBe('SCHEDULED');
      expect(rescheduleRes.body.followUp.rescheduleHistory).toHaveLength(1);
      expect(rescheduleRes.body.followUp.rescheduleHistory[0].reason).toContain('delayed');

      // Verify patient received FOLLOW_UP_RESCHEDULED notification
      const reschedNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        notificationType: 'FOLLOW_UP_RESCHEDULED'
      });
      expect(reschedNotif).not.toBeNull();
      expect(reschedNotif.title).toBe('Follow-Up Appointment Rescheduled');
    });
  });

  describe('3. Automated Reminder Progression & Missed Detection', () => {
    test('5. Upcoming reminder generated when appointment is within 24 hours', async () => {
      const now = new Date('2026-11-20T10:00:00Z');
      // Due in 18 hours (within 24-hour upcoming window)
      const dueDate = new Date('2026-11-21T04:00:00Z');

      const createRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: dueDate.toISOString(),
          instructions: 'Cardiology follow-up'
        });

      // Run automated scheduler cycle with simulated timestamp
      const stats = await processFollowUpRemindersAndStatuses(now);
      expect(stats.processedCount).toBeGreaterThanOrEqual(1);

      // Verify status progressed to UPCOMING
      const updatedFlp = await FollowUp.findOne({ followUpId: createRes.body.followUp.followUpId });
      expect(updatedFlp.status).toBe('UPCOMING');

      // Verify patient received UPCOMING reminder
      const notif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        notificationType: 'FOLLOW_UP_REMINDER_UPCOMING'
      });
      expect(notif).not.toBeNull();
      expect(notif.title).toBe('Upcoming Follow-Up Reminder');
    });

    test('6. Due-date reminder generated when appointment is due within 2 hours', async () => {
      const now = new Date('2026-11-20T10:00:00Z');
      // Due in 1 hour
      const dueDate = new Date('2026-11-20T11:00:00Z');

      const createRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: dueDate.toISOString(),
          instructions: 'Wound inspection'
        });

      const stats = await processFollowUpRemindersAndStatuses(now);
      expect(stats.processedCount).toBeGreaterThanOrEqual(1);

      const updatedFlp = await FollowUp.findOne({ followUpId: createRes.body.followUp.followUpId });
      expect(updatedFlp.status).toBe('DUE');

      const notif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        notificationType: 'FOLLOW_UP_REMINDER_DUE'
      });
      expect(notif).not.toBeNull();
      expect(notif.title).toBe('Follow-Up Visit Due Today');
    });

    test('7. Overdue detection: appointment past due date (>15 mins) flagged OVERDUE with notifications', async () => {
      const now = new Date('2026-11-20T12:00:00Z');
      // Due 2 hours ago
      const dueDate = new Date('2026-11-20T10:00:00Z');

      const createRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: dueDate.toISOString(),
          instructions: 'Urgent post-op check'
        });

      await processFollowUpRemindersAndStatuses(now);

      const updatedFlp = await FollowUp.findOne({ followUpId: createRes.body.followUp.followUpId });
      expect(updatedFlp.status).toBe('OVERDUE');

      // Patient received overdue notice
      const patNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        notificationType: 'FOLLOW_UP_OVERDUE'
      });
      expect(patNotif).not.toBeNull();
      expect(patNotif.title).toBe('Follow-Up Visit Overdue');

      // Responsible doctor received overdue alert
      const docNotif = await Notification.findOne({
        recipientUserId: doctorUserB.id,
        notificationType: 'FOLLOW_UP_OVERDUE'
      });
      expect(docNotif).not.toBeNull();
      expect(docNotif.title).toBe('Follow-Up Overdue Alert');
    });

    test('8. Missed follow-up detection: appointment past missed threshold (>48 hours) flagged MISSED with doctor alert', async () => {
      const now = new Date('2026-11-23T12:00:00Z');
      // Due 3 days (72 hours) ago
      const dueDate = new Date('2026-11-20T12:00:00Z');

      const createRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: dueDate.toISOString(),
          instructions: 'Cardiac follow-up'
        });

      await processFollowUpRemindersAndStatuses(now);

      const updatedFlp = await FollowUp.findOne({ followUpId: createRes.body.followUp.followUpId });
      expect(updatedFlp.status).toBe('MISSED');
      expect(updatedFlp.missedAt).not.toBeNull();

      // Patient received missed notice
      const patNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        notificationType: 'FOLLOW_UP_MISSED'
      });
      expect(patNotif).not.toBeNull();
      expect(patNotif.title).toBe('Missed Follow-Up Appointment');

      // Doctor received actionable alert
      const docNotif = await Notification.findOne({
        recipientUserId: doctorUserB.id,
        notificationType: 'FOLLOW_UP_MISSED'
      });
      expect(docNotif).not.toBeNull();
      expect(docNotif.title).toBe('Action Required: Patient Missed Follow-Up');
    });

    test('9. Repeated scheduler execution does NOT generate duplicate notifications (Database Idempotency)', async () => {
      const now = new Date('2026-11-23T12:00:00Z');
      const dueDate = new Date('2026-11-20T12:00:00Z');

      await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: dueDate.toISOString(),
          instructions: 'Repeat scheduler test'
        });

      // Run cycle 1
      await processFollowUpRemindersAndStatuses(now);
      const count1 = await Notification.countDocuments({
        relatedReferralId: testReferral.referralId,
        notificationType: 'FOLLOW_UP_MISSED'
      });
      expect(count1).toBeGreaterThanOrEqual(1);

      // Run cycle 2 and cycle 3
      await processFollowUpRemindersAndStatuses(now);
      await processFollowUpRemindersAndStatuses(now);

      const countAfter = await Notification.countDocuments({
        relatedReferralId: testReferral.referralId,
        notificationType: 'FOLLOW_UP_MISSED'
      });
      expect(countAfter).toBe(count1);
    });

    test('10. Completed follow-up stops receiving any further reminders', async () => {
      const now = new Date('2026-11-20T10:00:00Z');
      const dueDate = new Date('2026-11-20T11:00:00Z');

      const createRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: dueDate.toISOString(),
          instructions: 'Completed check'
        });

      const followUpId = createRes.body.followUp.followUpId;

      // Doctor completes the follow-up
      const compRes = await request(app)
        .post(`/api/follow-ups/${followUpId}/complete`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          outcomeNotes: 'Patient evaluated; recovered satisfactorily',
          treatmentSummary: 'Discharged from active follow-up'
        });
      expect(compRes.status).toBe(200);
      expect(compRes.body.followUp.status).toBe('COMPLETED');

      // Clear notifications log
      const notifsBefore = await Notification.countDocuments();

      // Simulate overdue time
      const overdueTime = new Date('2026-11-25T10:00:00Z');
      await processFollowUpRemindersAndStatuses(overdueTime);

      // Zero new overdue/missed reminder notifications generated for this completed follow-up
      const overdueNotif = await Notification.findOne({
        eventId: { $regex: followUpId },
        notificationType: { $in: ['FOLLOW_UP_OVERDUE', 'FOLLOW_UP_MISSED'] }
      });
      expect(overdueNotif).toBeNull();
    });

    test('11. Cancelled follow-up stops receiving any further reminders', async () => {
      const dueDate = new Date('2026-11-20T11:00:00Z');

      const createRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: dueDate.toISOString(),
          instructions: 'Cancel check'
        });

      const followUpId = createRes.body.followUp.followUpId;

      // Doctor cancels follow-up
      const cancelRes = await request(app)
        .patch(`/api/follow-ups/${followUpId}/cancel`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ reason: 'Patient moved out of state' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.followUp.status).toBe('CANCELLED');

      // Simulate overdue time
      const overdueTime = new Date('2026-11-25T10:00:00Z');
      await processFollowUpRemindersAndStatuses(overdueTime);

      const overdueNotif = await Notification.findOne({
        eventId: `FLP_OVERDUE_${followUpId}_${dueDate.getTime()}`
      });
      expect(overdueNotif).toBeNull();
    });
  });

  describe('4. Referral Lifecycle Integration & Closure Protection', () => {
    test('12. Referral closure is BLOCKED while active follow-up is unresolved', async () => {
      // Document treatment first (required before closure)
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ treatmentSummary: 'Critical resuscitation completed' });

      // Confirm care with follow-up planned
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          followUpAddressed: true,
          followUpPlan: 'Post-op clinic visit'
        });

      // Schedule an active structured follow-up
      await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000 * 4).toISOString(),
          instructions: 'Unresolved follow-up'
        });

      // Attempt to close referral -> BLOCKED
      const closeRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Attempting premature close' });

      expect(closeRes.status).toBe(400);
      expect(closeRes.body.error.code).toBe('UNRESOLVED_FOLLOW_UP');
      expect(closeRes.body.error.message).toContain('remain unresolved');
    });

    test('13. Referral closure is ALLOWED after all structured follow-ups are completed or cancelled', async () => {
      // Document treatment
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ treatmentSummary: 'Critical resuscitation completed' });

      // Create structured follow-up
      const flpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000 * 2).toISOString(),
          instructions: 'Wound care'
        });

      const followUpId = flpRes.body.followUp.followUpId;

      // Complete the structured follow-up
      await request(app)
        .post(`/api/follow-ups/${followUpId}/complete`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          outcomeNotes: 'Wound healed by first intention',
          treatmentSummary: 'Completed clinical follow-up'
        });

      // Confirm care
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          followUpAddressed: true,
          confirmationSummary: 'Attending physician confirms full clinical resolution'
        });

      // Close referral -> SUCCEEDS
      const closeRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Care completely delivered and closed' });

      expect(closeRes.status).toBe(200);
      expect(closeRes.body.referral.status).toBe('COMPLETED');
      expect(closeRes.body.referral.closure.isClosed).toBe(true);
    });

    test('14. Multiple follow-ups for a single referral are supported and trackable', async () => {
      // Follow-Up 1
      const flp1 = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000).toISOString(),
          instructions: 'First consult'
        });

      // Follow-Up 2
      const flp2 = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000 * 7).toISOString(),
          instructions: 'Second consult (suture removal)'
        });

      expect(flp1.status).toBe(201);
      expect(flp2.status).toBe(201);
      expect(flp1.body.followUp.followUpId).not.toBe(flp2.body.followUp.followUpId);

      const allForRef = await FollowUp.find({ referralId: testReferral.referralId });
      expect(allForRef.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('5. Security, IDOR Protection & Attendance', () => {
    test('15. Patients can ONLY view their own follow-ups (IDOR Protection)', async () => {
      // Create follow-up for Patient 1
      const flpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
          instructions: 'Patient 1 visit'
        });

      const p1FollowUpId = flpRes.body.followUp.followUpId;

      // Patient 2 queries follow-ups list: sees 0 of Patient 1's records
      const p2ListRes = await request(app)
        .get('/api/follow-ups')
        .set('Authorization', `Bearer ${patientToken2}`);

      expect(p2ListRes.status).toBe(200);
      const returnedIds = p2ListRes.body.followUps.map(f => f.followUpId);
      expect(returnedIds).not.toContain(p1FollowUpId);

      // Patient 2 attempts GET on Patient 1's follow-up: 403 FORBIDDEN_ACCESS
      const p2GetRes = await request(app)
        .get(`/api/follow-ups/${p1FollowUpId}`)
        .set('Authorization', `Bearer ${patientToken2}`);

      expect(p2GetRes.status).toBe(403);
      expect(p2GetRes.body.error.code).toBe('FORBIDDEN_ACCESS');
    });

    test('16. Patient attendance check-in records check-in but does NOT mark clinical completion', async () => {
      const flpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
          instructions: 'Patient check-in test'
        });

      const followUpId = flpRes.body.followUp.followUpId;

      // Patient performs self check-in
      const checkInRes = await request(app)
        .patch(`/api/follow-ups/${followUpId}/attendance`)
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({ attended: true, notes: 'Checked in via portal' });

      expect(checkInRes.status).toBe(200);
      expect(checkInRes.body.attendance.attended).toBe(true);
      expect(checkInRes.body.attendance.confirmedBy).toBe('PATIENT');

      // Verify status is STILL SCHEDULED (patient check-in is NOT medical completion)
      const checkFlp = await FollowUp.findOne({ followUpId });
      expect(checkFlp.status).toBe('SCHEDULED');
      expect(checkFlp.clinicalCompletion.isCompleted).toBe(false);

      // Patient attempts to mark clinically completed -> BLOCKED with 403
      const failComp = await request(app)
        .post(`/api/follow-ups/${followUpId}/complete`)
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({ outcomeNotes: 'Attempted patient self-completion' });

      expect(failComp.status).toBe(403);
      expect(failComp.body.error.code).toBe('FORBIDDEN_ROLE');
    });

    test('17. Notification preference: non-essential reminders suppressed when opted out, but essential reminders delivered with priority notice', async () => {
      // Patient 1 disables followUpReminders
      await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({ followUpReminders: false });

      const now = new Date('2026-11-20T10:00:00Z');
      // 18 hours until due -> UPCOMING window (non-essential)
      const dueDate = new Date('2026-11-21T04:00:00Z');

      const flpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: dueDate.toISOString(),
          instructions: 'Preference test'
        });

      expect(flpRes.status).toBe(201);

      // Run scheduler
      await processFollowUpRemindersAndStatuses(now);

      // Non-essential upcoming reminder should be SUPPRESSED (null)
      const upcomingNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'FOLLOW_UP_REMINDER_UPCOMING'
      });
      expect(upcomingNotif).toBeNull();

      // Trigger overdue time (essential reminder)
      const overdueTime = new Date('2026-11-21T06:00:00Z');
      await processFollowUpRemindersAndStatuses(overdueTime);

      // Essential overdue notice MUST NOT be suppressed and must have [Priority Notice]
      const overdueNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'FOLLOW_UP_OVERDUE'
      });
      expect(overdueNotif).not.toBeNull();
      expect(overdueNotif.title).toContain('[Priority Notice]');
      expect(overdueNotif.isEssential).toBe(true);

      // Re-enable preferences
      await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({ followUpReminders: true });
    });
  });

  describe('6. Phase 5.1: Missed Follow-Up Closure Protection & Transition Verification', () => {
    test('18. Referral closure is BLOCKED when a follow-up is MISSED with standard UNRESOLVED_FOLLOW_UP error', async () => {
      // Document treatment
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ treatmentSummary: 'Initial emergency stabilization complete' });

      // Confirm care
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          followUpAddressed: true,
          confirmationSummary: 'Physician confirms stabilization with required follow-up'
        });

      // Create a follow-up
      const flpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date('2026-11-20T10:00:00Z').toISOString(),
          instructions: 'Cardiology clinic review'
        });
      expect(flpRes.status).toBe(201);
      const followUpId = flpRes.body.followUp.followUpId;

      // Simulate passage of time past missed threshold (>48 hours)
      const missedTime = new Date('2026-11-23T10:00:00Z');
      await processFollowUpRemindersAndStatuses(missedTime);

      const checkFlp = await FollowUp.findOne({ followUpId });
      expect(checkFlp.status).toBe('MISSED');

      // Attempt to close referral -> BLOCKED by MISSED follow-up
      const closeRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Attempting to close with missed follow-up' });

      expect(closeRes.status).toBe(400);
      expect(closeRes.body.error.code).toBe('UNRESOLVED_FOLLOW_UP');
      expect(closeRes.body.error.message).toContain('required follow-up appointment(s) remain unresolved');
    });

    test('19. Referral closure remains BLOCKED when multiple follow-ups exist and at least one is MISSED', async () => {
      // Document treatment and care confirmation
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ treatmentSummary: 'Treatment documented' });

      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          followUpAddressed: true,
          confirmationSummary: 'Care confirmed'
        });

      // Follow-Up 1: Scheduled and completed
      const flp1Res = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000).toISOString(),
          instructions: 'Visit 1'
        });
      const flp1Id = flp1Res.body.followUp.followUpId;

      await request(app)
        .post(`/api/follow-ups/${flp1Id}/complete`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ outcomeNotes: 'Visit 1 completed successfully' });

      // Follow-Up 2: Scheduled then becomes MISSED
      const flp2Res = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date('2026-11-20T10:00:00Z').toISOString(),
          instructions: 'Visit 2 (Specialist)'
        });
      const flp2Id = flp2Res.body.followUp.followUpId;

      // Simulate MISSED state
      await processFollowUpRemindersAndStatuses(new Date('2026-11-23T12:00:00Z'));

      const flp2 = await FollowUp.findOne({ followUpId: flp2Id });
      expect(flp2.status).toBe('MISSED');

      // Attempt to close referral -> BLOCKED because Follow-up 2 is MISSED
      const closeRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Attempting closure' });

      expect(closeRes.status).toBe(400);
      expect(closeRes.body.error.code).toBe('UNRESOLVED_FOLLOW_UP');
      expect(closeRes.body.error.message).toContain('1 required follow-up appointment(s) remain unresolved');
    });

    test('20. Rescheduling a missed follow-up updates its state to SCHEDULED and preserves reschedule history', async () => {
      // Create follow-up and make it MISSED
      const flpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date('2026-11-20T10:00:00Z').toISOString(),
          instructions: 'Consult'
        });
      const followUpId = flpRes.body.followUp.followUpId;
      await processFollowUpRemindersAndStatuses(new Date('2026-11-23T10:00:00Z'));

      let flp = await FollowUp.findOne({ followUpId });
      expect(flp.status).toBe('MISSED');

      // Doctor reschedules the MISSED follow-up
      const newDueDate = new Date('2026-11-28T14:00:00Z');
      const rescheduleRes = await request(app)
        .patch(`/api/follow-ups/${followUpId}/reschedule`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          newDueDate: newDueDate.toISOString(),
          reason: 'Patient re-contacted clinic after missing appointment; rebooked for next week'
        });

      expect(rescheduleRes.status).toBe(200);
      expect(rescheduleRes.body.followUp.status).toBe('SCHEDULED');
      expect(rescheduleRes.body.followUp.rescheduleHistory.length).toBe(1);
      expect(rescheduleRes.body.followUp.rescheduleHistory[0].reason).toContain('Patient re-contacted clinic');

      flp = await FollowUp.findOne({ followUpId });
      expect(flp.status).toBe('SCHEDULED');
      expect(flp.missedAt).toBeNull();
      expect(flp.remindersSent).toEqual([]);
    });

    test('21. A properly completed follow-up (previously MISSED) no longer blocks closure', async () => {
      // Document treatment and care confirmation
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ treatmentSummary: 'Emergency care rendered' });

      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          followUpAddressed: true,
          confirmationSummary: 'Confirmed'
        });

      // Create follow-up and make it MISSED
      const flpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date('2026-11-20T10:00:00Z').toISOString(),
          instructions: 'Consult'
        });
      const followUpId = flpRes.body.followUp.followUpId;
      await processFollowUpRemindersAndStatuses(new Date('2026-11-23T10:00:00Z'));

      // Patient self-check-in does NOT mark completion
      const checkInRes = await request(app)
        .patch(`/api/follow-ups/${followUpId}/attendance`)
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({ attended: true });
      expect(checkInRes.status).toBe(200);

      // Closure must still be blocked (attendance check-in is NOT clinical completion)
      const closeBlockedRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Premature close' });
      expect(closeBlockedRes.status).toBe(400);
      expect(closeBlockedRes.body.error.code).toBe('UNRESOLVED_FOLLOW_UP');

      // Doctor performs formal clinical completion
      const compRes = await request(app)
        .post(`/api/follow-ups/${followUpId}/complete`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          outcomeNotes: 'Patient attended rescheduled walk-in; clinical evaluation normal',
          treatmentSummary: 'Follow-up clinical assessment finalized'
        });
      expect(compRes.status).toBe(200);
      expect(compRes.body.followUp.status).toBe('COMPLETED');

      // Now referral closure is ALLOWED
      const closeRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'All follow-up care concluded' });

      expect(closeRes.status).toBe(200);
      expect(closeRes.body.referral.status).toBe('COMPLETED');
      expect(closeRes.body.referral.closure.isClosed).toBe(true);
    });

    test('22. Authorized cancellation with documented reason resolves MISSED follow-up and unblocks closure', async () => {
      // Document treatment and care confirmation
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ treatmentSummary: 'Emergency care rendered' });

      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          followUpAddressed: true,
          confirmationSummary: 'Confirmed'
        });

      // Create follow-up and make it MISSED
      const flpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date('2026-11-20T10:00:00Z').toISOString(),
          instructions: 'Consult'
        });
      const followUpId = flpRes.body.followUp.followUpId;
      await processFollowUpRemindersAndStatuses(new Date('2026-11-23T10:00:00Z'));

      // Attempt cancellation without reason -> BLOCKED
      const failCancel = await request(app)
        .patch(`/api/follow-ups/${followUpId}/cancel`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ reason: '' });
      expect(failCancel.status).toBe(400);
      expect(failCancel.body.error.code).toBe('CANCELLATION_REASON_REQUIRED');

      // Doctor cancels with mandatory documented reason
      const cancelRes = await request(app)
        .patch(`/api/follow-ups/${followUpId}/cancel`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ reason: 'Patient established ongoing follow-up with primary local health center' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.followUp.status).toBe('CANCELLED');
      expect(cancelRes.body.followUp.cancellation.isCancelled).toBe(true);

      // Now referral closure is ALLOWED
      const closeRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Care handoff concluded with documented cancellation' });

      expect(closeRes.status).toBe(200);
      expect(closeRes.body.referral.status).toBe('COMPLETED');
    });

    test('23. Existing treatment documentation and care confirmation requirements remain strictly enforced', async () => {
      // Create a follow-up and complete it
      const flpRes = await request(app)
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          referralId: testReferral.referralId,
          dueDate: new Date(Date.now() + 86400000).toISOString(),
          instructions: 'Consult'
        });
      const followUpId = flpRes.body.followUp.followUpId;

      await request(app)
        .post(`/api/follow-ups/${followUpId}/complete`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ outcomeNotes: 'Completed' });

      // Condition 1 check: Treatment documentation NOT present -> BLOCKED with TREATMENT_NOT_DOCUMENTED
      const failNoTreatment = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Try close without treatment' });

      expect(failNoTreatment.status).toBe(400);
      expect(failNoTreatment.body.error.code).toBe('TREATMENT_NOT_DOCUMENTED');

      // Now document treatment
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ treatmentSummary: 'Inpatient recovery verified' });

      // Condition 2 check: Care confirmation NOT present -> BLOCKED with CARE_NOT_CONFIRMED
      const failNoCareConfirm = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Try close without care confirmation' });

      expect(failNoCareConfirm.status).toBe(400);
      expect(failNoCareConfirm.body.error.code).toBe('CARE_NOT_CONFIRMED');

      // Now confirm care
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/confirm-care`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          followUpAddressed: true,
          confirmationSummary: 'Care verified'
        });

      // Now closure succeeds
      const closeRes = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/close`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ closureNotes: 'Properly closed with all gates passed' });

      expect(closeRes.status).toBe(200);
      expect(closeRes.body.referral.status).toBe('COMPLETED');
    });
  });
});
