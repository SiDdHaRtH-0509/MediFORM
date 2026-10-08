import React, { createContext, useState, useEffect, useContext } from 'react';
import { api } from '../services/api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('mediform_token') || null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      localStorage.setItem('mediform_token', token);
      api.getMe()
        .then(res => setUser(res.user))
        .catch(() => {
          logout();
        })
        .finally(() => setLoading(false));
    } else {
      localStorage.removeItem('mediform_token');
      setUser(null);
      setLoading(false);
    }
  }, [token]);

  // Phase 1: Initiate Login -> Returns challengeId for OTP step
  const login = async (username, password) => {
    return api.login({ username, password });
  };

  // Phase 1: Initiate Registration -> Returns challengeId for OTP step
  const register = async (username, password, role = 'doctor', hospitalName = '') => {
    return api.register({ username, password, role, hospitalName });
  };

  // Phase 2: Verify OTP -> Sets authenticated token & user profile
  const verifyOtp = async (challengeId, otp) => {
    const res = await api.verifyOtp(challengeId, otp);
    setToken(res.token);
    setUser(res.user);
    return res;
  };

  // Resend OTP
  const resendOtp = async (challengeId) => {
    return api.resendOtp(challengeId);
  };

  // Forgot Password: Request OTP challenge for password reset
  const forgotPassword = async (email) => {
    return api.forgotPassword(email);
  };

  // Reset Password: Submit OTP code and new password
  const resetPassword = async (challengeId, otp, newPassword) => {
    return api.resetPassword(challengeId, otp, newPassword);
  };

  const logout = () => {
    localStorage.removeItem('mediform_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, verifyOtp, resendOtp, forgotPassword, resetPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
