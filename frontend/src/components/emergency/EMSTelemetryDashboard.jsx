import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Card, Button, Input, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';

export function EMSTelemetryDashboard({ transfer }) {
  const [eta, setEta] = useState(8); // minutes
  const [status, setStatus] = useState('EN_ROUTE');
  const [liveVitals, setLiveVitals] = useState({
    hr: transfer?.vit?.hr || 92,
    bp: transfer?.vit?.bp || '124/82',
    spo2: transfer?.vit?.spo2 || 97,
    rr: transfer?.vit?.rr || 18,
  });

  const [chatMessages, setChatMessages] = useState([
    { id: 1, sender: 'Paramedic Team A', time: '10:14 AM', text: 'Patient loaded into Unit 402. IV access established (18G LFA).' },
    { id: 2, sender: 'ER Triage Nurse', time: '10:15 AM', text: 'Received. Resuscitation Bay 2 prepped and ready.' },
    { id: 3, sender: 'Paramedic Team A', time: '10:18 AM', text: 'SpO2 stable at 97% on 2L O2 via nasal cannula. ETA 8 mins.' }
  ]);
  const [newMessage, setNewMessage] = useState('');

  // Live telemetry heart-rate simulation
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveVitals(prev => ({
        ...prev,
        hr: Math.min(130, Math.max(60, prev.hr + (Math.floor(Math.random() * 5) - 2))),
        spo2: Math.min(100, Math.max(90, prev.spo2 + (Math.floor(Math.random() * 3) - 1)))
      }));
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    const msg = {
      id: Date.now(),
      sender: 'ER Command',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: newMessage.trim()
    };
    setChatMessages([...chatMessages, msg]);
    setNewMessage('');
  };

  return (
    <Card
      title="🚑 REAL-TIME EMS TELEMETRY & INCIDENT DASHBOARD"
      subtitle="Live ambulance tracking, vital streaming & secure ER incident team feed"
      style={{ borderColor: COLORS.primary, borderWidth: 1.5, marginBottom: 16 }}
    >
      {/* Top Status & ETA Bar */}
      <View style={styles.statusRow}>
        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>AMBULANCE STATUS</Text>
          <View style={styles.badgeRow}>
            <View style={styles.livePulse} />
            <Text style={styles.statusText}>{status.replace('_', ' ')}</Text>
          </View>
        </View>

        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>ESTIMATED ARRIVAL (ETA)</Text>
          <Text style={styles.etaText}>⏱ {eta} MINS</Text>
        </View>

        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>LOCATION</Text>
          <Text style={styles.locText}>📍 Sector 42 Expressway (2.4 km away)</Text>
        </View>
      </View>

      {/* Live Telemetry Feed Grid */}
      <Text style={styles.sectionHeader}>LIVE VITAL TELEMETRY STREAMING</Text>
      <View style={styles.telemetryGrid}>
        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryLabel}>HEART RATE</Text>
          <Text style={[styles.telemetryVal, { color: liveVitals.hr > 100 ? '#DC2626' : COLORS.primary }]}>
            {liveVitals.hr} <Text style={styles.unit}>bpm</Text>
          </Text>
        </View>

        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryLabel}>BLOOD PRESSURE</Text>
          <Text style={styles.telemetryVal}>{liveVitals.bp}</Text>
        </View>

        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryLabel}>SpO₂ LEVEL</Text>
          <Text style={[styles.telemetryVal, { color: liveVitals.spo2 < 95 ? '#D97706' : '#059669' }]}>
            {liveVitals.spo2}%
          </Text>
        </View>

        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryLabel}>RESP RATE</Text>
          <Text style={styles.telemetryVal}>{liveVitals.rr} <Text style={styles.unit}>/min</Text></Text>
        </View>
      </View>

      {/* Secure Incident Team Chat */}
      <Text style={styles.sectionHeader}>SECURE INCIDENT TEAM FEED</Text>
      <View style={styles.chatBox}>
        <ScrollView style={styles.chatScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {chatMessages.map(msg => (
            <View key={msg.id} style={styles.chatBubble}>
              <View style={styles.chatHeader}>
                <Text style={styles.chatSender}>{msg.sender}</Text>
                <Text style={styles.chatTime}>{msg.time}</Text>
              </View>
              <Text style={styles.chatText}>{msg.text}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.chatInputRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Input
              placeholder="Send message to ambulance crew..."
              value={newMessage}
              onChangeText={setNewMessage}
            />
          </View>
          <Button title="Send" onPress={handleSendMessage} variant="primary" size="small" />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  statusBox: {
    flex: 1,
    minWidth: 140,
    marginRight: 8,
    marginBottom: 6,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  livePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  etaText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#2563EB',
  },
  locText: {
    fontSize: 12,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 8,
    marginTop: 6,
    letterSpacing: 0.5,
  },
  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  telemetryCard: {
    width: '23%',
    minWidth: 110,
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
    fontSize: 18,
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
    maxHeight: 140,
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
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
