import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { Card, Button, Input, Badge, AlertCard } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { calculateNEWS2 } from '../../utils/clinicalDecisionSupport';

export function ScreeningReferralView({ onShowQR, onSelectTransfer }) {
  const [activeTab, setActiveTab] = useState('flagged'); // 'flagged' | 'all' | 'referrals' | 'new_screening'
  const [referralViewFilter, setReferralViewFilter] = useState('incoming'); // 'incoming' | 'my_assigned' | 'unassigned' | 'urgent' | 'all'
  const [screenings, setScreenings] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [doctorsDirectory, setDoctorsDirectory] = useState([]);
  const [doctorSearchQuery, setDoctorSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Referral Creation Modal State
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [targetScreening, setTargetScreening] = useState(null);
  const [clinicalReason, setClinicalReason] = useState('');
  const [priority, setPriority] = useState('Urgent');
  const [selectedReceivingDoctor, setSelectedReceivingDoctor] = useState(null);
  const [receivingHospital, setReceivingHospital] = useState('');
  const [receivingDepartment, setReceivingDepartment] = useState('Emergency / Triage');
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [duplicateReason, setDuplicateReason] = useState('');
  const [submittingReferral, setSubmittingReferral] = useState(false);
  const [referralError, setReferralError] = useState(null);

  // Referral Reassignment Modal State
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [targetReferralForReassign, setTargetReferralForReassign] = useState(null);
  const [newReceivingDoctor, setNewReceivingDoctor] = useState(null);
  const [reassignReason, setReassignReason] = useState('');
  const [reassignDepartment, setReassignDepartment] = useState('');
  const [reassignSearchQuery, setReassignSearchQuery] = useState('');
  const [submittingReassign, setSubmittingReassign] = useState(false);
  const [reassignError, setReassignError] = useState(null);

  // Referral History Modal State
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedReferralHistory, setSelectedReferralHistory] = useState(null);

  // Referral Lifecycle (Phase 3) Modals & State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectTargetRef, setRejectTargetRef] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [submittingReject, setSubmittingReject] = useState(false);

  const [showTreatmentModal, setShowTreatmentModal] = useState(false);
  const [treatmentTargetRef, setTreatmentTargetRef] = useState(null);
  const [treatmentSummary, setTreatmentSummary] = useState('');
  const [clinicalObservations, setClinicalObservations] = useState('');
  const [proceduresPerformed, setProceduresPerformed] = useState('');
  const [medicationsAdministered, setMedicationsAdministered] = useState('');
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpInstructions, setFollowUpInstructions] = useState('');
  const [submittingTreatment, setSubmittingTreatment] = useState(false);

  const [showCareConfirmModal, setShowCareConfirmModal] = useState(false);
  const [careConfirmTargetRef, setCareConfirmTargetRef] = useState(null);
  const [confirmationSummary, setConfirmationSummary] = useState('');
  const [followUpAddressed, setFollowUpAddressed] = useState(false);
  const [followUpPlan, setFollowUpPlan] = useState('');
  const [submittingCareConfirm, setSubmittingCareConfirm] = useState(false);

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeTargetRef, setCloseTargetRef] = useState(null);
  const [closureNotes, setClosureNotes] = useState('');
  const [submittingClose, setSubmittingClose] = useState(false);

  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [selectedTimelineRef, setSelectedTimelineRef] = useState(null);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // New Screening Intake Form State
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Male');
  const [bloodGroup, setBloodGroup] = useState('O+');
  const [vitals, setVitals] = useState({ hr: null, bp: '', rr: null, spo2: null, temp: null, gcs: null });
  const [labName, setLabName] = useState('');
  const [labStatus, setLabStatus] = useState('Pending');
  const [labNotes, setLabNotes] = useState('');
  const [investigations, setInvestigations] = useState([]);
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [patientConsent, setPatientConsent] = useState(true);
  const [recordingScreening, setRecordingScreening] = useState(false);

  useEffect(() => {
    loadData();
    loadDoctors();
  }, [activeTab, referralViewFilter]);

  const loadDoctors = async (search = '') => {
    try {
      const res = await api.getDoctorsDirectory(search ? `search=${encodeURIComponent(search)}` : '');
      setDoctorsDirectory(res.doctors || []);
    } catch (err) {
      console.warn('Unable to load doctor directory:', err.message);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      if (activeTab === 'flagged') {
        const res = await api.getFlaggedScreenings();
        setScreenings(res.screenings || []);
      } else if (activeTab === 'all') {
        const res = await api.getScreenings();
        setScreenings(res.screenings || []);
      } else if (activeTab === 'referrals') {
        const param = referralViewFilter === 'all' ? '' : `view=${referralViewFilter}`;
        const res = await api.getReferrals(param);
        setReferrals(res.referrals || []);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Error loading clinical data.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenReferralModal = (screening) => {
    setTargetScreening(screening);
    const recPri = screening.evaluation?.recommendedPriority || (screening.evaluation?.riskLevel === 'HIGH' ? 'Emergency' : 'Urgent');
    setPriority(recPri);
    setClinicalReason(
      screening.evaluation?.flagReasons && screening.evaluation.flagReasons.length > 0
        ? `Patient flagged during clinical assessment: ${screening.evaluation.flagReasons.join('; ')}`
        : ''
    );
    setSelectedReceivingDoctor(null);
    setReceivingHospital('Metropolitan Specialty Trauma Hospital');
    setReceivingDepartment('Emergency / Triage');
    setDoctorSearchQuery('');
    setAllowDuplicate(false);
    setDuplicateReason('');
    setReferralError(null);
    setShowReferralModal(true);
  };

  const handleSelectDoctorForReferral = (doc) => {
    setSelectedReceivingDoctor(doc);
    if (doc.hospital) setReceivingHospital(doc.hospital);
    if (doc.department) setReceivingDepartment(doc.department);
  };

  const handleCreateReferralSubmit = async () => {
    if (!clinicalReason.trim()) {
      setReferralError('Please provide a clinical reason for the referral.');
      return;
    }

    setSubmittingReferral(true);
    setReferralError(null);
    try {
      const payload = {
        sourceScreeningId: targetScreening.screeningId,
        clinicalReason: clinicalReason.trim(),
        priority,
        receivingDoctorId: selectedReceivingDoctor ? selectedReceivingDoctor.id : undefined,
        receivingDoctorUsername: selectedReceivingDoctor ? selectedReceivingDoctor.username : undefined,
        receivingDoctorName: selectedReceivingDoctor ? selectedReceivingDoctor.name : undefined,
        receivingHospital: receivingHospital.trim(),
        receivingDepartment: receivingDepartment.trim(),
        allowDuplicate,
        duplicateAuthorizationReason: allowDuplicate ? duplicateReason : undefined
      };

      const res = await api.createReferral(payload);
      setShowReferralModal(false);
      setSuccessMsg(`Referral ${res.referral.referralId} created successfully! Assigned to: ${selectedReceivingDoctor ? selectedReceivingDoctor.name : 'Unassigned (Triage)'}.`);
      loadData();

      if (res.transfer && onShowQR) {
        onShowQR(res.transfer);
      }
    } catch (err) {
      setReferralError(err.message || 'Failed to create referral.');
    } finally {
      setSubmittingReferral(false);
    }
  };

  const handleOpenReassignModal = (referral) => {
    setTargetReferralForReassign(referral);
    setNewReceivingDoctor(null);
    setReassignReason('');
    setReassignDepartment(referral.receivingDepartment || 'Emergency / Triage');
    setReassignSearchQuery('');
    setReassignError(null);
    setShowReassignModal(true);
  };

  const handleReassignSubmit = async () => {
    if (!newReceivingDoctor) {
      setReassignError('Please select a registered receiving doctor from the directory.');
      return;
    }
    if (!reassignReason.trim()) {
      setReassignError('A clinical justification/reason for reassignment is mandatory.');
      return;
    }

    setSubmittingReassign(true);
    setReassignError(null);
    try {
      const payload = {
        receivingDoctorId: newReceivingDoctor.id,
        reason: reassignReason.trim(),
        department: reassignDepartment.trim() || undefined
      };

      const res = await api.reassignReferral(targetReferralForReassign.referralId, payload);
      setShowReassignModal(false);
      setSuccessMsg(`Referral ${targetReferralForReassign.referralId} successfully reassigned to ${newReceivingDoctor.name}.`);
      loadData();
    } catch (err) {
      setReassignError(err.message || 'Failed to reassign referral.');
    } finally {
      setSubmittingReassign(false);
    }
  };

  const handleOpenHistoryModal = (referral) => {
    setSelectedReferralHistory(referral);
    setShowHistoryModal(true);
  };

  // Phase 3: Lifecycle Handlers
  const handleAcknowledge = async (ref) => {
    try {
      await api.acknowledgeReferral(ref.referralId);
      setSuccessMsg(`Referral ${ref.referralId} successfully acknowledged.`);
      loadData();
    } catch (err) {
      setErrorMsg(err.message || 'Error acknowledging referral.');
    }
  };

  const handleAccept = async (ref) => {
    try {
      await api.acceptReferral(ref.referralId);
      setSuccessMsg(`Referral ${ref.referralId} accepted for clinical intake.`);
      loadData();
    } catch (err) {
      setErrorMsg(err.message || 'Error accepting referral.');
    }
  };

  const handleStartTreatment = async (ref) => {
    try {
      await api.startTreatment(ref.referralId);
      setSuccessMsg(`Clinical treatment initiated for referral ${ref.referralId}.`);
      loadData();
    } catch (err) {
      setErrorMsg(err.message || 'Error initiating treatment.');
    }
  };

  const handleOpenRejectModal = (ref) => {
    setRejectTargetRef(ref);
    setRejectionReason('');
    setShowRejectModal(true);
  };

  const handleRejectSubmit = async () => {
    if (!rejectionReason.trim()) {
      setErrorMsg('Mandatory clinical reason is required to reject a referral.');
      return;
    }
    setSubmittingReject(true);
    try {
      await api.rejectReferral(rejectTargetRef.referralId, { reason: rejectionReason.trim() });
      setShowRejectModal(false);
      setSuccessMsg(`Referral ${rejectTargetRef.referralId} rejected. Reason logged in audit trail.`);
      loadData();
    } catch (err) {
      setErrorMsg(err.message || 'Error rejecting referral.');
    } finally {
      setSubmittingReject(false);
    }
  };

  const handleOpenTreatmentModal = (ref) => {
    setTreatmentTargetRef(ref);
    const existing = ref.treatmentDocumentation || {};
    setTreatmentSummary(existing.treatmentSummary || '');
    setClinicalObservations(existing.clinicalObservations || '');
    setProceduresPerformed((existing.proceduresPerformed || []).join(', '));
    setMedicationsAdministered((existing.medicationsAdministered || []).map(m => `${m.name} ${m.dose || ''}`).join(', '));
    setFollowUpRequired(Boolean(existing.followUpRequired));
    setFollowUpInstructions(existing.followUpInstructions || '');
    setShowTreatmentModal(true);
  };

  const handleTreatmentSubmit = async () => {
    if (!treatmentSummary.trim()) {
      setErrorMsg('Treatment summary is mandatory.');
      return;
    }
    if (followUpRequired && !followUpInstructions.trim()) {
      setErrorMsg('Follow-up instructions are required when follow-up care is indicated.');
      return;
    }
    setSubmittingTreatment(true);
    try {
      const proceduresList = proceduresPerformed.split(',').map(s => s.trim()).filter(Boolean);
      const medsList = medicationsAdministered.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name }));
      await api.documentTreatment(treatmentTargetRef.referralId, {
        treatmentSummary: treatmentSummary.trim(),
        clinicalObservations: clinicalObservations.trim(),
        proceduresPerformed: proceduresList,
        medicationsAdministered: medsList,
        followUpRequired,
        followUpInstructions: followUpInstructions.trim()
      });
      setShowTreatmentModal(false);
      setSuccessMsg(`Treatment successfully documented for referral ${treatmentTargetRef.referralId}.`);
      loadData();
    } catch (err) {
      setErrorMsg(err.message || 'Error documenting treatment.');
    } finally {
      setSubmittingTreatment(false);
    }
  };

  const handleOpenCareConfirmModal = (ref) => {
    setCareConfirmTargetRef(ref);
    setConfirmationSummary('Clinical care and patient condition verified by attending physician.');
    setFollowUpAddressed(Boolean(ref.treatmentDocumentation?.followUpRequired));
    setFollowUpPlan('');
    setShowCareConfirmModal(true);
  };

  const handleCareConfirmSubmit = async () => {
    setSubmittingCareConfirm(true);
    try {
      await api.confirmCare(careConfirmTargetRef.referralId, {
        confirmationSummary: confirmationSummary.trim(),
        followUpAddressed,
        followUpPlan: followUpPlan.trim()
      });
      setShowCareConfirmModal(false);
      setSuccessMsg(`Clinical care confirmed for referral ${careConfirmTargetRef.referralId}.`);
      loadData();
    } catch (err) {
      setErrorMsg(err.message || 'Error confirming care.');
    } finally {
      setSubmittingCareConfirm(false);
    }
  };

  const handleOpenCloseModal = (ref) => {
    setCloseTargetRef(ref);
    setClosureNotes('Clinical handoff and treatment successfully closed.');
    setShowCloseModal(true);
  };

  const handleCloseSubmit = async () => {
    setSubmittingClose(true);
    try {
      await api.closeReferral(closeTargetRef.referralId, {
        closureNotes: closureNotes.trim()
      });
      setShowCloseModal(false);
      setSuccessMsg(`Referral ${closeTargetRef.referralId} successfully completed and closed.`);
      loadData();
    } catch (err) {
      setErrorMsg(err.message || 'Error closing referral.');
    } finally {
      setSubmittingClose(false);
    }
  };

  const handleOpenTimelineModal = async (ref) => {
    setSelectedTimelineRef(ref);
    setShowTimelineModal(true);
    setLoadingTimeline(true);
    try {
      const res = await api.getReferralTimeline(ref.referralId);
      setTimelineEvents(res.timeline || []);
    } catch (err) {
      setTimelineEvents(ref.timeline || []);
    } finally {
      setLoadingTimeline(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PENDING':
        return { variant: 'info', label: 'PENDING' };
      case 'ACKNOWLEDGED':
        return { variant: 'warning', label: 'ACKNOWLEDGED' };
      case 'ACCEPTED':
        return { variant: 'primary', label: 'ACCEPTED' };
      case 'IN_PROGRESS':
        return { variant: 'warning', label: 'IN PROGRESS' };
      case 'FOLLOW_UP_REQUIRED':
        return { variant: 'critical', label: '⚠️ FOLLOW-UP REQ' };
      case 'COMPLETED':
        return { variant: 'success', label: '✓ COMPLETED' };
      case 'REJECTED':
        return { variant: 'critical', label: '✕ REJECTED' };
      case 'CANCELLED':
        return { variant: 'neutral', label: 'CANCELLED' };
      case 'IN_TRANSIT':
        return { variant: 'warning', label: 'IN TRANSIT' };
      default:
        return { variant: 'neutral', label: status || 'UNKNOWN' };
    }
  };

  const handleAddInvestigation = () => {
    if (!labName.trim()) return;
    setInvestigations([...investigations, { name: labName.trim(), status: labStatus, notes: labNotes.trim() }]);
    setLabName('');
    setLabNotes('');
  };

  const handleRecordScreeningSubmit = async () => {
    if (!patientId.trim() || !patientName.trim() || !age) {
      setErrorMsg('Patient ID, Name, and Age are mandatory for clinical screening.');
      return;
    }

    setRecordingScreening(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const payload = {
        pid: patientId.trim(),
        patientName: patientName.trim(),
        age: Number(age),
        gender,
        bloodGroup,
        vitals,
        investigations,
        clinicalNotes: clinicalNotes.trim(),
        patientConsent: { consentGiven: patientConsent }
      };

      const res = await api.createScreening(payload);
      setSuccessMsg(`Screening ${res.screening.screeningId} recorded successfully! ${res.screening.evaluation?.isFlagged ? '⚠️ Flagged for clinical attention.' : 'Normal parameters.'}`);
      setPatientId('');
      setPatientName('');
      setAge('');
      setVitals({ hr: null, bp: '', rr: null, spo2: null, temp: null, gcs: null });
      setInvestigations([]);
      setClinicalNotes('');
      setActiveTab('flagged');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to record screening assessment.');
    } finally {
      setRecordingScreening(false);
    }
  };

  const liveNews = calculateNEWS2(vitals);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Title & Navigation Subtabs */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>PATIENT SCREENING & REFERRALS</Text>
          <Text style={styles.subtitle}>
            Clinical Intake Triage, Receiving Doctor Assignment & Ownership Management
          </Text>
        </View>
      </View>

      {/* Action Notification Messages */}
      {successMsg && (
        <View style={styles.successBanner}>
          <Text style={styles.successBannerText}>✓ {successMsg}</Text>
          <TouchableOpacity onPress={() => setSuccessMsg(null)}>
            <Text style={{ color: '#065F46', fontWeight: '700', marginLeft: 10 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {errorMsg && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>[!] {errorMsg}</Text>
          <TouchableOpacity onPress={() => setErrorMsg(null)}>
            <Text style={{ color: '#991B1B', fontWeight: '700', marginLeft: 10 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Primary Section Subtab Switcher */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          onPress={() => { setActiveTab('flagged'); setErrorMsg(null); setSuccessMsg(null); }}
          style={[styles.tabButton, activeTab === 'flagged' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabButtonText, activeTab === 'flagged' && styles.tabButtonTextActive]}>
            ⚠️ Flagged Screenings
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => { setActiveTab('all'); setErrorMsg(null); setSuccessMsg(null); }}
          style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabButtonText, activeTab === 'all' && styles.tabButtonTextActive]}>
            All Screenings
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => { setActiveTab('referrals'); setErrorMsg(null); setSuccessMsg(null); }}
          style={[styles.tabButton, activeTab === 'referrals' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabButtonText, activeTab === 'referrals' && styles.tabButtonTextActive]}>
            Referral Management
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => { setActiveTab('new_screening'); setErrorMsg(null); setSuccessMsg(null); }}
          style={[styles.tabButton, activeTab === 'new_screening' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabButtonText, activeTab === 'new_screening' && styles.tabButtonTextActive]}>
            + Record Screening
          </Text>
        </TouchableOpacity>
      </View>

      {/* TAB 1 & 2: SCREENINGS LIST VIEW */}
      {(activeTab === 'flagged' || activeTab === 'all') && (
        <View>
          {loading && <Text style={styles.loadingText}>Loading screening evaluations...</Text>}

          {!loading && screenings.length === 0 && (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {activeTab === 'flagged' ? 'No Flagged Screenings' : 'No Screening Records Found'}
              </Text>
              <Text style={styles.emptySub}>
                {activeTab === 'flagged'
                  ? 'All evaluated patients are currently within normal physiological thresholds. Click "+ Record Screening" to triage a new patient.'
                  : 'No patient screenings have been recorded yet.'}
              </Text>
            </Card>
          )}

          {!loading && screenings.map((screening) => {
            const isFlagged = screening.evaluation?.isFlagged;
            const riskLevel = screening.evaluation?.riskLevel || 'LOW';
            const newsScore = screening.evaluation?.news2Score ?? 0;
            const flagReasons = screening.evaluation?.flagReasons || [];
            const activeRef = screening.activeReferralId;

            return (
              <Card
                key={screening._id}
                style={[
                  styles.screeningCard,
                  isFlagged ? styles.flaggedBorder : styles.normalBorder
                ]}
              >
                {/* Header Row */}
                <View style={styles.cardHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.patientNameText}>{screening.patientName}</Text>
                      <Text style={styles.pidText}>({screening.pid})</Text>
                    </View>
                    <Text style={styles.demographicsText}>
                      {screening.age}y / {screening.gender} | Blood: {screening.bloodGroup || 'Unknown'} | Hospital: {screening.hospital}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end' }}>
                    <Badge
                      label={isFlagged ? `FLAGGED (${riskLevel} RISK)` : 'NORMAL'}
                      variant={riskLevel === 'HIGH' ? 'critical' : (riskLevel === 'MEDIUM' ? 'warning' : 'success')}
                    />
                    <Text style={styles.screeningIdText}>{screening.screeningId}</Text>
                  </View>
                </View>

                {/* Flag Reasons / Clinical Attention Banner */}
                {isFlagged && flagReasons.length > 0 && (
                  <View style={styles.flagReasonBox}>
                    <Text style={styles.flagReasonTitle}>⚠️ Clinical Concerns Identified (NEWS2: {newsScore}):</Text>
                    {flagReasons.map((reason, idx) => (
                      <Text key={idx} style={styles.flagReasonItem}>• {reason}</Text>
                    ))}
                  </View>
                )}

                {/* Vitals Summary Line */}
                <View style={styles.vitalsRow}>
                  <Text style={styles.vitalChip}>HR: {screening.vitals?.hr ? `${screening.vitals.hr} bpm` : '-'}</Text>
                  <Text style={styles.vitalChip}>BP: {screening.vitals?.bp || '-'}</Text>
                  <Text style={styles.vitalChip}>RR: {screening.vitals?.rr ? `${screening.vitals.rr}/min` : '-'}</Text>
                  <Text style={styles.vitalChip}>SpO₂: {screening.vitals?.spo2 ? `${screening.vitals.spo2}%` : '-'}</Text>
                  <Text style={styles.vitalChip}>Temp: {screening.vitals?.temp ? `${screening.vitals.temp}°C` : '-'}</Text>
                  <Text style={styles.vitalChip}>GCS: {screening.vitals?.gcs ?? '-'}</Text>
                </View>

                {/* Existing Referral Relationship Display */}
                {activeRef ? (
                  <View style={styles.referralLinkedBox}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.referralLinkedTitle}>
                        Active Referral: <Text style={{ fontWeight: '800', color: COLORS.primary }}>{activeRef.referralId || activeRef}</Text>
                      </Text>
                      <Text style={styles.referralLinkedSub}>
                        Status: <Text style={{ fontWeight: '700' }}>{activeRef.status || 'PENDING'}</Text>
                        {activeRef.receivingDoctorName ? ` | Assigned: ${activeRef.receivingDoctorName}` : ' | Unassigned'}
                        {activeRef.receivingHospital ? ` | Destination: ${activeRef.receivingHospital}` : ''}
                      </Text>
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {activeRef.transferId && onShowQR && (
                        <Button
                          title="Show QR"
                          onPress={() => onShowQR(activeRef.transferId)}
                          variant="secondary"
                          size="small"
                          style={{ marginRight: 6 }}
                        />
                      )}
                      {activeRef.transferId && onSelectTransfer && (
                        <Button
                          title="Receiver View"
                          onPress={() => onSelectTransfer(activeRef.transferId)}
                          variant="outline"
                          size="small"
                        />
                      )}
                    </View>
                  </View>
                ) : (
                  /* Action to Initiate Referral */
                  <View style={styles.referralActionRow}>
                    {isFlagged ? (
                      <Button
                        title="+ Initiate Clinical Referral"
                        onPress={() => handleOpenReferralModal(screening)}
                        variant="primary"
                        size="small"
                      />
                    ) : (
                      <Text style={styles.normalNoReferralText}>
                        ✓ Within normal physiological parameters. No active referral required.
                      </Text>
                    )}
                  </View>
                )}
              </Card>
            );
          })}
        </View>
      )}

      {/* TAB 3: REFERRAL MANAGEMENT DASHBOARD (Requirement 5) */}
      {activeTab === 'referrals' && (
        <View>
          {/* Referral Sections / Filter Pills (A, B, C, D, E) */}
          <View style={styles.referralFilterBar}>
            <TouchableOpacity
              onPress={() => setReferralViewFilter('incoming')}
              style={[styles.filterChip, referralViewFilter === 'incoming' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, referralViewFilter === 'incoming' && styles.filterChipTextActive]}>
                📥 Incoming Referrals
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setReferralViewFilter('my_assigned')}
              style={[styles.filterChip, referralViewFilter === 'my_assigned' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, referralViewFilter === 'my_assigned' && styles.filterChipTextActive]}>
                🩺 My Assigned
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setReferralViewFilter('unassigned')}
              style={[styles.filterChip, referralViewFilter === 'unassigned' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, referralViewFilter === 'unassigned' && styles.filterChipTextActive]}>
                📋 Unassigned Triage
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setReferralViewFilter('urgent')}
              style={[styles.filterChip, referralViewFilter === 'urgent' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, referralViewFilter === 'urgent' && styles.filterChipTextActive]}>
                🚨 Urgent / ICU
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setReferralViewFilter('all')}
              style={[styles.filterChip, referralViewFilter === 'all' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, referralViewFilter === 'all' && styles.filterChipTextActive]}>
                All Referrals
              </Text>
            </TouchableOpacity>
          </View>

          {loading && <Text style={styles.loadingText}>Loading referrals...</Text>}

          {!loading && referrals.length === 0 && (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No Referrals in this Category</Text>
              <Text style={styles.emptySub}>
                No referrals found matching the "{referralViewFilter.replace('_', ' ')}" filter.
              </Text>
            </Card>
          )}

          {!loading && referrals.map((ref) => {
            const hasReceivingDoctor = Boolean(ref.receivingDoctorId);
            const historyCount = (ref.assignmentHistory || []).length;
            const timelineCount = (ref.timeline || []).length;
            const statusBadge = getStatusBadge(ref.status);

            return (
              <Card key={ref._id} style={styles.referralCard}>
                {/* 1. Header: Referral ID, Priority, Status */}
                <View style={styles.cardHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.referralIdBig}>{ref.referralId}</Text>
                    <Text style={styles.patientMetaText}>
                      Patient: <Text style={styles.bold}>{ref.patientName}</Text> | UHID: <Text style={styles.bold}>{ref.patientId}</Text>
                    </Text>
                    <Text style={styles.screeningMetaText}>
                      Source Screening: <Text style={{ color: COLORS.primary, fontWeight: '700' }}>{ref.sourceScreeningId}</Text>
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end' }}>
                    <Badge
                      label={statusBadge.label}
                      variant={statusBadge.variant}
                    />
                    <View style={{ marginTop: 4 }}>
                      <Badge
                        label={ref.priority || 'Routine'}
                        variant={ref.priority === 'Emergency' ? 'critical' : (ref.priority === 'Urgent' ? 'warning' : 'neutral')}
                      />
                    </View>
                  </View>
                </View>

                {/* 2. Clinician & Organizational Ownership Box */}
                <View style={styles.doctorOwnershipGrid}>
                  <View style={styles.doctorCol}>
                    <Text style={styles.ownershipLabel}>Referring Clinician:</Text>
                    <Text style={styles.doctorNameBold}>
                      {ref.referringDoctorName || ref.referringDoctorUsername || 'Referring Attending'}
                    </Text>
                    <Text style={styles.hospSub}>{ref.referringHospital || 'Origin Facility'}</Text>
                  </View>

                  <View style={styles.doctorColArrow}>
                    <Text style={{ fontSize: 18, color: COLORS.primary, fontWeight: '900' }}>➔</Text>
                  </View>

                  <View style={styles.doctorCol}>
                    <Text style={styles.ownershipLabel}>Assigned Receiving Doctor:</Text>
                    {hasReceivingDoctor ? (
                      <View>
                        <Text style={[styles.doctorNameBold, { color: COLORS.secondary }]}>
                          {ref.receivingDoctorName || ref.receivingDoctorUsername}
                        </Text>
                        <Text style={styles.hospSub}>{ref.receivingHospital} ({ref.receivingDepartment || 'Triage'})</Text>
                        {ref.assignmentTimestamp && (
                          <Text style={styles.assignmentDateText}>
                            Assigned: {new Date(ref.assignmentTimestamp).toLocaleDateString()}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <View>
                        <Text style={[styles.doctorNameBold, { color: '#DC2626' }]}>
                          Unassigned
                        </Text>
                        <Text style={styles.hospSub}>{ref.receivingHospital || 'Target Facility'} (Pending Assignment)</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* 3. Clinical Reason */}
                <View style={styles.refReasonBox}>
                  <Text style={styles.refReasonLabel}>Clinical Reason for Referral:</Text>
                  <Text style={styles.refReasonText}>{ref.clinicalReason}</Text>
                </View>

                {/* 4. Phase 3 Rejection Reason Banner (if applicable) */}
                {ref.status === 'REJECTED' && ref.rejection && (
                  <View style={styles.rejectionNoticeBox}>
                    <Text style={styles.rejectionNoticeTitle}>✕ Referral Rejected by Receiving Doctor</Text>
                    <Text style={styles.rejectionNoticeReason}>Reason: "{ref.rejection.reason}"</Text>
                    <Text style={styles.rejectionNoticeSub}>
                      Logged by {ref.rejection.rejectedByDoctorName || ref.rejection.rejectedByDoctorUsername} on {ref.rejection.rejectedAt ? new Date(ref.rejection.rejectedAt).toLocaleString() : 'N/A'}.
                      Escalation: Use "Reassign Doctor" below to assign another clinician.
                    </Text>
                  </View>
                )}

                {/* 5. Phase 3 Documented Treatment Preview (if applicable) */}
                {ref.treatmentDocumentation && ref.treatmentDocumentation.treatmentSummary && (
                  <View style={styles.treatmentPreviewBox}>
                    <Text style={styles.treatmentPreviewTitle}>🩺 Documented Clinical Treatment</Text>
                    <Text style={styles.treatmentPreviewText}>{ref.treatmentDocumentation.treatmentSummary}</Text>
                    {ref.treatmentDocumentation.clinicalObservations ? (
                      <Text style={styles.treatmentDetailText}>
                        <Text style={styles.bold}>Observations: </Text>{ref.treatmentDocumentation.clinicalObservations}
                      </Text>
                    ) : null}
                    {(ref.treatmentDocumentation.proceduresPerformed || []).length > 0 && (
                      <Text style={styles.treatmentDetailText}>
                        <Text style={styles.bold}>Procedures: </Text>{ref.treatmentDocumentation.proceduresPerformed.join(', ')}
                      </Text>
                    )}
                    {(ref.treatmentDocumentation.medicationsAdministered || []).length > 0 && (
                      <Text style={styles.treatmentDetailText}>
                        <Text style={styles.bold}>Medications: </Text>
                        {ref.treatmentDocumentation.medicationsAdministered.map(m => `${m.name} ${m.dose || ''}`).join('; ')}
                      </Text>
                    )}
                  </View>
                )}

                {/* 6. Phase 3 Follow-up Requirement Indicator */}
                {ref.treatmentDocumentation?.followUpRequired && (
                  <View style={styles.followUpAlertBox}>
                    <Text style={styles.followUpAlertTitle}>⚠️ Follow-Up Care Required</Text>
                    <Text style={styles.followUpAlertText}>
                      Instructions: {ref.treatmentDocumentation.followUpInstructions || 'Follow-up clinical assessment required.'}
                    </Text>
                    {ref.careConfirmation?.followUpPlan ? (
                      <Text style={[styles.followUpAlertText, { color: '#065F46', marginTop: 3 }]}>
                        Resolution Plan: {ref.careConfirmation.followUpPlan}
                      </Text>
                    ) : null}
                  </View>
                )}

                {/* 7. Phase 3 Care Confirmation & Closure Status */}
                {ref.careConfirmation?.isConfirmed && (
                  <View style={styles.careConfirmedBox}>
                    <Text style={styles.careConfirmedText}>
                      ✓ Care Confirmed by Dr. {ref.careConfirmation.confirmedByDoctorName || ref.careConfirmation.confirmedByDoctorUsername}: "{ref.careConfirmation.confirmationSummary}"
                    </Text>
                  </View>
                )}

                {ref.status === 'COMPLETED' && ref.closure?.isClosed && (
                  <View style={styles.closureSuccessBox}>
                    <Text style={styles.closureSuccessTitle}>🔒 Referral Completed & Closed</Text>
                    <Text style={styles.closureSuccessText}>
                      Notes: {ref.closure.closureNotes || 'Clinical care and treatment completed.'}
                    </Text>
                    <Text style={styles.closureSuccessSub}>
                      Closed by Dr. {ref.closure.closedByDoctorName || ref.closure.closedByDoctorUsername} on {new Date(ref.closure.closedAt).toLocaleString()}
                    </Text>
                  </View>
                )}

                {/* 8. Lifecycle Clinical Action Bar */}
                <View style={styles.lifecycleActionBar}>
                  {/* Status: PENDING */}
                  {ref.status === 'PENDING' && (
                    <View style={styles.actionButtonGroup}>
                      <Button
                        title="✓ Acknowledge Receipt"
                        onPress={() => handleAcknowledge(ref)}
                        variant="primary"
                        size="small"
                        style={{ marginRight: 6 }}
                      />
                      <Button
                        title="Accept"
                        onPress={() => handleAccept(ref)}
                        variant="secondary"
                        size="small"
                        style={{ marginRight: 6 }}
                      />
                      <Button
                        title="✕ Reject"
                        onPress={() => handleOpenRejectModal(ref)}
                        variant="outline"
                        size="small"
                      />
                    </View>
                  )}

                  {/* Status: ACKNOWLEDGED */}
                  {ref.status === 'ACKNOWLEDGED' && (
                    <View style={styles.actionButtonGroup}>
                      <Button
                        title="✓ Accept Referral"
                        onPress={() => handleAccept(ref)}
                        variant="primary"
                        size="small"
                        style={{ marginRight: 6 }}
                      />
                      <Button
                        title="✕ Reject"
                        onPress={() => handleOpenRejectModal(ref)}
                        variant="outline"
                        size="small"
                      />
                    </View>
                  )}

                  {/* Status: ACCEPTED */}
                  {ref.status === 'ACCEPTED' && (
                    <View style={styles.actionButtonGroup}>
                      <Button
                        title="▶ Start Treatment"
                        onPress={() => handleStartTreatment(ref)}
                        variant="primary"
                        size="small"
                        style={{ marginRight: 6 }}
                      />
                      <Button
                        title="📝 Document Treatment"
                        onPress={() => handleOpenTreatmentModal(ref)}
                        variant="secondary"
                        size="small"
                      />
                    </View>
                  )}

                  {/* Status: IN_PROGRESS or FOLLOW_UP_REQUIRED */}
                  {(ref.status === 'IN_PROGRESS' || ref.status === 'FOLLOW_UP_REQUIRED') && (
                    <View style={styles.actionButtonGroup}>
                      <Button
                        title="📝 Document Treatment"
                        onPress={() => handleOpenTreatmentModal(ref)}
                        variant="secondary"
                        size="small"
                        style={{ marginRight: 6 }}
                      />
                      {ref.treatmentDocumentation?.treatmentSummary && !ref.careConfirmation?.isConfirmed && (
                        <Button
                          title="🛡️ Confirm Care"
                          onPress={() => handleOpenCareConfirmModal(ref)}
                          variant="primary"
                          size="small"
                          style={{ marginRight: 6 }}
                        />
                      )}
                      {ref.careConfirmation?.isConfirmed && (
                        <Button
                          title="🔒 Close Referral"
                          onPress={() => handleOpenCloseModal(ref)}
                          variant="primary"
                          size="small"
                        />
                      )}
                    </View>
                  )}
                </View>

                {/* 9. Assignment & Handoff Footer Actions */}
                <View style={styles.referralFooterRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    <TouchableOpacity
                      onPress={() => handleOpenTimelineModal(ref)}
                      style={[styles.historyBtn, { backgroundColor: '#EDE9FE', borderColor: '#8B5CF6' }]}
                    >
                      <Text style={[styles.historyBtnText, { color: '#6D28D9' }]}>
                        📜 Timeline ({timelineCount})
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleOpenHistoryModal(ref)}
                      style={[styles.historyBtn, { marginLeft: 6 }]}
                    >
                      <Text style={styles.historyBtnText}>
                        🕒 Assigns ({historyCount})
                      </Text>
                    </TouchableOpacity>

                    {ref.status !== 'COMPLETED' && ref.status !== 'CANCELLED' && (
                      <Button
                        title="Reassign Doctor"
                        onPress={() => handleOpenReassignModal(ref)}
                        variant="outline"
                        size="small"
                        style={{ marginLeft: 6 }}
                      />
                    )}
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                    {ref.transferId && onShowQR && (
                      <Button
                        title="Handoff QR"
                        onPress={() => onShowQR(ref.transferId)}
                        variant="secondary"
                        size="small"
                        style={{ marginRight: 6 }}
                      />
                    )}
                    {ref.transferId && onSelectTransfer && (
                      <Button
                        title="Receiver View"
                        onPress={() => onSelectTransfer(ref.transferId)}
                        variant="primary"
                        size="small"
                      />
                    )}
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* TAB 4: NEW SCREENING INTAKE FORM */}
      {activeTab === 'new_screening' && (
        <Card title="Patient Clinical Screening & Triage" subtitle="Input physiological vitals and diagnostic findings. MediFORM CDS will automatically evaluate triage score.">
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 6 }}>
              <Input
                label="Patient ID / UHID"
                required
                value={patientId}
                onChangeText={setPatientId}
                placeholder="e.g. PAT-2026-01"
              />
            </View>
            <View style={{ flex: 1, marginLeft: 6 }}>
              <Input
                label="Full Patient Name"
                required
                value={patientName}
                onChangeText={setPatientName}
                placeholder="e.g. John Doe"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 6 }}>
              <Input
                label="Age (Years)"
                required
                keyboardType="numeric"
                value={age}
                onChangeText={setAge}
                placeholder="e.g. 52"
              />
            </View>
            <View style={{ flex: 1, marginLeft: 6 }}>
              <Input
                label="Blood Group"
                value={bloodGroup}
                onChangeText={setBloodGroup}
                placeholder="e.g. O+, A-, B+"
              />
            </View>
          </View>

          {/* Vitals Form Section with Live NEWS2 */}
          <View style={styles.vitalsFormContainer}>
            <Text style={styles.sectionHeaderTitle}>Physiological Vital Signs</Text>
            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 4 }}>
                <Input
                  label="Heart Rate (bpm)"
                  keyboardType="numeric"
                  value={vitals.hr ? String(vitals.hr) : ''}
                  onChangeText={(val) => setVitals({ ...vitals, hr: val ? Number(val) : null })}
                  placeholder="e.g. 88"
                />
              </View>
              <View style={{ flex: 1, marginHorizontal: 4 }}>
                <Input
                  label="Blood Pressure"
                  value={vitals.bp}
                  onChangeText={(val) => setVitals({ ...vitals, bp: val })}
                  placeholder="e.g. 120/80"
                />
              </View>
              <View style={{ flex: 1, marginLeft: 4 }}>
                <Input
                  label="Resp Rate (/min)"
                  keyboardType="numeric"
                  value={vitals.rr ? String(vitals.rr) : ''}
                  onChangeText={(val) => setVitals({ ...vitals, rr: val ? Number(val) : null })}
                  placeholder="e.g. 18"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 4 }}>
                <Input
                  label="SpO₂ (%)"
                  keyboardType="numeric"
                  value={vitals.spo2 ? String(vitals.spo2) : ''}
                  onChangeText={(val) => setVitals({ ...vitals, spo2: val ? Number(val) : null })}
                  placeholder="e.g. 98"
                />
              </View>
              <View style={{ flex: 1, marginHorizontal: 4 }}>
                <Input
                  label="Temp (°C)"
                  keyboardType="numeric"
                  value={vitals.temp ? String(vitals.temp) : ''}
                  onChangeText={(val) => setVitals({ ...vitals, temp: val ? Number(val) : null })}
                  placeholder="e.g. 37.0"
                />
              </View>
              <View style={{ flex: 1, marginLeft: 4 }}>
                <Input
                  label="GCS (3-15)"
                  keyboardType="numeric"
                  value={vitals.gcs ? String(vitals.gcs) : ''}
                  onChangeText={(val) => setVitals({ ...vitals, gcs: val ? Number(val) : null })}
                  placeholder="e.g. 15"
                />
              </View>
            </View>

            {/* Live CDS Widget */}
            <View style={[styles.liveCdsBox, { borderColor: liveNews.color }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.liveCdsTitle}>
                  Live NEWS2 Score: <Text style={{ color: liveNews.color, fontSize: 16 }}>{liveNews.score}</Text> ({liveNews.riskLevel} RISK)
                </Text>
                <Text style={styles.liveCdsSub}>{liveNews.label}</Text>
              </View>
              <Badge
                label={liveNews.riskLevel === 'HIGH' ? 'EMERGENCY' : (liveNews.riskLevel === 'MEDIUM' ? 'URGENT' : 'ROUTINE')}
                variant={liveNews.riskLevel === 'HIGH' ? 'critical' : (liveNews.riskLevel === 'MEDIUM' ? 'warning' : 'success')}
              />
            </View>
          </View>

          {/* Investigations */}
          <View style={styles.investigationsFormContainer}>
            <Text style={styles.sectionHeaderTitle}>Diagnostic Investigations (Optional)</Text>
            <View style={styles.row}>
              <View style={{ flex: 2, marginRight: 6 }}>
                <Input
                  label="Investigation"
                  value={labName}
                  onChangeText={setLabName}
                  placeholder="e.g. Chest X-Ray, Troponin"
                />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Text style={styles.fieldLabel}>Status</Text>
                <View style={{ flexDirection: 'row', marginTop: 4 }}>
                  {['Normal', 'Abnormal'].map(st => (
                    <TouchableOpacity
                      key={st}
                      onPress={() => setLabStatus(st)}
                      style={[styles.miniChip, labStatus === st && styles.miniChipActive]}
                    >
                      <Text style={[styles.miniChipText, labStatus === st && { color: '#FFF' }]}>{st}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.row}>
              <View style={{ flex: 2, marginRight: 6 }}>
                <Input
                  label="Lab Findings / Notes"
                  value={labNotes}
                  onChangeText={setLabNotes}
                  placeholder="e.g. Bilateral infiltrates"
                />
              </View>
              <View style={{ flex: 1, justifyContent: 'center', marginTop: 12 }}>
                <Button
                  title="+ Add Lab"
                  onPress={handleAddInvestigation}
                  disabled={!labName.trim()}
                  variant="secondary"
                  size="small"
                />
              </View>
            </View>

            {investigations.map((item, idx) => (
              <View key={idx} style={styles.invItemRow}>
                <Text style={[styles.invItemText, item.status === 'Abnormal' && { color: COLORS.critical, fontWeight: '700' }]}>
                  • {item.name} [{item.status}]: {item.notes || 'No notes'}
                </Text>
                <TouchableOpacity onPress={() => setInvestigations(investigations.filter((_, i) => i !== idx))}>
                  <Text style={{ color: COLORS.critical, fontWeight: '800' }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {/* Clinical Notes & Consent */}
          <Input
            label="Attending Clinical Notes"
            multiline
            numberOfLines={3}
            value={clinicalNotes}
            onChangeText={setClinicalNotes}
            placeholder="Clinical observation, primary complaints, and provisional diagnosis..."
          />

          <View style={styles.consentRow}>
            <TouchableOpacity
              onPress={() => setPatientConsent(!patientConsent)}
              style={[styles.checkbox, patientConsent && styles.checkboxActive]}
            >
              {patientConsent && <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 12 }}>✓</Text>}
            </TouchableOpacity>
            <Text style={styles.consentText}>
              Patient / Next-of-Kin consent verified for medical screening assessment and referral information exchange.
            </Text>
          </View>

          <Button
            title={recordingScreening ? "Recording & Evaluating..." : "Record & Evaluate Screening"}
            onPress={handleRecordScreeningSubmit}
            disabled={recordingScreening}
            variant="primary"
            style={{ marginTop: 14 }}
          />
        </Card>
      )}

      {/* REFERRAL CREATION MODAL (WITH DOCTOR DIRECTORY SELECTION) */}
      <Modal visible={showReferralModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>Initiate Clinical Referral</Text>
            <Text style={styles.modalSub}>
              From Screening: <Text style={{ fontWeight: '800', color: COLORS.primary }}>{targetScreening?.screeningId}</Text>
            </Text>

            {referralError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>[!] {referralError}</Text>
              </View>
            )}

            {/* Target Patient Summary */}
            <View style={styles.modalPatientBox}>
              <Text style={styles.modalPatientName}>
                {targetScreening?.patientName} (ID: {targetScreening?.pid}, {targetScreening?.age}y / {targetScreening?.gender})
              </Text>
              <Text style={styles.modalCdsAlert}>
                NEWS2 Score: {targetScreening?.evaluation?.news2Score} ({targetScreening?.evaluation?.riskLevel} RISK)
              </Text>
            </View>

            {/* Doctor Directory Selector (Section 3 Requirement) */}
            <Text style={styles.fieldLabel}>Select Receiving Doctor from Registered Directory</Text>
            <Input
              placeholder="🔍 Search doctors by name, specialty, or facility..."
              value={doctorSearchQuery}
              onChangeText={(txt) => {
                setDoctorSearchQuery(txt);
                loadDoctors(txt);
              }}
              style={{ marginBottom: 6 }}
            />

            <ScrollView style={styles.doctorDirectoryList} nestedScrollEnabled>
              <TouchableOpacity
                onPress={() => setSelectedReceivingDoctor(null)}
                style={[
                  styles.doctorDirectoryCard,
                  !selectedReceivingDoctor && styles.doctorDirectoryCardActive
                ]}
              >
                <Text style={styles.docItemName}>📋 Leave Unassigned (Hospital Triage Queue)</Text>
                <Text style={styles.docItemSub}>Referral will be routed to receiving facility for departmental allocation</Text>
              </TouchableOpacity>

              {doctorsDirectory.map((doc) => {
                const isSelected = selectedReceivingDoctor?.id === doc.id;
                return (
                  <TouchableOpacity
                    key={doc.id}
                    onPress={() => handleSelectDoctorForReferral(doc)}
                    style={[
                      styles.doctorDirectoryCard,
                      isSelected && styles.doctorDirectoryCardActive
                    ]}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={[styles.docItemName, isSelected && { color: COLORS.primary }]}>
                        {doc.name}
                      </Text>
                      {doc.verificationStatus === 'VERIFIED' ? (
                        <Text style={{ fontSize: 11, color: '#059669', fontWeight: '800' }}>✓ Verified Clinician</Text>
                      ) : doc.verificationStatus === 'PENDING' ? (
                        <Text style={{ fontSize: 11, color: '#d97706', fontWeight: '700' }}>⏳ Pending Verification</Text>
                      ) : (
                        <Text style={{ fontSize: 11, color: '#64748b', fontWeight: '600' }}>Unverified</Text>
                      )}
                    </View>
                    <Text style={styles.docItemSub}>
                      {doc.specialization || 'General Practice'} • {doc.department || 'Triage'}
                    </Text>
                    <Text style={styles.docItemHosp}>{doc.hospital || 'Hospital Network'}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Receiving Facility and Department Inputs */}
            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Input
                  label="Receiving Facility"
                  value={receivingHospital}
                  onChangeText={setReceivingHospital}
                  placeholder="e.g. St. Jude Heart Hospital"
                />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Input
                  label="Department"
                  value={receivingDepartment}
                  onChangeText={setReceivingDepartment}
                  placeholder="e.g. Cardiology ICU"
                />
              </View>
            </View>

            {/* Clinical Reason (Mandatory) */}
            <Input
              label="Clinical Reason for Referral"
              required
              multiline
              numberOfLines={2}
              value={clinicalReason}
              onChangeText={setClinicalReason}
              placeholder="Detail reasons for referral and required level of care..."
            />

            {/* Priority Selection */}
            <Text style={styles.fieldLabel}>Referral Priority</Text>
            <View style={styles.prioritySelectorRow}>
              {['Routine', 'Urgent', 'Emergency'].map(p => (
                <TouchableOpacity
                  key={p}
                  onPress={() => setPriority(p)}
                  style={[styles.priorityChip, priority === p && styles.priorityChipActive]}
                >
                  <Text style={[styles.priorityChipText, priority === p && { color: '#FFF' }]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Duplicate Authorization (if active referral exists) */}
            {targetScreening?.activeReferralId && (
              <View style={styles.duplicateWarningBox}>
                <Text style={styles.duplicateWarningTitle}>
                  ⚠️ Active Referral Already Exists ({targetScreening.activeReferralId.referralId || 'REF-ACTIVE'})
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <TouchableOpacity
                    onPress={() => setAllowDuplicate(!allowDuplicate)}
                    style={[styles.checkbox, allowDuplicate && styles.checkboxActive]}
                  >
                    {allowDuplicate && <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 12 }}>✓</Text>}
                  </TouchableOpacity>
                  <Text style={styles.duplicateCheckText}>
                    I explicitly authorize creating an additional concurrent referral for this patient.
                  </Text>
                </View>
              </View>
            )}

            {/* Buttons */}
            <View style={styles.modalButtonsRow}>
              <Button
                title="Cancel"
                onPress={() => setShowReferralModal(false)}
                variant="outline"
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button
                title={submittingReferral ? "Creating..." : "Confirm Referral & Assign"}
                onPress={handleCreateReferralSubmit}
                disabled={submittingReferral}
                variant="primary"
                style={{ flex: 2, marginLeft: 6 }}
              />
            </View>
          </Card>
        </View>
      </Modal>

      {/* REASSIGNMENT MODAL (Section 6 Requirement) */}
      <Modal visible={showReassignModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reassign Referral Ownership</Text>
            <Text style={styles.modalSub}>
              Referral: <Text style={{ fontWeight: '800', color: COLORS.primary }}>{targetReferralForReassign?.referralId}</Text>
            </Text>

            {reassignError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>[!] {reassignError}</Text>
              </View>
            )}

            <View style={styles.currentDocNoticeBox}>
              <Text style={styles.currentDocNoticeTitle}>Currently Assigned Doctor:</Text>
              <Text style={styles.currentDocNoticeText}>
                {targetReferralForReassign?.receivingDoctorName || targetReferralForReassign?.receivingDoctorUsername || 'Currently Unassigned'} ({targetReferralForReassign?.receivingHospital || 'Hospital'})
              </Text>
            </View>

            {/* Doctor Search & Select */}
            <Text style={styles.fieldLabel}>Select New Receiving Doctor from Directory *</Text>
            <Input
              placeholder="🔍 Search doctors by name or specialization..."
              value={reassignSearchQuery}
              onChangeText={(txt) => {
                setReassignSearchQuery(txt);
                loadDoctors(txt);
              }}
              style={{ marginBottom: 6 }}
            />

            <ScrollView style={styles.doctorDirectoryList} nestedScrollEnabled>
              {doctorsDirectory.map((doc) => {
                const isSelected = newReceivingDoctor?.id === doc.id;
                return (
                  <TouchableOpacity
                    key={doc.id}
                    onPress={() => {
                      setNewReceivingDoctor(doc);
                      if (doc.department) setReassignDepartment(doc.department);
                    }}
                    style={[
                      styles.doctorDirectoryCard,
                      isSelected && styles.doctorDirectoryCardActive
                    ]}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={[styles.docItemName, isSelected && { color: COLORS.primary }]}>
                        {doc.name}
                      </Text>
                      {doc.verificationStatus === 'VERIFIED' ? (
                        <Text style={{ fontSize: 11, color: '#059669', fontWeight: '800' }}>✓ Verified</Text>
                      ) : doc.verificationStatus === 'PENDING' ? (
                        <Text style={{ fontSize: 11, color: '#d97706', fontWeight: '700' }}>⏳ Pending</Text>
                      ) : (
                        <Text style={{ fontSize: 11, color: '#64748b', fontWeight: '600' }}>Unverified</Text>
                      )}
                    </View>
                    <Text style={styles.docItemSub}>
                      {doc.specialization} • Department: {doc.department}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Input
              label="Receiving Department"
              value={reassignDepartment}
              onChangeText={setReassignDepartment}
              placeholder="e.g. ICU / Surgical Ward"
            />

            <Input
              label="Clinical Reason for Reassignment *"
              required
              multiline
              numberOfLines={2}
              value={reassignReason}
              onChangeText={setReassignReason}
              placeholder="e.g. Attending physician called into emergency surgery; handing over care to Dr. Vance."
            />

            <View style={styles.modalButtonsRow}>
              <Button
                title="Cancel"
                onPress={() => setShowReassignModal(false)}
                variant="outline"
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button
                title={submittingReassign ? "Reassigning..." : "Confirm Reassignment"}
                onPress={handleReassignSubmit}
                disabled={submittingReassign || !newReceivingDoctor || !reassignReason.trim()}
                variant="primary"
                style={{ flex: 2, marginLeft: 6 }}
              />
            </View>
          </Card>
        </View>
      </Modal>

      {/* ASSIGNMENT HISTORY MODAL (Section 5.E Requirement) */}
      <Modal visible={showHistoryModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.modalTitle}>Referral Ownership Audit History</Text>
              <TouchableOpacity onPress={() => setShowHistoryModal(false)}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.textSecondary }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Referral ID: <Text style={{ fontWeight: '800', color: COLORS.primary }}>{selectedReferralHistory?.referralId}</Text>
            </Text>

            <ScrollView style={{ maxHeight: 380, marginTop: 8 }} nestedScrollEnabled>
              {(selectedReferralHistory?.assignmentHistory || []).length === 0 ? (
                <Text style={{ textAlign: 'center', padding: 20, color: COLORS.textSecondary }}>
                  No historical assignment changes recorded.
                </Text>
              ) : (
                selectedReferralHistory.assignmentHistory.map((item, idx) => (
                  <View key={idx} style={styles.historyTimelineItem}>
                    <View style={styles.historyDot} />
                    <View style={styles.historyBody}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={styles.historyStepTitle}>
                          {item.previousReceivingDoctorName
                            ? `${item.previousReceivingDoctorName} ➔ ${item.newReceivingDoctorName}`
                            : `Assigned to ${item.newReceivingDoctorName}`}
                        </Text>
                        <Text style={styles.historyTime}>
                          {new Date(item.timestamp).toLocaleString()}
                        </Text>
                      </View>
                      <Text style={styles.historyReason}>Reason: "{item.reason}"</Text>
                      <Text style={styles.historyAuthor}>
                        Authorized By: {item.assignedByUsername || 'Attending Clinician'}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <Button
              title="Close Audit History"
              onPress={() => setShowHistoryModal(false)}
              variant="outline"
              style={{ marginTop: 12 }}
            />
          </Card>
        </View>
      </Modal>

      {/* PHASE 3 MODAL 1: REJECTION MODAL */}
      <Modal visible={showRejectModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={[styles.modalTitle, { color: '#DC2626' }]}>Reject Referral</Text>
              <TouchableOpacity onPress={() => setShowRejectModal(false)}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.textSecondary }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Referral ID: <Text style={{ fontWeight: '800', color: COLORS.primary }}>{rejectTargetRef?.referralId}</Text> | Patient: {rejectTargetRef?.patientName}
            </Text>

            <View style={[styles.rejectionNoticeBox, { marginVertical: 8 }]}>
              <Text style={[styles.rejectionNoticeTitle, { fontSize: 12 }]}>
                ⚠️ A mandatory clinical justification reason is required to reject a referral.
              </Text>
              <Text style={[styles.rejectionNoticeSub, { marginTop: 2 }]}>
                This justification will be permanently recorded in the immutable audit timeline and returned to the referring institution for escalation/reassignment.
              </Text>
            </View>

            <Input
              label="Clinical Justification for Rejection *"
              required
              multiline
              numberOfLines={3}
              value={rejectionReason}
              onChangeText={setRejectionReason}
              placeholder="e.g. Unit operating at maximum ventilator capacity; unable to safely admit ICU level sepsis. Recommend escalation to Regional Trauma Center."
            />

            <View style={styles.modalButtonsRow}>
              <Button
                title="Cancel"
                onPress={() => setShowRejectModal(false)}
                variant="outline"
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button
                title={submittingReject ? "Rejecting..." : "Confirm Rejection"}
                onPress={handleRejectSubmit}
                disabled={submittingReject || !rejectionReason.trim()}
                variant="critical"
                style={{ flex: 2, marginLeft: 6 }}
              />
            </View>
          </Card>
        </View>
      </Modal>

      {/* PHASE 3 MODAL 2: TREATMENT DOCUMENTATION MODAL */}
      <Modal visible={showTreatmentModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <Card style={[styles.modalCard, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.modalTitle}>Document Clinical Treatment</Text>
              <TouchableOpacity onPress={() => setShowTreatmentModal(false)}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.textSecondary }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Referral: <Text style={{ fontWeight: '800', color: COLORS.primary }}>{treatmentTargetRef?.referralId}</Text> | Patient: {treatmentTargetRef?.patientName} ({treatmentTargetRef?.patientId})
            </Text>

            <ScrollView style={{ maxHeight: 420, marginTop: 8 }} nestedScrollEnabled>
              <Input
                label="Treatment Summary *"
                required
                multiline
                numberOfLines={3}
                value={treatmentSummary}
                onChangeText={setTreatmentSummary}
                placeholder="Detail procedures, clinical response, stabilization, and interventions delivered..."
              />

              <Input
                label="Clinical Observations"
                multiline
                numberOfLines={2}
                value={clinicalObservations}
                onChangeText={setClinicalObservations}
                placeholder="e.g. Lactate cleared from 4.8 to 1.9 mmol/L; blood pressure stabilized on low-dose norepinephrine."
              />

              <Input
                label="Procedures Performed (comma separated)"
                value={proceduresPerformed}
                onChangeText={setProceduresPerformed}
                placeholder="e.g. Arterial line placement, Central line insertion, Endotracheal intubation"
              />

              <Input
                label="Medications Administered (comma separated)"
                value={medicationsAdministered}
                onChangeText={setMedicationsAdministered}
                placeholder="e.g. Norepinephrine 0.08mcg/kg/min, Meropenem 1g IV TDS"
              />

              {/* Follow-up Required Toggle */}
              <View style={[styles.rejectionNoticeBox, { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', marginVertical: 8 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity
                    onPress={() => setFollowUpRequired(!followUpRequired)}
                    style={[styles.checkbox, followUpRequired && styles.checkboxActive]}
                  >
                    {followUpRequired && <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 12 }}>✓</Text>}
                  </TouchableOpacity>
                  <Text style={[styles.duplicateCheckText, { color: '#92400E', fontWeight: '700' }]}>
                    This patient requires structured follow-up clinical care.
                  </Text>
                </View>
              </View>

              {followUpRequired && (
                <Input
                  label="Follow-up Instructions *"
                  required
                  multiline
                  numberOfLines={2}
                  value={followUpInstructions}
                  onChangeText={setFollowUpInstructions}
                  placeholder="e.g. Repeat arterial blood gas and inflammatory markers in 12h; outpatient clinic review in 7 days."
                />
              )}
            </ScrollView>

            <View style={styles.modalButtonsRow}>
              <Button
                title="Cancel"
                onPress={() => setShowTreatmentModal(false)}
                variant="outline"
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button
                title={submittingTreatment ? "Saving..." : "Save Documentation"}
                onPress={handleTreatmentSubmit}
                disabled={submittingTreatment || !treatmentSummary.trim() || (followUpRequired && !followUpInstructions.trim())}
                variant="primary"
                style={{ flex: 2, marginLeft: 6 }}
              />
            </View>
          </Card>
        </View>
      </Modal>

      {/* PHASE 3 MODAL 3: CARE CONFIRMATION MODAL */}
      <Modal visible={showCareConfirmModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.modalTitle}>Confirm Clinical Care</Text>
              <TouchableOpacity onPress={() => setShowCareConfirmModal(false)}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.textSecondary }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Referral ID: <Text style={{ fontWeight: '800', color: COLORS.primary }}>{careConfirmTargetRef?.referralId}</Text>
            </Text>

            <View style={[styles.careConfirmedBox, { marginVertical: 8 }]}>
              <Text style={styles.careConfirmedText}>
                Please confirm that the clinical interventions and treatment documented have been delivered and the patient condition is verified.
              </Text>
            </View>

            <Input
              label="Attending Care Confirmation Summary"
              multiline
              numberOfLines={2}
              value={confirmationSummary}
              onChangeText={setConfirmationSummary}
              placeholder="e.g. Patient condition verified and stable. Clinical handover complete."
            />

            {careConfirmTargetRef?.treatmentDocumentation?.followUpRequired && (
              <View style={[styles.followUpAlertBox, { marginVertical: 8 }]}>
                <Text style={styles.followUpAlertTitle}>⚠️ Follow-Up Care Requirement</Text>
                <Text style={styles.followUpAlertText}>
                  Instructions: {careConfirmTargetRef.treatmentDocumentation.followUpInstructions}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => setFollowUpAddressed(!followUpAddressed)}
                    style={[styles.checkbox, followUpAddressed && styles.checkboxActive]}
                  >
                    {followUpAddressed && <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 12 }}>✓</Text>}
                  </TouchableOpacity>
                  <Text style={[styles.duplicateCheckText, { color: '#92400E', fontWeight: '700' }]}>
                    Follow-up requirement is addressed or appointment scheduled.
                  </Text>
                </View>

                <Input
                  label="Follow-up Plan / Resolution"
                  value={followUpPlan}
                  onChangeText={setFollowUpPlan}
                  placeholder="e.g. Outpatient clinic slot reserved for next Tuesday."
                />
              </View>
            )}

            <View style={styles.modalButtonsRow}>
              <Button
                title="Cancel"
                onPress={() => setShowCareConfirmModal(false)}
                variant="outline"
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button
                title={submittingCareConfirm ? "Confirming..." : "Confirm Care"}
                onPress={handleCareConfirmSubmit}
                disabled={submittingCareConfirm}
                variant="primary"
                style={{ flex: 2, marginLeft: 6 }}
              />
            </View>
          </Card>
        </View>
      </Modal>

      {/* PHASE 3 MODAL 4: REFERRAL CLOSURE MODAL */}
      <Modal visible={showCloseModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.modalTitle}>Complete & Close Referral</Text>
              <TouchableOpacity onPress={() => setShowCloseModal(false)}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.textSecondary }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Referral ID: <Text style={{ fontWeight: '800', color: COLORS.primary }}>{closeTargetRef?.referralId}</Text>
            </Text>

            <View style={[styles.treatmentPreviewBox, { marginVertical: 8 }]}>
              <Text style={[styles.treatmentPreviewTitle, { fontSize: 13 }]}>Pre-Closure Requirements Verification:</Text>
              <Text style={styles.treatmentDetailText}>✓ Documented Clinical Treatment: Verified</Text>
              <Text style={styles.treatmentDetailText}>✓ Attending Care Confirmation: Verified</Text>
              <Text style={styles.treatmentDetailText}>
                {closeTargetRef?.treatmentDocumentation?.followUpRequired
                  ? '✓ Follow-Up Care Requirement: Addressed & Scheduled'
                  : '✓ Follow-Up Care Requirement: None'}
              </Text>
            </View>

            <Input
              label="Final Closure Notes"
              multiline
              numberOfLines={2}
              value={closureNotes}
              onChangeText={setClosureNotes}
              placeholder="e.g. Patient successfully discharged or transferred to general ward. Clinical handoff closed."
            />

            <View style={styles.modalButtonsRow}>
              <Button
                title="Cancel"
                onPress={() => setShowCloseModal(false)}
                variant="outline"
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button
                title={submittingClose ? "Closing..." : "Close Referral"}
                onPress={handleCloseSubmit}
                disabled={submittingClose}
                variant="primary"
                style={{ flex: 2, marginLeft: 6 }}
              />
            </View>
          </Card>
        </View>
      </Modal>

      {/* PHASE 3 MODAL 5: LIFECYCLE AUDIT TIMELINE MODAL */}
      <Modal visible={showTimelineModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <Card style={[styles.modalCard, { maxHeight: '85%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.modalTitle}>Referral Lifecycle Audit Timeline</Text>
              <TouchableOpacity onPress={() => setShowTimelineModal(false)}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.textSecondary }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Referral: <Text style={{ fontWeight: '800', color: COLORS.primary }}>{selectedTimelineRef?.referralId}</Text> | Current Status: <Text style={{ fontWeight: '700' }}>{selectedTimelineRef?.status}</Text>
            </Text>

            {loadingTimeline && <Text style={styles.loadingText}>Loading audit timeline...</Text>}

            {!loadingTimeline && (
              <ScrollView style={{ maxHeight: 420, marginTop: 8 }} nestedScrollEnabled>
                {timelineEvents.length === 0 ? (
                  <Text style={{ textAlign: 'center', padding: 20, color: COLORS.textSecondary }}>
                    No timeline events recorded.
                  </Text>
                ) : (
                  timelineEvents.map((event, idx) => (
                    <View key={idx} style={styles.historyTimelineItem}>
                      <View style={[styles.historyDot, { backgroundColor: event.eventType === 'REFERRAL_CLOSED' ? '#10B981' : (event.eventType === 'REFERRAL_REJECTED' ? '#DC2626' : COLORS.primary) }]} />
                      <View style={styles.historyBody}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Badge
                            label={event.eventType.replace(/_/g, ' ')}
                            variant={event.eventType === 'REFERRAL_CLOSED' ? 'success' : (event.eventType === 'REFERRAL_REJECTED' ? 'critical' : 'info')}
                          />
                          <Text style={styles.historyTime}>
                            {new Date(event.timestamp).toLocaleString()}
                          </Text>
                        </View>
                        {event.previousStatus && event.newStatus && event.previousStatus !== event.newStatus && (
                          <Text style={[styles.historyStepTitle, { marginTop: 4 }]}>
                            Status Transition: <Text style={{ color: COLORS.textSecondary }}>{event.previousStatus}</Text> ➔ <Text style={{ color: COLORS.primary }}>{event.newStatus}</Text>
                          </Text>
                        )}
                        {event.notes ? <Text style={styles.historyReason}>Notes: "{event.notes}"</Text> : null}
                        {event.reason ? <Text style={[styles.historyReason, { color: '#DC2626' }]}>Reason: "{event.reason}"</Text> : null}
                        <Text style={styles.historyAuthor}>
                          Actor: {event.performingUsername || 'Clinician'} ({event.performingUserRole || 'doctor'})
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            )}

            <Button
              title="Close Timeline"
              onPress={() => setShowTimelineModal(false)}
              variant="outline"
              style={{ marginTop: 12 }}
            />
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: COLORS.background
  },
  header: {
    marginBottom: 14
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 0.5
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#D1FAE5',
    borderColor: '#10B981',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12
  },
  successBannerText: {
    color: '#065F46',
    fontSize: 13,
    fontWeight: '700',
    flex: 1
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12
  },
  errorBannerText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
    flex: 1
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16
  },
  tabButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#FFF',
    marginRight: 8,
    marginBottom: 8
  },
  tabButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary
  },
  tabButtonTextActive: {
    color: '#FFF'
  },
  referralFilterBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
    marginRight: 6,
    marginBottom: 6
  },
  filterChipActive: {
    backgroundColor: COLORS.primary
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary
  },
  filterChipTextActive: {
    color: '#FFF'
  },
  loadingText: {
    textAlign: 'center',
    marginVertical: 20,
    fontSize: 14,
    color: COLORS.textSecondary
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center'
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 6
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center'
  },
  screeningCard: {
    marginBottom: 14,
    borderRadius: 8,
    borderWidth: 1.5
  },
  flaggedBorder: {
    borderColor: '#EF4444'
  },
  normalBorder: {
    borderColor: COLORS.border
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  patientNameText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  pidText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginLeft: 6
  },
  demographicsText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  screeningIdText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
    fontFamily: 'monospace'
  },
  flagReasonBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 8
  },
  flagReasonTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
    marginBottom: 2
  },
  flagReasonItem: {
    fontSize: 12,
    color: '#B91C1C',
    marginLeft: 4
  },
  vitalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: 6,
    backgroundColor: '#F8FAFC',
    padding: 6,
    borderRadius: 6
  },
  vitalChip: {
    fontSize: 12,
    color: COLORS.textPrimary,
    marginRight: 12,
    fontWeight: '600'
  },
  referralLinkedBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  referralLinkedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary
  },
  referralLinkedSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  referralActionRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  normalNoReferralText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600'
  },
  referralCard: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.primary
  },
  referralIdBig: {
    fontSize: 15,
    fontWeight: '900',
    color: COLORS.primary,
    fontFamily: 'monospace'
  },
  patientMetaText: {
    fontSize: 13,
    color: COLORS.textPrimary,
    marginTop: 2
  },
  screeningMetaText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 1
  },
  doctorOwnershipGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    marginVertical: 8
  },
  doctorCol: {
    flex: 1
  },
  doctorColArrow: {
    paddingHorizontal: 10
  },
  ownershipLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textSecondary,
    marginBottom: 2
  },
  doctorNameBold: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  hospSub: {
    fontSize: 11,
    color: COLORS.textSecondary
  },
  assignmentDateText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  refReasonBox: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 8,
    borderRadius: 6,
    marginVertical: 6
  },
  refReasonLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary
  },
  refReasonText: {
    fontSize: 12,
    color: COLORS.textPrimary,
    marginTop: 2
  },
  referralFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border
  },
  historyBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: '#F1F5F9'
  },
  historyBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary
  },
  row: {
    flexDirection: 'row'
  },
  sectionHeaderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 8
  },
  vitalsFormContainer: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginVertical: 10
  },
  liveCdsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderRadius: 6,
    padding: 8,
    marginTop: 8
  },
  liveCdsTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  liveCdsSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  investigationsFormContainer: {
    marginVertical: 8
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4
  },
  miniChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 6,
    backgroundColor: '#FFF'
  },
  miniChipActive: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary
  },
  miniChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary
  },
  invItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  invItemText: {
    fontSize: 12,
    color: COLORS.textPrimary
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10
  },
  checkboxActive: {
    backgroundColor: COLORS.primary
  },
  consentText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    flex: 1
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16
  },
  modalCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 18,
    maxHeight: '90%'
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.primary
  },
  modalSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 8
  },
  modalPatientBox: {
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8
  },
  modalPatientName: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  modalCdsAlert: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
    marginTop: 1
  },
  doctorDirectoryList: {
    maxHeight: 130,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    marginBottom: 8,
    backgroundColor: '#FAFAFA'
  },
  doctorDirectoryCard: {
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFF'
  },
  doctorDirectoryCardActive: {
    backgroundColor: '#E0F2FE',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary
  },
  docItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary
  },
  docItemSub: {
    fontSize: 11,
    color: COLORS.textSecondary
  },
  docItemHosp: {
    fontSize: 10,
    color: COLORS.primary,
    fontWeight: '600'
  },
  currentDocNoticeBox: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    padding: 8,
    borderRadius: 6,
    marginBottom: 8
  },
  currentDocNoticeTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1E40AF'
  },
  currentDocNoticeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E3A8A'
  },
  historyTimelineItem: {
    flexDirection: 'row',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginTop: 4,
    marginRight: 8
  },
  historyBody: {
    flex: 1
  },
  historyStepTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  historyTime: {
    fontSize: 11,
    color: COLORS.textSecondary
  },
  historyReason: {
    fontSize: 12,
    color: COLORS.textPrimary,
    marginTop: 2,
    fontStyle: 'italic'
  },
  historyAuthor: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 1
  },
  prioritySelectorRow: {
    flexDirection: 'row',
    marginBottom: 8
  },
  priorityChip: {
    flex: 1,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 3,
    backgroundColor: '#FFF'
  },
  priorityChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary
  },
  priorityChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary
  },
  duplicateWarningBox: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 6
  },
  duplicateWarningTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E'
  },
  duplicateCheckText: {
    fontSize: 11,
    color: '#92400E',
    fontWeight: '700',
    flex: 1
  },
  modalButtonsRow: {
    flexDirection: 'row',
    marginTop: 12
  },
  bold: {
    fontWeight: '700'
  },
  // Phase 3 Styles
  rejectionNoticeBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 6
  },
  rejectionNoticeTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#991B1B'
  },
  rejectionNoticeReason: {
    fontSize: 12,
    color: '#B91C1C',
    fontStyle: 'italic',
    marginTop: 2
  },
  rejectionNoticeSub: {
    fontSize: 11,
    color: '#7F1D1D',
    marginTop: 4
  },
  treatmentPreviewBox: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 6
  },
  treatmentPreviewTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534'
  },
  treatmentPreviewText: {
    fontSize: 12,
    color: '#15803D',
    marginTop: 2
  },
  treatmentDetailText: {
    fontSize: 11,
    color: '#14532D',
    marginTop: 2
  },
  followUpAlertBox: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 6
  },
  followUpAlertTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E'
  },
  followUpAlertText: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2
  },
  careConfirmedBox: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 6
  },
  careConfirmedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857'
  },
  closureSuccessBox: {
    backgroundColor: '#F0FDF4',
    borderColor: '#22C55E',
    borderWidth: 1.5,
    borderRadius: 6,
    padding: 8,
    marginVertical: 6
  },
  closureSuccessTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803D'
  },
  closureSuccessText: {
    fontSize: 12,
    color: '#166534',
    marginTop: 2
  },
  closureSuccessSub: {
    fontSize: 11,
    color: '#15803D',
    marginTop: 2
  },
  lifecycleActionBar: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 8
  },
  actionButtonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap'
  }
});
