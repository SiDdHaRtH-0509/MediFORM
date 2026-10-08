const express = require('express');
const router = express.Router();
const qrController = require('../controllers/qrController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { qrGenLimiter, qrValLimiter } = require('../middleware/rateLimiter');

// Doctor QR Generation requires authentication & doctor role
router.post('/generate', qrGenLimiter, authenticateToken, requireRole('doctor'), qrController.generateQR);

// Public Share Session Info (No PHI returned, for direct link landing page before PIN entry)
router.get('/info/:uuid', qrValLimiter, qrController.getShareInfo);

// Revoke Shared Access (Doctor only)
router.post('/revoke/:uuid', qrGenLimiter, authenticateToken, requireRole('doctor'), qrController.revokeQR);

// Full Clinical Receiver QR View (Doctor/Healthcare Professional)
router.post('/validate/:uuid', qrValLimiter, qrController.validateQR);

// Patient-Safe Read-Only View (Unauthenticated / QR Attendant viewer)
router.post('/validate-patient/:uuid', qrValLimiter, qrController.validatePatientQR);

module.exports = router;
