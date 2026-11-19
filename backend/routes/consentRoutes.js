const express = require('express');
const router = express.Router();
const consentController = require('../controllers/consentController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { transferLimiter } = require('../middleware/rateLimiter');

router.use(transferLimiter);
router.use(authenticateToken);

// List Consents (Patient sees their own; Doctor sees consents granted to them/their hospital)
router.get('/', consentController.getConsents);

// Grant New Consent (Patient)
router.post('/', consentController.grantConsent);

// Revoke Consent (Patient)
router.patch('/:id/revoke', consentController.revokeConsent);
router.post('/:id/revoke', consentController.revokeConsent);

// Update / Modify Consent (Protected: revoked consent cannot be modified)
router.patch('/:id', consentController.updateConsent);
router.put('/:id', consentController.updateConsent);

// Get Single Consent Record
router.get('/:id', consentController.getConsentById);

module.exports = router;
