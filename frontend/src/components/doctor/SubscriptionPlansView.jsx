import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { Card, Button, Badge, Input } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { ShieldCheck, Building2, HeartHandshake, Zap } from 'lucide-react-native';

export function SubscriptionPlansView() {
  const { user } = useAuth();
  const [plans, setPlans] = useState({ doctorPlans: [], hospitalLicenses: [] });
  const [statusData, setStatusData] = useState(null);
  const [activeSegment, setActiveSegment] = useState('hospital'); // 'doctor' | 'hospital'
  const [billingCycle, setBillingCycle] = useState('monthly'); // 'monthly' | 'yearly'
  const [hospitalNameInput, setHospitalNameInput] = useState(user?.hospitalName || '');
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState(null);
  const [processingCode, setProcessingCode] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [plansRes, statusRes] = await Promise.all([
        api.getSubscriptionPlans(),
        api.getSubscriptionStatus()
      ]);
      setPlans({
        doctorPlans: plansRes.doctorPlans || [],
        hospitalLicenses: plansRes.hospitalLicenses || []
      });
      setStatusData(statusRes);
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Unable to load licensing plans.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubscribeDoctor = async (planCode) => {
    setProcessingCode(planCode);
    setActionMsg(null);
    try {
      const res = await api.subscribeDoctorPlan({ planCode, billingCycle });
      setActionMsg({ type: 'success', text: res.message || `Activated ${planCode}` });
      await loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to update subscription.' });
    } finally {
      setProcessingCode(null);
    }
  };

  const handleActivateHospital = async (planCode) => {
    setProcessingCode(planCode);
    setActionMsg(null);
    try {
      const res = await api.activateHospitalLicense({
        planCode,
        hospitalName: hospitalNameInput.trim() || user?.hospitalName,
        billingCycle
      });
      setActionMsg({ type: 'success', text: res.message || `Activated hospital license ${planCode}` });
      await loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to activate hospital license.' });
    } finally {
      setProcessingCode(null);
    }
  };

  const currentPlanCode = statusData?.subscription?.planCode || 'DOCTOR_FREE';
  const quota = statusData?.quotaSummary || {};

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* COLIN TECH Header */}
      <View style={styles.heroCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brandTag}>COLIN TECH • MEDIFORM ENTERPRISE</Text>
            <Text style={styles.heroTitle}>Subscriptions & Hospital Licensing</Text>
            <Text style={styles.heroSub}>
              Dual-engine model: Sustainable hospital & clinician revenue + Zero-cost National Seva Grant for rural & public clinics.
            </Text>
          </View>
          <Badge label="EMERGENCY BYPASS ALWAYS ON" variant="success" />
        </View>

        {statusData && (
          <View style={styles.usageStrip}>
            <View style={styles.usageItem}>
              <Text style={styles.usageLabel}>ACTIVE LICENSE / PLAN</Text>
              <Text style={styles.usageVal}>{statusData.plan?.name || currentPlanCode}</Text>
            </View>
            <View style={styles.usageItem}>
              <Text style={styles.usageLabel}>TRANSFERS THIS MONTH</Text>
              <Text style={styles.usageVal}>
                {quota.transfersUsed ?? 0} / {quota.monthlyTransferQuota === -1 ? 'Unlimited' : (quota.monthlyTransferQuota ?? 25)}
              </Text>
            </View>
            <View style={styles.usageItem}>
              <Text style={styles.usageLabel}>REMAINING QUOTA</Text>
              <Text style={styles.usageVal}>{quota.transfersRemaining ?? '—'}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Nation-Serving Cross-Subsidy Banner */}
      <View style={styles.sevaBanner}>
        <HeartHandshake size={20} color="#047857" style={{ marginRight: 10 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.sevaTitle}>COLIN Tech Hybrid Mission: Serve the Nation + Scale Sustainability</Text>
          <Text style={styles.sevaText}>
            Critical emergencies are NEVER blocked by plan limits. Every commercial Hospital License automatically sponsors 5 rural Public Health Centers (PHCs) on the ₹0 Seva Grant.
          </Text>
        </View>
      </View>

      {actionMsg && (
        <View style={[styles.msgBanner, actionMsg.type === 'error' ? styles.msgErr : styles.msgOk]}>
          <Text style={styles.msgText}>{actionMsg.text}</Text>
        </View>
      )}

      {/* Segment & Billing Toggle */}
      <View style={styles.controlsRow}>
        <View style={styles.segmentRow}>
          <TouchableOpacity
            onPress={() => setActiveSegment('hospital')}
            style={[styles.segBtn, activeSegment === 'hospital' && styles.segActive]}
          >
            <Building2 size={14} color={activeSegment === 'hospital' ? '#FFF' : COLORS.textPrimary} style={{ marginRight: 6 }} />
            <Text style={[styles.segText, activeSegment === 'hospital' && { color: '#FFF' }]}>Hospital Licenses</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveSegment('doctor')}
            style={[styles.segBtn, activeSegment === 'doctor' && styles.segActive]}
          >
            <Zap size={14} color={activeSegment === 'doctor' ? '#FFF' : COLORS.textPrimary} style={{ marginRight: 6 }} />
            <Text style={[styles.segText, activeSegment === 'doctor' && { color: '#FFF' }]}>Doctor Plans</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.cycleRow}>
          <TouchableOpacity
            onPress={() => setBillingCycle('monthly')}
            style={[styles.cycleBtn, billingCycle === 'monthly' && styles.cycleActive]}
          >
            <Text style={[styles.cycleText, billingCycle === 'monthly' && { color: '#FFF' }]}>Monthly</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBillingCycle('yearly')}
            style={[styles.cycleBtn, billingCycle === 'yearly' && styles.cycleActive]}
          >
            <Text style={[styles.cycleText, billingCycle === 'yearly' && { color: '#FFF' }]}>Yearly (2 Months Free)</Text>
          </TouchableOpacity>
        </View>
      </View>

      {activeSegment === 'hospital' && (
        <Card title="Hospital Facility Licensing" subtitle="One license covers all ER doctors, ambulances & audit trails for your facility">
          <Input
            label="Hospital / Network Name for License"
            value={hospitalNameInput}
            onChangeText={setHospitalNameInput}
            placeholder="e.g. Metropolitan Trauma Hospital"
          />
        </Card>
      )}

      {loading && <Text style={{ textAlign: 'center', color: COLORS.textSecondary, marginVertical: 20 }}>Loading COLIN Tech plans...</Text>}

      {/* Plan Cards */}
      <View style={styles.planGrid}>
        {(activeSegment === 'doctor' ? plans.doctorPlans : plans.hospitalLicenses).map((plan) => {
          const isCurrent = currentPlanCode === plan.code;
          const price = billingCycle === 'yearly' && plan.yearlyPriceInr !== undefined
            ? plan.yearlyPriceInr
            : plan.monthlyPriceInr;
          const isFree = price === 0;

          return (
            <Card
              key={plan.code}
              style={[
                styles.planCard,
                isCurrent && { borderColor: COLORS.primary, borderWidth: 2 }
              ]}
            >
              <View style={styles.planTop}>
                <Badge label={plan.badge || 'PLAN'} variant={isFree ? 'success' : 'info'} />
                {isCurrent && <Badge label="CURRENT" variant="warning" />}
              </View>

              <Text style={styles.planName}>{plan.name}</Text>

              <Text style={styles.planPrice}>
                {isFree ? '₹0 / Free' : `₹${price?.toLocaleString('en-IN')}`}
                {!isFree && <Text style={styles.planCycle}> / {billingCycle === 'yearly' ? 'year' : 'month'}</Text>}
              </Text>

              <Text style={styles.planQuota}>
                Quota: {plan.monthlyTransferQuota === -1 ? 'Unlimited Transfers' : `${plan.monthlyTransferQuota} transfers/mo`}
                {plan.seatLimit > 1 ? ` • Up to ${plan.seatLimit} clinicians` : ''}
              </Text>

              <View style={styles.featureList}>
                {(plan.features || []).map((f, idx) => (
                  <View key={idx} style={styles.featureRow}>
                    <ShieldCheck size={13} color={COLORS.success} style={{ marginRight: 6, marginTop: 2 }} />
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
              </View>

              <Button
                title={
                  processingCode === plan.code
                    ? 'Activating...'
                    : isCurrent
                      ? '✓ Active Plan'
                      : (activeSegment === 'hospital' ? 'Activate Hospital License' : 'Switch to This Plan')
                }
                onPress={() => activeSegment === 'hospital' ? handleActivateHospital(plan.code) : handleSubscribeDoctor(plan.code)}
                disabled={isCurrent || !!processingCode}
                variant={isCurrent ? 'outline' : 'primary'}
              />
            </Card>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxWidth: 960,
    alignSelf: 'center',
    width: '100%',
  },
  heroCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
  },
  brandTag: {
    fontSize: 10,
    fontWeight: '900',
    color: '#38BDF8',
    letterSpacing: 1,
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  heroSub: {
    fontSize: 12,
    color: '#CBD5E1',
    marginTop: 4,
    lineHeight: 17,
  },
  usageStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  usageItem: {
    flex: 1,
    minWidth: 140,
  },
  usageLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
  },
  usageVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  sevaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  sevaTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  sevaText: {
    fontSize: 12,
    color: '#047857',
    marginTop: 2,
    lineHeight: 16,
  },
  msgBanner: {
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  msgOk: { backgroundColor: '#DCFCE7' },
  msgErr: { backgroundColor: '#FEE2E2' },
  msgText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: '#FFF',
  },
  segActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  segText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  cycleRow: {
    flexDirection: 'row',
    gap: 6,
  },
  cycleBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#FFF',
  },
  cycleActive: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  cycleText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  planGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  planCard: {
    flex: 1,
    minWidth: 260,
  },
  planTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  planName: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.textPrimary,
  },
  planPrice: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.primary,
    marginTop: 4,
  },
  planCycle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  planQuota: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.secondary,
    marginTop: 4,
    marginBottom: 10,
  },
  featureList: {
    marginBottom: 14,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  featureText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textPrimary,
    lineHeight: 16,
  }
});
