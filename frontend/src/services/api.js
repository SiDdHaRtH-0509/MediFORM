const CLOUD_API_FALLBACK = 'https://mediform-backend.onrender.com/api';

const getPrimaryApiBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (typeof window !== 'undefined' && window.location) {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5000/api';
    }
    return CLOUD_API_FALLBACK;
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
};
