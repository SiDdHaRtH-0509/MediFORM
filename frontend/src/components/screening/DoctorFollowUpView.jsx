import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { Card, Button, Input, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';

export function DoctorFollowUpView() {
  const [followUps, setFollowUps] = useState([]);
  const [summary, setSummary] = useState({ upcomingCount: 0, overdueCount: 0, missedCount: 0, completedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'upcoming' | 'overdue' | 'missed' | 'completed'
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Modals
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleReferralId, setScheduleReferralId] = useState('');
  const [scheduleDueDate, setScheduleDueDate] = useState('');
  const [scheduleInstructions, setScheduleInstructions] = useState('');
  const [schedulePriority, setSchedulePriority] = useState('Routine');
  const [submittingSchedule, setSubmittingSchedule] = useState(false);

  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [targetFollowUp, setTargetFollowUp] = useState(null);
  const [newDueDate, setNewDueDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [submittingReschedule, setSubmittingReschedule] = useState(false);

  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeTargetFollowUp, setCompleteTargetFollowUp] = useState(null);
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [treatmentSummary, setTreatmentSummary] = useState('');
  const [submittingComplete, setSubmittingComplete] = useState(false);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTargetFollowUp, setCancelTargetFollowUp] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [submittingCancel, setSubmittingCancel] = useState(false);

  useEffect(() => {
    loadFollowUps();
  }, [filter]);

  const loadFollowUps = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const queryParam = filter !== 'all' ? `filter=${filter}` : '';
      const res = await api.getFollowUps(queryParam);
      setFollowUps(res.followUps || []);
      if (res.summary) {
        setSummary(res.summary);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Error loading follow-up appointments.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFollowUp = async () => {
    if (!scheduleReferralId || !scheduleDueDate) {
      setErrorMsg('Referral ID and Due Date are required.');
      return;
    }
    setSubmittingSchedule(true);
    setErrorMsg(null);
    try {
      await api.createFollowUp({
        referralId: scheduleReferralId.trim(),
        dueDate: new Date(scheduleDueDate).toISOString(),
        instructions: scheduleInstructions.trim(),
        priority: schedulePriority
      });
      setShowScheduleModal(false);
      setScheduleReferralId('');
      setScheduleDueDate('');
      setScheduleInstructions('');
      setSuccessMsg('Follow-up scheduled successfully.');
      setTimeout(() => setSuccessMsg(null), 4000);
      loadFollowUps();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to schedule follow-up.');
    } finally {
      setSubmittingSchedule(false);
    }
  };

  const handleReschedule = async () => {
    if (!newDueDate || !rescheduleReason) {
      setErrorMsg('New due date and mandatory clinical reason are required.');
      return;
    }
    setSubmittingReschedule(true);
    setErrorMsg(null);
    try {
      await api.rescheduleFollowUp(targetFollowUp.followUpId, {
        newDueDate: new Date(newDueDate).toISOString(),
        reason: rescheduleReason.trim()
      });
      setShowRescheduleModal(false);
      setTargetFollowUp(null);
      setNewDueDate('');
      setRescheduleReason('');
      setSuccessMsg('Follow-up successfully rescheduled.');
      setTimeout(() => setSuccessMsg(null), 4000);
      loadFollowUps();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to reschedule follow-up.');
    } finally {
      setSubmittingReschedule(false);
    }
  };

  const handleComplete = async () => {
    setSubmittingComplete(true);
    setErrorMsg(null);
    try {
      await api.completeFollowUp(completeTargetFollowUp.followUpId, {
        outcomeNotes: outcomeNotes.trim(),
        treatmentSummary: treatmentSummary.trim()
      });
      setShowCompleteModal(false);
      setCompleteTargetFollowUp(null);
      setOutcomeNotes('');
      setTreatmentSummary('');
      setSuccessMsg('Follow-up care documented and marked completed.');
      setTimeout(() => setSuccessMsg(null), 4000);
      loadFollowUps();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to complete follow-up.');
    } finally {
      setSubmittingComplete(false);
    }
  };

  const handleCancel = async () => {
    setSubmittingCancel(true);
    setErrorMsg(null);
    try {
      await api.cancelFollowUp(cancelTargetFollowUp.followUpId, {
        reason: cancelReason.trim()
      });
      setShowCancelModal(false);
      setCancelTargetFollowUp(null);
      setCancelReason('');
      setSuccessMsg('Follow-up appointment cancelled.');
      setTimeout(() => setSuccessMsg(null), 4000);
      loadFollowUps();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to cancel follow-up.');
    } finally {
      setSubmittingCancel(false);
    }
  };

  const handleRecordAttendance = async (followUpId) => {
    try {
      await api.recordFollowUpAttendance(followUpId, { attended: true, notes: 'Patient arrived at clinic' });
      setSuccessMsg('Attendance check-in recorded.');
      setTimeout(() => setSuccessMsg(null), 3000);
      loadFollowUps();
    } catch (err) {
      setErrorMsg(err.message || 'Error recording attendance.');
    }
  };

  const filteredList = followUps.filter(f => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (f.followUpId && f.followUpId.toLowerCase().includes(q)) ||
      (f.referralId && f.referralId.toLowerCase().includes(q)) ||
      (f.patientId && f.patientId.toLowerCase().includes(q))
    );
  });

  const getStatusBadgeVariant = (st) => {
    switch (st) {
      case 'DUE':
        return 'warning';
      case 'OVERDUE':
        return 'danger';
      case 'MISSED':
        return 'danger';
      case 'COMPLETED':
        return 'success';
      case 'CANCELLED':
        return 'outline';
      case 'UPCOMING':
        return 'primary';
      default:
        return 'secondary';
    }
  };

  return (
    <ScrollView style={styles.container}>
      {/* Header & KPI Summary */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Follow-Up & Missed Appointment Management</Text>
          <Text style={styles.subtitle}>Track upcoming consultations, detect overdue care, and prevent patient drop-off.</Text>
        </View>
        <Button
          title="+ Schedule Follow-Up"
          onPress={() => {
            const defaultDate = new Date(Date.now() + 86400000 * 3);
            setScheduleDueDate(defaultDate.toISOString().slice(0, 16));
            setShowScheduleModal(true);
          }}
          size="small"
        />
      </View>

      {/* KPI Count Badges */}
      <View style={styles.kpiRow}>
        <TouchableOpacity onPress={() => setFilter('upcoming')} style={[styles.kpiCard, filter === 'upcoming' && styles.kpiActive]}>
          <Text style={styles.kpiValue}>{summary.upcomingCount}</Text>
          <Text style={styles.kpiLabel}>Upcoming / Due</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter('overdue')} style={[styles.kpiCard, filter === 'overdue' && styles.kpiActive]}>
          <Text style={[styles.kpiValue, { color: COLORS.danger }]}>{summary.overdueCount}</Text>
          <Text style={styles.kpiLabel}>Overdue</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter('missed')} style={[styles.kpiCard, filter === 'missed' && styles.kpiActive]}>
          <Text style={[styles.kpiValue, { color: '#E65100' }]}>{summary.missedCount}</Text>
          <Text style={styles.kpiLabel}>Missed Visits</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter('completed')} style={[styles.kpiCard, filter === 'completed' && styles.kpiActive]}>
          <Text style={[styles.kpiValue, { color: COLORS.success }]}>{summary.completedCount}</Text>
          <Text style={styles.kpiLabel}>Completed</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Chips & Search */}
      <View style={styles.controlsRow}>
        <View style={styles.chipGroup}>
          {['all', 'upcoming', 'overdue', 'missed', 'completed'].map(f => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, filter === f && { color: '#FFF', fontWeight: 'bold' }]}>
                {f.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ width: 220 }}>
          <Input
            placeholder="Search PID / Ref ID..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {/* Alert Messages */}
      {errorMsg && (
        <View style={styles.alertError}>
          <Text style={styles.alertErrorText}>⚠️ {errorMsg}</Text>
        </View>
      )}
      {successMsg && (
        <View style={styles.alertSuccess}>
          <Text style={styles.alertSuccessText}>✓ {successMsg}</Text>
        </View>
      )}

      {/* List of Follow-Ups */}
      {loading ? (
        <Text style={styles.loadingText}>Loading follow-up records...</Text>
      ) : filteredList.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No Follow-Up Appointments Found</Text>
          <Text style={styles.emptySubtitle}>All patients are currently attended to or no records match your filter.</Text>
        </View>
      ) : (
        filteredList.map(item => (
          <Card key={item.followUpId || item._id} style={styles.cardItem}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardFollowUpId}>{item.followUpId}</Text>
                <Text style={styles.cardReferralLink}>Referral: {item.referralId} • Patient: <Text style={{ fontWeight: 'bold' }}>{item.patientId}</Text></Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Badge text={item.status} variant={getStatusBadgeVariant(item.status)} />
                <Badge text={item.priority || 'Routine'} variant={item.priority === 'Emergency' ? 'danger' : 'outline'} />
              </View>
            </View>

            <View style={styles.cardDetails}>
              <Text style={styles.detailLine}>
                📅 <Text style={styles.detailBold}>Due Date:</Text> {new Date(item.dueDate).toLocaleString()}
              </Text>
              <Text style={styles.detailLine}>
                🏥 <Text style={styles.detailBold}>Center:</Text> {item.targetHospital || 'Main Center'} ({item.targetDepartment || 'General'})
              </Text>
              {item.instructions ? (
                <Text style={styles.detailLine}>
                  📝 <Text style={styles.detailBold}>Instructions:</Text> {item.instructions}
                </Text>
              ) : null}
              {item.attendance?.attended && (
                <Text style={[styles.detailLine, { color: COLORS.success, fontWeight: 'bold' }]}>
                  ✓ Patient Attendance Recorded ({item.attendance.confirmedBy})
                </Text>
              )}
              {item.status === 'MISSED' && (
                <View style={styles.missedNotice}>
                  <Text style={styles.missedNoticeText}>
                    ⚠️ Patient missed this follow-up. Review clinical priority and reschedule below.
                  </Text>
                </View>
              )}
            </View>

            {/* Action Buttons for Doctor */}
            {item.status !== 'COMPLETED' && item.status !== 'CANCELLED' && (
              <View style={styles.cardActions}>
                {!item.attendance?.attended && (
                  <Button
                    title="Check-In"
                    onPress={() => handleRecordAttendance(item.followUpId)}
                    variant="outline"
                    size="small"
                  />
                )}
                <Button
                  title="Reschedule"
                  onPress={() => {
                    setTargetFollowUp(item);
                    const defDate = new Date(Date.now() + 86400000 * 2);
                    setNewDueDate(defDate.toISOString().slice(0, 16));
                    setShowRescheduleModal(true);
                  }}
                  variant="outline"
                  size="small"
                />
                <Button
                  title="Complete Care"
                  onPress={() => {
                    setCompleteTargetFollowUp(item);
                    setShowCompleteModal(true);
                  }}
                  variant="primary"
                  size="small"
                />
                <Button
                  title="Cancel"
                  onPress={() => {
                    setCancelTargetFollowUp(item);
                    setShowCancelModal(true);
                  }}
                  variant="secondary"
                  size="small"
                />
              </View>
            )}
          </Card>
        ))
      )}

      {/* SCHEDULE MODAL */}
      <Modal visible={showScheduleModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Schedule Follow-Up Appointment</Text>
            <Input label="Referral ID" placeholder="e.g. REF-2026-123456" value={scheduleReferralId} onChangeText={setScheduleReferralId} />
            <Input label="Due Date and Time (YYYY-MM-DDTHH:MM)" placeholder="2026-11-25T10:00" value={scheduleDueDate} onChangeText={setScheduleDueDate} />
            <Input label="Clinical Guidance / Instructions" placeholder="e.g. Suture check and repeat renal panel" value={scheduleInstructions} onChangeText={setScheduleInstructions} multiline />
            <View style={styles.modalButtonRow}>
              <Button title="Cancel" onPress={() => setShowScheduleModal(false)} variant="outline" />
              <Button title={submittingSchedule ? 'Scheduling...' : 'Confirm Schedule'} onPress={handleCreateFollowUp} disabled={submittingSchedule} />
            </View>
          </View>
        </View>
      </Modal>

      {/* RESCHEDULE MODAL */}
      <Modal visible={showRescheduleModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Reschedule Follow-Up ({targetFollowUp?.followUpId})</Text>
            <Input label="New Due Date and Time (YYYY-MM-DDTHH:MM)" placeholder="2026-11-28T14:00" value={newDueDate} onChangeText={setNewDueDate} />
            <Input label="Clinical / Logistical Reason (Mandatory)" placeholder="e.g. Patient hospitalized; delayed wound review" value={rescheduleReason} onChangeText={setRescheduleReason} multiline />
            <View style={styles.modalButtonRow}>
              <Button title="Cancel" onPress={() => setShowRescheduleModal(false)} variant="outline" />
              <Button title={submittingReschedule ? 'Rescheduling...' : 'Confirm Reschedule'} onPress={handleReschedule} disabled={submittingReschedule} />
            </View>
          </View>
        </View>
      </Modal>

      {/* COMPLETE MODAL */}
      <Modal visible={showCompleteModal} transparent animationType="fade">
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>Document & Complete Follow-Up</Text>
          <Input label="Clinical Outcome Notes" placeholder="e.g. Wound clean, healing by primary intention. Suture removed." value={outcomeNotes} onChangeText={setOutcomeNotes} multiline />
          <Input label="Treatment Summary" placeholder="e.g. Follow-up consultation completed. Discharged to routine care." value={treatmentSummary} onChangeText={setTreatmentSummary} multiline />
          <View style={styles.modalButtonRow}>
            <Button title="Cancel" onPress={() => setShowCompleteModal(false)} variant="outline" />
            <Button title={submittingComplete ? 'Completing...' : 'Mark Completed'} onPress={handleComplete} disabled={submittingComplete} />
          </View>
        </View>
      </Modal>

      {/* CANCEL MODAL */}
      <Modal visible={showCancelModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Cancel Follow-Up Appointment</Text>
            <Input label="Reason for Cancellation" placeholder="e.g. Patient moved to tertiary care" value={cancelReason} onChangeText={setCancelReason} multiline />
            <View style={styles.modalButtonRow}>
              <Button title="Close" onPress={() => setShowCancelModal(false)} variant="outline" />
              <Button title={submittingCancel ? 'Cancelling...' : 'Confirm Cancel'} onPress={handleCancel} disabled={submittingCancel} variant="danger" />
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
    padding: 16,
    backgroundColor: '#F8FAFC'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0F172A'
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center'
  },
  kpiActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#EFF6FF'
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1E293B'
  },
  kpiLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
    fontWeight: '600'
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  chipGroup: {
    flexDirection: 'row',
    gap: 6
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#E2E8F0'
  },
  filterChipActive: {
    backgroundColor: COLORS.primary
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569'
  },
  cardItem: {
    marginBottom: 12,
    padding: 14
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  cardFollowUpId: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#0F172A'
  },
  cardReferralLink: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
  },
  cardDetails: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
    gap: 4
  },
  detailLine: {
    fontSize: 13,
    color: '#334155'
  },
  detailBold: {
    fontWeight: '600',
    color: '#0F172A'
  },
  missedNotice: {
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.danger,
    padding: 8,
    borderRadius: 4,
    marginTop: 4
  },
  missedNoticeText: {
    fontSize: 12,
    color: '#991B1B',
    fontWeight: '500'
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
    justifyContent: 'flex-end'
  },
  loadingText: {
    textAlign: 'center',
    padding: 24,
    color: '#64748B'
  },
  emptyBox: {
    backgroundColor: '#FFF',
    padding: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center'
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1E293B'
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4
  },
  alertError: {
    backgroundColor: '#FEE2E2',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12
  },
  alertErrorText: {
    color: '#991B1B',
    fontSize: 13
  },
  alertSuccess: {
    backgroundColor: '#DCFCE7',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12
  },
  alertSuccessText: {
    color: '#166534',
    fontSize: 13
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  modalBox: {
    backgroundColor: '#FFF',
    width: '100%',
    maxWidth: 480,
    borderRadius: 12,
    padding: 20,
    gap: 12
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#0F172A',
    marginBottom: 6
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8
  }
});
