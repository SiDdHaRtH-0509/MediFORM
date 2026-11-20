import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal
} from 'react-native';
import { COLORS } from '../../constants/theme';
import api from '../../services/api';

export function DoctorMonitoringView({ onSelectReferral }) {
  const [alerts, setAlerts] = useState([]);
  const [summary, setSummary] = useState({
    totalActiveAlerts: 0,
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    recentlyResolvedCount: 0
  });
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Filters
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Dismiss modal state
  const [dismissModalVisible, setDismissModalVisible] = useState(false);
  const [targetAlert, setTargetAlert] = useState(null);
  const [dismissReason, setDismissReason] = useState('');
  const [dismissSubmitting, setDismissSubmitting] = useState(false);

  useEffect(() => {
    loadAlerts();
  }, [severityFilter, statusFilter, categoryFilter]);

  const loadAlerts = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (severityFilter !== 'ALL') params.append('severity', severityFilter);
      if (categoryFilter !== 'ALL') params.append('category', categoryFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await api.getMonitoringAlerts(params.toString());
      if (res && res.success) {
        setAlerts(res.alerts || []);
        if (res.summary) setSummary(res.summary);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to retrieve clinical monitoring alerts.');
    } finally {
      setLoading(false);
    }
  };

  const handleScanNow = async () => {
    setScanning(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await api.triggerMonitoringScan();
      if (res && res.success) {
        setSuccessMessage(`Monitoring scan complete: ${res.stats?.scannedCount || 0} referrals inspected, ${res.stats?.activeAlertsCount || 0} active alerts.`);
        loadAlerts();
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to execute monitoring scan.');
    } finally {
      setScanning(false);
    }
  };

  const handleOpenDismissModal = (alert) => {
    setTargetAlert(alert);
    setDismissReason('');
    setDismissModalVisible(true);
  };

  const handleConfirmDismiss = async () => {
    if (!targetAlert) return;
    setDismissSubmitting(true);
    try {
      const res = await api.dismissMonitoringAlert(targetAlert.alertId, { reason: dismissReason.trim() });
      if (res && res.success) {
        setDismissModalVisible(false);
        setSuccessMessage(`Alert ${targetAlert.alertId} dismissed successfully.`);
        loadAlerts();
      }
    } catch (err) {
      setErrorMessage(err.message || 'Error dismissing alert.');
    } finally {
      setDismissSubmitting(false);
    }
  };

  const getSeverityBadgeStyle = (sev) => {
    switch (sev) {
      case 'CRITICAL':
        return { bg: '#FFEBEE', text: '#C62828', border: '#EF9A9A' };
      case 'HIGH':
        return { bg: '#FFF3E0', text: '#E65100', border: '#FFCC80' };
      case 'MEDIUM':
        return { bg: '#FFFDE7', text: '#F57F17', border: '#FFF59D' };
      case 'LOW':
        return { bg: '#E3F2FD', text: '#1565C0', border: '#90CAF9' };
      default:
        return { bg: '#F5F5F5', text: '#616161', border: '#E0E0E0' };
    }
  };

  return (
    <ScrollView style={styles.container}>
      {/* Header Banner */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Clinical Handoff Monitoring & Risk Detection</Text>
          <Text style={styles.subtitle}>
            Deterministic clinical rule engine for delayed handoffs, stalled workflows, and care closure risks.
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.scanButton, scanning && { opacity: 0.7 }]}
          onPress={handleScanNow}
          disabled={scanning}
        >
          {scanning ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.scanButtonText}>Scan Workflows</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Notifications / Alerts */}
      {errorMessage && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}
      {successMessage && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
      )}

      {/* KPI Overview Cards */}
      <View style={styles.kpiContainer}>
        <View style={[styles.kpiCard, { borderLeftColor: '#455A64' }]}>
          <Text style={styles.kpiLabel}>ACTIVE ALERTS</Text>
          <Text style={[styles.kpiValue, { color: '#37474F' }]}>{summary.totalActiveAlerts}</Text>
        </View>
        <View style={[styles.kpiCard, { borderLeftColor: '#C62828' }]}>
          <Text style={styles.kpiLabel}>CRITICAL</Text>
          <Text style={[styles.kpiValue, { color: '#C62828' }]}>{summary.criticalCount}</Text>
        </View>
        <View style={[styles.kpiCard, { borderLeftColor: '#E65100' }]}>
          <Text style={styles.kpiLabel}>HIGH RISK</Text>
          <Text style={[styles.kpiValue, { color: '#E65100' }]}>{summary.highCount}</Text>
        </View>
        <View style={[styles.kpiCard, { borderLeftColor: '#F57F17' }]}>
          <Text style={styles.kpiLabel}>MEDIUM / LOW</Text>
          <Text style={[styles.kpiValue, { color: '#F57F17' }]}>{summary.mediumCount + summary.lowCount}</Text>
        </View>
        <View style={[styles.kpiCard, { borderLeftColor: '#2E7D32' }]}>
          <Text style={styles.kpiLabel}>RECENTLY RESOLVED</Text>
          <Text style={[styles.kpiValue, { color: '#2E7D32' }]}>{summary.recentlyResolvedCount}</Text>
        </View>
      </View>

      {/* Search & Severity Filters */}
      <View style={styles.filterSection}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by Referral ID, Patient, Doctor or Finding..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={loadAlerts}
          />
          <TouchableOpacity style={styles.searchButton} onPress={loadAlerts}>
            <Text style={styles.searchButtonText}>Search</Text>
          </TouchableOpacity>
        </View>

        {/* Severity Chips */}
        <View style={styles.chipRow}>
          <Text style={styles.filterGroupLabel}>Severity:</Text>
          {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((sev) => (
            <TouchableOpacity
              key={sev}
              style={[
                styles.chip,
                severityFilter === sev && styles.chipActive
              ]}
              onPress={() => setSeverityFilter(sev)}
            >
              <Text
                style={[
                  styles.chipText,
                  severityFilter === sev && styles.chipTextActive
                ]}
              >
                {sev}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Category Chips */}
        <View style={styles.chipRow}>
          <Text style={styles.filterGroupLabel}>Category:</Text>
          {[
            { id: 'ALL', label: 'All' },
            { id: 'ASSIGNMENT_DELAY', label: 'Assignment' },
            { id: 'ACKNOWLEDGEMENT_DELAY', label: 'Acknowledgement' },
            { id: 'REJECTION_UNASSIGNED', label: 'Rejected / Unassigned' },
            { id: 'INCOMPLETE_CLINICAL_WORKFLOW', label: 'Incomplete' },
            { id: 'FOLLOW_UP_RISK', label: 'Follow-Up' },
            { id: 'STALLED_WORKFLOW', label: 'Stalled' }
          ].map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.chip,
                categoryFilter === cat.id && styles.chipActive
              ]}
              onPress={() => setCategoryFilter(cat.id)}
            >
              <Text
                style={[
                  styles.chipText,
                  categoryFilter === cat.id && styles.chipTextActive
                ]}
              >
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Alerts Feed */}
      {loading ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary || '#0284c7'} />
          <Text style={{ marginTop: 12, color: '#64748b' }}>Analyzing clinical referral workflows...</Text>
        </View>
      ) : alerts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Clinical Workflow Alerts</Text>
          <Text style={styles.emptySubtitle}>
            All tracked handoffs are progressing within normal clinical thresholds.
          </Text>
        </View>
      ) : (
        <View style={styles.alertList}>
          {alerts.map((alt) => {
            const badge = getSeverityBadgeStyle(alt.riskClassification);
            return (
              <View key={alt.alertId} style={[styles.alertCard, { borderLeftColor: badge.text }]}>
                <View style={styles.alertHeaderRow}>
                  <View style={[styles.severityPill, { backgroundColor: badge.bg, borderColor: badge.border }]}>
                    <Text style={[styles.severityPillText, { color: badge.text }]}>
                      {alt.riskClassification} RISK
                    </Text>
                  </View>
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryBadgeText}>
                      {alt.riskCategory.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <Text style={styles.alertIdText}>{alt.alertId}</Text>
                  {alt.resolutionStatus !== 'ACTIVE' && (
                    <View style={[styles.statusTag, alt.resolutionStatus === 'RESOLVED' ? styles.statusResolved : styles.statusDismissed]}>
                      <Text style={styles.statusTagText}>{alt.resolutionStatus}</Text>
                    </View>
                  )}
                </View>

                {/* Plain-Language Explanation */}
                <Text style={styles.explanationText}>
                  {alt.plainLanguageExplanation}
                </Text>

                {/* Evidence Drawer */}
                {alt.evidence && (
                  <View style={styles.evidenceBox}>
                    <Text style={styles.evidenceTitle}>Clinical Finding Evidence:</Text>
                    <Text style={styles.evidenceText}>
                      Elapsed: {alt.evidence.elapsedHours ? `${alt.evidence.elapsedHours} hours` : 'N/A'} (Threshold: {alt.evidence.thresholdHours || 'N/A'}h)
                      {alt.evidence.assignedDoctor ? ` | Assigned To: ${alt.evidence.assignedDoctor}` : ''}
                      {alt.evidence.rejectionReason ? ` | Reason: ${alt.evidence.rejectionReason}` : ''}
                      {alt.evidence.minsPastDue ? ` | Past due by ${alt.evidence.minsPastDue} mins` : ''}
                    </Text>
                  </View>
                )}

                {/* Recommended Next Action */}
                <View style={styles.recommendedBox}>
                  <Text style={styles.recommendedTitle}>Recommended Action:</Text>
                  <Text style={styles.recommendedText}>{alt.recommendedAction}</Text>
                </View>

                {/* Card Footer */}
                <View style={styles.cardFooter}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.footerMeta}>Referral: {alt.referralId} | Patient: {alt.patientId || 'Unlinked'}</Text>
                    <Text style={styles.footerMeta}>Responsible: Dr. {alt.responsibleDoctorName || 'Pending'}</Text>
                  </View>
                  {alt.resolutionStatus === 'ACTIVE' && (
                    <TouchableOpacity
                      style={styles.dismissButton}
                      onPress={() => handleOpenDismissModal(alt)}
                    >
                      <Text style={styles.dismissButtonText}>Dismiss Alert</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Dismiss Alert Modal */}
      <Modal
        visible={dismissModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDismissModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Dismiss Workflow Alert</Text>
            <Text style={styles.modalSubtitle}>
              Document the clinical rationale for dismissing {targetAlert?.alertId}:
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Bed confirmed via phone; clinical delay verified by attending physician"
              value={dismissReason}
              onChangeText={setDismissReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setDismissModalVisible(false)}
                disabled={dismissSubmitting}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={handleConfirmDismiss}
                disabled={dismissSubmitting}
              >
                {dismissSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmButtonText}>Confirm Dismiss</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 16
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A'
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4
  },
  scanButton: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8
  },
  scanButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14
  },
  kpiContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16
  },
  kpiCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 8,
    borderLeftWidth: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4
  },
  filterSection: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    elevation: 1
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14
  },
  searchButton: {
    backgroundColor: '#334155',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 6
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 8
  },
  filterGroupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginRight: 4
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F1F5F9'
  },
  chipActive: {
    backgroundColor: '#0284C7'
  },
  chipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500'
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600'
  },
  alertList: {
    gap: 12,
    paddingBottom: 40
  },
  alertCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 5,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10
  },
  severityPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1
  },
  severityPillText: {
    fontSize: 11,
    fontWeight: '800'
  },
  categoryBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155'
  },
  alertIdText: {
    fontSize: 12,
    color: '#94A3B8',
    fontFamily: 'monospace'
  },
  statusTag: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4
  },
  statusResolved: {
    backgroundColor: '#DCFCE7'
  },
  statusDismissed: {
    backgroundColor: '#F3F4F6'
  },
  statusTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534'
  },
  explanationText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    lineHeight: 22,
    marginBottom: 10
  },
  evidenceBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#94A3B8',
    marginBottom: 10
  },
  evidenceTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 2
  },
  evidenceText: {
    fontSize: 12,
    color: '#334155'
  },
  recommendedBox: {
    backgroundColor: '#EFF6FF',
    padding: 10,
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
    marginBottom: 12
  },
  recommendedTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
    marginBottom: 2
  },
  recommendedText: {
    fontSize: 13,
    color: '#1E40AF',
    fontWeight: '500'
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10
  },
  footerMeta: {
    fontSize: 12,
    color: '#64748B'
  },
  dismissButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1'
  },
  dismissButtonText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600'
  },
  emptyState: {
    backgroundColor: '#fff',
    padding: 40,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A'
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 6,
    textAlign: 'center'
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 6,
    marginBottom: 12
  },
  errorText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '500'
  },
  successBanner: {
    backgroundColor: '#DCFCE7',
    padding: 12,
    borderRadius: 6,
    marginBottom: 12
  },
  successText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '500'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    width: '100%',
    maxWidth: 480
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A'
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 6,
    marginBottom: 12
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10
  },
  modalCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#F1F5F9'
  },
  modalCancelButtonText: {
    color: '#475569',
    fontWeight: '600'
  },
  modalConfirmButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#0284C7'
  },
  modalConfirmButtonText: {
    color: '#fff',
    fontWeight: '600'
  }
});
