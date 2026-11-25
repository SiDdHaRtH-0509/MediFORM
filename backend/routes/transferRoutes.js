const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const transferController = require('../controllers/transferController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { transferLimiter } = require('../middleware/rateLimiter');
const { validateTransferPayload } = require('../middleware/payloadValidator');

const qrController = require('../controllers/qrController');

// Optional JWT parser for EMS routes that also accept verified QR UUID+PIN access
function optionalAuthenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return next();
  try {
    const secret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';
    req.user = jwt.verify(token, secret);
  } catch (e) {
    // Allow fallback to QR UUID+PIN check inside controller
  }
  return next();
}

// Apply rate limiting to all transfer endpoints
router.use(transferLimiter);

// Live EMS Location, Criticality & Direct Call/SMS routes (Doctor JWT OR verified QR session)
router.get('/:id/ems-status', optionalAuthenticateToken, transferController.getEmsStatus);
router.post('/:id/ems-location', optionalAuthenticateToken, transferController.updateEmsLocation);
router.post('/:id/ems-message', optionalAuthenticateToken, transferController.postEmsMessage);
router.post('/:id/emergency-sms', optionalAuthenticateToken, transferController.sendEmergencySms);

// Require authenticated token for all remaining clinical transfer endpoints
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
