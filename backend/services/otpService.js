const crypto = require('crypto');
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  nodemailer = null;
}
const OTPChallenge = require('../models/OTPChallenge');
const { OTP_CONFIG } = require('../config/constants');

const SERVER_SECRET = process.env.OTP_SERVER_SECRET || process.env.JWT_SECRET || 'mediform_otp_pepper_secret_2026';

/**
 * Generates a cryptographically secure 6-digit numeric OTP string.
 */
function generateOTP() {
  const num = crypto.randomInt(100000, 1000000);
  return num.toString();
}

/**
 * Creates a keyed HMAC-SHA-256 digest of the OTP and challenge context.
 */
function hashOTP(otp, challengeId) {
  const hmac = crypto.createHmac('sha256', SERVER_SECRET);
  hmac.update(`${otp}:${challengeId}`);
  return hmac.digest('hex');
}

/**
 * Delivery Provider Abstraction: Sends OTP via Nodemailer or logs in development.
 */
async function sendOTP(identifier, otp, purpose) {
  const env = process.env.NODE_ENV || 'development';
  
  if (process.env.SMTP_HOST && nodemailer) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'MediFORM <no-reply@mediform.health>',
        to: identifier,
        subject: `MediFORM OTP Verification - ${purpose}`,
        text: `Your 6-digit MediFORM verification code is: ${otp}. This code expires in 5 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; background-color: #f8fafc; border-radius: 8px;">
            <h2 style="color: #0f766e; margin-bottom: 16px;">MediFORM Security Verification</h2>
            <p>Use the following 6-digit code to complete your ${purpose.toLowerCase().replace('_', ' ')} authentication:</p>
            <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #0284c7; margin: 20px 0; background: #e0f2fe; padding: 12px 24px; border-radius: 6px; display: inline-block;">
              ${otp}
            </div>
            <p style="font-size: 13px; color: #64748b;">This verification code will expire in 5 minutes. Do not share this code with anyone.</p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`[SMTP EMAIL OTP SENT] Target: ${identifier} | Purpose: ${purpose}`);
      return true;
    } catch (err) {
      console.error(`[SMTP EMAIL OTP FAILED] Target: ${identifier} | Error: ${err.message}`);
    }
  }

  if (env !== 'test') {
    // Console output for local dev
    console.log(`========================================`);
    console.log(`[DEV OTP SERVICE] Target: ${identifier}`);
    console.log(`[DEV OTP SERVICE] Purpose: ${purpose}`);
    console.log(`[DEV OTP SERVICE] OTP Code: ${otp}`);
    console.log(`========================================`);
  }

  return true;
}

/**
 * Creates a new 2-Phase OTP challenge.
 */
async function createChallenge({ identifier, purpose, pendingUserData = null, userId = null }) {
  const challengeId = crypto.randomUUID();
  const rawOtp = generateOTP();
  const otpDigest = hashOTP(rawOtp, challengeId);

  const now = Date.now();
  const expiresAt = new Date(now + OTP_CONFIG.EXPIRATION_MINUTES * 60 * 1000);
  const resendAvailableAt = new Date(now + OTP_CONFIG.RESEND_COOLDOWN_SECONDS * 1000);

  // Invalidate any active previous challenges for this identifier & purpose
  await OTPChallenge.updateMany(
    { identifier: identifier.toLowerCase(), purpose, isConsumed: false },
    { $set: { isConsumed: true } }
  );

  const challenge = new OTPChallenge({
    challengeId,
    identifier: identifier.toLowerCase(),
    otpHash: otpDigest,
    purpose,
    pendingUserData,
    userId,
    failedAttempts: 0,
    maxAttempts: OTP_CONFIG.MAX_ATTEMPTS,
    resendAvailableAt,
    expiresAt,
    isVerified: false,
    isConsumed: false
  });

  await challenge.save();
  await sendOTP(identifier, rawOtp, purpose);

  return {
    challengeId,
    expiresAt,
    resendAvailableAt,
    // Return dev OTP in test environment for automated test assertions
    devOtp: process.env.NODE_ENV === 'test' ? rawOtp : undefined
  };
}

/**
 * Verifies an OTP against a challenge with strict purpose isolation.
 */
async function verifyOTP(challengeId, submittedOtp, expectedPurpose = null) {
  if (!challengeId || !submittedOtp) {
    return { success: false, code: 'INVALID_INPUT', message: 'Challenge ID and OTP code are required.' };
  }

  const challenge = await OTPChallenge.findOne({ challengeId, isConsumed: false });

  if (!challenge) {
    return { success: false, code: 'INVALID_CHALLENGE', message: 'OTP session not found or already verified.' };
  }

  // Enforce Purpose Isolation
  if (expectedPurpose) {
    const isPurposeMatch = challenge.purpose === expectedPurpose || 
      (expectedPurpose === 'EMAIL_VERIFICATION' && challenge.purpose === 'REGISTRATION') ||
      (expectedPurpose === 'REGISTRATION' && challenge.purpose === 'EMAIL_VERIFICATION');

    if (!isPurposeMatch) {
      return { success: false, code: 'INVALID_CHALLENGE', message: 'OTP challenge purpose mismatch.' };
    }
  }

  // Check Expiration
  if (new Date() > new Date(challenge.expiresAt)) {
    challenge.isConsumed = true;
    await challenge.save();
    return { success: false, code: 'OTP_EXPIRED', message: 'OTP has expired (5 minutes limit). Please request a new OTP.' };
  }

  // Check Lockout / Max Attempts
  if (challenge.failedAttempts >= challenge.maxAttempts) {
    challenge.isConsumed = true;
    await challenge.save();
    return { success: false, code: 'OTP_LOCKED', message: 'Maximum OTP verification attempts exceeded. Please request a new OTP.' };
  }

  // Constant-time Hash Comparison
  const submittedHash = hashOTP(submittedOtp.trim(), challengeId);
  const hashBuffer = Buffer.from(challenge.otpHash, 'hex');
  const submittedBuffer = Buffer.from(submittedHash, 'hex');

  const isMatch = hashBuffer.length === submittedBuffer.length &&
                  crypto.timingSafeEqual(hashBuffer, submittedBuffer);

  if (!isMatch) {
    challenge.failedAttempts += 1;
    if (challenge.failedAttempts >= challenge.maxAttempts) {
      challenge.isConsumed = true;
    }
    await challenge.save();

    const remaining = challenge.maxAttempts - challenge.failedAttempts;
    return {
      success: false,
      code: 'INCORRECT_OTP',
      message: remaining > 0 ? `Incorrect OTP code. ${remaining} attempts remaining.` : 'Maximum attempts exceeded. OTP session locked.',
      attemptsRemaining: Math.max(0, remaining)
    };
  }

  // OTP Verification Success -> Mark Verified & Consumed
  challenge.isVerified = true;
  challenge.isConsumed = true;
  await challenge.save();

  return {
    success: true,
    challenge
  };
}

/**
 * Handles Resend OTP requests with 60-second cooldown enforcement.
 */
async function resendOTP(challengeId) {
  const challenge = await OTPChallenge.findOne({ challengeId, isConsumed: false });
  if (!challenge) {
    return { success: false, code: 'INVALID_CHALLENGE', message: 'OTP session not found or expired.' };
  }

  if (new Date() < new Date(challenge.resendAvailableAt)) {
    const waitSeconds = Math.ceil((new Date(challenge.resendAvailableAt) - new Date()) / 1000);
    return {
      success: false,
      code: 'RESEND_COOLDOWN',
      message: `Please wait ${waitSeconds} seconds before requesting a new OTP.`
    };
  }

  // Create new challenge for the same identifier & purpose
  return createChallenge({
    identifier: challenge.identifier,
    purpose: challenge.purpose,
    pendingUserData: challenge.pendingUserData,
    userId: challenge.userId
  });
}

module.exports = {
  generateOTP,
  hashOTP,
  createChallenge,
  verifyOTP,
  resendOTP,
  sendOTP
};

