import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, CheckBox } from 'react-native';
import { Card, Button, Badge, AlertCard, Input } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { EMSTelemetryDashboard } from './EMSTelemetryDashboard';

export function EmergencyReceiverScreen({ transfer, onAcknowledgeComplete, onShowQR, onClose }) {
  const [showAckModal, setShowAckModal] = useState(false);
  const [arrivalCondition, setArrivalCondition] = useState('Stable');
  const [arrivalNotes, setArrivalNotes] = useState('');
  const [discrepancies, setDiscrepancies] = useState([]);
  const [submittingAck, setSubmittingAck] = useState(false);
  const [ackError, setAckError] = useState(null);

  if (!transfer) return null;

  // Filter Other Details by Priority (Section 11)
  const otherDetails = transfer.otherDetails || [];
  const criticalOtherDetails = otherDetails.filter(od => od.priority === 'CRITICAL');
  const importantOtherDetails = otherDetails.filter(od => od.priority === 'IMPORTANT');
  const normalOtherDetails = otherDetails.filter(od => od.priority === 'NORMAL' || !od.priority);

  // Filter Critical Medications
  const medications = transfer.med || [];
  const criticalMeds = medications.filter(m => (m.notes || '').toLowerCase().includes('critical') || (m.notes || '').toLowerCase().includes('urgent') || (m.notes || '').toLowerCase().includes('stat'));
  const otherMeds = medications.filter(m => !criticalMeds.includes(m));

  const toggleDiscrepancy = (item) => {
    if (discrepancies.includes(item)) {
      setDiscrepancies(discrepancies.filter(d => d !== item));
    } else {
      setDiscrepancies([...discrepancies, item]);
    }
  };

  const handleAcknowledgeSubmit = async () => {
    setSubmittingAck(true);
    setAckError(null);
    try {
      const res = await api.acknowledgeTransfer(transfer._id, {
        arrivalCondition,
        arrivalNotes,
        discrepancies
      });
      setShowAckModal(false);
      if (onAcknowledgeComplete) {
        onAcknowledgeComplete(res.transfer);
      }
    } catch (err) {
      setAckError(err.message || 'Failed to acknowledge transfer.');
    } finally {
      setSubmittingAck(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Top Banner */}
      <View style={styles.topHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.emergencyTitle}>EMERGENCY RECEIVER HANDOFF</Text>
          <Text style={styles.hospitalSub}>{transfer.fh} ➔ {transfer.th}</Text>
        </View>
        <Badge
          label={transfer.priority || 'Emergency'}
          variant={transfer.priority === 'Emergency' ? 'critical' : 'warning'}
        />
      </View>

      {/* Real-Time Telemetry & EMS Dashboard */}
      <EMSTelemetryDashboard transfer={transfer} />

      {/* Show Secure QR Action Banner */}
      {onShowQR && (
        <View style={styles.qrActionBanner}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.qrActionTitle}>Secure Transfer QR Code</Text>
            <Text style={styles.qrActionSub}>Generate or display valid encrypted QR session for receiving facility doctor</Text>
          </View>
          <Button
            title="Show Secure QR"
            onPress={() => onShowQR(transfer)}
            variant="primary"
            size="small"
          />
        </View>
      )}

      {/* 1. PATIENT IDENTITY */}
      <Card title="PATIENT IDENTITY" style={{ borderColor: COLORS.primary, borderWidth: 1.5 }}>
        <View style={styles.patientGrid}>
          <Text style={styles.patientName}>{transfer.nam}</Text>
          <Text style={styles.patientSub}>ID / UHID: <Text style={styles.bold}>{transfer.pid}</Text></Text>
          <Text style={styles.patientSub}>Age / Gender: <Text style={styles.bold}>{transfer.age} yrs / {transfer.gender}</Text></Text>
          <Text style={styles.patientSub}>Blood Group: <Text style={styles.bold}>{transfer.bg}</Text></Text>
        </View>
      </Card>

      {/* 2. CRITICAL ALERTS BANNER (First Viewport Requirement) */}
      {(transfer.alg && transfer.alg.length > 0 && !transfer.alg.includes('No Known Allergies')) || criticalOtherDetails.length > 0 ? (
        <AlertCard
          type="critical"
          title="HIGH RISK CLINICAL WARNINGS Surface First"
          message={`Known Allergies: ${transfer.alg ? transfer.alg.join(', ') : 'None'}`}
        />
      ) : null}

      {/* 3. ALLERGIES */}
      <Card title="KNOWN ALLERGIES" subtitle="Prominently displayed warning">
        <View style={styles.chipRow}>
          {(transfer.alg || []).map((a, i) => (
            <Badge
              key={i}
              label={a}
              variant={a === 'No Known Allergies' ? 'info' : 'critical'}
              style={{ marginRight: 8, marginBottom: 8, paddingVertical: 6, paddingHorizontal: 12 }}
            />
          ))}
        </View>
      </Card>

      {/* 4. CRITICAL MEDICATIONS */}
      {criticalMeds.length > 0 && (
        <Card title="CRITICAL MEDICATIONS" subtitle="High priority active infusions / STAT drugs">
          {criticalMeds.map((m, i) => (
            <View key={i} style={styles.medRowCritical}>
              <Text style={styles.medNameText}>{m.n} — {m.d} ({m.r}) [{m.frequency}]</Text>
              <Text style={styles.medNoteText}>Notes: {m.notes}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* 5. PRIMARY DIAGNOSIS */}
      <Card title="PRIMARY DIAGNOSIS">
        <Text style={styles.primaryDiagnosisText}>{transfer.pd}</Text>
        {transfer.secondaryDiagnosis ? (
          <Text style={styles.subDiagnosisText}>Secondary: {transfer.secondaryDiagnosis}</Text>
        ) : null}
      </Card>

      {/* 6. REASON FOR TRANSFER */}
      <Card title="REASON FOR TRANSFER">
        <Text style={styles.bodyText}>{transfer.rt}</Text>
      </Card>

      {/* 7. CRITICAL OTHER DETAILS */}
      {criticalOtherDetails.length > 0 && (
        <Card title="CRITICAL OTHER DETAILS" subtitle="Urgent clinical instructions surfaced to top">
          {criticalOtherDetails.map((od, i) => (
            <View key={i} style={styles.criticalOtherCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.critTitle}>🚨 {od.title}</Text>
                <Badge label="CRITICAL" variant="critical" />
              </View>
              <Text style={styles.critValue}>{od.value}</Text>
              <Text style={styles.critCat}>Category: {od.category}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* 8. VITALS */}
      {transfer.vit && (
        <Card title="LATEST PHYSIOLOGICAL VITALS">
          <View style={styles.vitalsGrid}>
            <View style={styles.vitalBox}><Text style={styles.vLabel}>Heart Rate</Text><Text style={styles.vVal}>{transfer.vit.hr ? `${transfer.vit.hr} bpm` : 'Missing'}</Text></View>
            <View style={styles.vitalBox}><Text style={styles.vLabel}>Blood Pressure</Text><Text style={styles.vVal}>{transfer.vit.bp || 'Missing'}</Text></View>
            <View style={styles.vitalBox}><Text style={styles.vLabel}>SpO₂</Text><Text style={styles.vVal}>{transfer.vit.spo2 ? `${transfer.vit.spo2}%` : 'Missing'}</Text></View>
            <View style={styles.vitalBox}><Text style={styles.vLabel}>Resp Rate</Text><Text style={styles.vVal}>{transfer.vit.rr ? `${transfer.vit.rr}/min` : 'Missing'}</Text></View>
            <View style={styles.vitalBox}><Text style={styles.vLabel}>Temp</Text><Text style={styles.vVal}>{transfer.vit.temp ? `${transfer.vit.temp}°C` : 'Missing'}</Text></View>
            <View style={styles.vitalBox}><Text style={styles.vLabel}>GCS</Text><Text style={styles.vVal}>{transfer.vit.gcs ? `${transfer.vit.gcs}` : 'Missing'}</Text></View>
          </View>
        </Card>
      )}

      {/* 9. OTHER MEDICATIONS */}
      {otherMeds.length > 0 && (
        <Card title="OTHER ACTIVE MEDICATIONS">
          {otherMeds.map((m, i) => (
            <View key={i} style={styles.medRowNormal}>
              <Text style={styles.medNameText}>{m.n} — {m.d} ({m.r}) [{m.frequency}]</Text>
              {m.notes ? <Text style={styles.subNote}>Notes: {m.notes}</Text> : null}
            </View>
          ))}
        </Card>
      )}

      {/* 10. INVESTIGATIONS */}
      {transfer.pi && transfer.pi.length > 0 && (
        <Card title="INVESTIGATIONS & LAB FINDINGS">
          {transfer.pi.map((item, i) => (
            <Text key={i} style={styles.investigationItem}>• {typeof item === 'string' ? item : JSON.stringify(item)}</Text>
          ))}
        </Card>
      )}

      {/* 11. OTHER DETAILS (Important & Normal) */}
      {(importantOtherDetails.length > 0 || normalOtherDetails.length > 0) && (
        <Card title="OTHER DETAILS & NURSING NOTES">
          {importantOtherDetails.map((od, i) => (
            <View key={`imp-${i}`} style={styles.otherCardImportant}>
              <View style={styles.rowBetween}>
                <Text style={styles.odTitleText}>⚡ {od.title}</Text>
                <Badge label="IMPORTANT" variant="warning" />
              </View>
              <Text style={styles.odValueText}>{od.value}</Text>
            </View>
          ))}
          {normalOtherDetails.map((od, i) => (
            <View key={`norm-${i}`} style={styles.otherCardNormal}>
              <View style={styles.rowBetween}>
                <Text style={styles.odTitleText}>{od.title}</Text>
                <Badge label={od.category} variant="neutral" />
              </View>
              <Text style={styles.odValueText}>{od.value}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* 12. CLINICAL SUMMARY */}
      <Card title="CLINICAL SUMMARY">
        <Text style={styles.bodyText}>{transfer.sum || 'No clinical summary recorded.'}</Text>
      </Card>

      {/* ACKNOWLEDGEMENT ACTION BUTTON */}
      <View style={styles.ackFooter}>
        <Button
          title={transfer.acknowledgementStatus === 'ACKNOWLEDGED' ? "✓ Arrival Already Acknowledged" : "Acknowledge Patient Arrival"}
          onPress={() => setShowAckModal(true)}
          variant={transfer.acknowledgementStatus === 'ACKNOWLEDGED' ? "secondary" : "critical"}
          style={{ width: '100%', paddingVertical: 14 }}
        />
      </View>

      {/* ACKNOWLEDGEMENT MODAL */}
      <Modal visible={showAckModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Patient Handoff Acknowledgement</Text>
            <Text style={styles.modalSub}>Record arrival condition and any clinical discrepancies</Text>

            {ackError && <Text style={styles.ackError}>{ackError}</Text>}

            <Text style={styles.fieldLabel}>Arrival Condition *</Text>
            <View style={styles.condRow}>
              <TouchableOpacity
                onPress={() => setArrivalCondition('Stable')}
                style={[styles.condBtn, arrivalCondition === 'Stable' && styles.condActiveStable]}
              >
                <Text style={[styles.condText, arrivalCondition === 'Stable' && { color: '#FFF' }]}>Stable</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setArrivalCondition('Unstable')}
                style={[styles.condBtn, arrivalCondition === 'Unstable' && styles.condActiveUnstable]}
              >
                <Text style={[styles.condText, arrivalCondition === 'Unstable' && { color: '#FFF' }]}>Unstable</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Discrepancies / Mismatches (Select if applicable)</Text>
            {[
              'Medication mismatch',
              'Allergy mismatch',
              'Missing investigation',
              'Incorrect patient information',
              'Missing document',
              'Unexpected clinical condition'
            ].map((disc, idx) => {
              const checked = discrepancies.includes(disc);
              return (
                <TouchableOpacity key={idx} onPress={() => toggleDiscrepancy(disc)} style={styles.checkboxRow}>
                  <Text style={styles.checkboxIcon}>{checked ? '☑' : '☐'}</Text>
                  <Text style={styles.checkboxLabel}>{disc}</Text>
                </TouchableOpacity>
              );
            })}

            <Input
              label="Arrival Notes"
              placeholder="e.g. Patient admitted directly to ICU Bed 4..."
              value={arrivalNotes}
              onChangeText={setArrivalNotes}
              multiline
              numberOfLines={3}
              maxLength={1000}
              counterText={`${(arrivalNotes || '').length} / 1000`}
            />

            <View style={styles.modalActions}>
              <Button title="Cancel" onPress={() => setShowAckModal(false)} variant="outline" style={{ flex: 1, marginRight: 6 }} />
              <Button
                title={submittingAck ? "Submitting..." : "Submit Receipt"}
                onPress={handleAcknowledgeSubmit}
                disabled={submittingAck}
                variant="primary"
                style={{ flex: 1, marginLeft: 6 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxWidth: 750,
    alignSelf: 'center',
    width: '100%',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  qrActionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E0F2FE',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  qrActionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.primary,
  },
  qrActionSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  emergencyTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.critical,
  },
  hospitalSub: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  patientGrid: {
    paddingVertical: 4,
  },
  patientName: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  patientSub: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  bold: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  medRowCritical: {
    backgroundColor: COLORS.criticalBg,
    borderLeftWidth: 4,
    borderColor: COLORS.critical,
    padding: 10,
    borderRadius: 6,
    marginBottom: 8,
  },
  medRowNormal: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  medNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  medNoteText: {
    fontSize: 13,
    color: COLORS.critical,
    marginTop: 2,
  },
  primaryDiagnosisText: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
  },
  subDiagnosisText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  bodyText: {
    fontSize: 15,
    color: COLORS.textPrimary,
    lineHeight: 22,
  },
  criticalOtherCard: {
    backgroundColor: COLORS.criticalBg,
    borderWidth: 1.5,
    borderColor: COLORS.critical,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  critTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.critical,
  },
  critValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  critCat: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  vitalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  vitalBox: {
    width: '32%',
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    marginRight: '1.3%',
    marginBottom: 8,
    alignItems: 'center',
  },
  vLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  vVal: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primary,
    marginTop: 4,
  },
  subNote: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  investigationItem: {
    fontSize: 14,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  otherCardImportant: {
    backgroundColor: COLORS.warningBg,
    borderWidth: 1,
    borderColor: COLORS.warning,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  otherCardNormal: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  odTitleText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  odValueText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  ackFooter: {
    marginTop: 16,
    marginBottom: 32,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 20,
    maxWidth: 500,
    width: '100%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
  },
  modalSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 14,
  },
  ackError: {
    color: COLORS.critical,
    fontSize: 13,
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  condRow: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  condBtn: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 6,
  },
  condActiveStable: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  condActiveUnstable: {
    backgroundColor: COLORS.critical,
    borderColor: COLORS.critical,
  },
  condText: {
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  checkboxIcon: {
    fontSize: 16,
    marginRight: 8,
    color: COLORS.primary,
  },
  checkboxLabel: {
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 16,
  }
});
