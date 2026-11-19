const Referral = require('../models/Referral');
const FollowUp = require('../models/FollowUp');
const MonitoringAlert = require('../models/MonitoringAlert');
const notificationService = require('./notificationService');

/**
 * Centralized, priority-sensitive monitoring thresholds (hours).
 * All thresholds are fully configurable.
 */
const MONITORING_CONFIG = {
  CHECK_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes

  // Assignment delay thresholds by priority (hours since creation without receiving doctor)
  ASSIGNMENT_DELAY_HOURS: {
    Emergency: 2,
    Urgent: 6,
    Routine: 24
  },

  // Acknowledgement delay thresholds by priority (hours since assignment without acknowledgement)
  ACKNOWLEDGEMENT_DELAY_HOURS: {
    Emergency: 2,
    Urgent: 6,
    Routine: 24
  },

  // Treatment start delay thresholds (hours after acceptance without treatment start)
  TREATMENT_START_DELAY_HOURS: {
    Emergency: 4,
    Urgent: 12,
    Routine: 48
  },

  // Treatment documentation delay (hours after treatment start without documented summary)
  TREATMENT_DOCUMENTATION_DELAY_HOURS: {
    Emergency: 6,
    Urgent: 24,
    Routine: 48
  },

  // Care confirmation delay (hours after treatment documented without confirmed care)
  CARE_CONFIRMATION_DELAY_HOURS: {
    Emergency: 12,
    Urgent: 24,
    Routine: 72
  },

  // Stalled workflow inactivity thresholds (hours since last timeline event)
  STALLED_WORKFLOW_HOURS: {
    Emergency: 12,
    Urgent: 48,
    Routine: 96
  }
};

/**
 * Evaluates an individual referral for delayed handoffs, incomplete workflows, and stalled state.
 * Returns an array of detected finding objects.
 */
