import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Card, Input, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';

export function TransferHistoryView({ onSelectTransfer, onViewTimeline, onShowQR }) {
  const [tab, setTab] = useState('issued'); // 'issued' | 'scanned'
  const [transfers, setTransfers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchHistory();
  }, [tab]);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = tab === 'issued'
        ? await api.getDoctorIssuedHistory()
        : await api.getRecipientScannedHistory();
      setTransfers(res.transfers || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch history.');
    } finally {
      setLoading(false);
    }
  };

  const filteredTransfers = transfers.filter(t => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (t.nam || '').toLowerCase().includes(q) ||
      (t.pid || '').toLowerCase().includes(q) ||
      (t.fh || '').toLowerCase().includes(q) ||
      (t.th || '').toLowerCase().includes(q) ||
      (t.pd || '').toLowerCase().includes(q)
    );
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.tabHeader}>
        <TouchableOpacity
          onPress={() => setTab('issued')}
          style={[styles.tabBtn, tab === 'issued' && styles.activeTab]}
        >
          <Text style={[styles.tabText, tab === 'issued' && styles.activeTabText]}>Doctor Issued</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab('scanned')}
          style={[styles.tabBtn, tab === 'scanned' && styles.activeTab]}
        >
          <Text style={[styles.tabText, tab === 'scanned' && styles.activeTabText]}>Recipient Scanned</Text>
        </TouchableOpacity>
      </View>

      <Input
        placeholder="Search by Patient Name, Patient ID, Hospital, or Diagnosis..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        maxLength={100}
      />

      {loading && <Text style={styles.infoText}>Loading transfer history...</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {!loading && filteredTransfers.length === 0 && (
        <Text style={styles.infoText}>No transfers found in this view.</Text>
      )}

      {filteredTransfers.map((item) => (
        <Card key={item._id} style={{ marginBottom: 12 }}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.patientName}>{item.nam}</Text>
              <Text style={styles.subText}>ID: <Text style={styles.bold}>{item.pid}</Text> | Age: {item.age} | BG: {item.bg}</Text>
            </View>
            <Badge
              label={item.priority || 'Routine'}
              variant={item.priority === 'Emergency' ? 'critical' : 'warning'}
            />
          </View>

          <Text style={styles.hospitals}>{item.fh} ➔ {item.th}</Text>
          <Text style={styles.diagnosis}>Diagnosis: {item.pd}</Text>
          <Text style={styles.metaLine}>
            Doctor: {item.issuerUsername} | Date: {new Date(item.submittedAt).toLocaleDateString()}
          </Text>

          <View style={styles.statusRow}>
            <Badge
              label={`Status: ${item.status}`}
              variant={item.status === 'DISCREPANCY' ? 'critical' : (item.status === 'RECEIVED' ? 'success' : 'info')}
            />
            {item.isCurrent && <Badge label="v1 (Current)" variant="neutral" style={{ marginLeft: 6 }} />}
          </View>

          <View style={styles.btnRow}>
            {onShowQR && (
              <Button
                title="Show Secure QR"
                onPress={() => onShowQR(item)}
                variant="secondary"
                size="small"
                style={{ flex: 1, marginRight: 4 }}
              />
            )}
            <Button
              title="Open View"
              onPress={() => onSelectTransfer(item)}
              variant="primary"
              size="small"
              style={{ flex: 1, marginHorizontal: 2 }}
            />
            <Button
              title="Timeline"
              onPress={() => onViewTimeline(item.pid)}
              variant="outline"
              size="small"
              style={{ flex: 1, marginLeft: 4 }}
            />
          </View>
        </Card>
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
  tabHeader: {
    flexDirection: 'row',
    marginBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 3,
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  activeTabText: {
    color: COLORS.primary,
    fontWeight: '800',
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  patientName: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  subText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  hospitals: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
    marginVertical: 2,
  },
  diagnosis: {
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  metaLine: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: 6,
  },
  bold: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  statusRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  btnRow: {
    flexDirection: 'row',
  }
});
