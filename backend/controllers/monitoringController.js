const MonitoringAlert = require('../models/MonitoringAlert');
const Referral = require('../models/Referral');
const AuditLog = require('../models/AuditLog');
const { runMonitoringScan } = require('../services/referralMonitoringService');

/**
 * Helper to check doctor authorization for an alert
 */
function isDoctorAuthorizedForAlert(doctorUser, alert) {
  const userIdStr = (doctorUser.userId || (doctorUser._id && doctorUser._id.toString()) || '').toString();
  const userHospital = ((doctorUser.hospitalName) || '').toLowerCase().trim();

  const isResponsibleDoc = alert.responsibleDoctorId && alert.responsibleDoctorId.toString() === userIdStr;
  const isReferringDoc = alert.referringDoctorId && alert.referringDoctorId.toString() === userIdStr;
  const isReceivingHosp = userHospital && alert.receivingHospital && userHospital === alert.receivingHospital.toLowerCase().trim();
  const isReferringHosp = userHospital && alert.referringHospital && userHospital === alert.referringHospital.toLowerCase().trim();

  return isResponsibleDoc || isReferringDoc || isReceivingHosp || isReferringHosp;
}

/**
 * List Monitoring Alerts (Doctor Only)
 * GET /api/monitoring/alerts
 */
exports.getMonitoringAlerts = async (req, res) => {
  try {
    const { severity, category, status = 'ACTIVE', search } = req.query;

    const userIdStr = (req.user.userId || '').toString();
    const userHospital = ((req.user.hospitalName) || '').toLowerCase().trim();

    // Hospital and doctor access isolation query
    const authFilter = {
      $or: [
        { responsibleDoctorId: req.user.userId },
        { referringDoctorId: req.user.userId },
        ...(userHospital ? [
          { receivingHospital: new RegExp(`^${userHospital}$`, 'i') },
          { referringHospital: new RegExp(`^${userHospital}$`, 'i') }
        ] : [])
      ]
    };

    const query = { ...authFilter };

    if (status && status !== 'ALL') {
      query.resolutionStatus = status.toUpperCase();
    }

    if (severity && severity !== 'ALL') {
      query.riskClassification = severity.toUpperCase();
    }

    if (category && category !== 'ALL') {
      query.riskCategory = category.toUpperCase();
    }

    if (search && search.trim()) {
      const q = search.trim();
      query.$and = [
        {
          $or: [
            { referralId: new RegExp(q, 'i') },
            { patientId: new RegExp(q, 'i') },
            { responsibleDoctorName: new RegExp(q, 'i') },
            { plainLanguageExplanation: new RegExp(q, 'i') }
          ]
        }
      ];
    }

    // Fetch alerts
    const alerts = await MonitoringAlert.find(query).sort({
      riskClassification: 1, // CRITICAL and HIGH priority sorting handled via collation or custom sort below
      detectionTimestamp: -1
    });

    // Custom severity sort: CRITICAL -> HIGH -> MEDIUM -> LOW
    const severityWeight = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    alerts.sort((a, b) => {
      const diff = (severityWeight[b.riskClassification] || 0) - (severityWeight[a.riskClassification] || 0);
      if (diff !== 0) return diff;
      return new Date(b.detectionTimestamp) - new Date(a.detectionTimestamp);
    });

    // Calculate aggregated metrics
    const [criticalCount, highCount, mediumCount, lowCount, recentlyResolvedCount] = await Promise.all([
      MonitoringAlert.countDocuments({ ...authFilter, resolutionStatus: 'ACTIVE', riskClassification: 'CRITICAL' }),
      MonitoringAlert.countDocuments({ ...authFilter, resolutionStatus: 'ACTIVE', riskClassification: 'HIGH' }),
      MonitoringAlert.countDocuments({ ...authFilter, resolutionStatus: 'ACTIVE', riskClassification: 'MEDIUM' }),
      MonitoringAlert.countDocuments({ ...authFilter, resolutionStatus: 'ACTIVE', riskClassification: 'LOW' }),
      MonitoringAlert.countDocuments({
        ...authFilter,
        resolutionStatus: 'RESOLVED',
        resolvedAt: { $gte: new Date(Date.now() - 7 * 86400000) }
      })
    ]);

    const totalActiveAlerts = criticalCount + highCount + mediumCount + lowCount;

    return res.status(200).json({
      success: true,
      summary: {
        totalActiveAlerts,
        criticalCount,
        highCount,
        mediumCount,
        lowCount,
        recentlyResolvedCount
      },
      count: alerts.length,
      alerts
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error fetching monitoring alerts.' }
    });
  }
};

/**
 * Trigger Immediate Monitoring Scan (Doctor Only)
 * POST /api/monitoring/scan
 */
exports.triggerMonitoringScan = async (req, res) => {
  try {
    const stats = await runMonitoringScan();

    await AuditLog.create({
      action: 'MONITORING_SCAN_TRIGGERED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: stats
    });

    return res.status(200).json({
      success: true,
      message: 'Intelligent referral monitoring scan concluded successfully.',
      stats
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error executing monitoring scan.' }
    });
  }
};

/**
 * Dismiss an Alert with documented clinical reason (Doctor Only)
 * PATCH /api/monitoring/alerts/:id/dismiss
 */
exports.dismissAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const alert = await MonitoringAlert.findOne({
      $or: [
        { alertId: id },
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])
      ]
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Monitoring alert not found.' }
      });
    }

    if (!isDoctorAuthorizedForAlert(req.user, alert)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ALERT_ACCESS', message: 'You are not authorized to dismiss alerts for this hospital or referral.' }
      });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'DISMISS_REASON_REQUIRED', message: 'A documented clinical reason is mandatory to dismiss an alert.' }
      });
    }

    if (alert.resolutionStatus === 'DISMISSED') {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_DISMISSED', message: 'Alert has already been dismissed.' }
      });
    }

    alert.resolutionStatus = 'DISMISSED';
    alert.dismissedBy = req.user.userId;
    alert.dismissedAt = new Date();
    alert.dismissReason = reason.trim();

    await alert.save();

    await AuditLog.create({
      action: 'MONITORING_ALERT_DISMISSED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: {
        alertId: alert.alertId,
        referralId: alert.referralId,
        reason: alert.dismissReason
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Monitoring alert dismissed successfully.',
      alert
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error dismissing alert.' }
    });
  }
};
