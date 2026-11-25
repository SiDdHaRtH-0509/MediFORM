const Subscription = require('../models/Subscription');
const AuditLog = require('../models/AuditLog');

const PLAN_CATALOG = {
  doctorPlans: [
    {
      code: 'DOCTOR_FREE',
      name: 'Clinician Starter (Free)',
      ownerType: 'doctor',
      monthlyPriceInr: 0,
      yearlyPriceInr: 0,
      monthlyPriceUsd: 0,
      monthlyTransferQuota: 25,
      monthlySmsQuota: 25,
      seatLimit: 1,
      badge: 'FREE FOREVER',
      features: [
        'Up to 25 patient transfer folios / month',
        'Unlimited Emergency Good-Samaritan bypasses',
        'AES-256 encrypted QR + 6-digit PIN handoff',
        'Live NEWS2 criticality scoring & drug-allergy alerts'
      ]
    },
    {
      code: 'DOCTOR_PRO',
      name: 'Clinician Pro',
      ownerType: 'doctor',
      monthlyPriceInr: 499,
      yearlyPriceInr: 4990,
      monthlyPriceUsd: 9,
      monthlyTransferQuota: 200,
      monthlySmsQuota: 300,
      seatLimit: 1,
      badge: 'MOST POPULAR',
      features: [
        'Up to 200 patient transfer requests & approvals / month',
        'Direct Hospital & Ambulance Emergency SMS + Call logging',
        'Live GPS ambulance telemetry & route ETA tracking',
        'Priority referral escalation & follow-up reminders'
      ]
    },
    {
      code: 'DOCTOR_COMMAND',
      name: 'Emergency Command',
      ownerType: 'doctor',
      monthlyPriceInr: 1299,
      yearlyPriceInr: 12990,
      monthlyPriceUsd: 19,
      monthlyTransferQuota: -1,
      monthlySmsQuota: 1500,
      seatLimit: 1,
      badge: 'UNLIMITED',
      features: [
        'Unlimited patient transfers, referrals & QR sessions',
        '1,500 automated Emergency SMS / WhatsApp dispatch alerts',
        'Multi-hospital receiving privileges & audit export',
        '24/7 priority trauma-desk clinical support'
      ]
    }
  ],
  hospitalLicenses: [
    {
      code: 'HOSPITAL_SEVA_PUBLIC',
      name: 'National Seva Public Health Grant',
      ownerType: 'hospital',
      monthlyPriceInr: 0,
      yearlyPriceInr: 0,
      monthlyPriceUsd: 0,
      monthlyTransferQuota: 1000,
      monthlySmsQuota: 500,
      seatLimit: 25,
      badge: 'SERVE THE NATION (₹0)',
      features: [
        'Zero license cost for Govt PHCs, CHCs & verified NGO clinics',
        'Up to 1,000 inter-hospital transfers / month across 25 clinicians',
        'Full QR + PIN, NEWS2 triage, and emergency ambulance tracking',
        'Funded by COLIN Tech commercial hospital license cross-subsidy'
      ]
    },
    {
      code: 'HOSPITAL_DISTRICT',
      name: 'District Hospital License',
      ownerType: 'hospital',
      monthlyPriceInr: 7999,
      yearlyPriceInr: 79990,
      monthlyPriceUsd: 99,
      monthlyTransferQuota: 1500,
      monthlySmsQuota: 2000,
      seatLimit: 30,
      badge: '10-30 DOCTORS',
      features: [
        '30 verified doctor & ER staff seats under one hospital license',
        '1,500 patient transfers / month (~350/week)',
        'Hospital command desk monitoring & SLA breach alerts',
        'Dedicated onboarding & NABH/ABDM-ready audit logs'
      ]
    },
    {
      code: 'HOSPITAL_MULTISPECIALTY',
      name: 'Multi-Specialty Enterprise License',
      ownerType: 'hospital',
      monthlyPriceInr: 19999,
      yearlyPriceInr: 199990,
      monthlyPriceUsd: 249,
      monthlyTransferQuota: -1,
      monthlySmsQuota: 10000,
      seatLimit: 150,
      badge: 'RECOMMENDED FOR HOSPITALS',
      features: [
        'Unlimited monthly transfers across up to 150 clinicians',
        'Real-time ambulance GPS fleet integration & dispatch SMS',
        'Custom hospital branding on QR Transfer Folios',
        '99.9% uptime SLA, dedicated cloud cluster & API webhooks'
      ]
    },
    {
      code: 'HOSPITAL_REGIONAL_GRID',
      name: 'Regional Hospital Network Grid (10+ Hospitals)',
      ownerType: 'hospital',
      monthlyPriceInr: 49999,
      yearlyPriceInr: 499990,
      monthlyPriceUsd: 599,
      monthlyTransferQuota: -1,
      monthlySmsQuota: 50000,
      seatLimit: 1000,
      badge: '10+ HOSPITAL NETWORK',
      features: [
        'Up to 1,000 clinicians across 10+ connected hospitals',
        'Unlimited inter-hospital emergency & routine transfers',
        'Cross-facility bed/department routing & analytics',
        'Sponsors 5 Rural Public Health Centers via Seva Grant'
      ]
    }
  ]
};

