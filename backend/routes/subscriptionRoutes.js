const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// Public plan catalog for pricing / pitch preview
router.get('/plans', subscriptionController.getPlans);

// Authenticated doctor/hospital usage & active license endpoints
router.get('/status', authenticateToken, requireRole('doctor'), subscriptionController.getSubscriptionStatus);
router.post('/subscribe', authenticateToken, requireRole('doctor'), subscriptionController.subscribeDoctorPlan);
router.post('/hospital-license', authenticateToken, requireRole('doctor'), subscriptionController.activateHospitalLicense);

module.exports = router;
