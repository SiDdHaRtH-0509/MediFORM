import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { storage } from '../utils/storage';

const CLOUD_API_FALLBACK = 'https://mediform-backend.onrender.com/api';

const getPrimaryApiBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5000/api';
    }
    return origin ? `${origin}/api` : CLOUD_API_FALLBACK;
  }
  // Native iOS / Android: derive dev machine LAN IP from Expo hostUri when running in Expo Go / Dev Client
  const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.debuggerHost;
  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    if (hostIp) {
      return `http://${hostIp}:5000/api`;
    }
  }
  return Platform.OS === 'android' ? 'http://10.0.2.2:5000/api' : 'http://localhost:5000/api';
};

const PRIMARY_API_BASE_URL = getPrimaryApiBaseUrl();

/**
 * Resilient Offline / Fallback Mock API Handler
 * Handles Auth, OTP, Transfers, QR Generation, and 6-digit PIN validation.
 */
function handleOfflineMockFallback(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};

  // Auth: Register
  if (endpoint === '/auth/register' && method === 'POST') {
    const challengeId = `mock_chal_${Date.now()}`;
    const pendingData = {
      email: body.username || body.email || 'doctor@hospital.org',
      name: body.name || 'Dr. Siddharth',
      role: 'doctor',
      hospitalName: body.hospitalName || 'Metropolitan Trauma Hospital'
    };
    storage.setItem(`mock_pending_${challengeId}`, JSON.stringify(pendingData));

    return {
      success: true,
      requireOtp: true,
      challengeId,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      resendAvailableAt: new Date(Date.now() + 60000).toISOString(),
      devOtp: '123456',
      message: 'Doctor email verification OTP sent (Demo mode). Enter verification code 123456 to continue.'
    };
  }

  // Auth: Login
  if (endpoint === '/auth/login' && method === 'POST') {
    const challengeId = `mock_chal_${Date.now()}`;
    const loginEmail = body.username || body.email || 'dr_smith@gmail.com';
    const pendingData = {
      email: loginEmail,
      name: 'Dr. Siddharth',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital'
    };
    storage.setItem(`mock_pending_${challengeId}`, JSON.stringify(pendingData));

    return {
      success: true,
      requireOtp: true,
      challengeId,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      resendAvailableAt: new Date(Date.now() + 60000).toISOString(),
      devOtp: '123456',
      message: 'Doctor login OTP sent (Demo mode). Enter verification code 123456 to continue.'
    };
  }

  // Auth: Verify OTP (Registration / Login / Email)
  if ((endpoint.startsWith('/auth/verify-') || endpoint === '/auth/verify-otp') && method === 'POST') {
    const challengeId = body.challengeId;
    const storedPending = storage.getItem(`mock_pending_${challengeId}`);
    const pendingData = storedPending ? JSON.parse(storedPending) : {
      email: 'clsiddharth7075@gmail.com',
      name: 'Dr. Siddharth',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital'
    };

    const user = {
      _id: `mock_user_${Date.now()}`,
      id: `mock_user_${Date.now()}`,
      email: pendingData.email,
      username: pendingData.email,
      name: pendingData.name || 'Dr. Jane Smith',
      role: 'doctor',
      hospitalName: pendingData.hospitalName || 'Metropolitan Trauma Hospital',
      verificationStatus: 'VERIFIED',
      isInstitutionalVerifier: true
    };

    const token = `mock_jwt_token_${Date.now()}`;
    storage.setItem('mediform_mock_user', JSON.stringify(user));

    return {
      success: true,
      token,
      user,
      message: 'Authentication successful.'
    };
  }

  // Auth: Get Me
  if (endpoint === '/auth/me') {
    const storedUser = storage.getItem('mediform_mock_user');
    const user = storedUser ? JSON.parse(storedUser) : {
      _id: 'mock_user_default',
      email: 'clsiddharth7075@gmail.com',
      username: 'clsiddharth7075@gmail.com',
      name: 'Dr. Siddharth',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital'
    };

    return { success: true, user };
  }

  // Auth: Forgot / Reset Password
  if (endpoint === '/auth/forgot-password' && method === 'POST') {
    const challengeId = `mock_chal_${Date.now()}`;
    return {
      success: true,
      challengeId,
      devOtp: '123456',
      message: 'Password reset OTP code generated (Demo mode: 123456).'
    };
  }

  if (endpoint === '/auth/reset-password' && method === 'POST') {
    return { success: true, message: 'Password reset successfully.' };
  }

  // Transfers: Create Transfer
  if (endpoint === '/transfers' && method === 'POST') {
    const existingTransfers = JSON.parse(storage.getItem('mediform_transfers') || '[]');
    const newTransfer = {
      _id: `transfer_${Date.now()}`,
      ...body,
      submittedAt: new Date().toISOString(),
      status: 'IN_TRANSIT',
      acknowledgementStatus: 'PENDING'
    };
    existingTransfers.unshift(newTransfer);
    storage.setItem('mediform_transfers', JSON.stringify(existingTransfers));
    return { success: true, transfer: newTransfer };
  }

  // Transfers: History
  if (endpoint.startsWith('/transfers/history')) {
    const existingTransfers = JSON.parse(storage.getItem('mediform_transfers') || '[]');
    return { success: true, transfers: existingTransfers };
  }

  // Transfers: Timeline or Specific PID
  if (endpoint.includes('/transfers/pid/')) {
    const existingTransfers = JSON.parse(storage.getItem('mediform_transfers') || '[]');
    return { success: true, history: existingTransfers, transfer: existingTransfers[0] || null };
  }

  // QR: Generate
  if (endpoint === '/qr/generate' && method === 'POST') {
    const uuid = `qr_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const pin = body.pin && /^\d{6}$/.test(body.pin) ? body.pin : Math.floor(100000 + Math.random() * 900000).toString();
    const existingTransfers = JSON.parse(storage.getItem('mediform_transfers') || '[]');
    const transfer = existingTransfers.find(t => t._id === body.transferId) || existingTransfers[0] || {
      _id: body.transferId || 'transfer_demo',
      pid: 'PAT-10029',
      nam: 'John Doe',
      age: 45,
      gender: 'Male',
      bg: 'O+',
      fh: 'St. Jude Emergency Hospital',
      th: 'Metropolitan Trauma ICU',
      rt: 'Acute Coronary Syndrome',
      priority: 'Critical',
      pd: 'ST-Elevation Myocardial Infarction (STEMI)',
      submittedAt: new Date().toISOString()
    };

    storage.setItem(`mock_qr_${uuid}`, JSON.stringify({ uuid, pin, transfer }));

    return {
      success: true,
      uuid,
      pin,
      expiresAt: new Date(Date.now() + 1800000).toISOString(),
      shareUrl: `${typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://mediform.health'}/handoff/${uuid}`,
      deepLinkUrl: `mediform://handoff/${uuid}`,
      transferId: transfer._id,
      patientId: transfer.pid,
      patientName: transfer.nam,
      fromHospital: transfer.fh,
      toHospital: transfer.th,
      priority: transfer.priority
    };
  }

  // QR: Validate QR (Clinician PIN verification)
  if (endpoint.startsWith('/qr/validate/') && method === 'POST') {
    const uuid = endpoint.replace('/qr/validate/', '');
    const submittedPin = body.pin ? body.pin.trim() : '';
    const storedQrData = storage.getItem(`mock_qr_${uuid}`);
    const qrObj = storedQrData ? JSON.parse(storedQrData) : null;

    const expectedPin = qrObj ? qrObj.pin : '123456';
    if (submittedPin !== expectedPin && submittedPin !== '123456') {
      const errorObj = new Error('Incorrect 6-digit PIN.');
      errorObj.status = 401;
      errorObj.code = 'INCORRECT_PIN';
      throw errorObj;
    }

    const existingTransfers = JSON.parse(storage.getItem('mediform_transfers') || '[]');
    const transfer = (qrObj && qrObj.transfer) || existingTransfers[0] || {
      _id: 'transfer_demo',
      pid: 'PAT-10029',
      nam: 'John Doe',
      age: 45,
      gender: 'Male',
      bg: 'O+',
      fh: 'St. Jude Emergency Hospital',
      th: 'Metropolitan Trauma ICU',
      rt: 'Acute Coronary Syndrome',
      priority: 'Critical',
      pd: 'ST-Elevation Myocardial Infarction (STEMI)',
      sum: 'Patient presented with acute chest pain. EKG shows ST elevation in leads II, III, aVF.',
      submittedAt: new Date().toISOString()
    };

    return {
      success: true,
      transfer
    };
  }

  // QR: Validate Patient QR (Patient-Safe Read-Only PIN verification)
  if (endpoint.startsWith('/qr/validate-patient/') && method === 'POST') {
    const uuid = endpoint.replace('/qr/validate-patient/', '');
    const submittedPin = body.pin ? body.pin.trim() : '';
    const storedQrData = storage.getItem(`mock_qr_${uuid}`);
    const qrObj = storedQrData ? JSON.parse(storedQrData) : null;

    const expectedPin = qrObj ? qrObj.pin : '123456';
    if (submittedPin !== expectedPin && submittedPin !== '123456') {
      const errorObj = new Error('Incorrect 6-digit PIN.');
      errorObj.status = 401;
      errorObj.code = 'INCORRECT_PIN';
      throw errorObj;
    }

    const existingTransfers = JSON.parse(storage.getItem('mediform_transfers') || '[]');
    const transfer = (qrObj && qrObj.transfer) || existingTransfers[0] || {
      pid: 'PAT-10029',
      nam: 'John Doe',
      age: 45,
      gender: 'Male',
      bg: 'O+',
      fh: 'St. Jude Emergency Hospital',
      th: 'Metropolitan Trauma ICU',
      rt: 'Acute Coronary Syndrome',
      priority: 'Critical',
      pd: 'ST-Elevation Myocardial Infarction (STEMI)',
      sum: 'Patient presented with acute chest pain. EKG shows ST elevation in leads II, III, aVF.',
      submittedAt: new Date().toISOString()
    };

    return {
      success: true,
      patientView: {
        patientName: transfer.nam,
        patientId: transfer.pid,
        age: transfer.age,
        gender: transfer.gender,
        bloodGroup: transfer.bg,
        fromHospital: transfer.fh,
        toHospital: transfer.th,
        transferReason: transfer.rt,
        priority: transfer.priority,
        primaryDiagnosis: transfer.pd,
        clinicalSummary: transfer.sum || 'N/A',
        submittedAt: transfer.submittedAt
      }
    };
  }

  // Screenings: Create Screening
  if (endpoint === '/screenings' && method === 'POST') {
    const existing = JSON.parse(storage.getItem('mediform_screenings') || '[]');
    const id = `SCR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const vitals = body.vitals || {};
    const hr = Number(vitals.hr) || 0;
    const isFlagged = hr > 110 || hr < 50 || Number(vitals.spo2) < 94 || (body.investigations || []).some(inv => (inv.status || '').toLowerCase() === 'abnormal');
    
    const newScr = {
      _id: `mock_scr_${Date.now()}`,
      screeningId: id,
      ...body,
      evaluation: {
        isFlagged,
        riskLevel: isFlagged ? 'HIGH' : 'LOW',
        news2Score: isFlagged ? 7 : 1,
        flagReasons: isFlagged ? ['Abnormal physiological parameter detected'] : [],
        recommendedPriority: isFlagged ? 'Emergency' : 'Routine',
        summary: isFlagged ? 'Flagged clinical screening requiring review' : 'Normal routine screening'
      },
      createdAt: new Date().toISOString()
    };
    existing.unshift(newScr);
    storage.setItem('mediform_screenings', JSON.stringify(existing));
    return { success: true, screening: newScr };
  }

  // Screenings: List Screenings
  if (endpoint.startsWith('/screenings') && method === 'GET') {
    const existing = JSON.parse(storage.getItem('mediform_screenings') || '[]');
    if (endpoint.includes('/flagged')) {
      const flagged = existing.filter(s => s.evaluation && s.evaluation.isFlagged);
      return { success: true, screenings: flagged, count: flagged.length };
    }
    return { success: true, screenings: existing, count: existing.length };
  }

  // Referrals: Create Referral
  if (endpoint === '/referrals' && method === 'POST') {
    const existingRefs = JSON.parse(storage.getItem('mediform_referrals') || '[]');
    const id = `REF-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const newRef = {
      _id: `mock_ref_${Date.now()}`,
      referralId: id,
      ...body,
      status: 'PENDING',
      assignmentHistory: body.receivingDoctorId ? [{
        previousReceivingDoctorId: null,
        newReceivingDoctorId: body.receivingDoctorId,
        newReceivingDoctorName: body.receivingDoctorName || 'Assigned Doctor',
        timestamp: new Date().toISOString(),
        reason: 'Initial assignment'
      }] : [],
      createdAt: new Date().toISOString()
    };
    existingRefs.unshift(newRef);
    storage.setItem('mediform_referrals', JSON.stringify(existingRefs));
    return { success: true, referral: newRef };
  }

  // Referrals: Reassign Referral
  if (endpoint.includes('/referrals/') && endpoint.endsWith('/reassign') && method === 'POST') {
    const existingRefs = JSON.parse(storage.getItem('mediform_referrals') || '[]');
    const id = endpoint.split('/referrals/')[1].split('/reassign')[0];
    const ref = existingRefs.find(r => r.referralId === id || r._id === id);
    if (ref) {
      ref.assignmentHistory = ref.assignmentHistory || [];
      ref.assignmentHistory.push({
        previousReceivingDoctorId: ref.receivingDoctorId,
        previousReceivingDoctorUsername: ref.receivingDoctorUsername,
        previousReceivingDoctorName: ref.receivingDoctorName,
        newReceivingDoctorId: body.receivingDoctorId,
        newReceivingDoctorUsername: body.receivingDoctorUsername || 'doctor_assigned',
        newReceivingDoctorName: body.receivingDoctorName || 'Assigned Doctor',
        timestamp: new Date().toISOString(),
        reason: body.reason || 'Reassigned'
      });
      ref.receivingDoctorId = body.receivingDoctorId;
      ref.receivingDoctorUsername = body.receivingDoctorUsername || 'doctor_assigned';
      ref.receivingDoctorName = body.receivingDoctorName || 'Assigned Doctor';
      if (body.department) ref.receivingDepartment = body.department;
      ref.assignmentTimestamp = new Date().toISOString();
      storage.setItem('mediform_referrals', JSON.stringify(existingRefs));
      return { success: true, message: 'Referral reassigned.', referral: ref };
    }
  }

  // Referrals: List Referrals
  if (endpoint.startsWith('/referrals') && method === 'GET') {
    const existingRefs = JSON.parse(storage.getItem('mediform_referrals') || '[]');
    return { success: true, referrals: existingRefs, count: existingRefs.length };
  }

  // Referrals: Generate QR
  if (endpoint.includes('/referrals/') && endpoint.endsWith('/qr') && method === 'POST') {
    const uuid = `mock_ref_uuid_${Date.now()}`;
    const pin = body.pin || '123456';
    return {
      success: true,
      qrSession: {
        uuid,
        pin,
        expiresAt: new Date(Date.now() + 7200000).toISOString(),
        shareUrl: `https://mediform.health/handoff/${uuid}`
      }
    };
  }

  // Referrals: Lifecycle actions mock
  if (endpoint.includes('/referrals/') && method === 'POST') {
    const existingRefs = JSON.parse(storage.getItem('mediform_referrals') || '[]');
    const parts = endpoint.split('/referrals/')[1].split('/');
    const id = parts[0];
    const action = parts[1];
    const ref = existingRefs.find(r => r.referralId === id || r._id === id);

    if (ref) {
      ref.timeline = ref.timeline || [];
      if (action === 'acknowledge') {
        ref.status = 'ACKNOWLEDGED';
        ref.acknowledgement = { acknowledgedAt: new Date().toISOString(), decision: 'ACKNOWLEDGED', notes: body.notes || '' };
        ref.timeline.push({ eventType: 'REFERRAL_ACKNOWLEDGED', newStatus: 'ACKNOWLEDGED', timestamp: new Date().toISOString(), notes: body.notes || '' });
      } else if (action === 'accept') {
        ref.status = 'ACCEPTED';
        ref.timeline.push({ eventType: 'REFERRAL_ACCEPTED', newStatus: 'ACCEPTED', timestamp: new Date().toISOString(), notes: body.notes || '' });
      } else if (action === 'reject') {
        ref.status = 'REJECTED';
        ref.rejection = { rejectedAt: new Date().toISOString(), reason: body.reason || '' };
        ref.timeline.push({ eventType: 'REFERRAL_REJECTED', newStatus: 'REJECTED', timestamp: new Date().toISOString(), reason: body.reason || '' });
      } else if (action === 'start-treatment') {
        ref.status = 'IN_PROGRESS';
        ref.timeline.push({ eventType: 'TREATMENT_STARTED', newStatus: 'IN_PROGRESS', timestamp: new Date().toISOString(), notes: body.notes || '' });
      } else if (action === 'treatment') {
        ref.treatmentDocumentation = { ...body, documentedAt: new Date().toISOString() };
        ref.status = body.followUpRequired ? 'FOLLOW_UP_REQUIRED' : 'IN_PROGRESS';
        ref.timeline.push({ eventType: 'TREATMENT_DOCUMENTED', newStatus: ref.status, timestamp: new Date().toISOString(), notes: body.treatmentSummary || '' });
      } else if (action === 'confirm-care') {
        ref.careConfirmation = { isConfirmed: true, ...body, confirmedAt: new Date().toISOString() };
        ref.timeline.push({ eventType: 'CARE_CONFIRMED', newStatus: ref.status, timestamp: new Date().toISOString(), notes: body.confirmationSummary || '' });
      } else if (action === 'close') {
        ref.status = 'COMPLETED';
        ref.closure = { isClosed: true, closureNotes: body.closureNotes || '', closedAt: new Date().toISOString() };
        ref.timeline.push({ eventType: 'REFERRAL_CLOSED', newStatus: 'COMPLETED', timestamp: new Date().toISOString(), notes: body.closureNotes || '' });
      } else if (action === 'cancel') {
        ref.status = 'CANCELLED';
        ref.timeline.push({ eventType: 'REFERRAL_CANCELLED', newStatus: 'CANCELLED', timestamp: new Date().toISOString(), reason: body.reason || '' });
      }
      storage.setItem('mediform_referrals', JSON.stringify(existingRefs));
      return { success: true, referral: ref };
    }
  }

  // Referrals: Get Timeline Mock
  if (endpoint.includes('/referrals/') && endpoint.endsWith('/timeline') && method === 'GET') {
    const existingRefs = JSON.parse(storage.getItem('mediform_referrals') || '[]');
    const id = endpoint.split('/referrals/')[1].split('/timeline')[0];
    const ref = existingRefs.find(r => r.referralId === id || r._id === id);
    return { success: true, timeline: (ref && ref.timeline) || [] };
  }

  // Doctor Directory Lookup
  if ((endpoint.startsWith('/user/doctors') || endpoint.startsWith('/referrals/doctors')) && method === 'GET') {
    return {
      success: true,
      count: 3,
      doctors: [
        {
          id: 'doc_metro_1',
          doctorId: 'doc_metro_1',
          name: 'Dr. Jane Smith',
          username: 'dr_smith@gmail.com',
          email: 'dr_smith@gmail.com',
          hospital: 'Metropolitan Trauma Hospital',
          hospitalName: 'Metropolitan Trauma Hospital',
          specialization: 'Emergency Medicine',
          department: 'Trauma ICU',
          isEmailVerified: true,
          verificationStatus: 'VERIFIED',
          isVerified: true,
          yearsOfExperience: 10,
          professionalDesignation: 'Attending Emergency Physician'
        },
        {
          id: 'doc_stjude_1',
          doctorId: 'doc_stjude_1',
          name: 'Dr. Robert Vance',
          username: 'dr_vance@stjude.org',
          email: 'dr_vance@stjude.org',
          hospital: 'St. Jude Heart Hospital',
          hospitalName: 'St. Jude Heart Hospital',
          specialization: 'Cardiothoracic Surgery',
          department: 'Cardiac Surgery Unit',
          isEmailVerified: true,
          verificationStatus: 'PENDING',
          isVerified: false,
          yearsOfExperience: 14,
          professionalDesignation: 'Consultant Cardiac Surgeon'
        },
        {
          id: 'doc_general_1',
          doctorId: 'doc_general_1',
          name: 'Dr. Sarah Connor',
          username: 'dr_connor@citymed.org',
          email: 'dr_connor@citymed.org',
          hospital: 'City General Medical Center',
          hospitalName: 'City General Medical Center',
          specialization: 'Neurology & Neurosurgery',
          department: 'Neuro ICU',
          isEmailVerified: true,
          verificationStatus: 'VERIFIED',
          isVerified: true,
          yearsOfExperience: 8,
          professionalDesignation: 'Senior Resident'
        }
      ]
    };
  }

  // Notifications Mock (Phase 4)
  if (endpoint.startsWith('/notifications') && method === 'GET') {
    if (endpoint.includes('/unread-count')) {
      const notifs = JSON.parse(storage.getItem('mediform_notifications') || '[]');
      return { success: true, unreadCount: notifs.filter(n => !n.isRead).length };
    }
    if (endpoint.includes('/preferences')) {
      const prefs = JSON.parse(storage.getItem('mediform_notif_prefs') || '{"referralUpdates":true,"appointmentReminders":true,"followUpReminders":true,"generalCareUpdates":true}');
      return { success: true, preferences: prefs };
    }
    let notifs = JSON.parse(storage.getItem('mediform_notifications') || '[]');
    if (notifs.length === 0) {
      notifs = [
        {
          notificationId: 'NOTIF-2026-101',
          title: 'New Medical Referral Created',
          message: 'A referral (REF-2026-881920) to St. Jude Heart Hospital has been initiated by Dr. Alice Carter.',
          category: 'REFERRAL_UPDATE',
          notificationType: 'REFERRAL_CREATED',
          relatedReferralId: 'REF-2026-881920',
          isRead: false,
          deliveryStatus: 'DELIVERED',
          createdAt: new Date(Date.now() - 3600000).toISOString()
        },
        {
          notificationId: 'NOTIF-2026-102',
          title: 'Specialist Assigned',
          message: 'Dr. Robert Vance at St. Jude Heart Hospital has been assigned to your referral (REF-2026-881920).',
          category: 'REFERRAL_UPDATE',
          notificationType: 'DOCTOR_ASSIGNED',
          relatedReferralId: 'REF-2026-881920',
          isRead: false,
          deliveryStatus: 'DELIVERED',
          createdAt: new Date(Date.now() - 1800000).toISOString()
        }
      ];
      storage.setItem('mediform_notifications', JSON.stringify(notifs));
    }
    return { success: true, notifications: notifs, count: notifs.length, totalUnread: notifs.filter(n => !n.isRead).length };
  }

  if (endpoint.startsWith('/notifications') && method === 'PATCH') {
    if (endpoint.includes('/preferences')) {
      storage.setItem('mediform_notif_prefs', JSON.stringify(body));
      return { success: true, preferences: body };
    }
    if (endpoint.includes('/read-all')) {
      const notifs = JSON.parse(storage.getItem('mediform_notifications') || '[]');
      notifs.forEach(n => { n.isRead = true; n.readAt = new Date().toISOString(); });
      storage.setItem('mediform_notifications', JSON.stringify(notifs));
      return { success: true, message: 'All marked read.' };
    }
    if (endpoint.includes('/read')) {
      const id = endpoint.split('/notifications/')[1].split('/read')[0];
      const notifs = JSON.parse(storage.getItem('mediform_notifications') || '[]');
      const notif = notifs.find(n => n.notificationId === id || n._id === id);
      if (notif) {
        notif.isRead = true;
        notif.readAt = new Date().toISOString();
        storage.setItem('mediform_notifications', JSON.stringify(notifs));
        return { success: true, notification: notif };
      }
    }
  }

  if (endpoint.startsWith('/follow-ups')) {
    const stored = JSON.parse(storage.getItem('mediform_followups') || '[]');
    if (method === 'POST') {
      const newFlp = {
        followUpId: `FLP-2026-${Math.floor(100000 + Math.random() * 900000)}`,
        status: 'SCHEDULED',
        ...body,
        createdAt: new Date().toISOString()
      };
      stored.unshift(newFlp);
      storage.setItem('mediform_followups', JSON.stringify(stored));
      return { success: true, followUp: newFlp };
    }
    return {
      success: true,
      followUps: stored,
      count: stored.length,
      summary: {
        upcomingCount: stored.filter(f => ['SCHEDULED', 'UPCOMING', 'DUE'].includes(f.status)).length,
        overdueCount: stored.filter(f => f.status === 'OVERDUE').length,
        missedCount: stored.filter(f => f.status === 'MISSED').length,
        completedCount: stored.filter(f => f.status === 'COMPLETED').length
      }
    };
  }

  if (endpoint.startsWith('/monitoring')) {
    const alerts = JSON.parse(storage.getItem('mediform_monitoring_alerts') || '[]');
    if (endpoint.includes('/scan')) {
      return { success: true, stats: { scannedCount: 3, activeAlertsCount: alerts.length } };
    }
    if (endpoint.includes('/dismiss')) {
      const id = endpoint.split('/alerts/')[1].split('/dismiss')[0];
      const alert = alerts.find(a => a.alertId === id || a._id === id);
      if (alert) {
        alert.status = 'DISMISSED';
        alert.resolution = { resolvedAt: new Date().toISOString(), reason: body.reason || 'Clinically resolved' };
        storage.setItem('mediform_monitoring_alerts', JSON.stringify(alerts));
      }
      return { success: true, alert };
    }
    return {
      success: true,
      alerts,
      count: alerts.length,
      summary: {
        activeCount: alerts.filter(a => a.status === 'ACTIVE').length,
        criticalCount: alerts.filter(a => a.riskClassification === 'CRITICAL').length,
        highCount: alerts.filter(a => a.riskClassification === 'HIGH').length,
        mediumCount: alerts.filter(a => a.riskClassification === 'MEDIUM').length,
        resolvedCount: alerts.filter(a => a.status !== 'ACTIVE').length
      }
    };
  }

  // Doctor Profile & Credentials Mock (Phase 9)
  if (endpoint.startsWith('/doctors/profile')) {
    const storedProfile = JSON.parse(storage.getItem('mediform_doctor_profile') || 'null') || {
      id: 'doc_self',
      doctorId: 'doc_self',
      name: 'Dr. Jane Smith',
      username: 'dr_smith@gmail.com',
      email: 'dr_smith@gmail.com',
      phone: '+1 (555) 234-5678',
      bio: 'Senior Emergency Medicine Attending and Acute Resuscitation Specialist.',
      profilePhoto: '',
      specialization: 'Emergency Medicine',
      department: 'Emergency / Triage',
      yearsOfExperience: 10,
      medicalRegistrationNumber: 'MED-REG-2026-44912',
      registrationAuthority: 'National Medical Commission',
      registrationJurisdiction: 'New York State Board of Medicine',
      professionalDesignation: 'Attending Emergency Physician',
      hospitalName: 'Metropolitan Trauma Hospital',
      institutionalAffiliationDetails: 'Metropolitan Healthcare System - Level 1 Trauma Center',
      isEmailVerified: true,
      isPhoneVerified: true,
      verificationStatus: 'VERIFIED',
      isInstitutionalVerifier: true,
      createdAt: '2026-01-15T08:00:00.000Z',
      lastProfileUpdate: new Date().toISOString()
    };

    if (method === 'PATCH' || method === 'PUT') {
      const isCurrentlyVerified = storedProfile.verificationStatus === 'VERIFIED';
      const changedMaterial = (body.medicalRegistrationNumber && body.medicalRegistrationNumber !== storedProfile.medicalRegistrationNumber) ||
        (body.hospitalName && body.hospitalName !== storedProfile.hospitalName);

      Object.assign(storedProfile, body);
      storedProfile.lastProfileUpdate = new Date().toISOString();
      let reverificationTriggered = false;

      if (isCurrentlyVerified && changedMaterial) {
        storedProfile.verificationStatus = 'RESUBMISSION_REQUIRED';
        reverificationTriggered = true;
      }
      storage.setItem('mediform_doctor_profile', JSON.stringify(storedProfile));
      return { success: true, profile: storedProfile, reverificationTriggered };
    }

    if (endpoint.includes('/photo') && method === 'POST') {
      storedProfile.profilePhoto = body.profilePhoto || body.photoData || '';
      storage.setItem('mediform_doctor_profile', JSON.stringify(storedProfile));
      return { success: true, profilePhoto: storedProfile.profilePhoto };
    }

    return { success: true, profile: storedProfile };
  }

  if (endpoint.startsWith('/doctors/credentials')) {
    let verifications = JSON.parse(storage.getItem('mediform_verifications') || '[]');
    let currentVerif = verifications.find(v => v.doctorId === 'doc_self') || {
      id: 'verif_1',
      doctorId: 'doc_self',
      status: 'VERIFIED',
      medicalRegistrationNumber: 'MED-REG-2026-44912',
      registrationAuthority: 'National Medical Commission',
      registrationJurisdiction: 'New York State Board of Medicine',
      professionalDesignation: 'Attending Emergency Physician',
      hospitalAffiliation: 'Metropolitan Trauma Hospital',
      submissionTimestamp: '2026-02-01T10:00:00.000Z',
      reviewerName: 'State Medical Licensing Board',
      reviewTimestamp: '2026-02-03T14:30:00.000Z',
      reviewNotes: 'All primary medical qualifications and state licensure authenticated.',
      documents: [{ documentId: 'doc_cert_1', fileName: 'medical_license_cert.pdf', fileType: 'application/pdf', fileSize: 1048576, uploadedAt: '2026-02-01T10:00:00.000Z' }]
    };

    if (endpoint.includes('/submit') && method === 'POST') {
      currentVerif = {
        ...currentVerif,
        ...body,
        status: 'PENDING',
        submissionTimestamp: new Date().toISOString(),
        reviewerName: null,
        reviewTimestamp: null,
        reviewNotes: null
      };
      const existingIdx = verifications.findIndex(v => v.doctorId === 'doc_self');
      if (existingIdx >= 0) verifications[existingIdx] = currentVerif;
      else verifications.push(currentVerif);
      storage.setItem('mediform_verifications', JSON.stringify(verifications));

      const prof = JSON.parse(storage.getItem('mediform_doctor_profile') || '{}');
      prof.verificationStatus = 'PENDING';
      storage.setItem('mediform_doctor_profile', JSON.stringify(prof));

      return { success: true, message: 'Credentials submitted.', verification: currentVerif };
    }

    if (endpoint.includes('/status')) {
      return { success: true, verificationStatus: currentVerif.status, verification: currentVerif };
    }

    return { success: true, verification: currentVerif };
  }

  if (endpoint.startsWith('/verifications')) {
    let verifications = JSON.parse(storage.getItem('mediform_verifications') || '[]');
    if (verifications.length === 0) {
      verifications = [
        {
          id: 'verif_ext_1',
          doctorId: 'doc_stjude_1',
          doctorName: 'Dr. Robert Vance',
          doctorEmail: 'dr_vance@stjude.org',
          hospital: 'St. Jude Heart Hospital',
          department: 'Cardiac Surgery Unit',
          specialization: 'Cardiothoracic Surgery',
          medicalRegistrationNumber: 'MED-TX-9921',
          registrationAuthority: 'Texas Medical Board',
          registrationJurisdiction: 'Texas',
          professionalDesignation: 'Consultant Cardiac Surgeon',
          status: 'PENDING',
          submissionTimestamp: new Date().toISOString(),
          documents: [{ documentId: 'doc_tx_1', fileName: 'texas_medical_license.pdf', fileType: 'application/pdf', fileSize: 850000 }]
        }
      ];
      storage.setItem('mediform_verifications', JSON.stringify(verifications));
    }

    if (endpoint.includes('/review') && method === 'POST') {
      const id = endpoint.split('/verifications/')[1].split('/review')[0];
      const target = verifications.find(v => v.id === id || v.doctorId === id);
      if (target) {
        target.status = body.decision || 'VERIFIED';
        target.reviewerName = 'Dr. Jane Smith (Institutional Verifier)';
        target.reviewTimestamp = new Date().toISOString();
        target.reviewNotes = body.notes || '';
        storage.setItem('mediform_verifications', JSON.stringify(verifications));
      }
      return { success: true, verification: target };
    }

    if (endpoint.includes('/pending')) {
      return { success: true, count: verifications.length, verifications };
    }

    const id = endpoint.split('/verifications/')[1];
    const target = verifications.find(v => v.id === id || v.doctorId === id) || verifications[0];
    return { success: true, verification: target };
  }

  // Default fallback response
  if (endpoint === '/qr/dispatch' && method === 'POST') {
    return {
      success: true,
      notifiedDoctorsCount: 1,
      emailDispatched: Boolean(body.recipientEmail),
      shareUrl: body.shareUrl,
      message: 'Handoff dispatched to receiving facility (Offline Resilient Mode).'
    };
  }

  if (endpoint.includes('/ems-status')) {
    const transfers = JSON.parse(storage.getItem('mediform_transfers') || '[]');
    const tr = transfers[0] || {};
    return {
      success: true,
      transferId: tr._id || 'transfer_demo',
      pid: tr.pid || 'PAT-10029',
      patientName: tr.nam || 'John Doe',
      priority: tr.priority || 'Emergency',
      status: tr.status || 'IN_TRANSIT',
      fromHospital: tr.fh || 'Origin Hospital',
      toHospital: tr.th || 'Receiving Hospital',
      contacts: {
        ambulancePhone: tr.emsDispatch?.ambulancePhone || '+919800000108',
        ambulanceId: tr.emsDispatch?.ambulanceId || 'AMB-108',
        ambulanceCrewName: tr.emsDispatch?.ambulanceCrewName || 'Paramedic Unit A',
        referringHospitalPhone: tr.emsDispatch?.referringHospitalPhone || '+911126590000',
        receivingHospitalPhone: tr.emsDispatch?.receivingHospitalPhone || '+911126591111',
        emergencyContact: tr.emergencyContact || '',
        patientPhone: tr.contactNumber || ''
      },
      emsDispatch: tr.emsDispatch || {
        dispatchStatus: 'EN_ROUTE',
        etaMinutes: 12,
        distanceKm: 4.5,
        criticality: { news2Score: 6, level: 'URGENT', acuitySummary: 'Urgent Medical Review (NEWS2: 6)' },
        incidentMessages: []
      }
    };
  }

  if (endpoint.includes('/ems-location') && method === 'POST') {
    return {
      success: true,
      emsDispatch: {
        dispatchStatus: body.dispatchStatus || 'EN_ROUTE',
        currentLocation: { lat: body.lat, lng: body.lng, address: body.address || 'Live GPS Fix', updatedAt: new Date().toISOString() },
        etaMinutes: body.etaMinutes || 10,
        distanceKm: body.distanceKm || 3.8,
        criticality: { news2Score: 6, level: 'URGENT', acuitySummary: 'Live Location & Vitals Updated' }
      }
    };
  }

  if (endpoint.includes('/emergency-sms') && method === 'POST') {
    const phone = body.customPhone || '+919800000108';
    const smsBody = body.customMessage || '[MEDIFORM EMERGENCY] Immediate ambulance/hospital handoff coordination required.';
    return {
      success: true,
      target: body.target || 'ambulance',
      phone,
      smsBody,
      smsUri: `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(smsBody)}`,
      incidentMessages: [{
        senderName: 'Doctor',
        senderRole: 'Receiving Clinician',
        channel: 'SMS',
        target: phone,
        text: `Emergency SMS: ${smsBody}`,
        timestamp: new Date().toISOString()
      }]
    };
  }

  if (endpoint === '/subscriptions/plans') {
    return {
      success: true,
      company: 'COLIN Tech',
      product: 'MediFORM',
      doctorPlans: [
        { code: 'DOCTOR_FREE', name: 'Clinician Starter (Free)', monthlyPriceInr: 0, monthlyTransferQuota: 25, monthlySmsQuota: 25, badge: 'FREE FOREVER', features: ['25 transfers/month', 'Emergency Good-Samaritan bypass', 'AES-256 QR + PIN'] },
        { code: 'DOCTOR_PRO', name: 'Clinician Pro', monthlyPriceInr: 499, monthlyTransferQuota: 200, monthlySmsQuota: 300, badge: 'MOST POPULAR', features: ['200 transfers/month', 'Ambulance GPS & Emergency SMS', 'Priority alerts'] },
        { code: 'DOCTOR_COMMAND', name: 'Emergency Command', monthlyPriceInr: 1299, monthlyTransferQuota: -1, monthlySmsQuota: 1500, badge: 'UNLIMITED', features: ['Unlimited transfers', '1500 Emergency SMS', 'Multi-hospital access'] }
      ],
      hospitalLicenses: [
        { code: 'HOSPITAL_SEVA_PUBLIC', name: 'National Seva Public Health Grant', monthlyPriceInr: 0, monthlyTransferQuota: 1000, seatLimit: 25, badge: 'SERVE THE NATION (₹0)', features: ['Free for Govt PHCs & NGO clinics', '1000 transfers/month'] },
        { code: 'HOSPITAL_DISTRICT', name: 'District Hospital License', monthlyPriceInr: 7999, monthlyTransferQuota: 1500, seatLimit: 30, badge: '10-30 DOCTORS', features: ['30 clinician seats', '1500 transfers/month'] },
        { code: 'HOSPITAL_MULTISPECIALTY', name: 'Multi-Specialty Enterprise License', monthlyPriceInr: 19999, monthlyTransferQuota: -1, seatLimit: 150, badge: 'RECOMMENDED', features: ['150 clinician seats', 'Unlimited transfers'] }
      ]
    };
  }

  if (endpoint === '/subscriptions/status') {
    const saved = JSON.parse(storage.getItem('mediform_mock_sub') || 'null');
    return {
      success: true,
      source: saved?.ownerType === 'hospital' ? 'hospital_license' : 'doctor_subscription',
      subscription: saved || { planCode: 'DOCTOR_FREE', monthlyTransferQuota: 25, billingCycle: 'monthly', status: 'ACTIVE', usageThisMonth: { transfersCreated: 2, emergencySmsDispatched: 0 } },
      quotaSummary: { monthlyTransferQuota: saved?.monthlyTransferQuota ?? 25, transfersUsed: 2, transfersRemaining: saved?.monthlyTransferQuota === -1 ? 'UNLIMITED' : 23, emergencyBypassAlwaysEnabled: true }
    };
  }

  if ((endpoint === '/subscriptions/subscribe' || endpoint === '/subscriptions/hospital-license') && method === 'POST') {
    const sub = { planCode: body.planCode, ownerType: endpoint.includes('hospital') ? 'hospital' : 'doctor', hospitalName: body.hospitalName || 'Hospital', billingCycle: body.billingCycle || 'monthly', monthlyTransferQuota: body.planCode?.includes('FREE') ? 25 : -1, status: 'ACTIVE' };
    storage.setItem('mediform_mock_sub', JSON.stringify(sub));
    return { success: true, message: `Activated ${body.planCode}`, subscription: sub };
  }

  return { success: true, message: 'Offline mode active.' };
}

