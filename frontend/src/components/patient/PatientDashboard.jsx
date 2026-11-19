import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Card, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { SUPPORTED_LANGUAGES, getTranslations } from '../../utils/translationService';

export function PatientDashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('transfers'); // 'transfers' | 'notifications' | 'preferences' | 'followups' | 'consent'
  const [currentTransfer, setCurrentTransfer] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [selectedTransferDetails, setSelectedTransferDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedLang, setSelectedLang] = useState('en');

  // Notification State (Phase 4)
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifFilter, setNotifFilter] = useState('all'); // 'all' | 'unread' | 'read'
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const [notifError, setNotifError] = useState(null);

  // Preference State (Phase 4)
  const [preferences, setPreferences] = useState({
    referralUpdates: true,
    appointmentReminders: true,
    followUpReminders: true,
    generalCareUpdates: true
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSavedMsg, setPrefsSavedMsg] = useState(null);

  // Follow-Up State (Phase 5)
  const [followUps, setFollowUps] = useState([]);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);
  const [followUpFilter, setFollowUpFilter] = useState('all'); // 'all' | 'upcoming' | 'overdue' | 'completed'
  const [checkInMsg, setCheckInMsg] = useState(null);

  // Consent State (Phase 7)
  const [consents, setConsents] = useState([]);
  const [loadingConsents, setLoadingConsents] = useState(false);
  const [revokingConsent, setRevokingConsent] = useState(null);
  const [revocationReason, setRevocationReason] = useState('');
  const [consentActionMsg, setConsentActionMsg] = useState(null);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [newConsent, setNewConsent] = useState({
    authorizedHospital: '',
    authorizedDoctorName: '',
    purpose: 'SPECIALIST_REFERRAL',
    durationDays: 30
  });

  const t = getTranslations(selectedLang);

  useEffect(() => {
    fetchPatientData();
    loadNotifications();
    loadPreferences();
    loadFollowUps();
    loadConsents();
  }, []);

  useEffect(() => {
    if (activeTab === 'notifications') {
      loadNotifications();
    }
    if (activeTab === 'followups') {
      loadFollowUps();
    }
    if (activeTab === 'consent') {
      loadConsents();
    }
  }, [activeTab, notifFilter]);

  const loadConsents = async () => {
    setLoadingConsents(true);
    try {
      const res = await api.getConsents();
      setConsents(res.consents || []);
    } catch (err) {
      console.warn('Unable to load consents:', err.message);
    } finally {
      setLoadingConsents(false);
    }
  };

  const handleRevokeConsent = async () => {
    if (!revokingConsent) return;
    try {
      await api.revokeConsent(
        revokingConsent._id || revokingConsent.consentId,
        revocationReason.trim() || 'Revoked by patient via portal'
      );
      setConsentActionMsg('Consent successfully revoked. Data sharing has been immediately halted.');
      setRevokingConsent(null);
      setRevocationReason('');
      setTimeout(() => setConsentActionMsg(null), 5000);
      loadConsents();
    } catch (err) {
      setConsentActionMsg(`Revocation failed: ${err.message}`);
    }
  };

  const handleGrantConsent = async () => {
    if (!newConsent.authorizedHospital.trim()) {
      setConsentActionMsg('Please enter an authorized hospital name.');
      return;
    }
    try {
      await api.grantConsent({
        authorizedHospital: newConsent.authorizedHospital.trim(),
        authorizedDoctorName: newConsent.authorizedDoctorName.trim(),
        purpose: newConsent.purpose,
        durationDays: Number(newConsent.durationDays) || 30
      });
      setConsentActionMsg('New consent record granted successfully.');
      setShowGrantModal(false);
      setNewConsent({ authorizedHospital: '', authorizedDoctorName: '', purpose: 'SPECIALIST_REFERRAL', durationDays: 30 });
      setTimeout(() => setConsentActionMsg(null), 5000);
      loadConsents();
    } catch (err) {
      setConsentActionMsg(`Grant failed: ${err.message}`);
    }
  };

  const loadFollowUps = async () => {
    setLoadingFollowUps(true);
    try {
      const res = await api.getFollowUps();
      setFollowUps(res.followUps || []);
    } catch (err) {
      console.warn('Unable to load follow-ups:', err.message);
    } finally {
      setLoadingFollowUps(false);
    }
  };

  const handlePatientCheckIn = async (followUpId) => {
    try {
      await api.recordFollowUpAttendance(followUpId, { attended: true, notes: 'Patient checked in via mobile portal' });
      setCheckInMsg('Your attendance check-in has been recorded. Please proceed to the clinic desk.');
      setTimeout(() => setCheckInMsg(null), 5000);
      loadFollowUps();
    } catch (err) {
      console.warn('Check-in failed:', err.message);
    }
  };

  const fetchPatientData = async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = user.username;
      const res = await api.getCurrentByPid(pid).catch(() => null);
      if (res && res.transfer) {
        setCurrentTransfer(res.transfer);
      }
      const timeRes = await api.getPatientTimeline(pid).catch(() => null);
      if (timeRes && timeRes.timeline) {
        setTimeline(timeRes.timeline);
      }
    } catch (err) {
      setError('Unable to fetch patient records at this time.');
    } finally {
      setLoading(false);
    }
  };

  const loadNotifications = async () => {
    setLoadingNotifs(true);
    setNotifError(null);
    try {
      let queryParam = '';
      if (notifFilter === 'unread') queryParam = 'isRead=false';
      if (notifFilter === 'read') queryParam = 'isRead=true';

      const res = await api.getNotifications(queryParam);
      setNotifications(res.notifications || []);

      const countRes = await api.getUnreadNotificationCount().catch(() => ({ unreadCount: 0 }));
      setUnreadCount(countRes.unreadCount || 0);
    } catch (err) {
      setNotifError(err.message || 'Error loading notifications.');
    } finally {
      setLoadingNotifs(false);
    }
  };

  const handleMarkAsRead = async (notifId) => {
    try {
      await api.markNotificationAsRead(notifId);
      setNotifications(prev => prev.map(n => n.notificationId === notifId ? { ...n, isRead: true, readAt: new Date().toISOString() } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.warn('Unable to mark notification as read:', err.message);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.markAllNotificationsAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true, readAt: new Date().toISOString() })));
      setUnreadCount(0);
    } catch (err) {
      console.warn('Unable to mark all as read:', err.message);
    }
  };

  const loadPreferences = async () => {
    try {
      const res = await api.getNotificationPreferences();
      if (res && res.preferences) {
        setPreferences(res.preferences);
      }
    } catch (err) {
      console.warn('Unable to load preferences:', err.message);
    }
  };

  const handleSavePreferences = async () => {
    setSavingPrefs(true);
    setPrefsSavedMsg(null);
    try {
      await api.updateNotificationPreferences(preferences);
      setPrefsSavedMsg('Communication preferences successfully saved.');
      setTimeout(() => setPrefsSavedMsg(null), 4000);
    } catch (err) {
      setNotifError(err.message || 'Error saving communication preferences.');
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleExportRecord = () => {
    if (!currentTransfer) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentTransfer, null, 2));
    if (typeof window !== 'undefined' && window.document) {
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `mediform_patient_transfer_${currentTransfer.pid || 'record'}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    }
  };

  const getNotifBadgeVariant = (type) => {
    switch (type) {
      case 'REFERRAL_CREATED':
      case 'REFERRAL_ACCEPTED':
        return 'primary';
      case 'DOCTOR_ASSIGNED':
      case 'REFERRAL_ACKNOWLEDGED':
        return 'info';
      case 'FOLLOW_UP_REQUIRED':
      case 'REFERRAL_REASSIGNED':
        return 'warning';
      case 'REFERRAL_CLOSED':
        return 'success';
      case 'REFERRAL_REJECTED':
        return 'critical';
      default:
        return 'neutral';
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brandTitle}>{t.portalTitle}</Text>
          <Text style={styles.welcomeText}>Welcome, <Text style={styles.bold}>{user.username}</Text></Text>
        </View>
        <Button title="Logout" onPress={onLogout} variant="outline" size="small" />
      </View>

      {/* Language Selector Bar */}
      <View style={styles.langBar}>
        <Text style={styles.langLabel}>🌐 {t.selectLanguage}:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          {SUPPORTED_LANGUAGES.map(lang => (
            <TouchableOpacity
              key={lang.code}
              onPress={() => setSelectedLang(lang.code)}
              style={[styles.langChip, selectedLang === lang.code && styles.langChipActive]}
            >
              <Text style={[styles.langChipText, selectedLang === lang.code && { color: '#FFF' }]}>
                {lang.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Navigation Tabs (Transfers, Notification Centre, Preferences) */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          onPress={() => setActiveTab('transfers')}
          style={[styles.tabButton, activeTab === 'transfers' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabButtonText, activeTab === 'transfers' && styles.tabButtonTextActive]}>
            📋 Active Care & Transfers
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setActiveTab('notifications')}
          style={[styles.tabButton, activeTab === 'notifications' && styles.tabButtonActive]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.tabButtonText, activeTab === 'notifications' && styles.tabButtonTextActive]}>
              🔔 Notifications
            </Text>
            {unreadCount > 0 && (
              <View style={styles.unreadCountPill}>
                <Text style={styles.unreadCountText}>{unreadCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setActiveTab('followups')}
          style={[styles.tabButton, activeTab === 'followups' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabButtonText, activeTab === 'followups' && styles.tabButtonTextActive]}>
            📅 Follow-Ups
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setActiveTab('preferences')}
          style={[styles.tabButton, activeTab === 'preferences' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabButtonText, activeTab === 'preferences' && styles.tabButtonTextActive]}>
            ⚙️ Preferences
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setActiveTab('consent')}
          style={[styles.tabButton, activeTab === 'consent' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabButtonText, activeTab === 'consent' && styles.tabButtonTextActive]}>
            🛡️ Consent & Privacy
          </Text>
        </TouchableOpacity>
      </View>

      {/* TAB 1: ACTIVE TRANSFERS & CARE */}
      {activeTab === 'transfers' && (
        <View>
          <Card title={t.activeTransfer} subtitle="Active hospital handoff status">
            {loading && <Text style={styles.infoText}>Loading your transfer information...</Text>}

            {!loading && !currentTransfer && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No Active Transfer Record</Text>
                <Text style={styles.emptySub}>
                  You currently have no active inter-hospital transfers in transit.
                </Text>
              </View>
            )}

            {currentTransfer && (
              <View style={styles.transferCardContent}>
                <View style={styles.rowBetween}>
                  <Text style={styles.hospitals}>{currentTransfer.fh} ➔ {currentTransfer.th}</Text>
                  <Badge
                    label={currentTransfer.status}
                    variant={currentTransfer.status === 'RECEIVED' ? 'success' : 'info'}
                  />
                </View>

                <View style={styles.infoGrid}>
                  <Text style={styles.infoLine}><Text style={styles.bold}>{t.patientId}:</Text> {currentTransfer.pid}</Text>
                  <Text style={styles.infoLine}><Text style={styles.bold}>{t.diagnosis}:</Text> {currentTransfer.pd}</Text>
                  <Text style={styles.infoLine}><Text style={styles.bold}>Transfer Priority:</Text> {currentTransfer.priority}</Text>
                  <Text style={styles.infoLine}><Text style={styles.bold}>Date:</Text> {new Date(currentTransfer.submittedAt).toLocaleDateString()}</Text>
                </View>

                <View style={styles.btnRow}>
                  <Button
                    title={selectedTransferDetails ? "Hide Details" : "View Transfer Details"}
                    onPress={() => setSelectedTransferDetails(selectedTransferDetails ? null : currentTransfer)}
                    variant="primary"
                    style={{ flex: 1, marginRight: 6 }}
                  />
                  <Button
                    title="📥 Export Record"
                    onPress={handleExportRecord}
                    variant="secondary"
                    style={{ flex: 1, marginLeft: 6 }}
                  />
                </View>
              </View>
            )}
          </Card>

          {selectedTransferDetails && (
            <Card title={t.emergencyCard} subtitle="Authorized clinical summary & emergency details">
              <View style={styles.detailsBox}>
                <Text style={styles.sectionHeading}>{t.reasonForTransfer}</Text>
                <Text style={styles.detailText}>{selectedTransferDetails.rt}</Text>

                <Text style={styles.sectionHeading}>{t.clinicalSummary}</Text>
                <Text style={styles.detailText}>{selectedTransferDetails.sum || 'N/A'}</Text>

                <Text style={styles.sectionHeading}>{t.allergies}</Text>
                <View style={styles.chipRow}>
                  {(selectedTransferDetails.alg || []).map((a, i) => (
                    <Badge key={i} label={a} variant={a === 'No Known Allergies' ? 'info' : 'critical'} style={{ marginRight: 6, marginBottom: 4 }} />
                  ))}
                </View>

                {selectedTransferDetails.med && selectedTransferDetails.med.length > 0 && (
                  <>
                    <Text style={styles.sectionHeading}>{t.medications}</Text>
                    {selectedTransferDetails.med.map((m, i) => (
                      <Text key={i} style={styles.detailText}>• <Text style={styles.bold}>{m.n}</Text> {m.d} {m.r}</Text>
                    ))}
                  </>
                )}
              </View>
            </Card>
          )}

          {timeline.length > 0 && (
            <Card title="RECENT TRANSFERS & HANDOFF LOG">
              {timeline.map((item) => (
                <View key={item._id} style={styles.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyHospitals}>{item.fh} ➔ {item.th}</Text>
                    <Text style={styles.historyDate}>{new Date(item.submittedAt).toLocaleString()}</Text>
                  </View>
                  <Badge label={`v${item.version} ${item.status}`} variant="neutral" />
                </View>
              ))}
            </Card>
          )}
        </View>
      )}

      {/* TAB 2: PATIENT NOTIFICATION CENTRE (Phase 4 Requirement) */}
      {activeTab === 'notifications' && (
        <Card
          title="Patient Notification Centre"
          subtitle="Real-time, privacy-preserving clinical updates on your medical transfers, appointments, and care milestones."
        >
          {/* Header Controls: Filters & Mark All Read */}
          <View style={styles.notifControlBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => setNotifFilter('all')}
                style={[styles.filterPill, notifFilter === 'all' && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillText, notifFilter === 'all' && styles.filterPillTextActive]}>
                  All ({notifications.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setNotifFilter('unread')}
                style={[styles.filterPill, notifFilter === 'unread' && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillText, notifFilter === 'unread' && styles.filterPillTextActive]}>
                  Unread ({unreadCount})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setNotifFilter('read')}
                style={[styles.filterPill, notifFilter === 'read' && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillText, notifFilter === 'read' && styles.filterPillTextActive]}>
                  Read
                </Text>
              </TouchableOpacity>
            </View>

            {unreadCount > 0 && (
              <Button
                title="✓ Mark All Read"
                onPress={handleMarkAllAsRead}
                variant="outline"
                size="small"
              />
            )}
          </View>

          {loadingNotifs && <Text style={styles.infoText}>Loading notifications...</Text>}
          {notifError && <Text style={[styles.infoText, { color: '#DC2626' }]}>{notifError}</Text>}

          {!loadingNotifs && notifications.length === 0 && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No Notifications</Text>
              <Text style={styles.emptySub}>
                You have no {notifFilter === 'all' ? '' : notifFilter} notifications at this time.
              </Text>
            </View>
          )}

          {!loadingNotifs && notifications.map((notif) => (
            <View
              key={notif.notificationId || notif._id}
              style={[
                styles.notifCard,
                !notif.isRead && styles.notifCardUnread
              ]}
            >
              <View style={styles.notifHeaderRow}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={[styles.notifTitle, !notif.isRead && styles.notifTitleUnread]}>
                    {notif.title}
                  </Text>
                  <Badge
                    label={notif.notificationType.replace(/_/g, ' ')}
                    variant={getNotifBadgeVariant(notif.notificationType)}
                    style={{ marginLeft: 6, marginVertical: 2 }}
                  />
                  {notif.isEssential && (
                    <Badge label="ESSENTIAL NOTICE" variant="critical" style={{ marginLeft: 4 }} />
                  )}
                </View>

                <Text style={styles.notifTimestamp}>
                  {new Date(notif.createdAt).toLocaleDateString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>

              <Text style={styles.notifMessage}>{notif.message}</Text>

              <View style={styles.notifFooterRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {notif.relatedReferralId && (
                    <Text style={styles.notifReferralPill}>
                      Referral: <Text style={{ fontWeight: '700' }}>{notif.relatedReferralId}</Text>
                    </Text>
                  )}
                  <Text style={styles.notifDeliveryPill}>
                    In-App Delivery: {notif.deliveryStatus || 'DELIVERED'}
                  </Text>
                </View>

                {!notif.isRead ? (
                  <TouchableOpacity
                    onPress={() => handleMarkAsRead(notif.notificationId || notif._id)}
                    style={styles.markReadBtn}
                  >
                    <Text style={styles.markReadBtnText}>Mark as Read</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.readStatusText}>✓ Read</Text>
                )}
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* TAB 3: NOTIFICATION PREFERENCES (Phase 4 Requirement) */}
      {activeTab === 'preferences' && (
        <Card
          title="Patient Communication Preferences"
          subtitle="Customize which clinical categories you receive in-app notifications for."
        >
          {prefsSavedMsg && (
            <View style={styles.prefsSuccessBox}>
              <Text style={styles.prefsSuccessText}>✓ {prefsSavedMsg}</Text>
            </View>
          )}

          {/* Essential Care Notice Banner */}
          <View style={styles.essentialNoticeCallout}>
            <Text style={styles.essentialNoticeTitle}>🛡️ Essential Clinical Communication Guarantee</Text>
            <Text style={styles.essentialNoticeText}>
              In accordance with healthcare safety standards, critical alerts regarding emergency referrals,
              vital physician reassignments, and mandatory follow-up schedules will always be delivered to preserve
              continuity of patient care, regardless of preference settings.
            </Text>
          </View>

          {/* Preference Toggles */}
          <View style={styles.prefOptionRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.prefOptionTitle}>Referral Updates</Text>
              <Text style={styles.prefOptionSub}>
                Updates when specialists are assigned, referrals accepted, or inter-hospital handoffs occur.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setPreferences({ ...preferences, referralUpdates: !preferences.referralUpdates })}
              style={[styles.prefToggle, preferences.referralUpdates && styles.prefToggleActive]}
            >
              <Text style={[styles.prefToggleText, preferences.referralUpdates && styles.prefToggleTextActive]}>
                {preferences.referralUpdates ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.prefOptionRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.prefOptionTitle}>Appointment & Consult Reminders</Text>
              <Text style={styles.prefOptionSub}>
                Scheduled specialist intakes, department arrivals, and clinical consultation notifications.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setPreferences({ ...preferences, appointmentReminders: !preferences.appointmentReminders })}
              style={[styles.prefToggle, preferences.appointmentReminders && styles.prefToggleActive]}
            >
              <Text style={[styles.prefToggleText, preferences.appointmentReminders && styles.prefToggleTextActive]}>
                {preferences.appointmentReminders ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.prefOptionRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.prefOptionTitle}>Follow-Up Reminders</Text>
              <Text style={styles.prefOptionSub}>
                Reminders when attending physicians prescribe follow-up tests, lab checks, or clinic re-evaluations.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setPreferences({ ...preferences, followUpReminders: !preferences.followUpReminders })}
              style={[styles.prefToggle, preferences.followUpReminders && styles.prefToggleActive]}
            >
              <Text style={[styles.prefToggleText, preferences.followUpReminders && styles.prefToggleTextActive]}>
                {preferences.followUpReminders ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.prefOptionRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.prefOptionTitle}>General Care Updates</Text>
              <Text style={styles.prefOptionSub}>
                Routine clinical consultation documentation notices and general care plan milestones.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setPreferences({ ...preferences, generalCareUpdates: !preferences.generalCareUpdates })}
              style={[styles.prefToggle, preferences.generalCareUpdates && styles.prefToggleActive]}
            >
              <Text style={[styles.prefToggleText, preferences.generalCareUpdates && styles.prefToggleTextActive]}>
                {preferences.generalCareUpdates ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          <Button
            title={savingPrefs ? "Saving Preferences..." : "Save Communication Preferences"}
            onPress={handleSavePreferences}
            disabled={savingPrefs}
            variant="primary"
            style={{ marginTop: 16 }}
          />
        </Card>
      )}

      {/* TAB 4: PATIENT FOLLOW-UP CARE (Phase 5 Requirement) */}
      {activeTab === 'followups' && (
        <View>
          <Card title="MY CLINICAL FOLLOW-UP CARE" subtitle="Scheduled specialist visits, re-evaluations, and required check-ups.">
            {/* Filter Chips */}
            <View style={styles.notifFilterRow}>
              {[
                { id: 'all', label: 'All Appointments' },
                { id: 'upcoming', label: 'Upcoming' },
                { id: 'overdue', label: 'Overdue / Action' },
                { id: 'completed', label: 'Completed' }
              ].map(f => (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => setFollowUpFilter(f.id)}
                  style={[styles.notifFilterChip, followUpFilter === f.id && styles.notifFilterChipActive]}
                >
                  <Text style={[styles.notifFilterText, followUpFilter === f.id && styles.notifFilterTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {checkInMsg && (
              <View style={[styles.emptyBox, { backgroundColor: '#DCFCE7', borderColor: '#86EFAC', marginVertical: 10, padding: 12 }]}>
                <Text style={{ color: '#166534', fontWeight: 'bold' }}>✓ {checkInMsg}</Text>
              </View>
            )}

            {loadingFollowUps && <Text style={styles.infoText}>Loading your scheduled follow-up care...</Text>}

            {!loadingFollowUps && followUps.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No Follow-Up Appointments Found</Text>
                <Text style={styles.emptySub}>You have no pending or scheduled follow-ups under this filter.</Text>
              </View>
            )}

            {!loadingFollowUps && followUps
              .filter(item => {
                if (followUpFilter === 'upcoming') return ['SCHEDULED', 'UPCOMING', 'DUE'].includes(item.status);
                if (followUpFilter === 'overdue') return ['OVERDUE', 'MISSED'].includes(item.status);
                if (followUpFilter === 'completed') return item.status === 'COMPLETED';
                return true;
              })
              .map(item => (
                <View
                  key={item.followUpId || item._id}
                  style={[
                    styles.notifCard,
                    (item.status === 'OVERDUE' || item.status === 'MISSED') && { borderLeftColor: COLORS.danger, backgroundColor: '#FFF5F5' }
                  ]}
                >
                  <View style={styles.notifHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifTitle}>Follow-Up: {item.followUpId}</Text>
                      <Text style={styles.notifMeta}>
                        Referral: {item.referralId} • Attending: Dr. {item.responsibleDoctorName || item.responsibleDoctorUsername}
                      </Text>
                    </View>
                    <Badge
                      text={item.status}
                      variant={
                        item.status === 'COMPLETED' ? 'success' :
                        item.status === 'DUE' ? 'warning' :
                        item.status === 'OVERDUE' || item.status === 'MISSED' ? 'danger' : 'primary'
                      }
                    />
                  </View>

                  <View style={{ marginTop: 8, gap: 4 }}>
                    <Text style={styles.infoLine}>
                      <Text style={styles.bold}>Scheduled Date & Time:</Text> {new Date(item.dueDate).toLocaleString()}
                    </Text>
                    <Text style={styles.infoLine}>
                      <Text style={styles.bold}>Facility / Location:</Text> {item.targetHospital || 'Main Center'} ({item.targetDepartment || 'General Care'})
                    </Text>
                    {item.instructions ? (
                      <Text style={styles.infoLine}>
                        <Text style={styles.bold}>Guidance:</Text> {item.instructions}
                      </Text>
                    ) : null}

                    {/* Overdue/Missed Patient Action Warning */}
                    {(item.status === 'OVERDUE' || item.status === 'MISSED') && (
                      <View style={{ backgroundColor: '#FEE2E2', padding: 8, borderRadius: 6, marginTop: 6 }}>
                        <Text style={{ color: '#991B1B', fontSize: 12, fontWeight: '600' }}>
                          ⚠️ Action Required: This visit was missed or is overdue. Please contact Dr. {item.responsibleDoctorName || item.responsibleDoctorUsername}'s clinic to reschedule your care.
                        </Text>
                      </View>
                    )}

                    {/* Attendance Status & Check-In */}
                    <View style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      {item.attendance?.attended ? (
                        <Text style={{ color: COLORS.success, fontWeight: '600', fontSize: 12 }}>
                          ✓ Attendance Checked In ({new Date(item.attendance.attendedAt).toLocaleTimeString()})
                        </Text>
                      ) : (
                        item.status !== 'COMPLETED' && item.status !== 'CANCELLED' && (
                          <Button
                            title="I am attending today (Check-In)"
                            onPress={() => handlePatientCheckIn(item.followUpId)}
                            variant="outline"
                            size="small"
                          />
                        )
                      )}
                    </View>

                    {item.clinicalCompletion?.isCompleted && (
                      <View style={{ backgroundColor: '#F0FDF4', padding: 8, borderRadius: 6, marginTop: 6 }}>
                        <Text style={{ color: '#166534', fontSize: 12, fontWeight: 'bold' }}>
                          ✓ Clinical Outcome Verified:
                        </Text>
                        <Text style={{ color: '#166534', fontSize: 12, marginTop: 2 }}>
                          {item.clinicalCompletion.outcomeNotes}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              ))}
          </Card>
        </View>
      )}

      {/* TAB 5: CONSENT MANAGEMENT & PRIVACY */}
      {activeTab === 'consent' && (
        <View>
          {consentActionMsg && (
            <View style={styles.prefsSuccessBox}>
              <Text style={styles.prefsSuccessText}>{consentActionMsg}</Text>
            </View>
          )}

          {/* Revocation Confirmation Modal */}
          {revokingConsent && (
            <Card
              title="⚠️ REVOKE DATA SHARING CONSENT"
              subtitle={`Consent ID: ${revokingConsent.consentId}`}
              style={{ borderColor: COLORS.critical, borderWidth: 1.5, marginBottom: 14 }}
            >
              <Text style={{ fontSize: 13, color: COLORS.textPrimary, marginBottom: 8, lineHeight: 18 }}>
                Are you sure you want to revoke consent for <Text style={styles.bold}>{revokingConsent.authorizedHospital}</Text>?
                {revokingConsent.authorizedDoctorName ? ` (Dr. ${revokingConsent.authorizedDoctorName})` : ''}
              </Text>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 10 }}>
                This will immediately invalidate active data sharing and any associated QR transfer sessions.
                Historical medical treatments and completed records will remain preserved for your legal health record.
              </Text>
              <Text style={[styles.bold, { fontSize: 12, marginBottom: 4 }]}>Reason for Revocation (Required):</Text>
              <TextInput
                style={styles.consentInput}
                placeholder="e.g. Treatment completed, switching providers, personal privacy preference..."
                value={revocationReason}
                onChangeText={setRevocationReason}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
                <Button
                  title="Cancel"
                  onPress={() => { setRevokingConsent(null); setRevocationReason(''); }}
                  variant="outline"
                  size="small"
                  style={{ marginRight: 8 }}
                />
                <Button
                  title="Confirm Revocation"
                  onPress={handleRevokeConsent}
                  variant="critical"
                  size="small"
                />
              </View>
            </Card>
          )}

          {/* Grant New Consent Modal / Form */}
          {showGrantModal ? (
            <Card
              title="➕ GRANT NEW DATA ACCESS CONSENT"
              subtitle="Authorize a hospital or specialist to access your MediFORM records"
              style={{ marginBottom: 14, borderColor: COLORS.primary, borderWidth: 1.5 }}
            >
              <Text style={[styles.bold, { fontSize: 12, marginBottom: 4 }]}>Authorized Hospital / Organization *</Text>
              <TextInput
                style={styles.consentInput}
                placeholder="e.g. Metropolitan Trauma Hospital, St. Jude Heart Hospital"
                value={newConsent.authorizedHospital}
                onChangeText={(text) => setNewConsent(prev => ({ ...prev, authorizedHospital: text }))}
              />

              <Text style={[styles.bold, { fontSize: 12, marginTop: 10, marginBottom: 4 }]}>Doctor Name (Optional)</Text>
              <TextInput
                style={styles.consentInput}
                placeholder="e.g. Dr. Alice Carter"
                value={newConsent.authorizedDoctorName}
                onChangeText={(text) => setNewConsent(prev => ({ ...prev, authorizedDoctorName: text }))}
              />

              <Text style={[styles.bold, { fontSize: 12, marginTop: 10, marginBottom: 4 }]}>Purpose of Disclosure</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {['SPECIALIST_REFERRAL', 'EMERGENCY_TRANSFER', 'CLINICAL_REVIEW', 'GENERAL_CARE'].map(p => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setNewConsent(prev => ({ ...prev, purpose: p }))}
                    style={[
                      styles.langChip,
                      newConsent.purpose === p && styles.langChipActive
                    ]}
                  >
                    <Text style={[styles.langChipText, newConsent.purpose === p && { color: '#FFF' }]}>
                      {p.replace('_', ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.bold, { fontSize: 12, marginBottom: 4 }]}>Consent Validity Duration (Days)</Text>
              <TextInput
                style={styles.consentInput}
                keyboardType="numeric"
                placeholder="30"
                value={String(newConsent.durationDays)}
                onChangeText={(text) => setNewConsent(prev => ({ ...prev, durationDays: text }))}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 }}>
                <Button
                  title="Cancel"
                  onPress={() => setShowGrantModal(false)}
                  variant="outline"
                  size="small"
                  style={{ marginRight: 8 }}
                />
                <Button
                  title="Authorize & Grant"
                  onPress={handleGrantConsent}
                  variant="primary"
                  size="small"
                />
              </View>
            </Card>
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.textPrimary }}>
                Active Consents ({consents.filter(c => c.status === 'GRANTED').length})
              </Text>
              <Button
                title="➕ Grant New Consent"
                onPress={() => setShowGrantModal(true)}
                variant="primary"
                size="small"
              />
            </View>
          )}

          {/* Consents List */}
          <Card
            title="CONSENT REGISTRY & PERMISSIONS"
            subtitle="Control which institutions and clinicians can view your health data"
          >
            {loadingConsents && <Text style={styles.infoText}>Loading your consent records...</Text>}

            {!loadingConsents && consents.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No Consents On Record</Text>
                <Text style={styles.emptySub}>
                  You have not granted external data sharing access to any hospital or doctor.
                </Text>
              </View>
            )}

            {!loadingConsents &&
              consents.map((consent) => (
                <View
                  key={consent._id || consent.consentId}
                  style={[
                    styles.consentCardItem,
                    consent.status === 'REVOKED' && { opacity: 0.7, backgroundColor: '#FEF2F2' },
                    consent.status === 'EXPIRED' && { opacity: 0.6, backgroundColor: '#F8FAFC' }
                  ]}
                >
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: COLORS.textPrimary }}>
                        {consent.authorizedHospital}
                      </Text>
                      {consent.authorizedDoctorName && (
                        <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: '600' }}>
                          Doctor: Dr. {consent.authorizedDoctorName}
                        </Text>
                      )}
                    </View>
                    <Badge
                      label={consent.status}
                      variant={
                        consent.status === 'GRANTED' ? 'success'
                        : consent.status === 'REVOKED' ? 'critical'
                        : 'secondary'
                      }
                    />
                  </View>

                  <View style={{ marginVertical: 6 }}>
                    <Text style={styles.infoLine}>
                      <Text style={styles.bold}>Purpose:</Text> {consent.purpose.replace('_', ' ')}
                    </Text>
                    <Text style={styles.infoLine}>
                      <Text style={styles.bold}>Consent ID:</Text> {consent.consentId}
                    </Text>
                    <Text style={styles.infoLine}>
                      <Text style={styles.bold}>Granted:</Text> {new Date(consent.grantedAt || consent.createdAt).toLocaleDateString()}
                    </Text>
                    <Text style={styles.infoLine}>
                      <Text style={styles.bold}>Expires:</Text> {new Date(consent.expiresAt).toLocaleDateString()}
                    </Text>

                    {consent.status === 'REVOKED' && (
                      <View style={{ backgroundColor: '#FEE2E2', padding: 8, borderRadius: 6, marginTop: 4 }}>
                        <Text style={{ color: '#991B1B', fontSize: 11, fontWeight: '700' }}>
                          Revoked on {new Date(consent.revokedAt).toLocaleDateString()}
                        </Text>
                        <Text style={{ color: '#991B1B', fontSize: 11 }}>
                          Reason: {consent.revocationReason || 'Patient requested withdrawal'}
                        </Text>
                      </View>
                    )}

                    {consent.status === 'EXPIRED' && (
                      <Text style={{ color: '#64748B', fontSize: 11, fontStyle: 'italic', marginTop: 2 }}>
                        Access expired automatically on {new Date(consent.expiresAt).toLocaleDateString()}
                      </Text>
                    )}
                  </View>

                  {/* Permitted Categories Pills */}
                  <View style={{ marginTop: 4, marginBottom: 8 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 4 }}>
                      Permitted Data Categories:
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      {(consent.permittedCategories || []).map((cat) => (
                        <View key={cat} style={styles.categoryPill}>
                          <Text style={styles.categoryPillText}>{cat.replace('_', ' ')}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Revoke Action */}
                  {consent.status === 'GRANTED' && (
                    <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#E2E8F0', alignItems: 'flex-end' }}>
                      <Button
                        title="Revoke Consent"
                        onPress={() => {
                          setRevokingConsent(consent);
                          setRevocationReason('');
                        }}
                        variant="critical"
                        size="small"
                      />
                    </View>
                  )}
                </View>
              ))}
          </Card>
        </View>
      )}

      {/* Account Profile Card */}
      <Card title="PATIENT PROFILE" style={{ marginTop: 12 }}>
        <Text style={styles.infoLine}><Text style={styles.bold}>Username / UHID:</Text> {user.username}</Text>
        <Text style={styles.infoLine}><Text style={styles.bold}>Role:</Text> Patient</Text>
        <Text style={styles.infoLine}><Text style={styles.bold}>Account Status:</Text> Active & Verified</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxWidth: 680,
    alignSelf: 'center',
    width: '100%',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  welcomeText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  bold: {
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    marginBottom: 14,
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: COLORS.primary,
  },
  tabButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  tabButtonTextActive: {
    color: '#FFF',
  },
  unreadCountPill: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  unreadCountText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
  },
  infoText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginVertical: 16,
  },
  emptyBox: {
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  transferCardContent: {
    marginTop: 4,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  hospitals: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.textPrimary,
    flex: 1,
  },
  infoGrid: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  infoLine: {
    fontSize: 13,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  detailsBox: {
    marginTop: 6,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.primary,
    marginTop: 10,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  detailText: {
    fontSize: 13,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ECEFF1',
  },
  historyHospitals: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  historyDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  langBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  langLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginRight: 8,
  },
  langChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    marginRight: 6,
  },
  langChipActive: {
    backgroundColor: COLORS.primary,
  },
  langChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  btnRow: {
    flexDirection: 'row',
    marginTop: 10,
  },

  // Notification Centre Styles
  notifControlBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    marginRight: 6,
  },
  filterPillActive: {
    backgroundColor: COLORS.primary,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  filterPillTextActive: {
    color: '#FFF',
  },
  notifCard: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  notifCardUnread: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
  },
  notifHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  notifTitleUnread: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  notifTimestamp: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginLeft: 6,
  },
  notifMessage: {
    fontSize: 13,
    color: COLORS.textPrimary,
    lineHeight: 18,
    marginVertical: 4,
  },
  notifFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  notifReferralPill: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginRight: 10,
  },
  notifDeliveryPill: {
    fontSize: 10,
    color: '#10B981',
    fontWeight: '700',
  },
  markReadBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#E0F2FE',
  },
  markReadBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  readStatusText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },

  // Preferences Styles
  prefsSuccessBox: {
    backgroundColor: '#D1FAE5',
    borderColor: '#10B981',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
  prefsSuccessText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  essentialNoticeCallout: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  essentialNoticeTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E',
    marginBottom: 4,
  },
  essentialNoticeText: {
    fontSize: 11,
    color: '#78350F',
    lineHeight: 16,
  },
  prefOptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  prefOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  prefOptionSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
    paddingRight: 12,
  },
  prefToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#CBD5E1',
    minWidth: 54,
    alignItems: 'center',
  },
  prefToggleActive: {
    backgroundColor: COLORS.primary,
  },
  prefToggleText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  prefToggleTextActive: {
    color: '#FFF',
  },
  consentInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    padding: 8,
    fontSize: 13,
    backgroundColor: '#FFF',
    color: COLORS.textPrimary,
  },
  consentCardItem: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  categoryPill: {
    backgroundColor: '#EEF2FF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 4,
    marginBottom: 4,
  },
  categoryPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4F46E5',
  },
});
