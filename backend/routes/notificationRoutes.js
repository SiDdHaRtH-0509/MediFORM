const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { transferLimiter } = require('../middleware/rateLimiter');

router.use(transferLimiter);
router.use(authenticateToken);

// Notification Preferences
router.get('/preferences', notificationController.getPreferences);
router.patch('/preferences', notificationController.updatePreferences);

// Unread Count
router.get('/unread-count', notificationController.getUnreadCount);

// Mark All Read
router.patch('/read-all', notificationController.markAllAsRead);

// Mark Single Notification Read (IDOR protected)
router.patch('/:id/read', notificationController.markAsRead);

// List Notifications (IDOR protected)
router.get('/', notificationController.getNotifications);

module.exports = router;
