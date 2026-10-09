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
    // On Vercel / Netlify / Cloud deployments, use relative /api proxy or cloud backend directly
    return CLOUD_API_FALLBACK;
  }
  return 'http://localhost:5000/api';
};

const PRIMARY_API_BASE_URL = getPrimaryApiBaseUrl();

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('mediform_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  // Try primary API base URL
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
    // If primary failed due to network error and primary was local, attempt cloud fallback
    if (!error.status && PRIMARY_API_BASE_URL !== CLOUD_API_FALLBACK) {
      try {
        console.warn(`Primary API (${PRIMARY_API_BASE_URL}) unreachable. Retrying via Cloud API (${CLOUD_API_FALLBACK})...`);
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

    if (!error.status) {
      error.message = 'Network error or server unavailable. Please check your internet connection or verify the backend server status.';
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
