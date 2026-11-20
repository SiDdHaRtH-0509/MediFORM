const express = require('express');
const router = express.Router();
const doctorProfileController = require('../controllers/doctorProfileController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.use(authenticateToken);

// Verifier Authority Endpoints
router.get('/pending', doctorProfileController.getPendingVerifications);
router.get('/:id', doctorProfileController.getVerificationDetails);
router.post('/:id/review', doctorProfileController.reviewVerification);
router.get('/document/:docId', doctorProfileController.getDocument);

module.exports = router;
