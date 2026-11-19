const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Screening = require('../models/Screening');
const Referral = require('../models/Referral');
const Consent = require('../models/Consent');
const FollowUp = require('../models/FollowUp');
const MonitoringAlert = require('../models/MonitoringAlert');
const Notification = require('../models/Notification');
const cdsService = require('../services/cdsService');

async function seedData() {
  console.log('Seeding demo accounts and clinical workflow data...');

  // 1. Doctor A (Referring)
  let docA = await User.findOne({ email: 'dr_smith@gmail.com' });
  if (!docA) {
    docA = await User.create({
      email: 'dr_smith@gmail.com',
      username: 'dr_smith',
      name: 'Dr. John Smith',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital',
      department: 'Emergency & Acute Care',
      isEmailVerified: true
    });
  }

  // 2. Doctor B (Receiving Specialist)
  let docB = await User.findOne({ email: 'dr_clara@stjude.health' });
  if (!docB) {
    docB = await User.create({
      email: 'dr_clara@stjude.health',
      username: 'dr_clara',
      name: 'Dr. Clara Oswald',
      password: 'password123',
      role: 'doctor',
      hospitalName: 'St. Jude Heart Hospital',
      department: 'Interventional Cardiology',
      isEmailVerified: true
    });
  }

  // 3. Patient Samantha Hall
  let patient = await User.findOne({ username: 'pat-demo-001' });
  if (!patient) {
    patient = await User.create({
      email: 'patient@mediform.org',
      username: 'pat-demo-001',
      name: 'Samantha Hall',
      password: 'password123',
      role: 'patient',
      hospitalName: 'Outpatient Community Care',
      isEmailVerified: true
    });
  }

  // 4. Screening with standard synthetic vitals profile
  let screening = await Screening.findOne({ screeningId: 'SCR-2026-001' });
  const vitals = {
    rr: 28,
    spo2: 91,
    hr: 122,
    bp: '88/58',
    temp: 38.8,
    consciousness: 'Alert'
  };
  const evaluation = cdsService.evaluateScreening({ vitals });

  if (!screening) {
    screening = await Screening.create({
      screeningId: 'SCR-2026-001',
      pid: 'PAT-DEMO-001',
      patientName: 'Samantha Hall',
      age: 38,
      gender: 'Female',
      bloodGroup: 'A+',
      contactNumber: '+1-555-0134',
      emergencyContact: 'John Hall (+1-555-0135)',
      vitals,
      evaluation: {
        isFlagged: evaluation.isFlagged,
        riskLevel: evaluation.riskLevel,
        news2Score: evaluation.news2Score,
        flagReasons: evaluation.flagReasons,
        recommendedPriority: evaluation.recommendedPriority,
        summary: evaluation.summary
      },
      patientConsent: {
        consentGiven: true,
        consentTimestamp: new Date(),
        consentedBy: 'Patient'
      },
      recordedByUserId: docA._id,
      recordedByUsername: docA.username,
      hospital: docA.hospitalName,
      screeningDateTime: new Date()
    });
  }

  // 5. Urgent Referral
  let referral = await Referral.findOne({ referralId: 'REF-2026-001' });
  if (!referral) {
    referral = await Referral.create({
      referralId: 'REF-2026-001',
      patientId: 'PAT-DEMO-001',
      patientName: 'Samantha Hall',
      sourceScreeningId: screening.screeningId,
      sourceScreeningRef: screening._id,
      status: 'ACKNOWLEDGED',
      priority: 'Urgent',
      referringDoctorId: docA._id,
      referringDoctorUsername: docA.username,
      referringHospital: docA.hospitalName,
      receivingDoctorId: docB._id,
      receivingDoctorUsername: docB.username,
      receivingHospital: docB.hospitalName,
      receivingSpecialty: 'Interventional Cardiology',
      clinicalReason: 'High NEWS2 score (12) indicative of acute decompensation and septic crisis',
      urgencyReason: 'High NEWS2 score (12) indicative of acute decompensation and septic crisis',
      treatment: {
        isDocumented: false
      },
      timeline: [
        {
          eventType: 'REFERRAL_CREATED',
          timestamp: new Date(Date.now() - 3600000 * 4),
          performingUserId: docA._id,
          performingUsername: docA.username,
          performingUserRole: 'doctor',
          notes: 'Referral created from high-risk screening'
        },
        {
          eventType: 'REFERRAL_ACKNOWLEDGED',
          timestamp: new Date(Date.now() - 3600000 * 2),
          performingUserId: docB._id,
          performingUsername: docB.username,
          performingUserRole: 'doctor',
          notes: 'Referral acknowledged by specialist'
        }
      ]
    });
  }

  // 6. Active Consent
  let consent = await Consent.findOne({ consentId: 'CST-2026-001' });
  if (!consent) {
    consent = await Consent.create({
      consentId: 'CST-2026-001',
      patientUserId: patient._id,
      patientId: 'PAT-DEMO-001',
      patientName: 'Samantha Hall',
      purpose: 'SPECIALIST_REFERRAL',
      authorizedDoctorId: docB._id,
      authorizedDoctorName: docB.name,
      authorizedHospital: docB.hospitalName,
      permittedCategories: [
        'DEMOGRAPHICS',
        'VITALS',
        'SCREENING_RESULTS',
        'CLINICAL_NOTES',
        'MEDICATIONS',
        'REFERRAL_DETAILS',
        'INVESTIGATIONS'
      ],
      status: 'GRANTED',
      grantedAt: new Date(Date.now() - 3600000 * 24),
      expiresAt: new Date(Date.now() + 3600000 * 24 * 30)
    });
  }

  // 7. Follow-Up Appointment
  let followUp = await FollowUp.findOne({ followUpId: 'FLP-2026-001' });
  if (!followUp) {
    followUp = await FollowUp.create({
      followUpId: 'FLP-2026-001',
      referralRef: referral._id,
      referralId: referral.referralId,
      patientId: 'PAT-DEMO-001',
      patientUserId: patient._id,
      patientName: 'Samantha Hall',
      dueDate: new Date(Date.now() + 3600000 * 24 * 7),
      followUpType: 'CLINICAL_REVIEW',
      status: 'SCHEDULED',
      responsibleDoctorId: docB._id,
      responsibleDoctorUsername: docB.username,
      responsibleDoctorName: docB.name,
      targetHospital: docB.hospitalName,
      targetDepartment: docB.department,
      instructions: 'Post-stabilization cardiology follow-up review.'
    });
  }

  // 8. Monitoring Alert
  let alert = await MonitoringAlert.findOne({ alertId: 'ALT-2026-001' });
  if (!alert) {
    alert = await MonitoringAlert.create({
      alertId: 'ALT-2026-001',
      referralRef: referral._id,
      referralId: referral.referralId,
      patientId: 'PAT-DEMO-001',
      riskCategory: 'ACKNOWLEDGEMENT_DELAY',
      riskClassification: 'HIGH',
      relevantLifecycleStatus: 'PENDING',
      plainLanguageExplanation: 'Urgent referral REF-2026-001 remained pending acknowledgement for >6 hours before clinical review.',
      recommendedAction: 'Verify that admitting cardiology team has finalized clinical handoff.',
      resolutionStatus: 'ACTIVE',
      responsibleDoctorId: docB._id,
      responsibleDoctorName: docB.name,
      receivingHospital: docB.hospitalName,
      referringDoctorId: docA._id,
      referringHospital: docA.hospitalName
    });
  }

  // 9. Notification for patient
  let notif = await Notification.findOne({ recipientUserId: patient._id });
  if (!notif) {
    notif = await Notification.create({
      notificationId: 'NTF-2026-001',
      eventId: 'EVT-2026-001',
      recipientUserId: patient._id,
      recipientPatientId: patient.username,
      recipientRole: 'patient',
      notificationType: 'FOLLOW_UP_SCHEDULED',
      title: 'Follow-Up Scheduled',
      message: 'Your follow-up clinical review with Dr. Clara Oswald at St. Jude Heart Hospital is scheduled for 26/11/2026.',
      priority: 'HIGH',
      relatedReferralId: referral.referralId,
      relatedReferralRef: referral._id,
      status: 'UNREAD'
    });
  }

  console.log('Demo data successfully seeded.');
}

module.exports = { seedData };
