const FollowUp = require('../models/FollowUp');
const notificationService = require('./notificationService');

/**
 * Configurable timings for follow-up reminders and status progression.
 * Default values can be overridden via environment variables.
 */
const FOLLOWUP_CONFIG = {
  UPCOMING_WINDOW_HOURS: parseInt(process.env.FOLLOWUP_UPCOMING_WINDOW_HOURS || '24', 10),
  DUE_SOON_WINDOW_HOURS: parseInt(process.env.FOLLOWUP_DUE_SOON_WINDOW_HOURS || '2', 10),
  OVERDUE_GRACE_MINUTES: parseInt(process.env.FOLLOWUP_OVERDUE_GRACE_MINUTES || '15', 10),
  MISSED_THRESHOLD_HOURS: parseInt(process.env.FOLLOWUP_MISSED_THRESHOLD_HOURS || '48', 10),
  CHECK_INTERVAL_MS: parseInt(process.env.FOLLOWUP_CHECK_INTERVAL_MS || '60000', 10)
};

/**
 * Core processing cycle for automated follow-up status progression and reminder generation.
 * Accepts optional `customNow` for deterministic unit and integration testing.
 */
async function processFollowUpRemindersAndStatuses(customNow = null) {
  const now = customNow ? new Date(customNow) : new Date();

  // Query only active follow-ups (completed or cancelled appointments stop receiving reminders)
  const activeFollowUps = await FollowUp.find({
    status: { $in: ['SCHEDULED', 'UPCOMING', 'DUE', 'OVERDUE'] }
  });

  const stats = {
    processedCount: activeFollowUps.length,
    statusTransitions: 0,
    remindersDispatched: 0
  };

  for (const followUp of activeFollowUps) {
    const dueTime = new Date(followUp.dueDate).getTime();
    const nowTime = now.getTime();
    const diffMs = dueTime - nowTime;
    const hoursUntilDue = diffMs / (1000 * 60 * 60);
    const minsPastDue = (nowTime - dueTime) / (1000 * 60);
    const hoursPastDue = minsPastDue / 60;

    let modified = false;

    // 1. MISSED: past due date beyond configured missed threshold (e.g. 48 hours)
    if (hoursPastDue >= FOLLOWUP_CONFIG.MISSED_THRESHOLD_HOURS) {
      if (followUp.status !== 'MISSED') {
        followUp.status = 'MISSED';
        followUp.missedAt = now;
        stats.statusTransitions++;
        modified = true;
      }

      const hasMissedReminder = followUp.remindersSent.some(r => r.stage === 'MISSED');
      if (!hasMissedReminder) {
        const eventId = `FLP_MISSED_${followUp.followUpId}_${dueTime}`;
        await notificationService.notifyFollowUpEvent('FOLLOW_UP_MISSED', followUp, { eventId });
        followUp.remindersSent.push({ stage: 'MISSED', sentAt: now, eventId });
        followUp.lastReminderAt = now;
        stats.remindersDispatched++;
        modified = true;
      }
    }
    // 2. OVERDUE: past due date beyond grace window (e.g. 15 minutes) but within missed threshold
    else if (minsPastDue >= FOLLOWUP_CONFIG.OVERDUE_GRACE_MINUTES) {
      if (followUp.status !== 'OVERDUE') {
        followUp.status = 'OVERDUE';
        stats.statusTransitions++;
        modified = true;
      }

      const hasOverdueReminder = followUp.remindersSent.some(r => r.stage === 'OVERDUE');
      if (!hasOverdueReminder) {
        const eventId = `FLP_OVERDUE_${followUp.followUpId}_${dueTime}`;
        await notificationService.notifyFollowUpEvent('FOLLOW_UP_OVERDUE', followUp, { eventId });
        followUp.remindersSent.push({ stage: 'OVERDUE', sentAt: now, eventId });
        followUp.lastReminderAt = now;
        stats.remindersDispatched++;
        modified = true;
      }
    }
    // 3. DUE: approaching due time within configured window (e.g. 2 hours before) up to overdue grace
    else if (hoursUntilDue <= FOLLOWUP_CONFIG.DUE_SOON_WINDOW_HOURS && minsPastDue < FOLLOWUP_CONFIG.OVERDUE_GRACE_MINUTES) {
      if (followUp.status === 'SCHEDULED' || followUp.status === 'UPCOMING') {
        followUp.status = 'DUE';
        stats.statusTransitions++;
        modified = true;
      }

      const hasDueSoonReminder = followUp.remindersSent.some(r => r.stage === 'DUE_SOON');
      if (!hasDueSoonReminder) {
        const eventId = `FLP_DUE_${followUp.followUpId}_${dueTime}`;
        await notificationService.notifyFollowUpEvent('FOLLOW_UP_REMINDER_DUE', followUp, { eventId });
        followUp.remindersSent.push({ stage: 'DUE_SOON', sentAt: now, eventId });
        followUp.lastReminderAt = now;
        stats.remindersDispatched++;
        modified = true;
      }
    }
    // 4. UPCOMING: within upcoming reminder window (e.g. 24 hours before)
    else if (hoursUntilDue <= FOLLOWUP_CONFIG.UPCOMING_WINDOW_HOURS && hoursUntilDue > FOLLOWUP_CONFIG.DUE_SOON_WINDOW_HOURS) {
      if (followUp.status === 'SCHEDULED') {
        followUp.status = 'UPCOMING';
        stats.statusTransitions++;
        modified = true;
      }

      const hasUpcomingReminder = followUp.remindersSent.some(r => r.stage === 'UPCOMING_24H');
      if (!hasUpcomingReminder) {
        const eventId = `FLP_UPCOMING_${followUp.followUpId}_${dueTime}`;
        await notificationService.notifyFollowUpEvent('FOLLOW_UP_REMINDER_UPCOMING', followUp, { eventId });
        followUp.remindersSent.push({ stage: 'UPCOMING_24H', sentAt: now, eventId });
        followUp.lastReminderAt = now;
        stats.remindersDispatched++;
        modified = true;
      }
    }

    if (modified) {
      await followUp.save();
    }
  }

  return stats;
}

let schedulerTimer = null;

/**
 * Starts persistent background scheduler timer.
 */
function startFollowUpScheduler(intervalMs = FOLLOWUP_CONFIG.CHECK_INTERVAL_MS) {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    try {
      await processFollowUpRemindersAndStatuses();
    } catch (err) {
      console.error('Follow-up scheduler tick error:', err.message);
    }
  }, intervalMs);

  if (schedulerTimer.unref) {
    schedulerTimer.unref(); // Ensure timer does not block process exit
  }
}

/**
 * Clears background scheduler timer.
 */
function stopFollowUpScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  FOLLOWUP_CONFIG,
  processFollowUpRemindersAndStatuses,
  startFollowUpScheduler,
  stopFollowUpScheduler
};