function findPlanDefinition(planCode) {
  return [...PLAN_CATALOG.doctorPlans, ...PLAN_CATALOG.hospitalLicenses].find(p => p.code === planCode) || null;
}

function getCurrentPeriodKey() {
  return new Date().toISOString().slice(0, 7);
}

async function ensurePeriodReset(sub) {
  const currentPeriod = getCurrentPeriodKey();
  if (!sub.usageThisMonth || sub.usageThisMonth.periodKey !== currentPeriod) {
    sub.usageThisMonth = {
      periodKey: currentPeriod,
      transfersCreated: 0,
      qrSessionsGenerated: 0,
      emergencySmsDispatched: 0,
      emergencyBypassesUsed: 0
    };
    await sub.save();
  }
  return sub;
}

async function getOrCreateEffectiveSubscription(user) {
  // 1. Check Hospital-level license first (covers all doctors in that hospital)
  if (user.hospitalName) {
    const hospitalSub = await Subscription.findOne({
      ownerType: 'hospital',
      hospitalName: new RegExp(`^${user.hospitalName.trim()}$`, 'i'),
      status: 'ACTIVE'
    });
    if (hospitalSub) {
      await ensurePeriodReset(hospitalSub);
      return { effectiveSubscription: hospitalSub, source: 'hospital_license' };
    }
  }

  // 2. Check Doctor-level subscription
  let doctorSub = await Subscription.findOne({
    ownerType: 'doctor',
    userId: user.userId || user._id
  });

  if (!doctorSub) {
    doctorSub = await Subscription.create({
      ownerType: 'doctor',
      userId: user.userId || user._id,
      hospitalName: user.hospitalName || '',
      planCode: 'DOCTOR_FREE',
      billingCycle: 'monthly',
      status: 'ACTIVE',
      monthlyTransferQuota: 25,
      monthlySmsQuota: 25,
      seatLimit: 1
    });
  } else {
    await ensurePeriodReset(doctorSub);
  }

  return { effectiveSubscription: doctorSub, source: 'doctor_subscription' };
}

async function recordTransferUsage(user, { isEmergency = false } = {}) {
  try {
    const { effectiveSubscription } = await getOrCreateEffectiveSubscription(user);
    effectiveSubscription.usageThisMonth.transfersCreated = (effectiveSubscription.usageThisMonth.transfersCreated || 0) + 1;
    const quota = effectiveSubscription.monthlyTransferQuota;
    if (quota > 0 && effectiveSubscription.usageThisMonth.transfersCreated > quota && isEmergency) {
      effectiveSubscription.usageThisMonth.emergencyBypassesUsed = (effectiveSubscription.usageThisMonth.emergencyBypassesUsed || 0) + 1;
    }
    await effectiveSubscription.save();
    return effectiveSubscription;
  } catch (err) {
    // Non-blocking for clinical safety
    return null;
  }
}

async function recordSmsUsage(user) {
  try {
    const { effectiveSubscription } = await getOrCreateEffectiveSubscription(user);
    effectiveSubscription.usageThisMonth.emergencySmsDispatched = (effectiveSubscription.usageThisMonth.emergencySmsDispatched || 0) + 1;
    await effectiveSubscription.save();
  } catch (err) {
    // Non-blocking
  }
}

exports.getPlans = (req, res) => {
  return res.status(200).json({
    success: true,
    company: 'COLIN Tech',
    product: 'MediFORM',
    ...PLAN_CATALOG
  });
};