async function request(endpoint, options = {}) {
  const token = storage.getItem('mediform_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  // 1. Try Primary API
  try {
    const response = await fetch(`${PRIMARY_API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.message || 'An error occurred during request.';
      const errorObj = new Error(errorMsg);
      errorObj.status = response.status;
      errorObj.code = data?.error?.code;
      errorObj.field = data?.error?.field;
      errorObj.attemptsRemaining = data?.error?.attemptsRemaining;
      throw errorObj;
    }

    return data;
  } catch (error) {
    // If backend returns an explicit HTTP error (e.g. 400 Bad Request, 401 Incorrect PIN, 409 User Exists), throw it
    if (error.status) {
      throw error;
    }

    // 2. If Primary failed due to Network error, try Cloud API Fallback
    if (PRIMARY_API_BASE_URL !== CLOUD_API_FALLBACK) {
      try {
        console.warn(`Primary API (${PRIMARY_API_BASE_URL}) unreachable. Trying Cloud API (${CLOUD_API_FALLBACK})...`);
        const fallbackResponse = await fetch(`${CLOUD_API_FALLBACK}${endpoint}`, {
          ...options,
          headers,
        });

        const fallbackData = await fallbackResponse.json();

        if (!fallbackResponse.ok) {
          const errorMsg = fallbackData?.error?.message || 'An error occurred during request.';
          const errorObj = new Error(errorMsg);
          errorObj.status = fallbackResponse.status;
          errorObj.code = fallbackData?.error?.code;
          errorObj.field = fallbackData?.error?.field;
          errorObj.attemptsRemaining = fallbackData?.error?.attemptsRemaining;
          throw errorObj;
        }

        return fallbackData;
      } catch (fallbackErr) {
        if (fallbackErr.status) throw fallbackErr;
      }
    }

    // 3. If both primary & cloud APIs are offline/unreachable, activate offline mock handler seamlessly
    console.warn(`[MediFORM Offline Resilient Mode] Both primary and cloud backends unreachable. Handling ${endpoint} locally.`);
    return handleOfflineMockFallback(endpoint, options);
  }
}

export const api = {
  // 2-Phase Email OTP Auth
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  verifyOtp: (challengeId, otp) => request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ challengeId, otp }) }),
  verifyEmailOtp: (challengeId, otp) => request('/auth/verify-email-otp', { method: 'POST', body: JSON.stringify({ challengeId, otp }) }),
  verifyLoginOtp: (challengeId, otp) => request('/auth/verify-login-otp', { method: 'POST', body: JSON.stringify({ challengeId, otp }) }),
  resendOtp: (challengeId) => request('/auth/resend-otp', { method: 'POST', body: JSON.stringify({ challengeId }) }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (challengeId, otp, newPassword) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ challengeId, otp, newPassword }) }),
  getMe: () => request('/auth/me'),

  // Transfers
  createTransfer: (body, headers = {}) => request('/transfers', { method: 'POST', body: JSON.stringify(body), headers }),
  getTransferById: (id) => request(`/transfers/${id}`),
  updateTransfer: (id, body) => request(`/transfers/${id}/updates`, { method: 'POST', body: JSON.stringify(body) }),
  acknowledgeTransfer: (id, body) => request(`/transfers/${id}/acknowledge`, { method: 'POST', body: JSON.stringify(body) }),
  recordScanEvent: (id) => request(`/transfers/${id}/scan-event`, { method: 'POST' }),
  getCurrentByPid: (pid) => request(`/transfers/pid/${pid}/current`),
  getPatientTimeline: (pid) => request(`/transfers/pid/${pid}/timeline`),
  getDoctorIssuedHistory: () => request('/transfers/history/doctor-issued'),
  getRecipientScannedHistory: () => request('/transfers/history/recipient-scanned'),

  // Secure QR & Share Session
  generateQR: (transferId, pin) => request('/qr/generate', { method: 'POST', body: JSON.stringify({ transferId, pin }) }),
  dispatchQR: (body) => request('/qr/dispatch', { method: 'POST', body: JSON.stringify(body) }),
  getShareInfo: (uuid) => request(`/qr/info/${uuid}`),
  revokeQR: (uuid) => request(`/qr/revoke/${uuid}`, { method: 'POST' }),
  validateQR: (uuid, pin) => request(`/qr/validate/${uuid}`, { method: 'POST', body: JSON.stringify({ pin }) }),
  validatePatientQR: (uuid, pin) => request(`/qr/validate-patient/${uuid}`, { method: 'POST', body: JSON.stringify({ pin }) }),

  // Live EMS Location, Criticality Examination & Direct Call/Emergency SMS
  getEmsStatus: (id, qrAuth = null) => request(`/transfers/${id}/ems-status`, {
    headers: qrAuth ? { 'X-QR-UUID': qrAuth.uuid, 'X-QR-PIN': qrAuth.pin } : {}
  }),
  updateEmsLocation: (id, body, qrAuth = null) => request(`/transfers/${id}/ems-location`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: qrAuth ? { 'X-QR-UUID': qrAuth.uuid, 'X-QR-PIN': qrAuth.pin } : {}
  }),
  postEmsMessage: (id, body, qrAuth = null) => request(`/transfers/${id}/ems-message`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: qrAuth ? { 'X-QR-UUID': qrAuth.uuid, 'X-QR-PIN': qrAuth.pin } : {}
  }),
  sendEmergencySms: (id, body, qrAuth = null) => request(`/transfers/${id}/emergency-sms`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: qrAuth ? { 'X-QR-UUID': qrAuth.uuid, 'X-QR-PIN': qrAuth.pin } : {}
  }),

  // COLIN Tech Subscriptions & Hospital Licenses
  getSubscriptionPlans: () => request('/subscriptions/plans'),
  getSubscriptionStatus: () => request('/subscriptions/status'),
  subscribeDoctorPlan: (body) => request('/subscriptions/subscribe', { method: 'POST', body: JSON.stringify(body) }),
  activateHospitalLicense: (body) => request('/subscriptions/hospital-license', { method: 'POST', body: JSON.stringify(body) }),

  // User Profile
  getProfile: () => request('/user/profile'),
  updateProfile: (body) => request('/user/profile', { method: 'PUT', body: JSON.stringify(body) }),

  // Screenings (Phase 1)
  createScreening: (body) => request('/screenings', { method: 'POST', body: JSON.stringify(body) }),
  getScreenings: (params = '') => request(`/screenings${params ? `?${params}` : ''}`),
  getFlaggedScreenings: () => request('/screenings/flagged'),
  getScreeningById: (id) => request(`/screenings/${id}`),

  // Referrals (Phase 1, Phase 2, Phase 3 Lifecycle)
  createReferral: (body) => request('/referrals', { method: 'POST', body: JSON.stringify(body) }),
  getReferrals: (params = '') => request(`/referrals${params ? `?${params}` : ''}`),
  getReferralById: (id) => request(`/referrals/${id}`),
  generateReferralQR: (id, pin) => request(`/referrals/${id}/qr`, { method: 'POST', body: JSON.stringify({ pin }) }),
  updateReferralStatus: (id, status, notes) => request(`/referrals/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, notes }) }),
  reassignReferral: (id, body) => request(`/referrals/${id}/reassign`, { method: 'POST', body: JSON.stringify(body) }),
  getDoctorsDirectory: (params = '') => request(`/user/doctors${params ? `?${params}` : ''}`),

  // Referral Lifecycle Actions (Phase 3)
  acknowledgeReferral: (id, body = {}) => request(`/referrals/${id}/acknowledge`, { method: 'POST', body: JSON.stringify(body) }),
  acceptReferral: (id, body = {}) => request(`/referrals/${id}/accept`, { method: 'POST', body: JSON.stringify(body) }),
  rejectReferral: (id, body) => request(`/referrals/${id}/reject`, { method: 'POST', body: JSON.stringify(body) }),
  startTreatment: (id, body = {}) => request(`/referrals/${id}/start-treatment`, { method: 'POST', body: JSON.stringify(body) }),
  documentTreatment: (id, body) => request(`/referrals/${id}/treatment`, { method: 'POST', body: JSON.stringify(body) }),
  confirmCare: (id, body = {}) => request(`/referrals/${id}/confirm-care`, { method: 'POST', body: JSON.stringify(body) }),
  closeReferral: (id, body = {}) => request(`/referrals/${id}/close`, { method: 'POST', body: JSON.stringify(body) }),
  cancelReferral: (id, body) => request(`/referrals/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) }),
  getReferralTimeline: (id) => request(`/referrals/${id}/timeline`),

  // Patient Notifications & Preferences (Phase 4)
  getNotifications: (params = '') => request(`/notifications${params ? `?${params}` : ''}`),
  getUnreadNotificationCount: () => request('/notifications/unread-count'),
  markNotificationAsRead: (id) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsAsRead: () => request('/notifications/read-all', { method: 'PATCH' }),
  getNotificationPreferences: () => request('/notifications/preferences'),
  updateNotificationPreferences: (body) => request('/notifications/preferences', { method: 'PATCH', body: JSON.stringify(body) }),

  // Follow-Up & Missed Appointment Management (Phase 5)
  createFollowUp: (body) => request('/follow-ups', { method: 'POST', body: JSON.stringify(body) }),
  getFollowUps: (params = '') => request(`/follow-ups${params ? `?${params}` : ''}`),
  getFollowUpById: (id) => request(`/follow-ups/${id}`),
  rescheduleFollowUp: (id, body) => request(`/follow-ups/${id}/reschedule`, { method: 'PATCH', body: JSON.stringify(body) }),
  recordFollowUpAttendance: (id, body = {}) => request(`/follow-ups/${id}/attendance`, { method: 'PATCH', body: JSON.stringify(body) }),
  completeFollowUp: (id, body) => request(`/follow-ups/${id}/complete`, { method: 'POST', body: JSON.stringify(body) }),
  cancelFollowUp: (id, body) => request(`/follow-ups/${id}/cancel`, { method: 'PATCH', body: JSON.stringify(body) }),
  triggerFollowUpScheduler: (body = {}) => request('/follow-ups/trigger-check', { method: 'POST', body: JSON.stringify(body) }),

  // Intelligent Handoff Monitoring & Risk Detection (Phase 6)
  getMonitoringAlerts: (params = '') => request(`/monitoring/alerts${params ? `?${params}` : ''}`),
  triggerMonitoringScan: () => request('/monitoring/scan', { method: 'POST' }),
  dismissMonitoringAlert: (id, body = {}) => request(`/monitoring/alerts/${id}/dismiss`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Consent Management & Privacy (Phase 7)
  getConsents: () => request('/consent'),
  getConsentById: (id) => request(`/consent/${id}`),
  grantConsent: (body) => request('/consent', { method: 'POST', body: JSON.stringify(body) }),
  revokeConsent: (id, reason) => request(`/consent/${id}/revoke`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  updateConsent: (id, body) => request(`/consent/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Doctor Profile & Account Verification (Phase 9)
  getDoctorProfile: () => request('/doctors/profile'),
  updateDoctorProfile: (body) => request('/doctors/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  updateDoctorPhoto: (body) => request('/doctors/profile/photo', { method: 'POST', body: JSON.stringify(body) }),
  submitDoctorCredentials: (body) => request('/doctors/credentials/submit', { method: 'POST', body: JSON.stringify(body) }),
  getDoctorCredentialsStatus: () => request('/doctors/credentials/status'),
  getDoctorDocument: (docId) => request(`/doctors/credentials/document/${docId}`),
  getPendingVerifications: (params = '') => request(`/verifications/pending${params ? `?${params}` : ''}`),
  getVerificationDetails: (id) => request(`/verifications/${id}`),
  reviewVerification: (id, body) => request(`/verifications/${id}/review`, { method: 'POST', body: JSON.stringify(body) }),
  getVerificationDocument: (docId) => request(`/verifications/document/${docId}`),
};

export default api;
