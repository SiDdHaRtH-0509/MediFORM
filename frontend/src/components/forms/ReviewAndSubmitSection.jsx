import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';

export function ReviewAndSubmitSection({ formData, onSubmit, isSubmitting }) {
  const otherDetails = formData.otherDetails || [];

  return (
    <Card title="Section 9 — Review & Submit Medical Transfer" subtitle="Verify all clinical data below and submit the complete handoff record">
      <View style={styles.reviewBlock}>
        <Text style={styles.blockTitle}>Patient Identity</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Name:</Text> {formData.nam || 'Not specified'}</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>ID / UHID:</Text> {formData.pid || 'Not specified'}</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Age / Gender:</Text> {formData.age ? `${formData.age} yrs` : 'N/A'} / {formData.gender || 'N/A'}</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Blood Group:</Text> {formData.bg || 'N/A'}</Text>
      </View>

      <View style={styles.reviewBlock}>
        <Text style={styles.blockTitle}>Transfer Details</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>From Facility:</Text> {formData.fh || 'Not specified'}</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>To Facility:</Text> {formData.th || 'Not specified'}</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Priority:</Text> {formData.priority || 'Emergency'}</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Reason:</Text> {formData.rt || 'Not specified'}</Text>
      </View>

      <View style={styles.reviewBlock}>
        <Text style={styles.blockTitle}>Clinical Summary & Diagnosis</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Primary Diagnosis:</Text> {formData.pd || 'Not specified'}</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Summary:</Text> {formData.sum || 'None provided'}</Text>
      </View>

      <View style={styles.reviewBlock}>
        <Text style={styles.blockTitle}>Allergies</Text>
        <View style={styles.chipRow}>
          {(formData.alg || []).length === 0 ? (
            <Text style={styles.noneText}>None recorded.</Text>
          ) : (
            (formData.alg || []).map((a, i) => (
              <Badge key={i} label={a} variant={a === 'No Known Allergies' ? 'info' : 'critical'} style={{ marginRight: 6, marginBottom: 6 }} />
            ))
          )}
        </View>
      </View>

      <View style={styles.reviewBlock}>
        <Text style={styles.blockTitle}>Active Medications ({ (formData.med || []).length })</Text>
        {(formData.med || []).length === 0 ? (
          <Text style={styles.noneText}>No active medications recorded.</Text>
        ) : (
          (formData.med || []).map((m, i) => (
            <Text key={i} style={styles.dataLine}>
              • <Text style={styles.bold}>{m.n}</Text> {m.d} {m.r} {m.frequency} {m.notes ? `(${m.notes})` : ''}
            </Text>
          ))
        )}
      </View>

      <View style={styles.reviewBlock}>
        <Text style={styles.blockTitle}>Other Details ({otherDetails.length})</Text>
        {otherDetails.length === 0 ? (
          <Text style={styles.noneText}>None recorded.</Text>
        ) : (
          otherDetails.map((od, i) => (
            <View key={i} style={styles.otherDetailRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.odTitle}>{od.title}</Text>
                <Text style={styles.odValue}>{od.value}</Text>
                <Text style={styles.odCat}>Category: {od.category}</Text>
              </View>
              <Badge
                label={od.priority}
                variant={od.priority === 'CRITICAL' ? 'critical' : (od.priority === 'IMPORTANT' ? 'warning' : 'neutral')}
              />
            </View>
          ))
        )}
      </View>

      <View style={styles.actionRow}>
        <Button
          title={isSubmitting ? "Submitting Transfer Record..." : "Submit Medical Transfer"}
          onPress={onSubmit}
          disabled={isSubmitting}
          variant="primary"
          style={{ flex: 1, paddingVertical: 14 }}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  reviewBlock: {
    padding: 12,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    marginBottom: 12,
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 6,
  },
  dataLine: {
    fontSize: 14,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  bold: {
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  noneText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  otherDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EDEBE9',
  },
  odTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  odValue: {
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  odCat: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  actionRow: {
    marginTop: 14,
  }
});

