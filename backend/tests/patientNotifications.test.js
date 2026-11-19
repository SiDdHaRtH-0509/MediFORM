const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');
const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');

jest.setTimeout(60000);

let mongoServer;
let doctorTokenA; // Referring Doctor (Metropolitan)
let doctorUserA;
let doctorTokenB; // Receiving Doctor (St. Jude)
let doctorUserB;
let doctorTokenC; // Reassigned Doctor (St. Jude)
let doctorUserC;
let patientToken1; // Patient 1 (UHID: PAT-NOTIF-01)
let patientUser1;
let patientToken2; // Patient 2 (UHID: PAT-NOTIF-02)
let patientUser2;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // 1. Doctor A: Metropolitan Hospital
  const docRegA = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.alice.phase4@metropolitan.health',
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
      email: 'dr.bob.phase4@stjude.health',
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

  // 3. Doctor C: St. Jude Hospital (Colleague)
  const docRegC = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.clara.phase4@stjude.health',
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

  // 4. Patient 1: PAT-NOTIF-01
  patientUser1 = await User.create({
    email: 'patient1@phase4.org',
    username: 'PAT-NOTIF-01',
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

  // 5. Patient 2: PAT-NOTIF-02
  patientUser2 = await User.create({
    email: 'patient2@phase4.org',
    username: 'PAT-NOTIF-02',
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

describe('Phase 4: Patient Notifications & Communication Test Suite', () => {

  let testScreening;
  let testReferral;

  beforeEach(async () => {
    // Fresh flagged screening and referral for Patient 1
    const screeningRes = await request(app)
      .post('/api/screenings')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        pid: 'PAT-NOTIF-01',
        patientName: 'Sarah Connor',
        age: 38,
        gender: 'Female',
        bloodGroup: 'A+',
        vitals: { hr: 130, bp: '82/45', rr: 29, spo2: 88, temp: 39.4, gcs: 14 },
        clinicalNotes: 'Septic shock suspected; bilateral pulmonary infiltrate',
        medications: [{ name: 'Meropenem', dose: '1g', route: 'IV' }],
        patientConsent: { consentGiven: true, consentMethod: 'Digital Signature' }
      });

    testScreening = screeningRes.body.screening;

    const referralRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        sourceScreeningId: testScreening.screeningId,
        clinicalReason: 'Severe sepsis refractory to resuscitation; requires urgent ICU step-up',
        priority: 'Emergency',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDepartment: 'Cardiothoracic ICU',
        receivingDoctorId: doctorUserB.id
      });

    testReferral = referralRes.body.referral;
  });

  describe('1. Automated Referral Lifecycle Notifications', () => {
    test('1. Referral creation generates patient and doctor notifications', async () => {
      // Patient 1 should have received a notification for REFERRAL_CREATED
      const patientNotifs = await Notification.find({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_CREATED'
      });

      expect(patientNotifs).toHaveLength(1);
      expect(patientNotifs[0].title).toBe('New Medical Referral Created');
      expect(patientNotifs[0].message).toContain(testReferral.referralId);
      expect(patientNotifs[0].message).toContain('St. Jude Heart Hospital');
      expect(patientNotifs[0].isRead).toBe(false);

      // Assigned receiving doctor should have received DOCTOR_ASSIGNED notification
      const docNotifs = await Notification.find({
        recipientUserId: doctorUserB.id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'DOCTOR_ASSIGNED'
      });

      expect(docNotifs).toHaveLength(1);
      expect(docNotifs[0].title).toBe('New Clinical Referral Assigned');
    });

    test('2. Referral acknowledgement generates patient and referring doctor notifications', async () => {
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/acknowledge`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Bed confirmed' });

      // Patient notification
      const patientNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_ACKNOWLEDGED'
      });
      expect(patientNotif).not.toBeNull();
      expect(patientNotif.title).toBe('Referral Receipt Confirmed');

      // Referring doctor notification
      const refDocNotif = await Notification.findOne({
        recipientUserId: doctorUserA.id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_ACKNOWLEDGED'
      });
      expect(refDocNotif).not.toBeNull();
      expect(refDocNotif.title).toBe('Referral Acknowledged');
    });

    test('3. Referral acceptance generates patient and referring doctor notifications', async () => {
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ notes: 'Accepted for intake' });

      const patientNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_ACCEPTED'
      });
      expect(patientNotif).not.toBeNull();
      expect(patientNotif.title).toBe('Referral Intake Accepted');
    });

    test('4. Referral rejection generates neutral patient notification and actionable doctor notice', async () => {
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/reject`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({ reason: 'ICU full; no ventilator beds' });

      // Patient notification: MUST BE NEUTRAL
      const patientNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_REJECTED'
      });
      expect(patientNotif).not.toBeNull();
      expect(patientNotif.title).toBe('Referral Review Update');
      expect(patientNotif.message).not.toContain('ventilator');
      expect(patientNotif.message).toContain('reassign your care');

      // Referring doctor notification: contains actionable clinical reason
      const refDocNotif = await Notification.findOne({
        recipientUserId: doctorUserA.id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_REJECTED'
      });
      expect(refDocNotif).not.toBeNull();
      expect(refDocNotif.title).toBe('Action Required: Referral Declined');
      expect(refDocNotif.message).toContain('ICU full');
    });

    test('5. Reassignment generates patient notification and new doctor notification', async () => {
      // Reassign to Dr. Clara
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          receivingDoctorId: doctorUserC.id,
          reason: 'Care transferred to Dr. Clara'
        });

      // Patient notification
      const patientNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_REASSIGNED'
      });
      expect(patientNotif).not.toBeNull();
      expect(patientNotif.title).toBe('Specialist Reassignment');
      expect(patientNotif.message).toContain('Dr. Clara Oswald');

      // New doctor notification
      const newDocNotif = await Notification.findOne({
        recipientUserId: doctorUserC.id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_REASSIGNED'
      });
      expect(newDocNotif).not.toBeNull();
      expect(newDocNotif.title).toBe('Reassigned Referral Intake');
    });

    test('6. Treatment documentation and follow-up generate patient notifications', async () => {
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send();

      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          treatmentSummary: 'Patient resuscitated and placed on mechanical ventilation',
          followUpRequired: true,
          followUpInstructions: 'Repeat ABG in 6 hours'
        });

      // TREATMENT_DOCUMENTED notification
      const treatNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'TREATMENT_DOCUMENTED'
      });
      expect(treatNotif).not.toBeNull();
      expect(treatNotif.title).toBe('Clinical Consultation Documented');

      // FOLLOW_UP_REQUIRED notification
      const followUpNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'FOLLOW_UP_REQUIRED'
      });
      expect(followUpNotif).not.toBeNull();
      expect(followUpNotif.title).toBe('Follow-Up Care Scheduled');
      expect(followUpNotif.isEssential).toBe(true);
    });

    test('7. Referral closure generates closure notifications', async () => {
      // Move to completed
      await request(app).post(`/api/referrals/${testReferral.referralId}/accept`).set('Authorization', `Bearer ${doctorTokenB}`).send();
      await request(app).post(`/api/referrals/${testReferral.referralId}/treatment`).set('Authorization', `Bearer ${doctorTokenB}`).send({ treatmentSummary: 'Care completed', followUpRequired: false });
      await request(app).post(`/api/referrals/${testReferral.referralId}/confirm-care`).set('Authorization', `Bearer ${doctorTokenB}`).send({ confirmationSummary: 'Attending verified' });
      await request(app).post(`/api/referrals/${testReferral.referralId}/close`).set('Authorization', `Bearer ${doctorTokenB}`).send({ closureNotes: 'Patient safely discharged' });

      // Patient closure notification
      const patientNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_CLOSED'
      });
      expect(patientNotif).not.toBeNull();
      expect(patientNotif.title).toBe('Referral Completed');

      // Referring doctor closure notification
      const docNotif = await Notification.findOne({
        recipientUserId: doctorUserA.id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_CLOSED'
      });
      expect(docNotif).not.toBeNull();
      expect(docNotif.title).toBe('Referral Completed');
    });
  });

  describe('2. Privacy & Clinical Neutrality', () => {
    test('11. Notification messages NEVER expose sensitive clinical data', async () => {
      // Re-trigger multiple notifications to verify all generated messages
      await request(app).post(`/api/referrals/${testReferral.referralId}/accept`).set('Authorization', `Bearer ${doctorTokenB}`).send();
      await request(app).post(`/api/referrals/${testReferral.referralId}/treatment`).set('Authorization', `Bearer ${doctorTokenB}`).send({
        treatmentSummary: 'Acute STEMI catheterization and Meropenem infusion',
        clinicalObservations: 'Lactate 4.8, BP 82/45',
        followUpRequired: true,
        followUpInstructions: 'Follow-up ECG'
      });

      const allPatientNotifs = await Notification.find({ recipientUserId: patientUser1._id });

      const sensitiveTerms = [
        /sepsis/i,
        /stemi/i,
        /shock/i,
        /lactate/i,
        /meropenem/i,
        /norepinephrine/i,
        /\b82\/45\b/,
        /\b39\.4\b/
      ];

      allPatientNotifs.forEach(notif => {
        sensitiveTerms.forEach(regex => {
          expect(notif.message).not.toMatch(regex);
          expect(notif.title).not.toMatch(regex);
        });
      });
    });
  });

  describe('3. Idempotency & Duplicate Prevention', () => {
    test('12. Retrying an event does not create duplicate notifications', async () => {
      const initialCount = await Notification.countDocuments({
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_CREATED'
      });

      // Call notificationService directly with same event
      await notificationService.notifyReferralEvent('REFERRAL_CREATED', testReferral);
      await notificationService.notifyReferralEvent('REFERRAL_CREATED', testReferral);

      const postCount = await Notification.countDocuments({
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_CREATED'
      });

      expect(postCount).toBe(initialCount);
    });

    test('13. Reassigning a referral multiple times generates distinct notifications without suppression', async () => {
      // Reassignment 1: from Dr. Bob to Dr. Clara
      const reassign1 = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          receivingDoctorId: doctorUserC.id,
          reason: 'Initial reassignment to Dr. Clara'
        });
      expect(reassign1.status).toBe(200);

      // Reassignment 2: back to Dr. Bob
      const reassign2 = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          receivingDoctorId: doctorUserB.id,
          reason: 'Secondary reassignment back to Dr. Bob'
        });
      expect(reassign2.status).toBe(200);

      // Patient should have received 2 distinct REFERRAL_REASSIGNED notifications
      const patientReassignNotifs = await Notification.find({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_REASSIGNED'
      });
      expect(patientReassignNotifs).toHaveLength(2);
      expect(patientReassignNotifs[0].eventId).not.toBe(patientReassignNotifs[1].eventId);
    });

    test('14. Repeated follow-up requirements each generate distinct notifications without suppression', async () => {
      // Accept referral first
      await request(app)
        .post(`/api/referrals/${testReferral.referralId}/accept`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send();

      // Treatment 1 with follow-up required
      const treat1 = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          treatmentSummary: 'Initial stabilization and fluid challenge',
          followUpRequired: true,
          followUpInstructions: 'Check lactate in 4 hours'
        });
      expect(treat1.status).toBe(200);

      // Treatment 2 with another follow-up required
      const treat2 = await request(app)
        .post(`/api/referrals/${testReferral.referralId}/treatment`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          treatmentSummary: 'Secondary consult and assessment',
          followUpRequired: true,
          followUpInstructions: 'Follow-up ultrasound in 24 hours'
        });
      expect(treat2.status).toBe(200);

      const followUpNotifs = await Notification.find({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'FOLLOW_UP_REQUIRED'
      });
      expect(followUpNotifs.length).toBeGreaterThanOrEqual(2);
      // Verify eventIds are unique between the distinct follow-ups
      const eventIds = new Set(followUpNotifs.map(n => n.eventId));
      expect(eventIds.size).toBe(followUpNotifs.length);
    });

    test('15. Multiple recipients receiving the same transition event both receive their notification', async () => {
      const distinctEventId = new mongoose.Types.ObjectId().toString();

      const patNotif = await notificationService.createNotification({
        eventId: distinctEventId,
        recipientUserId: patientUser1._id,
        recipientRole: 'patient',
        relatedReferralId: testReferral.referralId,
        notificationType: 'REFERRAL_CREATED',
        category: 'REFERRAL_UPDATE',
        title: 'New Medical Referral Created',
        message: 'A referral has been initiated',
        isEssential: true
      });

      const docNotif = await notificationService.createNotification({
        eventId: distinctEventId,
        recipientUserId: doctorUserB.id,
        recipientRole: 'doctor',
        relatedReferralId: testReferral.referralId,
        notificationType: 'DOCTOR_ASSIGNED',
        category: 'REFERRAL_UPDATE',
        title: 'New Clinical Referral Assigned',
        message: 'You have been assigned as receiving clinician',
        isEssential: true
      });

      expect(patNotif).not.toBeNull();
      expect(docNotif).not.toBeNull();
      expect(patNotif.eventId).toBe(distinctEventId);
      expect(docNotif.eventId).toBe(distinctEventId);
      expect(patNotif.recipientRole).toBe('patient');
      expect(docNotif.recipientRole).toBe('doctor');
      expect(patNotif._id.toString()).not.toBe(docNotif._id.toString());
    });

    test('16. Concurrent attempts to dispatch the same event are safely resolved by database-level unique protection', async () => {
      const sharedEventId = new mongoose.Types.ObjectId().toString();

      // Launch concurrent calls with the exact same eventId and recipient
      const dispatches = await Promise.all([
        notificationService.createNotification({
          eventId: sharedEventId,
          recipientUserId: patientUser1._id,
          recipientRole: 'patient',
          relatedReferralId: testReferral.referralId,
          notificationType: 'REFERRAL_CREATED',
          title: 'Concurrent Dispatch Test',
          message: 'Concurrent message',
          isEssential: true
        }),
        notificationService.createNotification({
          eventId: sharedEventId,
          recipientUserId: patientUser1._id,
          recipientRole: 'patient',
          relatedReferralId: testReferral.referralId,
          notificationType: 'REFERRAL_CREATED',
          title: 'Concurrent Dispatch Test',
          message: 'Concurrent message',
          isEssential: true
        }),
        notificationService.createNotification({
          eventId: sharedEventId,
          recipientUserId: patientUser1._id,
          recipientRole: 'patient',
          relatedReferralId: testReferral.referralId,
          notificationType: 'REFERRAL_CREATED',
          title: 'Concurrent Dispatch Test',
          message: 'Concurrent message',
          isEssential: true
        })
      ]);

      // All promises resolve cleanly without unhandled rejection
      dispatches.forEach(d => {
        expect(d).not.toBeNull();
        expect(d.eventId).toBe(sharedEventId);
      });

      // Exactly 1 notification persisted in database
      const dbCount = await Notification.countDocuments({
        eventId: sharedEventId,
        recipientUserId: patientUser1._id
      });
      expect(dbCount).toBe(1);
    });
  });

  describe('4. Security & IDOR Protections', () => {
    test('8. Patients cannot access another patient notifications (IDOR Protection)', async () => {
      // Patient 1 has notifications from referral creation
      const pat1Notifs = await Notification.find({ recipientUserId: patientUser1._id });
      expect(pat1Notifs.length).toBeGreaterThan(0);
      const targetNotif = pat1Notifs[0];

      // Patient 2 attempts to view notifications list: Patient 2 should see 0 of Patient 1's notifications
      const listRes = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${patientToken2}`);

      expect(listRes.status).toBe(200);
      const returnedIds = listRes.body.notifications.map(n => n.notificationId);
      expect(returnedIds).not.toContain(targetNotif.notificationId);

      // Patient 2 attempts to mark Patient 1's notification as read: BLOCKED with 403
      const patchRes = await request(app)
        .patch(`/api/notifications/${targetNotif.notificationId}/read`)
        .set('Authorization', `Bearer ${patientToken2}`);

      expect(patchRes.status).toBe(403);
      expect(patchRes.body.error.code).toBe('FORBIDDEN_NOTIFICATION_ACCESS');
    });

    test('17. Patient attempting to manipulate unread count of another patient receives only own count', async () => {
      // Patient 2 sends unread-count query attempting to spoof patientId/userId
      const res = await request(app)
        .get(`/api/notifications/unread-count?patientId=PAT-NOTIF-01&recipientUserId=${patientUser1._id}`)
        .set('Authorization', `Bearer ${patientToken2}`);

      expect(res.status).toBe(200);
      // Patient 2 has zero notifications, so unread count is 0
      expect(res.body.unreadCount).toBe(0);
    });

    test('18. Strict doctor isolation: doctor cannot view or mark patient notifications as read', async () => {
      // Find a notification belonging to Patient 1
      const pat1Notif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        recipientRole: 'patient'
      });
      expect(pat1Notif).not.toBeNull();

      // Doctor B attempts to list notifications with spoofed role
      const docListRes = await request(app)
        .get('/api/notifications?recipientRole=patient')
        .set('Authorization', `Bearer ${doctorTokenB}`);

      expect(docListRes.status).toBe(200);
      const docReturnedIds = docListRes.body.notifications.map(n => n.notificationId);
      expect(docReturnedIds).not.toContain(pat1Notif.notificationId);

      // Doctor B attempts to mark Patient 1's notification as read
      const docPatchRes = await request(app)
        .patch(`/api/notifications/${pat1Notif.notificationId}/read`)
        .set('Authorization', `Bearer ${doctorTokenB}`);

      expect(docPatchRes.status).toBe(403);
      expect(docPatchRes.body.error.code).toBe('FORBIDDEN_NOTIFICATION_ACCESS');
    });

    test('19. Unauthenticated requests to all notification routes are rejected with 401', async () => {
      const routes = [
        { method: 'get', path: '/api/notifications' },
        { method: 'get', path: '/api/notifications/unread-count' },
        { method: 'patch', path: '/api/notifications/NOTIF-12345/read' },
        { method: 'patch', path: '/api/notifications/read-all' },
        { method: 'get', path: '/api/notifications/preferences' },
        { method: 'patch', path: '/api/notifications/preferences' }
      ];

      for (const r of routes) {
        const res = await request(app)[r.method](r.path);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('5. Read / Unread Status & Preferences Management', () => {
    test('9. Read/unread status and mark-all-read work cleanly', async () => {
      // Get unread count
      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${patientToken1}`);

      expect(countRes.status).toBe(200);
      expect(countRes.body.unreadCount).toBeGreaterThan(0);
      const initialUnread = countRes.body.unreadCount;

      // Mark single notification as read
      const listRes = await request(app)
        .get('/api/notifications?isRead=false')
        .set('Authorization', `Bearer ${patientToken1}`);

      const firstNotif = listRes.body.notifications[0];
      const readRes = await request(app)
        .patch(`/api/notifications/${firstNotif.notificationId}/read`)
        .set('Authorization', `Bearer ${patientToken1}`);

      expect(readRes.status).toBe(200);
      expect(readRes.body.notification.isRead).toBe(true);
      expect(readRes.body.notification.readAt).toBeDefined();

      // Mark all remaining as read
      const readAllRes = await request(app)
        .patch('/api/notifications/read-all')
        .set('Authorization', `Bearer ${patientToken1}`);

      expect(readAllRes.status).toBe(200);

      // Verify unread count is now 0
      const countAfter = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${patientToken1}`);

      expect(countAfter.body.unreadCount).toBe(0);
    });

    test('10. Notification preferences are respected and essential notices are not dropped', async () => {
      // Update preferences: disable generalCareUpdates, but keep followUpReminders
      const prefUpdateRes = await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({
          generalCareUpdates: false,
          referralUpdates: false
        });

      expect(prefUpdateRes.status).toBe(200);
      expect(prefUpdateRes.body.preferences.generalCareUpdates).toBe(false);
      expect(prefUpdateRes.body.preferences.referralUpdates).toBe(false);

      // Verify GET preferences
      const getPrefRes = await request(app)
        .get('/api/notifications/preferences')
        .set('Authorization', `Bearer ${patientToken1}`);

      expect(getPrefRes.status).toBe(200);
      expect(getPrefRes.body.preferences.generalCareUpdates).toBe(false);

      // Trigger a non-essential GENERAL_CARE notification directly
      const nonEssential = await notificationService.createNotification({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'GENERAL_UPDATE',
        category: 'GENERAL_CARE',
        title: 'Non-Essential Health Tip',
        message: 'Stay hydrated',
        isEssential: false
      });
      // Should be filtered out
      expect(nonEssential).toBeNull();

      // Trigger an essential notification (e.g. critical follow up) while referralUpdates is false
      const essential = await notificationService.createNotification({
        recipientUserId: patientUser1._id,
        relatedReferralId: testReferral.referralId,
        notificationType: 'FOLLOW_UP_REQUIRED',
        category: 'REFERRAL_UPDATE',
        title: 'Follow-Up Suture Removal',
        message: 'Please attend scheduled clinic',
        isEssential: true
      });
      // Essential communication is NOT dropped: delivered with priority notice tag
      expect(essential).not.toBeNull();
      expect(essential.title).toContain('[Priority Notice]');
      expect(essential.deliveryStatus).toBe('DELIVERED');
    });

    test('20. Routine referral creation is suppressed when referralUpdates is false, but Emergency referral creation is delivered with priority notice', async () => {
      // Disable referralUpdates on Patient 1
      await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({ referralUpdates: false });

      // Create Flagged screening for Routine referral
      const routineScreening = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          pid: 'PAT-NOTIF-01',
          patientName: 'Sarah Connor',
          age: 38,
          gender: 'Female',
          vitals: { hr: 115, bp: '135/85', rr: 21, spo2: 95, temp: 38.5, gcs: 15 },
          clinicalNotes: 'Persistent febrile illness; flagged for routine specialist review',
          patientConsent: { consentGiven: true, consentMethod: 'Digital Signature' }
        });

      const routineRefRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: routineScreening.body.screening.screeningId,
          clinicalReason: 'Routine specialist consultation for lingering symptoms',
          priority: 'Routine',
          receivingHospital: 'St. Jude Heart Hospital',
          receivingDepartment: 'Pulmonology',
          receivingDoctorId: doctorUserB.id
        });

      expect(routineRefRes.status).toBe(201);
      expect(routineRefRes.body.referral).toBeDefined();

      // Routine referral creation notification for Patient 1 should be SUPPRESSED (null)
      const routineNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: routineRefRes.body.referral.referralId,
        notificationType: 'REFERRAL_CREATED'
      });
      expect(routineNotif).toBeNull();

      // Create Emergency referral
      const emergencyScreening = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          pid: 'PAT-NOTIF-01',
          patientName: 'Sarah Connor',
          age: 38,
          gender: 'Female',
          vitals: { hr: 145, bp: '75/40', rr: 32, spo2: 84, temp: 40.1, gcs: 12 },
          clinicalNotes: 'Septic shock in extremis',
          patientConsent: { consentGiven: true, consentMethod: 'Digital Signature' }
        });

      const emergencyRefRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: emergencyScreening.body.screening.screeningId,
          clinicalReason: 'Immediate resuscitation required',
          priority: 'Emergency',
          receivingHospital: 'St. Jude Heart Hospital',
          receivingDepartment: 'Cardiothoracic ICU',
          receivingDoctorId: doctorUserB.id
        });

      // Emergency referral creation notification for Patient 1 MUST NOT be suppressed, and must have [Priority Notice]
      const emergencyNotif = await Notification.findOne({
        recipientUserId: patientUser1._id,
        relatedReferralId: emergencyRefRes.body.referral.referralId,
        notificationType: 'REFERRAL_CREATED'
      });
      expect(emergencyNotif).not.toBeNull();
      expect(emergencyNotif.title).toContain('[Priority Notice]');
      expect(emergencyNotif.isEssential).toBe(true);

      // Re-enable preferences for subsequent runs
      await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${patientToken1}`)
        .send({ referralUpdates: true });
    });
  });
});
