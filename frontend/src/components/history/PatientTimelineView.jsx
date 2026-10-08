import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Card, Badge, Button } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';

export function PatientTimelineView({ pid, onSelectVersion, onBack }) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (pid) {
      fetchTimeline();
    }
  }, [pid]);

  const fetchTimeline = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPatientTimeline(pid);
      setTimeline(res.timeline || []);
    } catch (err) {
      setError(err.message || 'Failed to load timeline.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Button title="← Back" onPress={onBack} size="small" variant="outline" style={{ alignSelf: 'flex-start' }} />
        <Text style={styles.title}>PATIENT IMMUTABLE TIMELINE</Text>
        <Text style={styles.sub}>Patient ID: <Text style={{ fontWeight: '700', color: COLORS.primary }}>{pid}</Text></Text>
      </View>

      {loading && <Text style={styles.infoText}>Loading transfer history timeline...</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {!loading && timeline.length === 0 && (
        <Text style={styles.infoText}>No transfer history found for this Patient ID.</Text>
      )}

      {timeline.map((item, idx) => (
        <View key={item._id} style={styles.timelineNode}>
          <View style={styles.leftLineCol}>
            <View style={[styles.dot, item.isCurrent && styles.activeDot]} />
            {idx < timeline.length - 1 && <View style={styles.line} />}
          </View>
          <View style={styles.contentCol}>
            <Card style={item.isCurrent ? styles.currentCard : {}}>
              <View style={styles.cardHeader}>
                <Text style={styles.hospitals}>{item.fh} ➔ {item.th}</Text>
                {item.isCurrent && <Badge label="CURRENT ACTIVE VERSION" variant="success" />}
              </View>
              <Text style={styles.detailLine}>Version: <Text style={styles.bold}>v{item.version}</Text> | Priority: <Text style={styles.bold}>{item.priority}</Text></Text>
              <Text style={styles.detailLine}>Diagnosis: <Text style={styles.bold}>{item.pd}</Text></Text>
              <Text style={styles.detailLine}>Doctor: {item.issuerUsername} | Date: {new Date(item.submittedAt).toLocaleString()}</Text>
              <Text style={styles.statusLine}>Status: <Text style={{ fontWeight: '700', color: item.status === 'DISCREPANCY' ? COLORS.critical : COLORS.primary }}>{item.status}</Text></Text>

              {item.history && item.history.length > 0 && (
                <View style={styles.historyLogs}>
                  <Text style={styles.logTitle}>Audit Log Events:</Text>
                  {item.history.map((h, i) => (
                    <Text key={i} style={styles.logItem}>• [{new Date(h.timestamp).toLocaleTimeString()}] {h.action}: {h.notes}</Text>
                  ))}
                </View>
              )}

              <Button
                title="View Full Record"
                onPress={() => onSelectVersion(item)}
                variant="outline"
                size="small"
                style={{ marginTop: 8 }}
              />
            </Card>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxWidth: 700,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
    marginTop: 8,
  },
  sub: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  infoText: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    marginVertical: 20,
  },
  errorText: {
    color: COLORS.critical,
    textAlign: 'center',
    marginVertical: 10,
  },
  timelineNode: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  leftLineCol: {
    width: 24,
    alignItems: 'center',
    marginRight: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#B0BEC5',
    marginTop: 6,
  },
  activeDot: {
    backgroundColor: COLORS.primary,
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: '#CFD8DC',
    marginVertical: 4,
  },
  contentCol: {
    flex: 1,
  },
  currentCard: {
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  hospitals: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  detailLine: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  statusLine: {
    fontSize: 13,
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  bold: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  historyLogs: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#ECEFF1',
  },
  logTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  logItem: {
    fontSize: 11,
    color: COLORS.textSecondary,
  }
});
