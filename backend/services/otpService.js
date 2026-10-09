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
 * Delivery Provider Abstraction: Sends real OTP via Nodemailer or logs in dev.
 */
async function sendOTP(identifier, otp, purpose) {
  const env = process.env.NODE_ENV || 'development';
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const smtpHost = (process.env.SMTP_HOST || '').trim();

  const isRealSmtp = Boolean(
    nodemailer &&
    smtpUser &&
    smtpPass &&
    !smtpUser.includes('YOUR_') &&
    !smtpUser.includes('hospital.org')
  );

  if (isRealSmtp) {
    try {
      const transporterConfig = smtpHost.includes('gmail')
        ? {
            service: 'gmail',
            auth: { user: smtpUser, pass: smtpPass }
          }
        : {
            host: smtpHost || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: smtpUser, pass: smtpPass }
          };

      const transporter = nodemailer.createTransport(transporterConfig);

      const fromAddress = process.env.SMTP_FROM
        ? process.env.SMTP_FROM.replace(/<.*?>/, `<${smtpUser}>`)
        : `MediFORM Verification <${smtpUser}>`;

      const mailOptions = {
        from: fromAddress,
        to: identifier,
        subject: `MediFORM Security Code - ${purpose}`,
        text: `Your 6-digit MediFORM verification code is: ${otp}. This code expires in 5 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 24px; color: #1e293b; background-color: #f8fafc; border-radius: 8px; max-width: 500px; margin: 0 auto; border: 1px solid #e2e8f0;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #0f766e; margin: 0; font-size: 22px;">MediFORM Security Verification</h2>
              <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Secure Patient Handoff Platform</p>
            </div>
            <p style="font-size: 15px; color: #334155;">Hello,</p>
            <p style="font-size: 15px; color: #334155;">Use the 6-digit verification code below to complete your <strong>${purpose.toLowerCase().replace('_', ' ')}</strong> request:</p>
            <div style="text-align: center; margin: 24px 0;">
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0284c7; background: #e0f2fe; padding: 14px 28px; border-radius: 8px; display: inline-block; border: 1px dashed #0284c7;">
                ${otp}
              </div>
            </div>
            <p style="font-size: 13px; color: #64748b; line-height: 1.5;">This code is valid for <strong>5 minutes</strong>. For security, never share this code with anyone.</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #94a3b8; text-align: center;">If you did not initiate this request, please ignore this email.</p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`[REAL SMTP EMAIL SENT] Target: ${identifier} | Purpose: ${purpose}`);
      return true;
    } catch (err) {
      console.error(`[SMTP EMAIL FAILED] Target: ${identifier} | Error: ${err.message}`);
    }
  }

  if (env !== 'test') {
    console.log(`========================================`);
    console.log(`[DEV OTP SERVICE] Target: ${identifier}`);
    console.log(`[DEV OTP SERVICE] Purpose: ${purpose}`);
    console.log(`[DEV OTP SERVICE] OTP Code: ${otp}`);
    console.log(`========================================`);
  }

  return false;
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
  const emailSent = await sendOTP(identifier, rawOtp, purpose);

  return {
    challengeId,
    expiresAt,
    resendAvailableAt,
    // If real email was sent via SMTP, hide devOtp hint. Only provide devOtp hint if SMTP delivery failed/unconfigured.
    devOtp: emailSent ? undefined : (process.env.NODE_ENV === 'test' ? rawOtp : (process.env.SHOW_DEV_OTP === 'true' ? rawOtp : undefined))
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

  challenge.isVerified = true;
  challenge.isConsumed = true;
  await challenge.save();

  return {
    success: true,
    challenge
  };
}

/**
 * Resends a new OTP for an existing active challenge, enforcing a 60-second cooldown limit.
 */
async function resendOTP(challengeId) {
  if (!challengeId) {
    return { success: false, code: 'INVALID_INPUT', message: 'Challenge ID is required.' };
  }

  const existingChallenge = await OTPChallenge.findOne({ challengeId, isConsumed: false });
  if (!existingChallenge) {
    return { success: false, code: 'INVALID_CHALLENGE', message: 'OTP challenge not found or expired.' };
  }

  if (new Date() < new Date(existingChallenge.resendAvailableAt)) {
    const secondsRemaining = Math.ceil((new Date(existingChallenge.resendAvailableAt) - new Date()) / 1000);
    return {
      success: false,
      code: 'RESEND_COOLDOWN',
      message: `Please wait ${secondsRemaining} seconds before requesting another OTP.`
    };
  }

  // Create a fresh challenge for the same identifier & purpose
  return createChallenge({
    identifier: existingChallenge.identifier,
    purpose: existingChallenge.purpose,
    pendingUserData: existingChallenge.pendingUserData,
    userId: existingChallenge.userId
  });
}

module.exports = {
  generateOTP,
  hashOTP,
  sendOTP,
  createChallenge,
  verifyOTP,
  resendOTP
};
