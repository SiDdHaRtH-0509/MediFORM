const express = require('express');
const router = express.Router();
const followUpController = require('../controllers/followUpController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { transferLimiter } = require('../middleware/rateLimiter');

router.use(transferLimiter);
router.use(authenticateToken);

// Create follow-up (Doctor only)
router.post('/', requireRole('doctor'), followUpController.createFollowUp);

// List follow-ups (Role protected & IDOR isolated)
router.get('/', followUpController.getFollowUps);

// Trigger scheduler cycle (Doctor only)
router.post('/trigger-check', requireRole('doctor'), followUpController.triggerSchedulerCycle);

// Get single follow-up
router.get('/:id', followUpController.getFollowUpById);

// Reschedule follow-up (Doctor only)
router.patch('/:id/reschedule', requireRole('doctor'), followUpController.rescheduleFollowUp);

// Attendance check-in (Patient check-in or Doctor confirmation)
router.patch('/:id/attendance', followUpController.recordAttendance);

// Complete and document clinical follow-up (Doctor only)
router.post('/:id/complete', requireRole('doctor'), followUpController.completeFollowUp);

// Cancel follow-up (Doctor only)
router.patch('/:id/cancel', requireRole('doctor'), followUpController.cancelFollowUp);

module.exports = router;