function evaluateReferralConditions(referral, followUps = [], customNow = null) {
  const now = customNow ? new Date(customNow) : new Date();
  const findings = [];

  // Exclude completed or cancelled referrals from false positive alerts
  if (['COMPLETED', 'CANCELLED'].includes(referral.status) || (referral.closure && referral.closure.isClosed)) {
    return findings;
  }

  const priority = referral.priority || 'Routine';
  const referralId = referral.referralId;
  const createdAt = new Date(referral.createdAt || now);

  // -------------------------------------------------------------
  // A. Assignment Delays
  // -------------------------------------------------------------
  if (referral.status === 'PENDING' && !referral.receivingDoctorId) {
    const elapsedHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    const thresholdHours = MONITORING_CONFIG.ASSIGNMENT_DELAY_HOURS[priority] || 24;

    if (elapsedHours >= thresholdHours) {
      const riskClassification = priority === 'Emergency' ? 'CRITICAL' : (priority === 'Urgent' ? 'HIGH' : 'MEDIUM');
      findings.push({
        riskCategory: 'ASSIGNMENT_DELAY',
        riskClassification,
        relevantLifecycleStatus: referral.status,
        plainLanguageExplanation: `Referral ${referralId} (${priority} priority) has remained unassigned for ${Math.floor(elapsedHours)} hours since creation, exceeding the ${thresholdHours}h safety threshold.`,
        evidence: {
          elapsedHours: Math.round(elapsedHours * 10) / 10,
          thresholdHours,
          priority,
          createdAt
        },
        recommendedAction: 'Assign an eligible receiving doctor or hospital department immediately.',
        responsibleDoctorId: referral.referringDoctorId,
        responsibleDoctorName: referral.referringDoctorName || referral.referringDoctorUsername || 'Referring Physician'
      });
    }
  }

  // -------------------------------------------------------------
  // B. Acknowledgement Delays
  // -------------------------------------------------------------
  if (referral.receivingDoctorId && referral.status === 'PENDING' && (!referral.acknowledgement || !referral.acknowledgement.acknowledgedAt)) {
    const assignmentTime = referral.assignmentTimestamp
      ? new Date(referral.assignmentTimestamp)
      : createdAt;
    const elapsedHours = (now.getTime() - assignmentTime.getTime()) / (1000 * 60 * 60);
    const thresholdHours = MONITORING_CONFIG.ACKNOWLEDGEMENT_DELAY_HOURS[priority] || 24;

    if (elapsedHours >= thresholdHours) {
      const riskClassification = priority === 'Emergency' ? 'CRITICAL' : (priority === 'Urgent' ? 'HIGH' : 'MEDIUM');
      const docName = referral.receivingDoctorName || referral.receivingDoctorUsername || 'Assigned Clinician';
      findings.push({
        riskCategory: 'ACKNOWLEDGEMENT_DELAY',
        riskClassification,
        relevantLifecycleStatus: referral.status,
        plainLanguageExplanation: `Referral ${referralId} was assigned to Dr. ${docName} ${Math.floor(elapsedHours)} hours ago, but receipt has not been acknowledged.`,
        evidence: {
          elapsedHours: Math.round(elapsedHours * 10) / 10,
          thresholdHours,
          assignedDoctor: docName,
          assignmentTimestamp: assignmentTime
        },
        recommendedAction: `Prompt Dr. ${docName} or hospital clinical triage to review and acknowledge the referral handoff.`,
        responsibleDoctorId: referral.receivingDoctorId,
        responsibleDoctorName: docName
      });
    }
  }

  // -------------------------------------------------------------
  // C. Rejection without Reassignment
  // -------------------------------------------------------------
  if (referral.status === 'REJECTED') {
    const rejectionTime = referral.rejection && referral.rejection.rejectedAt
      ? new Date(referral.rejection.rejectedAt)
      : new Date(referral.updatedAt || now);
    const elapsedHours = (now.getTime() - rejectionTime.getTime()) / (1000 * 60 * 60);
    const riskClassification = priority === 'Emergency' ? 'CRITICAL' : (priority === 'Urgent' ? 'HIGH' : 'MEDIUM');
    const rejectReason = (referral.rejection && referral.rejection.reason) || 'Capacity constraints / department mismatch';

    findings.push({
      riskCategory: 'REJECTION_UNASSIGNED',
      riskClassification,
      relevantLifecycleStatus: referral.status,
      plainLanguageExplanation: `Referral ${referralId} was rejected (${rejectReason}), but has not been reassigned to a replacement clinician.`,
      evidence: {
        elapsedHours: Math.round(elapsedHours * 10) / 10,
        rejectionTimestamp: rejectionTime,
        rejectionReason: rejectReason
      },
      recommendedAction: 'Reassign the referral to an alternative specialist doctor or escalate to clinical coordination.',
      responsibleDoctorId: referral.referringDoctorId,
      responsibleDoctorName: referral.referringDoctorName || referral.referringDoctorUsername || 'Referring Physician'
    });
  }

  // -------------------------------------------------------------
  // D. Incomplete Clinical Workflow
  // -------------------------------------------------------------
  // D1: Accepted but treatment not started
  if (referral.status === 'ACCEPTED') {
    const acceptedAt = (referral.acknowledgement && referral.acknowledgement.acknowledgedAt)
      ? new Date(referral.acknowledgement.acknowledgedAt)
      : (referral.assignmentTimestamp ? new Date(referral.assignmentTimestamp) : createdAt);
    const elapsedHours = (now.getTime() - acceptedAt.getTime()) / (1000 * 60 * 60);
    const thresholdHours = MONITORING_CONFIG.TREATMENT_START_DELAY_HOURS[priority] || 24;

    if (elapsedHours >= thresholdHours) {
      const riskClassification = (priority === 'Emergency' || priority === 'Urgent') ? 'HIGH' : 'MEDIUM';
      findings.push({
        riskCategory: 'INCOMPLETE_CLINICAL_WORKFLOW',
        riskClassification,
        relevantLifecycleStatus: referral.status,
        plainLanguageExplanation: `Referral ${referralId} was accepted ${Math.floor(elapsedHours)} hours ago, but clinical treatment intake has not been initiated.`,
        evidence: {
          workflowStage: 'AWAITING_TREATMENT_START',
          elapsedHours: Math.round(elapsedHours * 10) / 10,
          thresholdHours,
          acceptedAt
        },
        recommendedAction: 'Commence clinical treatment and document the start of care.',
        responsibleDoctorId: referral.receivingDoctorId,
        responsibleDoctorName: referral.receivingDoctorName || referral.receivingDoctorUsername || 'Attending Physician'
      });
    }
  }

  // D2: Treatment started / In-progress, but treatment documentation missing
  if (referral.status === 'IN_PROGRESS' || (referral.treatmentDocumentation && referral.treatmentDocumentation.treatmentDate && !referral.treatmentDocumentation.treatmentSummary)) {
    const startedAt = (referral.treatmentDocumentation && referral.treatmentDocumentation.treatmentDate)
      ? new Date(referral.treatmentDocumentation.treatmentDate)
      : (referral.updatedAt ? new Date(referral.updatedAt) : createdAt);
    const elapsedHours = (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60);
    const thresholdHours = MONITORING_CONFIG.TREATMENT_DOCUMENTATION_DELAY_HOURS[priority] || 24;

    if (elapsedHours >= thresholdHours && (!referral.treatmentDocumentation || !referral.treatmentDocumentation.treatmentSummary)) {
      const riskClassification = priority === 'Emergency' ? 'HIGH' : 'MEDIUM';
      findings.push({
        riskCategory: 'INCOMPLETE_CLINICAL_WORKFLOW',
        riskClassification,
        relevantLifecycleStatus: referral.status,
        plainLanguageExplanation: `Treatment for referral ${referralId} has been in progress for ${Math.floor(elapsedHours)} hours, but clinical treatment documentation remains incomplete.`,
        evidence: {
          workflowStage: 'AWAITING_TREATMENT_DOCUMENTATION',
          elapsedHours: Math.round(elapsedHours * 10) / 10,
          thresholdHours,
          startedAt
        },
        recommendedAction: 'Complete clinical treatment documentation, procedural notes, and administered medications.',
        responsibleDoctorId: referral.receivingDoctorId,
        responsibleDoctorName: referral.receivingDoctorName || referral.receivingDoctorUsername || 'Attending Physician'
      });
    }
  }

  // D3: Treatment documented, but care confirmation missing
  if (referral.treatmentDocumentation && referral.treatmentDocumentation.treatmentSummary && (!referral.careConfirmation || !referral.careConfirmation.isConfirmed)) {
    const documentedAt = referral.treatmentDocumentation.documentedAt
      ? new Date(referral.treatmentDocumentation.documentedAt)
      : (referral.updatedAt ? new Date(referral.updatedAt) : createdAt);
    const elapsedHours = (now.getTime() - documentedAt.getTime()) / (1000 * 60 * 60);
    const thresholdHours = MONITORING_CONFIG.CARE_CONFIRMATION_DELAY_HOURS[priority] || 24;

    if (elapsedHours >= thresholdHours) {
      const riskClassification = priority === 'Emergency' ? 'HIGH' : 'MEDIUM';
      findings.push({
        riskCategory: 'INCOMPLETE_CLINICAL_WORKFLOW',
        riskClassification,
        relevantLifecycleStatus: referral.status,
        plainLanguageExplanation: `Treatment for referral ${referralId} was documented ${Math.floor(elapsedHours)} hours ago, but attending care confirmation has not been recorded.`,
        evidence: {
          workflowStage: 'AWAITING_CARE_CONFIRMATION',
          elapsedHours: Math.round(elapsedHours * 10) / 10,
          thresholdHours,
          documentedAt
        },
        recommendedAction: 'Perform clinical verification and document care confirmation to finalize the episode of care.',
        responsibleDoctorId: referral.receivingDoctorId,
        responsibleDoctorName: referral.receivingDoctorName || referral.receivingDoctorUsername || 'Attending Physician'
      });
    }
  }

  // -------------------------------------------------------------
  // E. Follow-Up Risks (Evaluated against structured FollowUp records)
  // -------------------------------------------------------------
  for (const flp of followUps) {
    if (flp.status === 'MISSED') {
      const riskClassification = (priority === 'Emergency' || priority === 'Urgent') ? 'CRITICAL' : 'HIGH';
      findings.push({
        riskCategory: 'FOLLOW_UP_RISK',
        riskClassification,
        relevantLifecycleStatus: referral.status,
        plainLanguageExplanation: `Follow-up appointment ${flp.followUpId} for referral ${referralId} was marked MISSED (>48h past due). Clinical review is urgently required.`,
        evidence: {
          followUpId: flp.followUpId,
          dueDate: flp.dueDate,
          followUpStatus: flp.status,
          missedAt: flp.missedAt
        },
        recommendedAction: 'Contact patient immediately to reschedule consultation or document alternative care plan.',
        responsibleDoctorId: flp.responsibleDoctorId || referral.receivingDoctorId,
        responsibleDoctorName: flp.responsibleDoctorName || referral.receivingDoctorName || 'Responsible Physician'
      });
    } else if (flp.status === 'OVERDUE') {
      const dueTime = new Date(flp.dueDate).getTime();
      const minsPastDue = Math.max(0, Math.floor((now.getTime() - dueTime) / (1000 * 60)));
      findings.push({
        riskCategory: 'FOLLOW_UP_RISK',
        riskClassification: 'HIGH',
        relevantLifecycleStatus: referral.status,
        plainLanguageExplanation: `Follow-up appointment ${flp.followUpId} for referral ${referralId} is past due by ${minsPastDue} minutes without documented attendance.`,
        evidence: {
          followUpId: flp.followUpId,
          dueDate: flp.dueDate,
          followUpStatus: flp.status,
          minsPastDue
        },
        recommendedAction: 'Verify patient arrival, record attendance, or reschedule appointment.',
        responsibleDoctorId: flp.responsibleDoctorId || referral.receivingDoctorId,
        responsibleDoctorName: flp.responsibleDoctorName || referral.receivingDoctorName || 'Responsible Physician'
      });
    }
  }

  // -------------------------------------------------------------
  // F. Stalled Referral (Inactivity across timeline)
  // -------------------------------------------------------------
  // Only evaluate stalled workflow if no higher-priority specific alert has fired for this referral
  if (findings.length === 0) {
    let lastActivityTime = createdAt;
    if (referral.timeline && referral.timeline.length > 0) {
      const lastItem = referral.timeline[referral.timeline.length - 1];
      if (lastItem && lastItem.timestamp) {
        lastActivityTime = new Date(lastItem.timestamp);
      }
    } else if (referral.updatedAt) {
      lastActivityTime = new Date(referral.updatedAt);
    }

    const elapsedHours = (now.getTime() - lastActivityTime.getTime()) / (1000 * 60 * 60);
    const thresholdHours = MONITORING_CONFIG.STALLED_WORKFLOW_HOURS[priority] || 48;

    if (elapsedHours >= thresholdHours) {
      const riskClassification = priority === 'Emergency' ? 'HIGH' : (priority === 'Urgent' ? 'MEDIUM' : 'LOW');
      findings.push({
        riskCategory: 'STALLED_WORKFLOW',
        riskClassification,
        relevantLifecycleStatus: referral.status,
        plainLanguageExplanation: `Referral ${referralId} has had no recorded clinical or lifecycle activity for ${Math.floor(elapsedHours)} hours.`,
        evidence: {
          elapsedHours: Math.round(elapsedHours * 10) / 10,
          thresholdHours,
          lastActivityTime
        },
        recommendedAction: 'Review patient status and record a clinical progress note or update referral status.',
        responsibleDoctorId: referral.receivingDoctorId || referral.referringDoctorId,
        responsibleDoctorName: referral.receivingDoctorName || referral.referringDoctorName || 'Care Coordinator'
      });
    }
  }

  return findings;
}

