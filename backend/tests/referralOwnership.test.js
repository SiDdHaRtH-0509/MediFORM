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
let doctorTokenA;
let doctorUserA;
let doctorTokenB;
let doctorUserB;
let doctorTokenUnrelated;
let doctorUserUnrelated;
let patientToken;
let patientUser;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // 1. Doctor A: Metropolitan Hospital (Cardiology / Referring Doctor)
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

  // Update Alice profile with specialization and department
  await User.findByIdAndUpdate(doctorUserA.id, {
    specialization: 'Emergency Medicine',
    department: 'Trauma ICU'
  });

  // 2. Doctor B: St. Jude Hospital (Cardiothoracic Surgery / Receiving Doctor)
  const docRegB = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.bob@stjude.health',
      name: 'Dr. Robert Bob Vance',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital'
    });
  const docVerifyB = await request(app)
    .post('/api/auth/verify-email-otp')
    .send({ challengeId: docRegB.body.challengeId, otp: docRegB.body.devOtp });
  doctorTokenB = docVerifyB.body.token;
  doctorUserB = docVerifyB.body.user;

  // Update Bob profile with specialization and department
  await User.findByIdAndUpdate(doctorUserB.id, {
    specialization: 'Cardiothoracic Surgery',
    department: 'Cardiac Surgery Unit'
  });

  // 3. Doctor Unrelated: General City Clinic (Unaffiliated third hospital)
  const docRegUnrelated = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'dr.outsider@ruralclinic.org',
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

  // 4. Patient User
  patientUser = await User.create({
    email: 'pat.phase2@test.org',
    username: 'PAT-PHASE2',
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

describe('Phase 2: Referral Ownership & Doctor Assignment Test Suite', () => {

  let flaggedScreening;

  beforeAll(async () => {
    // Create a flagged screening to refer
    const scrRes = await request(app)
      .post('/api/screenings')
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({
        pid: 'PAT-PHASE2',
        patientName: 'Samuel Patient',
        age: 58,
        vitals: { hr: 125, bp: '85/55', rr: 24, spo2: 91, temp: 38.8, gcs: 14 },
        clinicalNotes: 'Acute aortic syndrome suspected with severe chest pain.'
      });

    flaggedScreening = scrRes.body.screening;
  });

  describe('1. Doctor Directory Lookup', () => {
    test('Doctor directory returns registered doctors with required fields', async () => {
      const res = await request(app)
        .get('/api/user/doctors')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBeGreaterThanOrEqual(3);

      const bob = res.body.doctors.find(d => d.email === 'dr.bob@stjude.health');
      expect(bob).toBeDefined();
      expect(bob.name).toBe('Dr. Robert Bob Vance');
      expect(bob.doctorId).toBeDefined();
      expect(bob.specialization).toBe('Cardiothoracic Surgery');
      expect(bob.hospital).toBe('St. Jude Heart Hospital');
      expect(bob.department).toBe('Cardiac Surgery Unit');
      expect(bob.isEmailVerified).toBe(true);
    });

    test('Doctor directory filters by specialization and hospital', async () => {
      const specRes = await request(app)
        .get('/api/user/doctors?specialization=Cardiothoracic Surgery')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(specRes.status).toBe(200);
      expect(specRes.body.doctors.every(d => d.specialization === 'Cardiothoracic Surgery')).toBe(true);

      const hospRes = await request(app)
        .get('/api/user/doctors?hospital=St. Jude')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(hospRes.status).toBe(200);
      expect(hospRes.body.doctors.every(d => d.hospital.includes('St. Jude'))).toBe(true);
    });

    test('Alias endpoint /api/referrals/doctors also returns directory', async () => {
      const res = await request(app)
        .get('/api/referrals/doctors?search=Alice')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.doctors.length).toBeGreaterThanOrEqual(1);
      expect(res.body.doctors[0].email).toBe('dr.alice@metropolitan.health');
    });

    test('Patient accounts are excluded from doctor directory', async () => {
      const res = await request(app)
        .get('/api/user/doctors?search=PAT-PHASE2')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.doctors.length).toBe(0);
    });
  });

  describe('2. Referral Assignment & Validation', () => {
    let assignedReferral;

    test('Cannot assign referral to an unregistered / non-existent doctor ID (HTTP 400)', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: flaggedScreening.screeningId,
          clinicalReason: 'Cardiothoracic surgery evaluation',
          receivingDoctorId: fakeId.toString()
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_RECEIVING_DOCTOR');
    });

    test('Cannot assign referral to a patient account (HTTP 400)', async () => {
      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: flaggedScreening.screeningId,
          clinicalReason: 'Cardiothoracic surgery evaluation',
          receivingDoctorId: patientUser._id.toString()
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_RECEIVING_DOCTOR');
    });

    test('Authorized doctor successfully assigns referral to registered receiving doctor', async () => {
      const res = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: flaggedScreening.screeningId,
          clinicalReason: 'Ascending aortic dissection requiring emergency surgical replacement',
          priority: 'Emergency',
          receivingDoctorId: doctorUserB.id.toString(),
          receivingDepartment: 'Cardiac Surgery Unit'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const ref = res.body.referral;
      expect(ref.receivingDoctorId).toBe(doctorUserB.id.toString());
      expect(ref.receivingDoctorUsername).toBe('dr.bob@stjude.health');
      expect(ref.receivingDoctorName).toBe('Dr. Robert Bob Vance');
      expect(ref.receivingHospital).toBe('St. Jude Heart Hospital');
      expect(ref.receivingDepartment).toBe('Cardiac Surgery Unit');
      expect(ref.assignmentTimestamp).toBeDefined();
      expect(ref.assignedBy).toBe(doctorUserA.id.toString());

      // Assignment History verification
      expect(ref.assignmentHistory).toBeDefined();
      expect(ref.assignmentHistory.length).toBe(1);
      expect(ref.assignmentHistory[0].previousReceivingDoctorId).toBeNull();
      expect(ref.assignmentHistory[0].newReceivingDoctorId).toBe(doctorUserB.id.toString());
      expect(ref.assignmentHistory[0].assignedByUserId).toBe(doctorUserA.id.toString());
      expect(ref.assignmentHistory[0].reason).toContain('Initial');

      assignedReferral = ref;
    });

    test('Underlying transfer handoff includes receiving doctor in recipient access list', async () => {
      const transfer = await Transfer.findById(assignedReferral.transferId);
      expect(transfer).not.toBeNull();
      expect(transfer.recipientUserIds.map(id => id.toString())).toContain(doctorUserB.id.toString());
      expect(transfer.recipientUsernames).toContain('dr.bob@stjude.health');
    });
  });

  describe('3. Dashboard Views: Incoming, My Assigned, Unassigned, Urgent', () => {
    let unassignedReferral;

    beforeAll(async () => {
      // Create an unassigned referral from another screening
      const scrRes = await request(app)
        .post('/api/screenings')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          pid: 'PAT-UNASSIGNED',
          patientName: 'Triage Patient',
          age: 40,
          vitals: { hr: 115, bp: '95/60', rr: 22, spo2: 93, temp: 38.5, gcs: 15 },
          clinicalNotes: 'Suspected severe pneumonia'
        });

      const refRes = await request(app)
        .post('/api/referrals')
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          sourceScreeningId: scrRes.body.screening.screeningId,
          clinicalReason: 'Unassigned patient seeking ICU bed',
          priority: 'Urgent',
          receivingHospital: 'Metropolitan Trauma Hospital'
        });

      unassignedReferral = refRes.body.referral;
    });

    test('Receiving doctor sees their assigned referrals via view=my_assigned', async () => {
      const res = await request(app)
        .get('/api/referrals?view=my_assigned')
        .set('Authorization', `Bearer ${doctorTokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.referrals.length).toBeGreaterThanOrEqual(1);
      res.body.referrals.forEach(r => {
        expect(r.receivingDoctorId).toBe(doctorUserB.id.toString());
      });
    });

    test('Doctor sees incoming referrals via view=incoming', async () => {
      const res = await request(app)
        .get('/api/referrals?view=incoming')
        .set('Authorization', `Bearer ${doctorTokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.referrals.length).toBeGreaterThanOrEqual(1);
    });

    test('Doctor sees unassigned referrals via view=unassigned', async () => {
      const res = await request(app)
        .get('/api/referrals?view=unassigned')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.referrals.some(r => r.referralId === unassignedReferral.referralId)).toBe(true);
      res.body.referrals.forEach(r => {
        expect(r.receivingDoctorId).toBeNull();
      });
    });

    test('Doctor sees urgent/emergency referrals via view=urgent', async () => {
      const res = await request(app)
        .get('/api/referrals?view=urgent')
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(200);
      res.body.referrals.forEach(r => {
        expect(['Emergency', 'Urgent']).toContain(r.priority);
      });
    });
  });

  describe('4. Reassignment & Historical Ownership Preservation', () => {
    let targetReferral;

    beforeAll(async () => {
      targetReferral = await Referral.findOne({ receivingDoctorId: doctorUserB.id });
    });

    test('Reassignment requires a clinical reason (HTTP 400 MISSING_REASSIGNMENT_REASON)', async () => {
      const res = await request(app)
        .post(`/api/referrals/${targetReferral.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({
          receivingDoctorId: doctorUserA.id.toString(),
          reason: ''
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_REASSIGNMENT_REASON');
    });

    test('Unauthorized doctor from unrelated hospital cannot reassign referral (HTTP 403 FORBIDDEN_REASSIGNMENT)', async () => {
      const res = await request(app)
        .post(`/api/referrals/${targetReferral.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenUnrelated}`)
        .send({
          receivingDoctorId: doctorUserUnrelated.id.toString(),
          reason: 'Attempted hijack of referral by outsider'
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_REASSIGNMENT');
    });

    test('Authorized doctor successfully reassigns referral and preserves complete history', async () => {
      // Create Doctor C to reassign to
      const docRegC = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'dr.carol@stjude.health',
          name: 'Dr. Carol Danvers',
          password: 'password123',
          role: 'doctor',
          hospitalName: 'St. Jude Heart Hospital'
        });
      const docVerifyC = await request(app)
        .post('/api/auth/verify-email-otp')
        .send({ challengeId: docRegC.body.challengeId, otp: docRegC.body.devOtp });
      const doctorUserC = docVerifyC.body.user;

      const res = await request(app)
        .post(`/api/referrals/${targetReferral.referralId}/reassign`)
        .set('Authorization', `Bearer ${doctorTokenB}`)
        .send({
          receivingDoctorId: doctorUserC.id.toString(),
          reason: 'Original surgeon called into emergency transplant procedure; handed over to Dr. Carol',
          department: 'Cardiothoracic Surgery Division'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ref = res.body.referral;
      expect(ref.receivingDoctorId).toBe(doctorUserC.id.toString());
      expect(ref.receivingDoctorUsername).toBe('dr.carol@stjude.health');
      expect(ref.receivingDoctorName).toBe('Dr. Carol Danvers');
      expect(ref.receivingDepartment).toBe('Cardiothoracic Surgery Division');

      // Verify Assignment History is strictly preserved (Not overwritten)
      expect(ref.assignmentHistory.length).toBe(2);

      const initialAssignment = ref.assignmentHistory[0];
      expect(initialAssignment.newReceivingDoctorId).toBe(doctorUserB.id.toString());

      const reassignment = ref.assignmentHistory[1];
      expect(reassignment.previousReceivingDoctorId).toBe(doctorUserB.id.toString());
      expect(reassignment.previousReceivingDoctorUsername).toBe('dr.bob@stjude.health');
      expect(reassignment.newReceivingDoctorId).toBe(doctorUserC.id.toString());
      expect(reassignment.newReceivingDoctorUsername).toBe('dr.carol@stjude.health');
      expect(reassignment.assignedByUserId).toBe(doctorUserB.id.toString());
      expect(reassignment.reason).toContain('Original surgeon called into emergency transplant');
      expect(reassignment.timestamp).toBeDefined();

      // Audit Log recorded
      const audit = await AuditLog.findOne({
        action: 'REFERRAL_REASSIGNED',
        'details.referralId': targetReferral.referralId
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('5. Hospital Access Isolation', () => {
    test('Doctor from isolated hospital cannot access referral details (HTTP 403 FORBIDDEN_HOSPITAL_ACCESS)', async () => {
      const ref = await Referral.findOne({ receivingHospital: 'St. Jude Heart Hospital' });

      const res = await request(app)
        .get(`/api/referrals/${ref.referralId}`)
        .set('Authorization', `Bearer ${doctorTokenUnrelated}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_HOSPITAL_ACCESS');
    });

    test('Affiliated referring doctor can access the referral details', async () => {
      const ref = await Referral.findOne({ receivingHospital: 'St. Jude Heart Hospital' });

      const res = await request(app)
        .get(`/api/referrals/${ref.referralId}`)
        .set('Authorization', `Bearer ${doctorTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.referral.referralId).toBe(ref.referralId);
    });
  });

});
