import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import * as Location from 'expo-location';
import { Card, Button, Input, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { calculateNEWS2 } from '../../utils/clinicalDecisionSupport';
import { openExternalUrl } from '../../utils/qrShareUtils';
import { PhoneCall, MessageSquare, MapPin, Navigation, Activity, RefreshCw } from 'lucide-react-native';

export function EMSTelemetryDashboard({ transfer, qrAuth = null }) {
  const [emsData, setEmsData] = useState(transfer?.emsDispatch || {});
  const [contacts, setContacts] = useState({
    ambulancePhone: transfer?.emsDispatch?.ambulancePhone || '',
    ambulanceId: transfer?.emsDispatch?.ambulanceId || '',
    ambulanceCrewName: transfer?.emsDispatch?.ambulanceCrewName || '',
    referringHospitalPhone: transfer?.emsDispatch?.referringHospitalPhone || '',
    receivingHospitalPhone: transfer?.emsDispatch?.receivingHospitalPhone || '',
    emergencyContact: transfer?.emergencyContact || '',
    patientPhone: transfer?.contactNumber || ''
  });
  const [liveVitals, setLiveVitals] = useState(transfer?.vit || {});
  const [chatMessages, setChatMessages] = useState(transfer?.emsDispatch?.incidentMessages || []);
  const [newMessage, setNewMessage] = useState('');
  const [smsDraft, setSmsDraft] = useState('');
  const [showSmsComposer, setShowSmsComposer] = useState(false);
  const [smsTarget, setSmsTarget] = useState('ambulance');
  const [statusFeedback, setStatusFeedback] = useState(null);
  const [updatingLocation, setUpdatingLocation] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLiveStatus = async () => {
    if (!transfer?._id) return;
    setRefreshing(true);
    try {
      const res = await api.getEmsStatus(transfer._id, qrAuth);
      if (res && res.success) {
        setEmsData(res.emsDispatch || {});
        if (res.contacts) setContacts(res.contacts);
        if (res.vit) setLiveVitals(res.vit);
        if (res.emsDispatch?.incidentMessages) {
          setChatMessages(res.emsDispatch.incidentMessages);
        }
      }
    } catch (e) {
      // Keep current display cleanly if offline
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLiveStatus();
    const timer = setInterval(fetchLiveStatus, 8000);
    return () => clearInterval(timer);
  }, [transfer?._id]);

  const news = calculateNEWS2(liveVitals || {});
  const criticalityLevel = emsData?.criticality?.level || (news.score >= 7 ? 'CRITICAL' : news.score >= 5 ? 'URGENT' : 'MODERATE');
  const criticalityColor = criticalityLevel === 'CRITICAL' ? '#DC2626' : criticalityLevel === 'URGENT' ? '#D97706' : '#059669';

  const loc = emsData?.currentLocation || {};
  const hasCoords = loc.lat !== null && loc.lat !== undefined && loc.lng !== null && loc.lng !== undefined;

  const handleOpenMaps = async () => {
    if (!hasCoords) return;
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
    await openExternalUrl(mapsUrl);
  };

  const handleUpdateLiveGps = async () => {
    if (!transfer?._id) return;
    setUpdatingLocation(true);
    setStatusFeedback(null);
    try {
      let lat, lng, speedKmh = 0, accuracyMeters = null, address = loc.address || '';
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
        });
        lat = Number(pos.coords.latitude.toFixed(6));
        lng = Number(pos.coords.longitude.toFixed(6));
        accuracyMeters = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null;
        speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        address = address || `Live GPS (${lat}, ${lng})`;
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setStatusFeedback('Location permission denied on this device.');
          setUpdatingLocation(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = Number(pos.coords.latitude.toFixed(6));
        lng = Number(pos.coords.longitude.toFixed(6));
        accuracyMeters = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null;
        speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        address = address || `Live GPS (${lat}, ${lng})`;
      }

      const res = await api.updateEmsLocation(
        transfer._id,
        { lat, lng, address, speedKmh, accuracyMeters, dispatchStatus: 'EN_ROUTE' },
        qrAuth
      );
      if (res?.emsDispatch) setEmsData(res.emsDispatch);
      setStatusFeedback(`Live location updated (${lat}, ${lng})`);
    } catch (err) {
      setStatusFeedback('Unable to read GPS from this browser/device.');
    } finally {
      setUpdatingLocation(false);
    }
  };

  const handleDirectCall = async (targetLabel, phone) => {
    if (!phone) {
      setStatusFeedback(`No phone number recorded for ${targetLabel}.`);
      return;
    }
    const clean = phone.replace(/[^0-9+]/g, '');
    await openExternalUrl(`tel:${clean}`);
    if (transfer?._id) {
      try {
        const res = await api.postEmsMessage(
          transfer._id,
          { text: `Initiated direct emergency call to ${targetLabel} (${phone})`, channel: 'CALL_LOG', target: phone },
          qrAuth
        );
        if (res?.incidentMessages) setChatMessages(res.incidentMessages);
      } catch (e) {}
    }
  };

  const handleOpenEmergencySms = (targetKey) => {
    setSmsTarget(targetKey);
    setSmsDraft(
      `[MEDIFORM EMERGENCY] Patient ${transfer.nam} (${transfer.pid}) | ${transfer.pd} | Criticality: ${criticalityLevel} (NEWS2 ${news.score}) | Route: ${transfer.fh} -> ${transfer.th}. Immediate status update requested.`
    );
    setShowSmsComposer(true);
  };

  const handleSendEmergencySms = async () => {
    if (!transfer?._id) return;
    try {
      const res = await api.sendEmergencySms(
        transfer._id,
        { target: smsTarget, customMessage: smsDraft },
        qrAuth
      );
      setShowSmsComposer(false);
      if (res?.incidentMessages) setChatMessages(res.incidentMessages);
      setStatusFeedback(`Emergency SMS logged for ${res.target}${res.phone ? ` (${res.phone})` : ''}. Opening SMS app...`);
      if (res?.smsUri) {
        await openExternalUrl(res.smsUri);
      }
    } catch (err) {
      setStatusFeedback(err.message || 'Failed to dispatch emergency SMS.');
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !transfer?._id) return;
    const text = newMessage.trim();
    setNewMessage('');
    try {
      const res = await api.postEmsMessage(transfer._id, { text, channel: 'IN_APP' }, qrAuth);
      if (res?.incidentMessages) setChatMessages(res.incidentMessages);
    } catch (err) {
      setChatMessages(prev => [...prev, { id: Date.now(), senderName: 'Clinician', timestamp: new Date().toISOString(), text }]);
    }
  };

  return (
    <Card
      title="🚑 LIVE LOCATION, CRITICALITY & AMBULANCE COMMAND"
      subtitle="Examine patient location & clinical criticality, and call or SMS ambulance / hospital directly"
      style={{ borderColor: criticalityColor, borderWidth: 2, marginBottom: 16 }}
      headerRight={
        <TouchableOpacity onPress={fetchLiveStatus} style={styles.refreshBtn}>
          <RefreshCw size={14} color={COLORS.primary} />
          <Text style={styles.refreshText}>{refreshing ? 'Syncing' : 'Sync'}</Text>
        </TouchableOpacity>
      }
    >
      {/* 1. CRITICALITY & LOCATION EXAMINATION BANNER */}
      <View style={styles.examRow}>
        <View style={[styles.examCard, { borderColor: criticalityColor, backgroundColor: criticalityLevel === 'CRITICAL' ? '#FEF2F2' : '#FFFBEB' }]}>
          <View style={styles.examHeader}>
            <Activity size={14} color={criticalityColor} />
            <Text style={[styles.examLabel, { color: criticalityColor }]}>PATIENT CRITICALITY</Text>
          </View>
          <Text style={[styles.examValue, { color: criticalityColor }]}>{criticalityLevel}</Text>
          <Text style={styles.examSub}>NEWS2 Score: {news.score} • {news.label}</Text>
        </View>

        <View style={styles.examCard}>
          <View style={styles.examHeader}>
            <MapPin size={14} color={COLORS.primary} />
            <Text style={styles.examLabel}>LIVE PATIENT LOCATION</Text>
          </View>
          <Text style={styles.locMain} numberOfLines={2}>
            {loc.address || (hasCoords ? `${loc.lat}, ${loc.lng}` : 'Awaiting GPS Fix from Ambulance/Origin')}
          </Text>
          <Text style={styles.examSub}>
            Status: {(emsData?.dispatchStatus || 'IN_TRANSIT').replace('_', ' ')}
            {emsData?.etaMinutes ? ` • ETA ${emsData.etaMinutes} min` : ''}
            {emsData?.distanceKm ? ` (${emsData.distanceKm} km)` : ''}
          </Text>
          <View style={styles.locBtnRow}>
            {hasCoords && (
              <TouchableOpacity onPress={handleOpenMaps} style={styles.mapPill}>
                <Navigation size={11} color="#FFF" style={{ marginRight: 4 }} />
                <Text style={styles.mapPillText}>Open Map</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={handleUpdateLiveGps} disabled={updatingLocation} style={styles.gpsPill}>
              <Text style={styles.gpsPillText}>{updatingLocation ? 'Locking GPS...' : '📍 Update GPS'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* 2. DIRECT CALL & EMERGENCY SMS COMMAND CENTER */}
      <View style={styles.commBox}>
        <Text style={styles.sectionHeader}>DIRECT AMBULANCE & HOSPITAL CONTACT (FROM TRANSFER FOLIO)</Text>
        <View style={styles.commGrid}>
          {/* Ambulance Unit Controls */}
          <View style={styles.commCard}>
            <Text style={styles.commTitle}>🚑 Ambulance {contacts.ambulanceId || 'Unit'}</Text>
            <Text style={styles.commPhone}>
              {contacts.ambulanceCrewName ? `${contacts.ambulanceCrewName} • ` : ''}
              {contacts.ambulancePhone || 'No ambulance phone recorded'}
            </Text>
            <View style={styles.commActions}>
              <Button
                title="Call Ambulance"
                onPress={() => handleDirectCall('Ambulance Crew', contacts.ambulancePhone)}
                variant="primary"
                size="small"
                icon={<PhoneCall size={13} color="#FFF" />}
                style={styles.commBtn}
              />
              <Button
                title="Emergency SMS"
                onPress={() => handleOpenEmergencySms('ambulance')}
                variant="critical"
                size="small"
                icon={<MessageSquare size={13} color="#FFF" />}
                style={styles.commBtn}
              />
            </View>
          </View>

          {/* Referring Hospital Controls */}
          <View style={styles.commCard}>
            <Text style={styles.commTitle}>🏥 {transfer.fh}</Text>
            <Text style={styles.commPhone}>
              {contacts.referringHospitalPhone || 'No hospital desk phone recorded'}
            </Text>
            <View style={styles.commActions}>
              <Button
                title="Call Hospital"
                onPress={() => handleDirectCall(transfer.fh, contacts.referringHospitalPhone)}
                variant="secondary"
                size="small"
                icon={<PhoneCall size={13} color="#FFF" />}
                style={styles.commBtn}
              />
              <Button
                title="Hospital SMS"
                onPress={() => handleOpenEmergencySms('referring_hospital')}
                variant="outline"
                size="small"
                icon={<MessageSquare size={13} color={COLORS.primary} />}
                style={styles.commBtn}
              />
            </View>
          </View>
        </View>

        {contacts.emergencyContact ? (
          <TouchableOpacity
            onPress={() => handleDirectCall('Next of Kin', contacts.emergencyContact)}
            style={styles.kinBar}
          >
            <PhoneCall size={13} color={COLORS.primary} style={{ marginRight: 6 }} />
            <Text style={styles.kinText}>Call Patient Emergency Contact: {contacts.emergencyContact}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {statusFeedback && (
        <View style={styles.feedbackBar}>
          <Text style={styles.feedbackText}>{statusFeedback}</Text>
        </View>
      )}

      {showSmsComposer && (
        <View style={styles.smsBox}>
          <Text style={styles.smsTitle}>Send Emergency SMS ({smsTarget.replace('_', ' ').toUpperCase()})</Text>
          <Input
            value={smsDraft}
            onChangeText={setSmsDraft}
            multiline
            numberOfLines={3}
            maxLength={500}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button title="Cancel" onPress={() => setShowSmsComposer(false)} variant="outline" size="small" />
            <Button title="Dispatch Emergency SMS" onPress={handleSendEmergencySms} variant="critical" size="small" />
          </View>
        </View>
      )}

      {/* 3. LIVE VITALS TELEMETRY GRID */}
      <Text style={styles.sectionHeader}>PATIENT VITALS SNAPSHOT</Text>
      <View style={styles.telemetryGrid}>
        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryLabel}>HEART RATE</Text>
          <Text style={[styles.telemetryVal, { color: (liveVitals.hr || 0) > 100 ? '#DC2626' : COLORS.primary }]}>
            {liveVitals.hr ?? '—'} <Text style={styles.unit}>bpm</Text>
          </Text>
        </View>
        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryLabel}>BP</Text>
          <Text style={styles.telemetryVal}>{liveVitals.bp || '—'}</Text>
        </View>
        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryLabel}>SpO₂</Text>
          <Text style={[styles.telemetryVal, { color: (liveVitals.spo2 || 100) < 95 ? '#D97706' : '#059669' }]}>
            {liveVitals.spo2 != null ? `${liveVitals.spo2}%` : '—'}
          </Text>
        </View>
        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryLabel}>GCS</Text>
          <Text style={styles.telemetryVal}>{liveVitals.gcs ?? '—'}</Text>
        </View>
      </View>

      {/* 4. PERSISTENT INCIDENT TEAM FEED */}
      <Text style={styles.sectionHeader}>INTER-HOSPITAL & EMS INCIDENT LOG</Text>
      <View style={styles.chatBox}>
        <ScrollView style={styles.chatScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {chatMessages.length === 0 ? (
            <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontStyle: 'italic' }}>
              No live updates logged yet. Calls, Emergency SMS, and crew notes appear here.
            </Text>
          ) : (
            chatMessages.map((msg, idx) => (
              <View key={msg._id || msg.id || idx} style={styles.chatBubble}>
                <View style={styles.chatHeader}>
                  <Text style={styles.chatSender}>
                    {msg.channel === 'SMS' ? '📲 ' : msg.channel === 'CALL_LOG' ? '📞 ' : ''}
                    {msg.senderName || msg.sender || 'Clinician'}
                  </Text>
                  <Text style={styles.chatTime}>
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (msg.time || '')}
                  </Text>
                </View>
                <Text style={styles.chatText}>{msg.text}</Text>
              </View>
            ))
          )}
        </ScrollView>
        <View style={styles.chatInputRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Input
              placeholder="Send clinical update to ambulance / ER team..."
              value={newMessage}
              onChangeText={setNewMessage}
              style={{ marginBottom: 0 }}
            />
          </View>
          <Button title="Send" onPress={handleSendMessage} variant="primary" size="small" />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  refreshText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  examRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  examCard: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  examHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  examLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  examValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  locMain: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  examSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  locBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  mapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  mapPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFF',
  },
  gpsPill: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  gpsPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  commBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  commGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  commCard: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
  },
  commTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  commPhone: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginTop: 2,
  },
  commActions: {
    flexDirection: 'row',
    gap: 6,
  },
  commBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  kinBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#EFF6FF',
    padding: 8,
    borderRadius: 6,
  },
  kinText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  feedbackBar: {
    backgroundColor: '#DCFCE7',
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
  },
  feedbackText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  smsBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: COLORS.critical,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  smsTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.critical,
    marginBottom: 6,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  telemetryCard: {
    width: '23%',
    minWidth: 100,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 10,
    marginRight: '2%',
    marginBottom: 8,
    alignItems: 'center',
  },
  telemetryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  telemetryVal: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.primary,
    marginTop: 4,
  },
  unit: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  chatBox: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 10,
  },
  chatScroll: {
    maxHeight: 150,
    marginBottom: 8,
  },
  chatBubble: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  chatSender: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.primary,
  },
  chatTime: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  chatText: {
    fontSize: 12,
    color: COLORS.textPrimary,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
