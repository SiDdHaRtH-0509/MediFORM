import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { AIHandoverModal } from '../ui/AIHandoverModal';
import { calculateNEWS2, checkDrugAllergyConflicts } from '../../utils/clinicalDecisionSupport';

export function ReviewAndSubmitSection({ formData, onSubmit, isSubmitting }) {
  const [showAiModal, setShowAiModal] = useState(false);
  const otherDetails = formData.otherDetails || [];
  const ems = formData.emsDispatch || {};
  const news2 = calculateNEWS2(formData.vit || {});
  const conflicts = checkDrugAllergyConflicts(formData.alg || [], formData.med || []);

  return (
    <Card
      title="SECTION 10 // FOLIO REVIEW, SIGN-OFF & QR GENERATION"
      subtitle="Verify clinical transfer folio & generate encrypted QR + PIN for receiving hospital"
      style={styles.folioCard}
    >
      {/* CDS Summary Bar */}
      <View style={[styles.cdsBar, { borderColor: news2.color }]}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.textPrimary }}>
            NEWS2 Criticality: <Text style={{ color: news2.color }}>{news2.score} ({news2.riskLevel} RISK)</Text>
          </Text>
          {conflicts.length > 0 && (
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#DC2626', marginTop: 2 }}>
              ⚠️ {conflicts.length} Drug-Allergy Conflict(s) Detected!
            </Text>
          )}
        </View>
        <Button
          title="🤖 AI Handover Brief"
          onPress={() => setShowAiModal(true)}
          variant="secondary"
          size="small"
        />
      </View>

      <View style={styles.reviewGrid}>
        <View style={styles.reviewBlock}>
          <Text style={styles.blockTitle}>01. Patient Identity</Text>
          <Text style={styles.dataLine}><Text style={styles.bold}>Name:</Text> {formData.nam || 'Not specified'}</Text>
          <Text style={styles.dataLine}><Text style={styles.bold}>UHID:</Text> {formData.pid || 'Not specified'}</Text>
          <Text style={styles.dataLine}><Text style={styles.bold}>Age / Sex / BG:</Text> {formData.age || '—'}y / {formData.gender || '—'} / {formData.bg || '—'}</Text>
        </View>

        <View style={styles.reviewBlock}>
          <Text style={styles.blockTitle}>02. Hospital Routing</Text>
          <Text style={styles.dataLine}><Text style={styles.bold}>From:</Text> {formData.fh || 'Not specified'}</Text>
          <Text style={styles.dataLine}><Text style={styles.bold}>To:</Text> {formData.th || 'Not specified'}</Text>
          <Text style={styles.dataLine}><Text style={styles.bold}>Priority:</Text> {formData.priority || 'Emergency'} ({formData.receivingDepartment || 'ICU'})</Text>
        </View>
      </View>

      <View style={styles.reviewBlock}>
        <Text style={styles.blockTitle}>03. Live EMS Location & Ambulance Contacts</Text>
        <Text style={styles.dataLine}>
          <Text style={styles.bold}>Location:</Text>{' '}
          {ems.currentLocation?.lat != null
            ? `${ems.currentLocation.lat}, ${ems.currentLocation.lng}${ems.currentLocation.address ? ` (${ems.currentLocation.address})` : ''}`
            : (ems.currentLocation?.address || 'Not captured yet')}
        </Text>
        <Text style={styles.dataLine}>
          <Text style={styles.bold}>Ambulance:</Text> {ems.ambulanceId || 'Unassigned'} {ems.ambulancePhone ? `| 📞 ${ems.ambulancePhone}` : ''}
        </Text>
        <Text style={styles.dataLine}>
          <Text style={styles.bold}>Hospital Desk Phone:</Text> {ems.referringHospitalPhone || 'Not specified'}
        </Text>
      </View>

      <View style={styles.reviewBlock}>
        <Text style={styles.blockTitle}>04. Clinical Summary & Diagnosis</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Primary Diagnosis:</Text> {formData.pd || 'Not specified'}</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Reason:</Text> {formData.rt || 'Not specified'}</Text>
        <Text style={styles.dataLine}><Text style={styles.bold}>Summary:</Text> {formData.sum || 'None provided'}</Text>
      </View>

      <View style={styles.reviewBlock}>
        <Text style={styles.blockTitle}>05-09. Allergies, Meds & Special Orders</Text>
        <View style={styles.chipRow}>
          {(formData.alg || []).map((a, i) => (
            <Badge key={i} label={a} variant={a === 'No Known Allergies' ? 'info' : 'critical'} style={{ marginRight: 6, marginBottom: 6 }} />
          ))}
        </View>
        <Text style={styles.dataLine}>
          <Text style={styles.bold}>Medications:</Text> {(formData.med || []).length} active |{' '}
          <Text style={styles.bold}>Investigations:</Text> {(formData.pi || []).length} |{' '}
          <Text style={styles.bold}>Orders:</Text> {otherDetails.length}
        </Text>
      </View>

      <View style={styles.actionRow}>
        <Button
          title={isSubmitting ? "Submitting Transfer Folio..." : "Sign, Submit & Generate Secure QR + PIN"}
          onPress={onSubmit}
          disabled={isSubmitting}
          variant="primary"
          style={{ flex: 1, paddingVertical: 14 }}
        />
      </View>

      <AIHandoverModal
        visible={showAiModal}
        onClose={() => setShowAiModal(false)}
        formData={formData}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  folioCard: {
    borderTopWidth: 3,
    borderTopColor: COLORS.success,
  },
  cdsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1.5,
    marginBottom: 14,
  },
  reviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  reviewBlock: {
    flex: 1,
    minWidth: 220,
    padding: 12,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    marginBottom: 12,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.primary,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  dataLine: {
    fontSize: 13,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  bold: {
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  actionRow: {
    marginTop: 10,
  }
});
