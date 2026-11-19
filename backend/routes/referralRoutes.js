const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { transferLimiter, qrGenLimiter } = require('../middleware/rateLimiter');

router.use(transferLimiter);
router.use(authenticateToken);

// Create Referral from Flagged Screening (Doctor only)
router.post('/', requireRole('doctor'), referralController.createReferralFromScreening);

// Doctor Directory lookup
router.get('/doctors', referralController.getDoctorsDirectory);

// List Referrals (Auth required, IDOR protected)
router.get('/', referralController.getReferrals);

// Referral Lifecycle Endpoints (Phase 3)
router.get('/:id/timeline', referralController.getReferralTimeline);
router.post('/:id/acknowledge', requireRole('doctor'), referralController.acknowledgeReferral);
router.post('/:id/accept', requireRole('doctor'), referralController.acceptReferral);
router.post('/:id/reject', requireRole('doctor'), referralController.rejectReferral);
router.post('/:id/start-treatment', requireRole('doctor'), referralController.startTreatment);
router.post('/:id/treatment', requireRole('doctor'), referralController.documentTreatment);
router.post('/:id/confirm-care', requireRole('doctor'), referralController.confirmCare);
router.post('/:id/close', requireRole('doctor'), referralController.closeReferral);
router.post('/:id/cancel', requireRole('doctor'), referralController.cancelReferral);

// Reassign Referral to a different Receiving Doctor (Doctor only)
router.post('/:id/reassign', requireRole('doctor'), referralController.reassignReferral);
router.patch('/:id/reassign', requireRole('doctor'), referralController.reassignReferral);

// Generate Handoff QR for Referral (Doctor only)
router.post('/:id/qr', qrGenLimiter, requireRole('doctor'), referralController.generateReferralQR);

// Update Referral Status (Doctor only)
router.patch('/:id/status', requireRole('doctor'), referralController.updateReferralStatus);

// Get Referral by ID (Auth required, IDOR protected)
router.get('/:id', referralController.getReferralById);

module.exports = router;
