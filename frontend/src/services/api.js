const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('mediform_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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
    if (!error.status) {
      error.message = 'Network error or server unavailable. Please check your connectivity.';
    }
    throw error;
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
