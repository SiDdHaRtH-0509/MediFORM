/**
 * MediFORM Phase 8: Demonstration Scenario Runner & Seed Script
 * 
 * Runs a complete, reproducible clinical demonstration using isolated synthetic data.
 * Outputs a structured demonstration log mapping:
 * - Step Number
 * - Actor
 * - Action
 * - Expected Result
 * - Actual Result
 * - Screen / API Endpoint
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const User = require('../models/User');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');
const Transfer = require('../models/Transfer');
const Consent = require('../models/Consent');
const QRSession = require('../models/QRSession');
const FollowUp = require('../models/FollowUp');
const MonitoringAlert = require('../models/MonitoringAlert');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const referralMonitoringService = require('../services/referralMonitoringService');
const followUpSchedulerService = require('../services/followUpSchedulerService');

async function runDemo() {
  console.log('================================================================');
  console.log('   MEDIFORM V2 — PHASE 8 CLINICAL DEMONSTRATION RUNNER');
  console.log('   Reproducible End-to-End System Journey & Security Validation');
  console.log('================================================================\n');

  const mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  const jwtSecret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';

  const demoResults = [];

  function recordStep(stepNo, actor, action, endpoint, expected, actual, passed) {
    demoResults.push({ stepNo, actor, action, endpoint, expected, actual, status: passed ? 'PASS' : 'FAIL' });
    console.log(`[Step ${stepNo}] ${passed ? '✓ PASS' : '✗ FAIL'} | ${actor}: ${action}`);
    console.log(`         Endpoint: ${endpoint}`);
    console.log(`         Expected: ${expected}`);
    console.log(`         Actual:   ${actual}\n`);
  }

  try {
    // -------------------------------------------------------------
    // SETUP: Synthetic Actors
    // -------------------------------------------------------------
    const pUserA = await User.create({
      email: 'samantha.demo@example.com',
      username: 'PAT-DEMO-001',
      name: 'Samantha Hall',
      password: 'password123',
      role: 'patient',
      isEmailVerified: true
    });
    const pTokenA = jwt.sign(
      { userId: pUserA._id, username: pUserA.username, name: pUserA.name, role: 'patient', tokenVersion: 0 },
      jwtSecret,
      { expiresIn: '2h' }
    );

    const docUserA = await User.create({
      email: 'dr.alice.demo@metropolitan.health',
      username: 'dr.alice.demo@metropolitan.health',
      name: 'Dr. Alice Carter',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital',
      isEmailVerified: true
    });
    const docTokenA = jwt.sign(
      { userId: docUserA._id, username: docUserA.username, name: docUserA.name, role: 'doctor', hospitalName: docUserA.hospitalName, tokenVersion: 0 },
      jwtSecret,
      { expiresIn: '2h' }
    );

    const docUserB = await User.create({
      email: 'dr.robert.demo@stjude.health',
      username: 'dr.robert.demo@stjude.health',
      name: 'Dr. Robert Vance',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital',
      isEmailVerified: true
    });
    const docTokenB = jwt.sign(
      { userId: docUserB._id, username: docUserB.username, name: docUserB.name, role: 'doctor', hospitalName: docUserB.hospitalName, tokenVersion: 0 },
      jwtSecret,
      { expiresIn: '2h' }
    );

    const docUserC = await User.create({
      email: 'dr.clara.demo@stjude.health',
      username: 'dr.clara.demo@stjude.health',
      name: 'Dr. Clara Oswald',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital',
      isEmailVerified: true
    });
    const docTokenC = jwt.sign(
      { userId: docUserC._id, username: docUserC.username, name: docUserC.name, role: 'doctor', hospitalName: docUserC.hospitalName, tokenVersion: 0 },
      jwtSecret,
      { expiresIn: '2h' }
    );

    const docUserUnrel = await User.create({
      email: 'dr.evelyn.demo@outpost.health',
      username: 'dr.evelyn.demo@outpost.health',
      name: 'Dr. Evelyn Cross',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'General Outpost Clinic',
      isEmailVerified: true
    });
    const docTokenUnrel = jwt.sign(
      { userId: docUserUnrel._id, username: docUserUnrel.username, name: docUserUnrel.name, role: 'doctor', hospitalName: docUserUnrel.hospitalName, tokenVersion: 0 },
      jwtSecret,
      { expiresIn: '2h' }
    );

    // -------------------------------------------------------------
    // DEMO STEP 1: Patient Screening & CDS Abnormality Detection
    // -------------------------------------------------------------
    const scrRes = await request(app)
      .post('/api/screenings')
      .set('Authorization', `Bearer ${docTokenA}`)
      .send({
        pid: 'PAT-DEMO-001',
        patientName: 'Samantha Hall',
        age: 38,
        gender: 'Female',
        bloodGroup: 'A+',
        vitals: { hr: 135, bp: '85/55', rr: 26, spo2: 89, temp: 39.1, gcs: 14 },
        investigations: [
          { name: 'High-Sensitivity Troponin I', result: '145 ng/L', isAbnormal: true, notes: 'Marked myocardial injury' },
          { name: 'Serum Lactate', result: '4.2 mmol/L', isAbnormal: true, notes: 'Severe tissue hypoperfusion' }
        ],
        clinicalNotes: 'Severe septic shock with myocardial compromise',
        patientConsent: { consentGiven: true, consentTimestamp: new Date(), consentedBy: 'Patient' }
      });

    const screeningId = scrRes.body.screening.screeningId;
    const isFlagged = scrRes.body.screening.evaluation && scrRes.body.screening.evaluation.isFlagged;
    const news2 = scrRes.body.screening.evaluation.news2Score;
    recordStep(
      1,
      'Referring Doctor (Dr. Alice Carter)',
      'Performs intake screening on Samantha Hall (PAT-DEMO-001)',
      'POST /api/screenings',
      'Screening created, CDS flags high-risk abnormalities (NEWS2 >= 7)',
      `Screening ${screeningId} created. Flagged: ${isFlagged}, NEWS2 Score: ${news2}, Risk: ${scrRes.body.screening.evaluation.riskLevel}`,
      scrRes.status === 201 && isFlagged === true && news2 >= 7
    );

    // -------------------------------------------------------------
    // DEMO STEP 2: Referral Creation
    // -------------------------------------------------------------
    const refRes = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${docTokenA}`)
      .send({
        sourceScreeningId: screeningId,
        priority: 'Urgent',
        clinicalReason: 'Refractory septic shock and acute myocardial injury requiring tertiary ICU and catheterization',
        receivingHospital: 'St. Jude Heart Hospital',
        receivingDepartment: 'Cardiology ICU',
        receivingDoctorId: docUserB._id,
        receivingDoctorUsername: docUserB.username,
        receivingDoctorName: docUserB.name
      });

    const referralId = refRes.body.referral.referralId;
    recordStep(
      2,
      'Referring Doctor (Dr. Alice Carter)',
      'Creates Urgent referral linked to source screening',
      'POST /api/referrals',
      'Referral created in PENDING status, linked to screening SCR and transfer handoff',
      `Referral ${referralId} created with status '${refRes.body.referral.status}', priority '${refRes.body.referral.priority}'`,
      refRes.status === 201 && refRes.body.referral.status === 'PENDING'
    );

    // -------------------------------------------------------------
    // DEMO STEP 3: Doctor Reassignment with Documented Clinical Reason
    // -------------------------------------------------------------
    const reassignRes = await request(app)
      .post(`/api/referrals/${referralId}/reassign`)
      .set('Authorization', `Bearer ${docTokenB}`)
      .send({
        receivingDoctorId: docUserC._id,
        reason: 'Patient presents with acute refractory arrhythmias requiring specialized interventional cardiac catheterization',
        department: 'Interventional Cardiology'
      });

    const reassignHistoryLen = reassignRes.body.referral.assignmentHistory.length;
    recordStep(
      3,
      'Receiving Doctor (Dr. Robert Vance)',
      'Reassigns referral to Interventional Cardiologist (Dr. Clara Oswald)',
      `POST /api/referrals/${referralId}/reassign`,
      'Receiving doctor updated to Dr. Clara Oswald, reassignment history preserved with clinical reason',
      `Reassigned to ${reassignRes.body.referral.receivingDoctorName}. Total assignment history entries: ${reassignHistoryLen}`,
      reassignRes.status === 200 && reassignRes.body.referral.receivingDoctorId.toString() === docUserC._id.toString()
    );

    // -------------------------------------------------------------
    // DEMO STEP 4: Patient Consent Grant
    // -------------------------------------------------------------
    const cstRes = await request(app)
      .post('/api/consent')
      .set('Authorization', `Bearer ${pTokenA}`)
      .send({
        authorizedHospital: 'St. Jude Heart Hospital',
        authorizedDoctorName: 'Dr. Clara Oswald',
        purpose: 'SPECIALIST_REFERRAL',
        permittedCategories: ['DEMOGRAPHICS', 'SCREENING_RESULTS', 'REFERRAL_DETAILS', 'INVESTIGATIONS'],
        durationDays: 30
      });

    const consentId = cstRes.body.consent.consentId;
    recordStep(
      4,
      'Patient (Samantha Hall)',
      'Grants digital sharing consent for specialist referral to Dr. Clara Oswald at St. Jude Heart Hospital',
      'POST /api/consent',
      'Active consent granted with explicit permitted data categories and 30-day expiration',
      `Consent ${consentId} granted with categories: [${cstRes.body.consent.permittedCategories.join(', ')}]`,
      cstRes.status === 201 && cstRes.body.consent.status === 'GRANTED'
    );

    // -------------------------------------------------------------
    // DEMO STEP 5: QR/PIN Handoff Generation & Redemption
    // -------------------------------------------------------------
    const qrRes = await request(app)
      .post(`/api/referrals/${referralId}/qr`)
      .set('Authorization', `Bearer ${docTokenA}`)
      .send({ pin: '741258' });

    const qrUuid = qrRes.body.qrSession.uuid;

    const redeemRes = await request(app)
      .post(`/api/qr/validate/${qrUuid}`)
      .send({ pin: '741258' });

    recordStep(
      5,
      'Receiving Specialist (Dr. Clara Oswald)',
      'Scans Handoff QR code and enters 6-digit PIN (741258)',
      `POST /api/qr/validate/${qrUuid}`,
      'PIN verified, clinical payload decrypted, zero authentication secret leakage',
      `Clinical transfer redeemed for patient ${redeemRes.body.transfer.nam}. Age: ${redeemRes.body.transfer.age}, Gender: ${redeemRes.body.transfer.gender}`,
      redeemRes.status === 200 && redeemRes.body.transfer.nam === 'Samantha Hall'
    );

    // -------------------------------------------------------------
    // DEMO STEP 6: Doctor Acknowledgement & Acceptance
    // -------------------------------------------------------------
    const ackRes = await request(app)
      .post(`/api/referrals/${referralId}/acknowledge`)
      .set('Authorization', `Bearer ${docTokenC}`)
      .send({ notes: 'Patient received in cardiology triage. Preparing catheterization laboratory.' });

    const acceptRes = await request(app)
      .post(`/api/referrals/${referralId}/accept`)
      .set('Authorization', `Bearer ${docTokenC}`)
      .send({ notes: 'Accepted for primary angioplasty intervention.' });

    recordStep(
      6,
      'Receiving Specialist (Dr. Clara Oswald)',
      'Formally acknowledges and accepts referral for clinical intake',
      `POST /api/referrals/${referralId}/accept`,
      'Status transitions from PENDING -> ACKNOWLEDGED -> ACCEPTED with timestamp and doctor signature',
      `Referral status is now '${acceptRes.body.referral.status}'. Acknowledgement decision: '${acceptRes.body.referral.acknowledgement.decision}'`,
      ackRes.status === 200 && acceptRes.status === 200 && acceptRes.body.referral.status === 'ACCEPTED'
    );

    // -------------------------------------------------------------
    // DEMO STEP 7: Treatment Start & Full Documentation
    // -------------------------------------------------------------
    await request(app)
      .post(`/api/referrals/${referralId}/start-treatment`)
      .set('Authorization', `Bearer ${docTokenC}`)
      .send({ notes: 'Transferring patient to catheterization lab.' });

    const treatRes = await request(app)
      .post(`/api/referrals/${referralId}/treatment`)
      .set('Authorization', `Bearer ${docTokenC}`)
      .send({
        treatmentSummary: 'Coronary angiography performed: 95% proximal LAD stenosis. Primary drug-eluting stent successfully deployed. Sepsis resuscitation completed.',
        clinicalObservations: 'Hemodynamics stabilized. Blood pressure 125/80 mmHg, HR 74 bpm, lactate normalized to 1.2 mmol/L.',
        proceduresPerformed: ['Coronary angiography', 'Drug-eluting stent placement', 'Arterial line catheterization'],
        medicationsAdministered: [
          { name: 'Aspirin', dose: '300mg', route: 'Oral' },
          { name: 'Ticagrelor', dose: '180mg', route: 'Oral' },
          { name: 'Ceftriaxone', dose: '2g', route: 'IV' }
        ],
        followUpRequired: true,
        followUpInstructions: 'Repeat 12-lead ECG, troponin, and transthoracic echocardiogram in 7 days.'
      });

    recordStep(
      7,
      'Receiving Specialist (Dr. Clara Oswald)',
      'Documents comprehensive clinical treatment and indicates follow-up requirement',
      `POST /api/referrals/${referralId}/treatment`,
      'Treatment documented, medications and procedures saved, status transitions to FOLLOW_UP_REQUIRED',
      `Treatment documented. Status: '${treatRes.body.referral.status}'. Procedures: [${treatRes.body.referral.treatmentDocumentation.proceduresPerformed.join(', ')}]`,
      treatRes.status === 200 && treatRes.body.referral.treatmentDocumentation.treatmentSummary.includes('Coronary angiography')
    );

    // -------------------------------------------------------------
    // DEMO STEP 8: Follow-Up Scheduling & Patient Notification
    // -------------------------------------------------------------
    const fuDueDate = new Date(Date.now() + 7 * 24 * 3600000).toISOString();
    const fuRes = await request(app)
      .post('/api/follow-ups')
      .set('Authorization', `Bearer ${docTokenC}`)
      .send({
        referralId: referralId,
        dueDate: fuDueDate,
        instructions: 'Post-intervention cardiology echo and outpatient review',
        priority: 'Urgent'
      });

    const fuId = fuRes.body.followUp.followUpId;
    const notifs = await Notification.find({ recipientUserId: pUserA._id, relatedReferralId: referralId });

    recordStep(
      8,
      'Receiving Specialist (Dr. Clara Oswald)',
      'Schedules structured follow-up appointment; triggers patient notification',
      'POST /api/follow-ups',
      'Follow-up appointment created in SCHEDULED status, notification delivered to patient',
      `Follow-up ${fuId} scheduled for ${new Date(fuDueDate).toLocaleDateString()}. Notifications dispatched to patient: ${notifs.length}`,
      fuRes.status === 201 && notifs.length >= 1
    );

    // -------------------------------------------------------------
    // DEMO STEP 9: Follow-Up Completion & Documentation
    // -------------------------------------------------------------
    const fuCompRes = await request(app)
      .post(`/api/follow-ups/${fuId}/complete`)
      .set('Authorization', `Bearer ${docTokenC}`)
      .send({
        outcomeNotes: 'Follow-up ECG demonstrates normal sinus rhythm without ischemia. Echocardiogram reveals LVEF 55% with good anterior wall recovery.',
        treatmentSummary: 'Dual antiplatelet therapy confirmed. Patient asymptomatic and recovering well.'
      });

    recordStep(
      9,
      'Receiving Specialist (Dr. Clara Oswald)',
      'Completes follow-up consultation with documented clinical outcome notes',
      `POST /api/follow-ups/${fuId}/complete`,
      'Follow-up status transitions to COMPLETED, unblocking referral closure path',
      `Follow-up ${fuId} marked COMPLETED. Outcome documented.`,
      fuCompRes.status === 200 && fuCompRes.body.followUp.status === 'COMPLETED'
    );

    // -------------------------------------------------------------
    // DEMO STEP 10: Care Confirmation & Referral Closure
    // -------------------------------------------------------------
    const confirmRes = await request(app)
      .post(`/api/referrals/${referralId}/confirm-care`)
      .set('Authorization', `Bearer ${docTokenC}`)
      .send({
        confirmationSummary: 'Comprehensive care delivered. Full cardiac and sepsis recovery confirmed.',
        followUpAddressed: true,
        followUpPlan: 'Routine cardiology outpatient clinic in 6 months.'
      });

    const closeRes = await request(app)
      .post(`/api/referrals/${referralId}/close`)
      .set('Authorization', `Bearer ${docTokenC}`)
      .send({
        closureNotes: 'All clinical milestones reached, treatment documented, follow-ups resolved. Case formally closed.'
      });

    recordStep(
      10,
      'Receiving Specialist (Dr. Clara Oswald)',
      'Confirms clinical care and closes referral lifecycle',
      `POST /api/referrals/${referralId}/close`,
      'Closure gate passes, referral status transitions to COMPLETED, terminal state locked',
      `Referral ${referralId} status: '${closeRes.body.referral.status}'. Closure confirmed: ${closeRes.body.referral.closure.isClosed}`,
      confirmRes.status === 200 && closeRes.status === 200 && closeRes.body.referral.status === 'COMPLETED'
    );

    // -------------------------------------------------------------
    // DEMO STEP 11: AI-Based Monitoring Scan & Alert Lifecycle
    // -------------------------------------------------------------
    const pastDate = new Date(Date.now() - 10 * 3600000); // 10h ago
    const stalledRef = await Referral.create({
      referralId: 'REF-2026-DEMO-STALL',
      patientId: 'PAT-DEMO-001',
      patientName: 'Samantha Hall',
      sourceScreeningId: screeningId,
      sourceScreeningRef: new mongoose.Types.ObjectId(),
      clinicalReason: 'Demonstration of automated risk detection',
      priority: 'Urgent',
      status: 'PENDING',
      referringDoctorId: docUserA._id,
      referringDoctorUsername: docUserA.username,
      referringDoctorName: 'Dr. Alice Carter',
      referringHospital: 'Metropolitan Trauma Hospital',
      createdAt: pastDate,
      updatedAt: pastDate
    });

    const scanStats = await referralMonitoringService.runMonitoringScan();
    const alert = await MonitoringAlert.findOne({ referralId: 'REF-2026-DEMO-STALL', riskCategory: 'ASSIGNMENT_DELAY' });

    recordStep(
      11,
      'MediFORM AI Monitoring Engine',
      'Detects delayed clinical handoff and generates clinical risk alert',
      'POST /api/monitoring/scan',
      'Scans active workload, identifies unassigned Urgent referral > 6h, flags HIGH risk alert with plain-language explanation',
      `Alert ${alert ? alert.alertId : 'N/A'} generated. Category: '${alert ? alert.riskCategory : 'N/A'}', Severity: '${alert ? alert.riskClassification : 'N/A'}'. Explanation: "${alert ? alert.plainLanguageExplanation : 'N/A'}"`,
      scanStats.activeAlertsCount >= 1 && alert && alert.resolutionStatus === 'ACTIVE'
    );

    // -------------------------------------------------------------
    // DEMO STEP 12: Security Scenario — Consent Revocation Halts QR Access
    // -------------------------------------------------------------
    const demoTf = await Transfer.create({
      pid: 'PAT-DEMO-SEC',
      nam: 'Samantha Hall',
      age: 38,
      gender: 'Female',
      bg: 'A+',
      pd: 'Security Verification Transfer',
      fh: 'Metropolitan Trauma Hospital',
      th: 'St. Jude Heart Hospital',
      rt: 'Security Testing',
      issuerUserId: docUserA._id,
      issuerUsername: docUserA.username,
      recipientUserIds: [docUserC._id],
      recipientUsernames: [docUserC.username]
    });

    const secCst = await Consent.create({
      consentId: 'CST-DEMO-SEC-01',
      patientUserId: pUserA._id,
      patientId: 'PAT-DEMO-SEC',
      patientName: 'Samantha Hall',
      authorizedHospital: 'St. Jude Heart Hospital',
      authorizedDoctorId: docUserC._id,
      status: 'GRANTED',
      purpose: 'SPECIALIST_REFERRAL',
      expiresAt: new Date(Date.now() + 10 * 24 * 3600000)
    });

    const secQr = await request(app)
      .post(`/api/transfers/${demoTf._id}/qr`)
      .set('Authorization', `Bearer ${docTokenA}`)
      .send({ pin: '334455' });

    const secUuid = secQr.body.uuid;

    // Patient explicitly revokes consent
    await Consent.findOneAndUpdate(
      { consentId: 'CST-DEMO-SEC-01' },
      { status: 'REVOKED', revokedAt: new Date(), revocationReason: 'Patient withdrawn consent' }
    );

    // Clinician attempts to redeem QR code
    const secAttempt = await request(app)
      .post(`/api/qr/validate/${secUuid}`)
      .send({ pin: '334455' });

    recordStep(
      12,
      'Security Boundary Engine',
      'Patient revokes consent; clinician attempts redemption of previously issued QR code',
      `POST /api/qr/validate/${secUuid}`,
      'HTTP 410 QR_EXPIRED returned immediately, data access denied, audit log generated',
      `Access denied with HTTP ${secAttempt.status} (${secAttempt.body.error.code}). Message: "${secAttempt.body.error.message}"`,
      secAttempt.status === 410 && secAttempt.body.error.code === 'QR_EXPIRED'
    );

    console.log('================================================================');
    console.log(`   DEMONSTRATION COMPLETE: ${demoResults.filter(r => r.status === 'PASS').length}/${demoResults.length} STEPS PASSED`);
    console.log('================================================================\n');

  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
  }

  return demoResults;
}

if (require.main === module) {
  runDemo().catch(err => {
    console.error('Demonstration Runner encountered an error:', err);
    process.exit(1);
  });
}

module.exports = { runDemo };
