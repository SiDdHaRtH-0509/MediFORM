const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');
const Transfer = require('../models/Transfer');
const Notification = require('../models/Notification');
const Subscription = require('../models/Subscription');

describe('Production Readiness: EMS Location/SMS, QR Dispatch & COLIN Tech Subscriptions', () => {
  let mongoServer;
  let docAToken;
  let docBToken;
  let docA;
  let docB;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    // Register & verify Doctor A (Referring Hospital)
    const regA = await request(app).post('/api/auth/register').send({
      email: 'dr_alpha@metrotrauma.org',
      name: 'Dr. Alpha',
      password: 'password123',
      hospitalName: 'Metropolitan Trauma Hospital'
    });
    const verA = await request(app).post('/api/auth/verify-email-otp').send({
      challengeId: regA.body.challengeId,
      otp: regA.body.devOtp
    });
    docAToken = verA.body.token;
    docA = verA.body.user;

    // Register & verify Doctor B (Receiving Hospital)
    const regB = await request(app).post('/api/auth/register').send({
      email: 'dr_beta@stjudeheart.org',
      name: 'Dr. Beta',
      password: 'password123',
      hospitalName: 'St. Jude Heart Hospital'
    });
    const verB = await request(app).post('/api/auth/verify-email-otp').send({
      challengeId: regB.body.challengeId,
      otp: regB.body.devOtp
    });
    docBToken = verB.body.token;
    docB = verB.body.user;
  });

  afterAll(async () => {
    await mongoose.connection.close();
    if (mongoServer) await mongoServer.stop();
  });

  test('Health endpoint reports production readiness & COLIN Tech branding', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.company).toBe('COLIN Tech');
    expect(res.body.database).toBe('connected');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  test('Full Transfer Folio -> QR + PIN -> Hospital Dispatch -> Live GPS & Criticality -> Call/SMS', async () => {
    // 1. Create transfer with EMS Location & Ambulance/Hospital phone numbers
    const createRes = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${docAToken}`)
      .send({
        pid: 'PAT-EMS-9001',
        nam: 'Arjun Verma',
        age: 54,
        gender: 'Male',
        bg: 'O+',
        contactNumber: '+919811112222',
        emergencyContact: 'Meera Verma (+919811113333)',
        fh: 'Metropolitan Trauma Hospital',
        th: 'St. Jude Heart Hospital',
        rt: 'Acute Anterior STEMI requiring primary PCI',
        priority: 'Emergency',
        pd: 'ST-Elevation Myocardial Infarction',
        vit: { hr: 134, bp: '86/54', rr: 26, spo2: 90, temp: 37.2, gcs: 14 },
        emsDispatch: {
          ambulanceId: 'AMB-108-DL',
          ambulanceCrewName: 'Paramedic Vikram',
          ambulancePhone: '+919800000108',
          referringHospitalPhone: '+911126590000',
          receivingHospitalPhone: '+911126591111',
          dispatchStatus: 'EN_ROUTE',
          currentLocation: {
            lat: 28.6139,
            lng: 77.209,
            address: 'AIIMS Flyover, Ring Road',
            speedKmh: 55
          },
          etaMinutes: 11
        }
      });

    expect(createRes.status).toBe(201);
    const transfer = createRes.body.transfer;
    expect(transfer.emsDispatch.ambulanceId).toBe('AMB-108-DL');
    expect(transfer.emsDispatch.criticality.level).toBe('CRITICAL');
    expect(transfer.emsDispatch.criticality.news2Score).toBeGreaterThanOrEqual(7);

    // 2. Generate QR + 6-digit PIN
    const qrRes = await request(app)
      .post('/api/qr/generate')
      .set('Authorization', `Bearer ${docAToken}`)
      .send({ transferId: transfer._id });

    expect(qrRes.status).toBe(201);
    const { uuid, pin, shareUrl, deepLinkUrl } = qrRes.body;
    expect(pin).toMatch(/^\d{6}$/);
    expect(shareUrl).toContain(`/handoff/${uuid}`);
    expect(deepLinkUrl).toBe(`mediform://handoff/${uuid}`);

    // 3. Dispatch QR to Receiving Hospital Doctor B
    const dispatchRes = await request(app)
      .post('/api/qr/dispatch')
      .set('Authorization', `Bearer ${docAToken}`)
      .send({
        uuid,
        recipientEmail: 'dr_beta@stjudeheart.org',
        recipientHospital: 'St. Jude Heart Hospital',
        shareUrl
      });

    expect(dispatchRes.status).toBe(200);
    expect(dispatchRes.body.notifiedDoctorsCount).toBeGreaterThanOrEqual(1);

    const docBNotifs = await Notification.find({ recipientUserId: docB.id });
    expect(docBNotifs.length).toBeGreaterThanOrEqual(1);
    expect(docBNotifs[0].notificationType).toBe('TRANSFER_DISPATCHED');

    // 4. Receiving doctor scans QR & enters 6-digit PIN -> receives full folio including EMS contacts
    const validateRes = await request(app)
      .post(`/api/qr/validate/${uuid}`)
      .send({ pin });

    expect(validateRes.status).toBe(200);
    expect(validateRes.body.transfer.pid).toBe('PAT-EMS-9001');
    expect(validateRes.body.transfer.emsDispatch.ambulancePhone).toBe('+919800000108');

    // 5. Using verified QR UUID+PIN headers, examine live EMS location & criticality
    const statusRes = await request(app)
      .get(`/api/transfers/${transfer._id}/ems-status`)
      .set('X-QR-UUID', uuid)
      .set('X-QR-PIN', pin);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.contacts.ambulancePhone).toBe('+919800000108');
    expect(statusRes.body.emsDispatch.criticality.level).toBe('CRITICAL');

    // 6. Update live GPS coordinates & vitals
    const locRes = await request(app)
      .post(`/api/transfers/${transfer._id}/ems-location`)
      .set('X-QR-UUID', uuid)
      .set('X-QR-PIN', pin)
      .send({
        lat: 28.625,
        lng: 77.215,
        address: 'Near Safdarjung Gate 2',
        speedKmh: 40,
        etaMinutes: 4
      });

    expect(locRes.status).toBe(200);
    expect(locRes.body.emsDispatch.currentLocation.lat).toBe(28.625);
    expect(locRes.body.emsDispatch.etaMinutes).toBe(4);
    expect(locRes.body.emsDispatch.locationHistory.length).toBeGreaterThanOrEqual(2);

    // 7. Receiving doctor sends Emergency SMS to Ambulance directly from the folio
    const smsRes = await request(app)
      .post(`/api/transfers/${transfer._id}/emergency-sms`)
      .set('X-QR-UUID', uuid)
      .set('X-QR-PIN', pin)
      .send({ target: 'ambulance' });

    expect(smsRes.status).toBe(200);
    expect(smsRes.body.phone).toBe('+919800000108');
    expect(smsRes.body.smsUri).toContain('sms:%2B919800000108');
    expect(smsRes.body.smsBody).toContain('MEDIFORM EMERGENCY');
  });

  test('COLIN Tech Doctor Subscriptions, Hospital Licenses & National Seva Grant', async () => {
    const plansRes = await request(app).get('/api/subscriptions/plans');
    expect(plansRes.status).toBe(200);
    expect(plansRes.body.company).toBe('COLIN Tech');
    expect(plansRes.body.doctorPlans.length).toBeGreaterThanOrEqual(3);
    expect(plansRes.body.hospitalLicenses.some(p => p.code === 'HOSPITAL_SEVA_PUBLIC')).toBe(true);

    // Doctor status defaults to DOCTOR_FREE and tracks transfer usage
    const statusBefore = await request(app)
      .get('/api/subscriptions/status')
      .set('Authorization', `Bearer ${docAToken}`);
    expect(statusBefore.status).toBe(200);
    expect(statusBefore.body.quotaSummary.emergencyBypassAlwaysEnabled).toBe(true);

    // Doctor upgrades to Clinician Pro
    const subRes = await request(app)
      .post('/api/subscriptions/subscribe')
      .set('Authorization', `Bearer ${docAToken}`)
      .send({ planCode: 'DOCTOR_PRO', billingCycle: 'monthly' });
    expect(subRes.status).toBe(200);
    expect(subRes.body.subscription.planCode).toBe('DOCTOR_PRO');

    // Hospital activates Multi-Specialty Enterprise License
    const hospRes = await request(app)
      .post('/api/subscriptions/hospital-license')
      .set('Authorization', `Bearer ${docAToken}`)
      .send({
        planCode: 'HOSPITAL_MULTISPECIALTY',
        hospitalName: 'Metropolitan Trauma Hospital',
        billingCycle: 'yearly'
      });
    expect(hospRes.status).toBe(200);
    expect(hospRes.body.subscription.planCode).toBe('HOSPITAL_MULTISPECIALTY');
    expect(hospRes.body.subscription.monthlyTransferQuota).toBe(-1);

    // Subsequent status reflects Hospital License taking precedence
    const statusAfter = await request(app)
      .get('/api/subscriptions/status')
      .set('Authorization', `Bearer ${docAToken}`);
    expect(statusAfter.status).toBe(200);
    expect(statusAfter.body.source).toBe('hospital_license');
    expect(statusAfter.body.quotaSummary.transfersRemaining).toBe('UNLIMITED');
  });
});
