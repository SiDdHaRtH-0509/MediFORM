const express = require('express');
const router = express.Router();
const doctorProfileController = require('../controllers/doctorProfileController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.use(authenticateToken);

// Doctor Profile Management
router.get('/profile', doctorProfileController.getDoctorProfile);
router.patch('/profile', doctorProfileController.updateDoctorProfile);
router.put('/profile', doctorProfileController.updateDoctorProfile); // Support PUT as well
router.post('/profile/photo', doctorProfileController.updateProfilePhoto);

// Doctor Credentials Submission & Status
router.post('/credentials/submit', doctorProfileController.submitCredentials);
router.get('/credentials/status', doctorProfileController.getCredentialsStatus);
router.get('/credentials/document/:docId', doctorProfileController.getDocument);

module.exports = router;
