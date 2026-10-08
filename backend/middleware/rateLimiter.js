const rateLimit = require('express-rate-limit');

// Use test-specific limits when NODE_ENV === 'test'
const isTest = process.env.NODE_ENV === 'test';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 50 : 15,
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many authentication attempts. Please try again after 15 minutes."
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const transferLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100 : 100,
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many transfer operations. Rate limit exceeded."
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const qrGenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 50 : 30,
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many QR generation requests. Please wait a few minutes."
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const qrValLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100 : 20,
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many QR validation attempts. Access temporarily throttled."
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  authLimiter,
  transferLimiter,
  qrGenLimiter,
  qrValLimiter
};