exports.getSubscriptionStatus = async (req, res) => {
  try {
    const { effectiveSubscription, source } = await getOrCreateEffectiveSubscription(req.user);
    const planDef = findPlanDefinition(effectiveSubscription.planCode);
    const quota = effectiveSubscription.monthlyTransferQuota;
    const used = effectiveSubscription.usageThisMonth?.transfersCreated || 0;
    const remaining = quota === -1 ? 'UNLIMITED' : Math.max(0, quota - used);

    return res.status(200).json({
      success: true,
      source,
      subscription: effectiveSubscription,
      plan: planDef,
      quotaSummary: {
        monthlyTransferQuota: quota,
        transfersUsed: used,
        transfersRemaining: remaining,
        emergencyBypassAlwaysEnabled: true,
        smsUsed: effectiveSubscription.usageThisMonth?.emergencySmsDispatched || 0,
        monthlySmsQuota: effectiveSubscription.monthlySmsQuota
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

exports.subscribeDoctorPlan = async (req, res) => {
  try {
    const { planCode, billingCycle = 'monthly' } = req.body;
    const planDef = PLAN_CATALOG.doctorPlans.find(p => p.code === planCode);
    if (!planDef) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PLAN', message: 'Invalid doctor subscription plan selected.' }
      });
    }

    const durationDays = billingCycle === 'yearly' ? 365 : 30;
    const renewsAt = new Date(Date.now() + durationDays * 86400000);

    const sub = await Subscription.findOneAndUpdate(
      { ownerType: 'doctor', userId: req.user.userId },
      {
        $set: {
          ownerType: 'doctor',
          userId: req.user.userId,
          hospitalName: req.user.hospitalName || '',
          planCode: planDef.code,
          billingCycle,
          status: 'ACTIVE',
          monthlyTransferQuota: planDef.monthlyTransferQuota,
          monthlySmsQuota: planDef.monthlySmsQuota,
          seatLimit: planDef.seatLimit,
          renewsAt
        }
      },
      { upsert: true, new: true }
    );

    await AuditLog.create({
      action: 'DOCTOR_SUBSCRIPTION_UPDATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { planCode: planDef.code, billingCycle }
    });

    return res.status(200).json({
      success: true,
      message: `Activated ${planDef.name} (${billingCycle}).`,
      subscription: sub,
      plan: planDef
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

exports.activateHospitalLicense = async (req, res) => {
  try {
    const { planCode, hospitalName, billingCycle = 'yearly' } = req.body;
    const targetHospital = (hospitalName || req.user.hospitalName || '').trim();
    if (!targetHospital) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_HOSPITAL', message: 'Hospital name is required for institutional license.' }
      });
    }

    const planDef = PLAN_CATALOG.hospitalLicenses.find(p => p.code === planCode);
    if (!planDef) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PLAN', message: 'Invalid hospital license plan selected.' }
      });
    }

    const durationDays = billingCycle === 'yearly' ? 365 : 30;
    const renewsAt = new Date(Date.now() + durationDays * 86400000);

    const sub = await Subscription.findOneAndUpdate(
      { ownerType: 'hospital', hospitalName: new RegExp(`^${targetHospital}$`, 'i') },
      {
        $set: {
          ownerType: 'hospital',
          userId: req.user.userId,
          hospitalName: targetHospital,
          planCode: planDef.code,
          billingCycle: planDef.code === 'HOSPITAL_SEVA_PUBLIC' ? 'grant' : billingCycle,
          status: 'ACTIVE',
          monthlyTransferQuota: planDef.monthlyTransferQuota,
          monthlySmsQuota: planDef.monthlySmsQuota,
          seatLimit: planDef.seatLimit,
          renewsAt
        }
      },
      { upsert: true, new: true }
    );

    await AuditLog.create({
      action: 'HOSPITAL_LICENSE_ACTIVATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { hospitalName: targetHospital, planCode: planDef.code, billingCycle }
    });

    return res.status(200).json({
      success: true,
      message: `Activated ${planDef.name} for ${targetHospital}.`,
      subscription: sub,
      plan: planDef
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

exports.recordTransferUsage = recordTransferUsage;
exports.recordSmsUsage = recordSmsUsage;
exports.getOrCreateEffectiveSubscription = getOrCreateEffectiveSubscription;
