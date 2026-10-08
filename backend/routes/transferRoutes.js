const express = require('express');
const router = express.Router();
const transferController = require('../controllers/transferController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { transferLimiter } = require('../middleware/rateLimiter');
const { validateTransferPayload } = require('../middleware/payloadValidator');

const qrController = require('../controllers/qrController');

// Apply rate limiting and token authentication to all transfer endpoints
router.use(transferLimiter);
router.use(authenticateToken);

// Create Transfer (Doctor only)
router.post('/', requireRole('doctor'), validateTransferPayload, transferController.createTransfer);

// Specific History Endpoints
router.get('/history/doctor-issued', requireRole('doctor'), transferController.getDoctorIssuedHistory);
router.get('/history/recipient-scanned', requireRole('doctor'), transferController.getRecipientScannedHistory);

// Patient Specific Endpoints
router.get('/pid/:pid/current', transferController.getCurrentByPid);
router.get('/pid/:pid/timeline', transferController.getPatientTimeline);

// Individual Transfer Endpoints
router.get('/:id', transferController.getTransferById);
router.post('/:id/qr', requireRole('doctor'), qrController.generateQR);
router.post('/:id/updates', requireRole('doctor'), validateTransferPayload, transferController.updateTransfer);
router.post('/:id/acknowledge', requireRole('doctor'), transferController.acknowledgeTransfer);
router.post('/:id/scan-event', transferController.recordScanEvent);

module.exports = router;
