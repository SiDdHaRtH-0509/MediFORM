const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/verify-otp', authLimiter, authController.verifyOtp);
router.post('/verify-email-otp', authLimiter, authController.verifyEmailOtp);
router.post('/verify-login-otp', authLimiter, authController.verifyLoginOtp);
router.post('/resend-otp', authLimiter, authController.resendOtp);
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/reset-password', authLimiter, authController.resetPassword);
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;