let isScanRunning = false;

/**
 * Runs a complete monitoring cycle across all active referrals and follow-ups.
 * Synchronizes findings with MonitoringAlert collection and dispatches high-priority notifications.
 * Prevents overlapping cycles and preserves dismissed alert status.
 */
async function runMonitoringScan(customNow = null) {
  if (isScanRunning) {
    return {
      scannedCount: 0,
      newAlertsCount: 0,
      activeAlertsCount: 0,
      resolvedAlertsCount: 0,
      notificationsDispatched: 0,
      errorsCount: 0,
      skippedOverlapping: true
    };
  }

  isScanRunning = true;
  const now = customNow ? new Date(customNow) : new Date();

  const stats = {
    scannedCount: 0,
    newAlertsCount: 0,
    activeAlertsCount: 0,
    resolvedAlertsCount: 0,
    notificationsDispatched: 0,
    errorsCount: 0
  };

  try {
    // 1. Fetch active referrals
    const activeReferrals = await Referral.find({
      status: { $nin: ['COMPLETED', 'CANCELLED'] },
      'closure.isClosed': { $ne: true }
    });

    stats.scannedCount = activeReferrals.length;

    // Map of currently detected alerts key -> finding
    const currentFindingsByKey = new Map();

    for (const referral of activeReferrals) {
      try {
        // Fetch follow-ups associated with this referral
        const followUps = await FollowUp.find({
          $or: [
            { referralRef: referral._id },
            { referralId: referral.referralId }
          ]
        });

        const findings = evaluateReferralConditions(referral, followUps, now);

        for (const finding of findings) {
          const key = `${referral.referralId}_${finding.riskCategory}`;
          currentFindingsByKey.set(key, {
            referral,
            finding
          });
        }
      } catch (refErr) {
        // Log failure safely without patient PHI
        console.error(`Referral evaluation failed for referral ${referral.referralId}:`, refErr.message);
        stats.errorsCount++;
      }
    }

    // 2. Fetch existing OPEN (ACTIVE and DISMISSED) alerts in database
    const existingOpenAlerts = await MonitoringAlert.find({
      resolutionStatus: { $in: ['ACTIVE', 'DISMISSED'] }
    });

    // Track keys that remain present in this scan
    const stillPresentKeys = new Set();

    // 3. Process current findings
    for (const [key, { referral, finding }] of currentFindingsByKey.entries()) {
      stillPresentKeys.add(key);

      const existingAlert = existingOpenAlerts.find(
        a => a.referralId === referral.referralId && a.riskCategory === finding.riskCategory
      );

      if (existingAlert) {
        if (existingAlert.resolutionStatus === 'ACTIVE') {
          // Update evaluation timestamp and evidence for active alert
          existingAlert.lastEvaluatedAt = now;
          existingAlert.plainLanguageExplanation = finding.plainLanguageExplanation;
          existingAlert.evidence = finding.evidence;
          existingAlert.riskClassification = finding.riskClassification;
          existingAlert.recommendedAction = finding.recommendedAction;
          await existingAlert.save();
          stats.activeAlertsCount++;
        } else if (existingAlert.resolutionStatus === 'DISMISSED') {
          // Clinician previously dismissed this finding: keep it DISMISSED
          // Update evaluation timestamp and evidence without reactivating or creating a duplicate
          existingAlert.lastEvaluatedAt = now;
          existingAlert.plainLanguageExplanation = finding.plainLanguageExplanation;
          existingAlert.evidence = finding.evidence;
          await existingAlert.save();
        }
      } else {
        // Create new alert (either first time, or recurring after previous resolution)
        const newAlert = new MonitoringAlert({
          referralRef: referral._id,
          referralId: referral.referralId,
          patientId: referral.patientId,
          riskClassification: finding.riskClassification,
          riskCategory: finding.riskCategory,
          relevantLifecycleStatus: finding.relevantLifecycleStatus,
          plainLanguageExplanation: finding.plainLanguageExplanation,
          evidence: finding.evidence,
          recommendedAction: finding.recommendedAction,
          responsibleDoctorId: finding.responsibleDoctorId || referral.receivingDoctorId || referral.referringDoctorId,
          responsibleDoctorName: finding.responsibleDoctorName,
          referringDoctorId: referral.referringDoctorId,
          referringHospital: referral.referringHospital || '',
          receivingHospital: referral.receivingHospital || '',
          resolutionStatus: 'ACTIVE',
          detectionTimestamp: now,
          lastEvaluatedAt: now
        });

        await newAlert.save();
        stats.newAlertsCount++;
        stats.activeAlertsCount++;

        // Notify clinicians for CRITICAL and HIGH severity findings
        if (['CRITICAL', 'HIGH'].includes(finding.riskClassification)) {
          try {
            const notifs = await notificationService.notifyMonitoringAlert(newAlert);
            if (notifs && notifs.length > 0) {
              stats.notificationsDispatched += notifs.length;
            }
          } catch (notifErr) {
            console.error('Error dispatching monitoring notification:', notifErr.message);
          }
        }
      }
    }

    // 4. Auto-resolve alerts whose underlying condition has cleared
    for (const openAlert of existingOpenAlerts) {
      const key = `${openAlert.referralId}_${openAlert.riskCategory}`;
      if (!stillPresentKeys.has(key)) {
        // The condition no longer exists in database
        openAlert.resolutionStatus = 'RESOLVED';
        openAlert.resolvedAt = now;
        await openAlert.save();
        stats.resolvedAlertsCount++;
      }
    }

    return stats;
  } catch (err) {
    console.error('Critical failure in monitoring cycle:', err.message);
    stats.errorsCount++;
    return stats;
  } finally {
    isScanRunning = false;
  }
}

let monitoringTimer = null;

/**
 * Starts background monitoring scheduler.
 */
function startMonitoringScheduler(intervalMs = MONITORING_CONFIG.CHECK_INTERVAL_MS) {
  if (monitoringTimer) return;
  monitoringTimer = setInterval(async () => {
    try {
      await runMonitoringScan();
    } catch (err) {
      console.error('Background monitoring tick error:', err.message);
    }
  }, intervalMs);

  if (monitoringTimer.unref) {
    monitoringTimer.unref();
  }
}

/**
 * Stops background monitoring scheduler.
 */
function stopMonitoringScheduler() {
  if (monitoringTimer) {
    clearInterval(monitoringTimer);
    monitoringTimer = null;
  }
}

module.exports = {
  MONITORING_CONFIG,
  evaluateReferralConditions,
  runMonitoringScan,
  startMonitoringScheduler,
  stopMonitoringScheduler
};
