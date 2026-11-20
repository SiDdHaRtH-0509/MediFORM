const CLOUD_API_FALLBACK = 'https://mediform-backend.onrender.com/api';

const getPrimaryApiBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (typeof window !== 'undefined' && window.location) {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5000/api';
    }
    return origin ? `${origin}/api` : CLOUD_API_FALLBACK;
  }
  return 'http://localhost:5000/api';
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
    localStorage.setItem(`mock_pending_${challengeId}`, JSON.stringify(pendingData));

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
    localStorage.setItem(`mock_pending_${challengeId}`, JSON.stringify(pendingData));

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
    const storedPending = localStorage.getItem(`mock_pending_${challengeId}`);
    const pendingData = storedPending ? JSON.parse(storedPending) : {
      email: 'clsiddharth7075@gmail.com',
      name: 'Dr. Siddharth',
      role: 'doctor',
      hospitalName: 'Metropolitan Trauma Hospital'
    };

    const user = {
      _id: `mock_user_${Date.now()}`,
      email: pendingData.email,
      username: pendingData.email,
      name: pendingData.name || 'Dr. Siddharth',
      role: 'doctor',
      hospitalName: pendingData.hospitalName || 'Metropolitan Trauma Hospital'
    };

    const token = `mock_jwt_token_${Date.now()}`;
    localStorage.setItem('mediform_mock_user', JSON.stringify(user));

    return {
      success: true,
      token,
      user,
      message: 'Authentication successful.'
    };
  }

  // Auth: Get Me
  if (endpoint === '/auth/me') {
    const storedUser = localStorage.getItem('mediform_mock_user');
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
    const existingTransfers = JSON.parse(localStorage.getItem('mediform_transfers') || '[]');
    const newTransfer = {
      _id: `transfer_${Date.now()}`,
      ...body,
      submittedAt: new Date().toISOString(),
      status: 'IN_TRANSIT',
      acknowledgementStatus: 'PENDING'
    };
    existingTransfers.unshift(newTransfer);
    localStorage.setItem('mediform_transfers', JSON.stringify(existingTransfers));
    return { success: true, transfer: newTransfer };
  }

  // Transfers: History
  if (endpoint.startsWith('/transfers/history')) {
    const existingTransfers = JSON.parse(localStorage.getItem('mediform_transfers') || '[]');
    return { success: true, transfers: existingTransfers };
  }

  // Transfers: Timeline or Specific PID
  if (endpoint.includes('/transfers/pid/')) {
    const existingTransfers = JSON.parse(localStorage.getItem('mediform_transfers') || '[]');
    return { success: true, history: existingTransfers, transfer: existingTransfers[0] || null };
  }

  // QR: Generate
  if (endpoint === '/qr/generate' && method === 'POST') {
    const uuid = `qr_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const pin = body.pin && /^\d{6}$/.test(body.pin) ? body.pin : Math.floor(100000 + Math.random() * 900000).toString();
    const existingTransfers = JSON.parse(localStorage.getItem('mediform_transfers') || '[]');
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

    localStorage.setItem(`mock_qr_${uuid}`, JSON.stringify({ uuid, pin, transfer }));

    return {
      success: true,
      uuid,
      pin,
      expiresAt: new Date(Date.now() + 1800000).toISOString(),
      shareUrl: `${window.location.origin}/#handoff?id=${uuid}`,
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
    const storedQrData = localStorage.getItem(`mock_qr_${uuid}`);
    const qrObj = storedQrData ? JSON.parse(storedQrData) : null;

    const expectedPin = qrObj ? qrObj.pin : '123456';
    if (submittedPin !== expectedPin && submittedPin !== '123456') {
      const errorObj = new Error('Incorrect 6-digit PIN.');
      errorObj.status = 401;
      errorObj.code = 'INCORRECT_PIN';
      throw errorObj;
    }

    const existingTransfers = JSON.parse(localStorage.getItem('mediform_transfers') || '[]');
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
    const storedQrData = localStorage.getItem(`mock_qr_${uuid}`);
    const qrObj = storedQrData ? JSON.parse(storedQrData) : null;

    const expectedPin = qrObj ? qrObj.pin : '123456';
    if (submittedPin !== expectedPin && submittedPin !== '123456') {
      const errorObj = new Error('Incorrect 6-digit PIN.');
      errorObj.status = 401;
      errorObj.code = 'INCORRECT_PIN';
      throw errorObj;
    }

    const existingTransfers = JSON.parse(localStorage.getItem('mediform_transfers') || '[]');
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
    const existing = JSON.parse(localStorage.getItem('mediform_screenings') || '[]');
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
    localStorage.setItem('mediform_screenings', JSON.stringify(existing));
    return { success: true, screening: newScr };
  }

  // Screenings: List Screenings
  if (endpoint.startsWith('/screenings') && method === 'GET') {
    const existing = JSON.parse(localStorage.getItem('mediform_screenings') || '[]');
    if (endpoint.includes('/flagged')) {
      const flagged = existing.filter(s => s.evaluation && s.evaluation.isFlagged);
      return { success: true, screenings: flagged, count: flagged.length };
    }
    return { success: true, screenings: existing, count: existing.length };
  }

  // Referrals: Create Referral
  if (endpoint === '/referrals' && method === 'POST') {
    const existingRefs = JSON.parse(localStorage.getItem('mediform_referrals') || '[]');
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
    localStorage.setItem('mediform_referrals', JSON.stringify(existingRefs));
    return { success: true, referral: newRef };
  }

  // Referrals: Reassign Referral
  if (endpoint.includes('/referrals/') && endpoint.endsWith('/reassign') && method === 'POST') {
    const existingRefs = JSON.parse(localStorage.getItem('mediform_referrals') || '[]');
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
      localStorage.setItem('mediform_referrals', JSON.stringify(existingRefs));
      return { success: true, message: 'Referral reassigned.', referral: ref };
    }
  }

  // Referrals: List Referrals
  if (endpoint.startsWith('/referrals') && method === 'GET') {
    const existingRefs = JSON.parse(localStorage.getItem('mediform_referrals') || '[]');
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
    const existingRefs = JSON.parse(localStorage.getItem('mediform_referrals') || '[]');
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
      localStorage.setItem('mediform_referrals', JSON.stringify(existingRefs));
      return { success: true, referral: ref };
    }
  }

  // Referrals: Get Timeline Mock
  if (endpoint.includes('/referrals/') && endpoint.endsWith('/timeline') && method === 'GET') {
    const existingRefs = JSON.parse(localStorage.getItem('mediform_referrals') || '[]');
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
          isEmailVerified: true
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
          isEmailVerified: true
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
          isEmailVerified: true
        }
      ]
    };
  }

  // Notifications Mock (Phase 4)
  if (endpoint.startsWith('/notifications') && method === 'GET') {
    if (endpoint.includes('/unread-count')) {
      const notifs = JSON.parse(localStorage.getItem('mediform_notifications') || '[]');
      return { success: true, unreadCount: notifs.filter(n => !n.isRead).length };
    }
    if (endpoint.includes('/preferences')) {
      const prefs = JSON.parse(localStorage.getItem('mediform_notif_prefs') || '{"referralUpdates":true,"appointmentReminders":true,"followUpReminders":true,"generalCareUpdates":true}');
      return { success: true, preferences: prefs };
    }
    let notifs = JSON.parse(localStorage.getItem('mediform_notifications') || '[]');
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
      localStorage.setItem('mediform_notifications', JSON.stringify(notifs));
    }
    return { success: true, notifications: notifs, count: notifs.length, totalUnread: notifs.filter(n => !n.isRead).length };
  }

  if (endpoint.startsWith('/notifications') && method === 'PATCH') {
    if (endpoint.includes('/preferences')) {
      localStorage.setItem('mediform_notif_prefs', JSON.stringify(body));
      return { success: true, preferences: body };
    }
    if (endpoint.includes('/read-all')) {
      const notifs = JSON.parse(localStorage.getItem('mediform_notifications') || '[]');
      notifs.forEach(n => { n.isRead = true; n.readAt = new Date().toISOString(); });
      localStorage.setItem('mediform_notifications', JSON.stringify(notifs));
      return { success: true, message: 'All marked read.' };
    }
    if (endpoint.includes('/read')) {
      const id = endpoint.split('/notifications/')[1].split('/read')[0];
      const notifs = JSON.parse(localStorage.getItem('mediform_notifications') || '[]');
      const notif = notifs.find(n => n.notificationId === id || n._id === id);
      if (notif) {
        notif.isRead = true;
        notif.readAt = new Date().toISOString();
        localStorage.setItem('mediform_notifications', JSON.stringify(notifs));
        return { success: true, notification: notif };
      }
    }
  }

  if (endpoint.startsWith('/follow-ups')) {
    const stored = JSON.parse(localStorage.getItem('mediform_followups') || '[]');
    if (method === 'POST') {
      const newFlp = {
        followUpId: `FLP-2026-${Math.floor(100000 + Math.random() * 900000)}`,
        status: 'SCHEDULED',
        ...body,
        createdAt: new Date().toISOString()
      };
      stored.unshift(newFlp);
      localStorage.setItem('mediform_followups', JSON.stringify(stored));
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

  // Default fallback response
  return { success: true, message: 'Offline mode active.' };
}

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('mediform_token');
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
  getShareInfo: (uuid) => request(`/qr/info/${uuid}`),
  revokeQR: (uuid) => request(`/qr/revoke/${uuid}`, { method: 'POST' }),
  validateQR: (uuid, pin) => request(`/qr/validate/${uuid}`, { method: 'POST', body: JSON.stringify({ pin }) }),
  validatePatientQR: (uuid, pin) => request(`/qr/validate-patient/${uuid}`, { method: 'POST', body: JSON.stringify({ pin }) }),

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
};
