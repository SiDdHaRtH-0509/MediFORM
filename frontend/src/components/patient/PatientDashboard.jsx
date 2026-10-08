import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Card, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';

export function PatientDashboard({ user, onLogout }) {
  const [currentTransfer, setCurrentTransfer] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [selectedTransferDetails, setSelectedTransferDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchPatientData();
  }, []);

  const fetchPatientData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Use patient username as patient ID reference
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={styles.topHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brandTitle}>MediFORM Patient Portal</Text>
          <Text style={styles.welcomeText}>Welcome, <Text style={styles.bold}>{user.username}</Text></Text>
        </View>
        <Button title="Logout" onPress={onLogout} variant="outline" size="small" />
      </View>

      {/* 1. MY CURRENT TRANSFER CARD */}
      <Card title="MY CURRENT TRANSFER" subtitle="Active hospital handoff status">
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
              <Text style={styles.infoLine}><Text style={styles.bold}>Patient ID:</Text> {currentTransfer.pid}</Text>
              <Text style={styles.infoLine}><Text style={styles.bold}>Primary Diagnosis:</Text> {currentTransfer.pd}</Text>
              <Text style={styles.infoLine}><Text style={styles.bold}>Transfer Priority:</Text> {currentTransfer.priority}</Text>
              <Text style={styles.infoLine}><Text style={styles.bold}>Date:</Text> {new Date(currentTransfer.submittedAt).toLocaleDateString()}</Text>
            </View>

            <Button
              title={selectedTransferDetails ? "Hide Details" : "View Transfer Details"}
              onPress={() => setSelectedTransferDetails(selectedTransferDetails ? null : currentTransfer)}
              variant="primary"
              style={{ marginTop: 10 }}
            />
          </View>
        )}
      </Card>

      {/* DETAILED VIEW IF EXPANDED */}
      {selectedTransferDetails && (
        <Card title="AUTHORIZED CLINICAL INFORMATION" subtitle="Permitted patient transfer summary">
          <View style={styles.detailsBox}>
            <Text style={styles.sectionHeading}>Clinical Context</Text>
            <Text style={styles.detailText}><Text style={styles.bold}>Reason for Transfer:</Text> {selectedTransferDetails.rt}</Text>
            <Text style={styles.detailText}><Text style={styles.bold}>Clinical Summary:</Text> {selectedTransferDetails.sum || 'N/A'}</Text>

            <Text style={styles.sectionHeading}>Allergies</Text>
            <View style={styles.chipRow}>
              {(selectedTransferDetails.alg || []).map((a, i) => (
                <Badge key={i} label={a} variant={a === 'No Known Allergies' ? 'info' : 'critical'} style={{ marginRight: 6, marginBottom: 4 }} />
              ))}
            </View>
          </View>
        </Card>
      )}

      {/* 2. RECENT TRANSFERS */}
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

      {/* 3. PROFILE */}
      <Card title="PATIENT PROFILE">
        <Text style={styles.infoLine}><Text style={styles.bold}>Username / ID:</Text> {user.username}</Text>
        <Text style={styles.infoLine}><Text style={styles.bold}>Role:</Text> Patient</Text>
        <Text style={styles.infoLine}><Text style={styles.bold}>Account Created:</Text> {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Active'}</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxWidth: 650,
    alignSelf: 'center',
    width: '100%',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: COLORS.primary,
  },
  welcomeText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  bold: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  infoText: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    marginVertical: 14,
  },
  emptyBox: {
    padding: 16,
    backgroundColor: '#FAFAFA',
    borderRadius: 8,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  transferCardContent: {
    paddingVertical: 4,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  hospitals: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primary,
  },
  infoGrid: {
    backgroundColor: '#FAFAFA',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  infoLine: {
    fontSize: 14,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  detailsBox: {
    backgroundColor: '#FAFAFA',
    padding: 12,
    borderRadius: 8,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.primary,
    marginTop: 6,
    marginBottom: 4,
  },
  detailText: {
    fontSize: 14,
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
  }
});
