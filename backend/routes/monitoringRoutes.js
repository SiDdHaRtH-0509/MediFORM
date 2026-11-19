const express = require('express');
const router = express.Router();
const monitoringController = require('../controllers/monitoringController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { transferLimiter } = require('../middleware/rateLimiter');

router.use(transferLimiter);
router.use(authenticateToken);
// Internal monitoring and clinical risk detection is restricted to authorized clinicians
router.use(requireRole('doctor'));

// Query Monitoring Alerts with filters
router.get('/alerts', monitoringController.getMonitoringAlerts);

// Trigger Immediate Monitoring Scan
router.post('/scan', monitoringController.triggerMonitoringScan);

// Dismiss a Specific Alert
router.patch('/alerts/:id/dismiss', monitoringController.dismissAlert);

module.exports = router;
