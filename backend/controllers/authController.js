const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const otpService = require('../services/otpService');
const { FIELD_LIMITS } = require('../config/constants');

const getJwtSecret = () => process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';

// Helper to sign JWT with user's current tokenVersion
const generateAuthToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      email: user.email,
      username: user.username || user.email,
      name: user.name || '',
      role: 'doctor',
      hospitalName: user.hospitalName,
      tokenVersion: user.tokenVersion || 0
    },
    getJwtSecret(),
    { expiresIn: '24h' }
  );
};

// Doctor-Only Registration with Email OTP Challenge
exports.register = async (req, res) => {
  try {
    const { email, username, name, password, role = 'doctor', hospitalName } = req.body;
    const targetEmail = (email || username || '').trim().toLowerCase();

    if (role === 'patient') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ROLE',
          message: 'MediFORM V2 is a clinician-operated platform. Patient accounts are not created through the application.'
        }
      });
    }

    if (!targetEmail || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Doctor email and password are required.' }
      });
    }

    if (targetEmail.length > FIELD_LIMITS.USERNAME) {
      return res.status(400).json({
        success: false,
        error: { code: 'PAYLOAD_VALIDATION_ERROR', field: 'email', message: `Email exceeds maximum length of ${FIELD_LIMITS.USERNAME} characters.` }
      });
    }

    if (password.length > FIELD_LIMITS.PASSWORD) {
      return res.status(400).json({
        success: false,
        error: { code: 'PAYLOAD_VALIDATION_ERROR', field: 'password', message: `Password exceeds maximum length of ${FIELD_LIMITS.PASSWORD} characters.` }
      });
    }

    if (!hospitalName || !hospitalName.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Hospital name is required for doctor registration.' }
      });
    }

    if (hospitalName.length > FIELD_LIMITS.HOSPITAL_NAME) {
      return res.status(400).json({
        success: false,
        error: { code: 'PAYLOAD_VALIDATION_ERROR', field: 'hospitalName', message: `Hospital name exceeds maximum length of ${FIELD_LIMITS.HOSPITAL_NAME} characters.` }
      });
    }

    const existingUser = await User.findOne({ $or: [{ email: targetEmail }, { username: targetEmail }] });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: { code: 'USER_EXISTS', message: 'A doctor account with this email already exists.' }
      });
    }

    // 2-Phase Email Auth: Create EMAIL_VERIFICATION OTP challenge
    const challenge = await otpService.createChallenge({
      identifier: targetEmail,
      purpose: 'EMAIL_VERIFICATION',
      pendingUserData: {
        email: targetEmail,
        username: targetEmail,
        name: name ? name.trim() : '',
        password,
        role: 'doctor',
        hospitalName: hospitalName.trim()
      }
    });

    return res.status(200).json({
      success: true,
      requireOtp: true,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
      devOtp: challenge.devOtp,
      message: 'Doctor email verification OTP sent. Please verify the 6-digit code sent to your email to activate account.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Doctor Login with 2-Phase Email OTP Challenge
exports.login = async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const targetEmail = (email || username || '').trim().toLowerCase();

    if (!targetEmail || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Email and password are required.' }
      });
    }

    const user = await User.findOne({ $or: [{ email: targetEmail }, { username: targetEmail }] });
    if (!user) {
      await AuditLog.create({
        action: 'DOCTOR_LOGIN_FAILURE',
        actorId: null,
        actorRole: 'doctor',
        details: { email: targetEmail, reason: 'User not found' }
      });
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await AuditLog.create({
        action: 'DOCTOR_LOGIN_FAILURE',
        actorId: user._id,
        actorRole: user.role,
        details: { email: targetEmail, reason: 'Invalid password' }
      });
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    // Credentials valid -> Issue 2-Phase LOGIN OTP Challenge before issuing JWT
    const challenge = await otpService.createChallenge({
      identifier: user.email,
      purpose: 'LOGIN',
      userId: user._id
    });

    return res.status(200).json({
      success: true,
      requireOtp: true,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
      devOtp: challenge.devOtp,
      message: 'Credentials verified. Please enter the 6-digit OTP code sent to your email to complete login.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Verify 2-Phase OTP Challenge (Supports general, email verification, or login purpose)
exports.verifyOtp = async (req, res) => {
  try {
    const { challengeId, expectedPurpose } = req.body;
    const submittedOtp = req.body.otp || req.body.otpCode || req.body.code || req.body.verificationCode;

    const result = await otpService.verifyOTP(challengeId, submittedOtp, expectedPurpose);
    if (!result.success) {
      await AuditLog.create({
        action: 'OTP_VERIFICATION_FAILURE',
        actorId: null,
        actorRole: 'doctor',
        details: { challengeId, code: result.code }
      });
      return res.status(401).json({
        success: false,
        error: { code: result.code, message: result.message, attemptsRemaining: result.attemptsRemaining }
      });
    }

    const challenge = result.challenge;
    let user;

    if (challenge.purpose === 'REGISTRATION' || challenge.purpose === 'EMAIL_VERIFICATION') {
      const p = challenge.pendingUserData;
      const newUser = new User({
        email: p.email,
        username: p.username || p.email,
        name: p.name || '',
        password: p.password,
        role: 'doctor',
        hospitalName: p.hospitalName,
        isEmailVerified: true,
        tokenVersion: 0
      });
      await newUser.save();
      user = newUser;

      await AuditLog.create({
        action: 'OTP_VERIFICATION_SUCCESS',
        actorId: user._id,
        actorRole: user.role,
        details: { email: user.email, purpose: challenge.purpose }
      });

      await AuditLog.create({
        action: 'DOCTOR_REGISTERED_OTP_VERIFIED',
        actorId: user._id,
        actorRole: user.role,
        details: { email: user.email }
      });
    } else if (challenge.purpose === 'LOGIN') {
      user = await User.findById(challenge.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Associated doctor account no longer exists.' }
        });
      }

      if (!user.isEmailVerified) {
        user.isEmailVerified = true;
        await user.save();
      }

      await AuditLog.create({
        action: 'OTP_VERIFICATION_SUCCESS',
        actorId: user._id,
        actorRole: user.role,
        details: { email: user.email, purpose: challenge.purpose }
      });

      await AuditLog.create({
        action: 'DOCTOR_LOGIN_SUCCESS',
        actorId: user._id,
        actorRole: user.role,
        details: { email: user.email }
      });
    } else {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CHALLENGE_PURPOSE', message: `Challenge purpose ${challenge.purpose} cannot issue direct JWT session.` }
      });
    }

    // Issue authenticated JWT token ONLY after successful OTP verification
    const token = generateAuthToken(user);

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username || user.email,
        name: user.name || '',
        role: 'doctor',
        hospitalName: user.hospitalName,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Aliases for explicit endpoint clarity
exports.verifyEmailOtp = (req, res) => {
  req.body.expectedPurpose = 'EMAIL_VERIFICATION';
  return exports.verifyOtp(req, res);
};

exports.verifyLoginOtp = (req, res) => {
  req.body.expectedPurpose = 'LOGIN';
  return exports.verifyOtp(req, res);
};

// Resend OTP Challenge (Enforces 60s cooldown limit)
exports.resendOtp = async (req, res) => {
  try {
    const { challengeId } = req.body;

    const result = await otpService.resendOTP(challengeId);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { code: result.code, message: result.message }
      });
    }

    return res.status(200).json({
      success: true,
      challengeId: result.challengeId,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
      devOtp: result.devOtp,
      message: 'New OTP code generated and sent to email.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Forgot Password Endpoint (Generic response to prevent account enumeration)
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const targetEmail = (email || '').trim().toLowerCase();

    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Email address is required.' }
      });
    }

    const user = await User.findOne({ $or: [{ email: targetEmail }, { username: targetEmail }] });
    
    let challengeData = null;
    if (user) {
      challengeData = await otpService.createChallenge({
        identifier: user.email,
        purpose: 'PASSWORD_RESET',
        userId: user._id
      });
    }

    // Defensive Security Rule: Always return uniform response regardless of account existence
    return res.status(200).json({
      success: true,
      message: 'If an account associated with that email exists, a password reset OTP code has been sent.',
      challengeId: challengeData ? challengeData.challengeId : undefined,
      expiresAt: challengeData ? challengeData.expiresAt : undefined,
      resendAvailableAt: challengeData ? challengeData.resendAvailableAt : undefined,
      devOtp: challengeData ? challengeData.devOtp : undefined
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Reset Password Endpoint (Verifies PASSWORD_RESET OTP & increments tokenVersion to revoke old JWT sessions)
exports.resetPassword = async (req, res) => {
  try {
    const { challengeId, otp, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'New password must be at least 6 characters long.' }
      });
    }

    if (newPassword.length > FIELD_LIMITS.PASSWORD) {
      return res.status(400).json({
        success: false,
        error: { code: 'PAYLOAD_VALIDATION_ERROR', field: 'newPassword', message: `Password exceeds maximum length of ${FIELD_LIMITS.PASSWORD} characters.` }
      });
    }

    const result = await otpService.verifyOTP(challengeId, otp, 'PASSWORD_RESET');
    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: { code: result.code, message: result.message, attemptsRemaining: result.attemptsRemaining }
      });
    }

    const challenge = result.challenge;
    const user = await User.findById(challenge.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Doctor account not found.' }
      });
    }

    // Update password and increment tokenVersion to revoke existing JWT sessions
    user.password = newPassword;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    await AuditLog.create({
      action: 'DOCTOR_PASSWORD_RESET_SUCCESS',
      actorId: user._id,
      actorRole: user.role,
      details: { email: user.email, newTokenVersion: user.tokenVersion }
    });

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully. All active sessions have been invalidated. Please log in with your new password.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User profile not found.' }
      });
    }
    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        username: user.username || user.email,
        name: user.name || '',
        role: 'doctor',
        hospitalName: user.hospitalName,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

