const Notification = require('../models/Notification');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

/**
 * Helper to build ownership query for notifications using canonical user identity.
 * Enforces strict role isolation between patient and doctor notifications,
 * and resolves legacy patient identifiers only through trusted server-side DB mapping.
 */
function buildOwnershipQuery(user, currentUser) {
  const canonicalUserId = (user && user.userId) || (currentUser && currentUser._id);
  if (!canonicalUserId) {
    return { _id: null };
  }

  if (user && user.role === 'patient') {
    // Trusted server-side mapping: resolve username from canonical database record
    const verifiedUsername = ((currentUser && currentUser.username) || (user && user.username) || '').trim();
    return {
      recipientRole: 'patient',
      $or: [
        { recipientUserId: canonicalUserId },
        ...(verifiedUsername ? [{ recipientPatientId: new RegExp(`^${verifiedUsername}$`, 'i') }] : [])
      ]
    };
  }

  // Doctor role: strict isolation - only notifications explicitly intended for doctor and matching canonical userId
  return {
    recipientRole: 'doctor',
    recipientUserId: canonicalUserId
  };
}

/**
 * List Notifications for Authenticated User (IDOR Protected)
 * GET /api/notifications
 */
exports.getNotifications = async (req, res) => {
  try {
    const { isRead, category, limit = 50 } = req.query;
    // Strictly rely on authenticated session identity; ignore any client-supplied user/patient query params
    const baseQuery = buildOwnershipQuery(req.user, req.currentUser);

    if (isRead !== undefined) {
      baseQuery.isRead = isRead === 'true' || isRead === true;
    }

    if (category) {
      baseQuery.category = category;
    }

    const notifications = await Notification.find(baseQuery)
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    const totalUnread = await Notification.countDocuments({
      ...buildOwnershipQuery(req.user, req.currentUser),
      isRead: false
    });

    return res.status(200).json({
      success: true,
      count: notifications.length,
      totalUnread,
      notifications
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving notifications.' }
    });
  }
};

/**
 * Get Unread Notification Count
 * GET /api/notifications/unread-count
 */
exports.getUnreadCount = async (req, res) => {
  try {
    // Strictly enforce canonical ownership; ignore client query parameters
    const query = {
      ...buildOwnershipQuery(req.user, req.currentUser),
      isRead: false
    };

    const count = await Notification.countDocuments(query);

    return res.status(200).json({
      success: true,
      unreadCount: count
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error getting unread count.' }
    });
  }
};

/**
 * Mark Single Notification as Read (IDOR Protected)
 * PATCH /api/notifications/:id/read
 */
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    let notif = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      notif = await Notification.findById(id);
    }
    if (!notif) {
      notif = await Notification.findOne({ notificationId: id });
    }

    if (!notif) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Notification not found.' }
      });
    }

    // Canonical identity verification (Strict IDOR protection)
    const canonicalUserIdStr = (req.user.userId || (req.currentUser && req.currentUser._id) || '').toString();
    const verifiedUsername = ((req.currentUser && req.currentUser.username) || (req.user && req.user.username) || '').toLowerCase().trim();

    const notifRecipientUserIdStr = notif.recipientUserId ? notif.recipientUserId.toString() : '';
    const notifRecipientPatientId = (notif.recipientPatientId || '').toLowerCase().trim();

    // Verify role matches notification target (Strict doctor vs patient isolation)
    const roleMatches = notif.recipientRole === req.user.role;

    // Verify ownership: canonical user ID match, or trusted server-side username mapping for legacy patient records
    const isOwner = roleMatches && (
      (notifRecipientUserIdStr && notifRecipientUserIdStr === canonicalUserIdStr) ||
      (req.user.role === 'patient' && notifRecipientPatientId && notifRecipientPatientId === verifiedUsername)
    );

    if (!isOwner) {
      await AuditLog.create({
        action: 'UNAUTHORIZED_NOTIFICATION_ACCESS_ATTEMPT',
        actorId: req.user.userId,
        actorRole: req.user.role,
        details: { notificationId: notif.notificationId, targetRecipient: notif.recipientUserId }
      });

      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_NOTIFICATION_ACCESS', message: 'You are not authorized to access this notification.' }
      });
    }

    notif.isRead = true;
    notif.readAt = new Date();
    await notif.save();

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read.',
      notification: notif
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error marking notification as read.' }
    });
  }
};

/**
 * Mark All Notifications as Read for Authenticated User
 * PATCH /api/notifications/read-all
 */
exports.markAllAsRead = async (req, res) => {
  try {
    const query = {
      ...buildOwnershipQuery(req.user, req.currentUser),
      isRead: false
    };

    const updateResult = await Notification.updateMany(query, {
      $set: {
        isRead: true,
        readAt: new Date()
      }
    });

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read.',
      modifiedCount: updateResult.modifiedCount
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error marking all notifications as read.' }
    });
  }
};

/**
 * Get Notification Preferences
 * GET /api/notifications/preferences
 */
exports.getPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User profile not found.' }
      });
    }

    const defaultPrefs = {
      referralUpdates: true,
      appointmentReminders: true,
      followUpReminders: true,
      generalCareUpdates: true
    };

    return res.status(200).json({
      success: true,
      preferences: user.notificationPreferences || defaultPrefs
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving preferences.' }
    });
  }
};

/**
 * Update Notification Preferences
 * PATCH /api/notifications/preferences
 */
exports.updatePreferences = async (req, res) => {
  try {
    const { referralUpdates, appointmentReminders, followUpReminders, generalCareUpdates } = req.body;
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User profile not found.' }
      });
    }

    if (!user.notificationPreferences) {
      user.notificationPreferences = {};
    }

    if (referralUpdates !== undefined) user.notificationPreferences.referralUpdates = Boolean(referralUpdates);
    if (appointmentReminders !== undefined) user.notificationPreferences.appointmentReminders = Boolean(appointmentReminders);
    if (followUpReminders !== undefined) user.notificationPreferences.followUpReminders = Boolean(followUpReminders);
    if (generalCareUpdates !== undefined) user.notificationPreferences.generalCareUpdates = Boolean(generalCareUpdates);

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Notification preferences updated successfully.',
      preferences: user.notificationPreferences
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error updating preferences.' }
    });
  }
};
