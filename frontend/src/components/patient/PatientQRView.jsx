import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Card, Button, Badge, Input } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { UniversalQRScannerModal } from '../qr/UniversalQRScannerModal';
import { Camera, ShieldCheck, Lock } from 'lucide-react-native';

export function PatientQRView({ initialUuid = '', onReset }) {
  const [uuid, setUuid] = useState(initialUuid);
  const [pin, setPin] = useState('');
  const [patientData, setPatientData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [showScannerModal, setShowScannerModal] = useState(false);

  const handleVerifyAccess = async () => {
    if (!uuid || !pin) {
      setErrorMsg('Please enter both QR Payload UUID and 6-digit PIN.');
      return;
    }
    if (pin.length !== 6) {
      setErrorMsg('PIN must be exactly 6 numeric digits.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      // Calls validatePatientQR ONLY — PatientSafeDTO allowlist enforced
      const res = await api.validatePatientQR(uuid.trim(), pin.trim());
      setPatientData(res.patientView);
    } catch (err) {
      setErrorMsg(err.message || 'Access verification failed. Incorrect PIN or expired QR.');
    } finally {
      setLoading(false);
    }
  };

  const handlePatientScanSuccess = (patientView) => {
    setPatientData(patientView);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topHeader}>
        <Image source={require('../../../assets/logo.png')} style={{ width: 64, height: 64, resizeMode: 'contain', marginBottom: 8 }} />
        <Text style={styles.brandTitle}>MediFORM</Text>
        <Text style={styles.brandSub}>Secure Transfer Read-Only Patient Portal</Text>
      </View>

      {!patientData ? (
        /* PIN & ACCESS AUTHENTICATION STEP */
        <Card title="PATIENT READ-ONLY ACCESS VERIFICATION" subtitle="Scan QR code or enter the 6-digit security PIN provided by facility">
          {errorMsg && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            </View>
          )}

          {/* Camera Scanner Button */}
          <Button
            title="Scan QR with Camera"
            onPress={() => setShowScannerModal(true)}
            variant="secondary"
            accessibilityLabel="Scan QR code with camera"
            style={{ marginBottom: 14 }}
          />

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR ENTER CODE MANUALLY</Text>
            <View style={styles.dividerLine} />
          </View>

          <Input
            label="Transfer QR Token / UUID"
            placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
            value={uuid}
            onChangeText={setUuid}
            accessibilityLabel="Enter secure handoff code manually"
            maxLength={128}
          />

          <Input
            label="6-Digit Security PIN"
            placeholder="e.g. 123456"
            value={pin}
            onChangeText={(txt) => setPin(txt.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="numeric"
            maxLength={6}
          />

          <Button
            title={loading ? "Verifying Access..." : "Verify & View Transfer"}
            onPress={handleVerifyAccess}
            disabled={loading || !uuid || pin.length !== 6}
            variant="primary"
            style={{ marginTop: 10 }}
          />

          {onReset && (
            <Button
              title="← Back to Main Screen"
              onPress={onReset}
              variant="outline"
              style={{ marginTop: 8 }}
            />
          )}
        </Card>
      ) : (
        /* READ-ONLY PATIENT-SAFE VIEW */
        <View>
          {/* Patient Identity */}
          <Card title="PATIENT INFORMATION">
            <Text style={styles.patientName}>{patientData.patientName}</Text>
            <Text style={styles.infoLine}><Text style={styles.bold}>Patient ID / UHID:</Text> {patientData.patientId}</Text>
            <Text style={styles.infoLine}><Text style={styles.bold}>Age / Gender:</Text> {patientData.age} yrs / {patientData.gender}</Text>
            {patientData.bloodGroup && (
              <Text style={styles.infoLine}><Text style={styles.bold}>Blood Group:</Text> {patientData.bloodGroup}</Text>
            )}
          </Card>

          {/* Transfer Info */}
          <Card title="TRANSFER INFORMATION">
            <View style={styles.rowBetween}>
              <Text style={styles.hospitals}>{patientData.fromHospital} ➔ {patientData.toHospital}</Text>
              <Badge label={patientData.transferStatus} variant={patientData.transferStatus === 'RECEIVED' ? 'success' : 'info'} />
            </View>
            <Text style={styles.infoLine}><Text style={styles.bold}>Reason for Transfer:</Text> {patientData.transferReason}</Text>
            <Text style={styles.infoLine}><Text style={styles.bold}>Priority:</Text> {patientData.priority}</Text>
            <Text style={styles.infoLine}><Text style={styles.bold}>Transfer Date:</Text> {new Date(patientData.submittedAt).toLocaleString()}</Text>
          </Card>

          {/* Allergies */}
          {patientData.allergies && patientData.allergies.length > 0 && (
            <Card title="KNOWN ALLERGIES">
              <View style={styles.chipRow}>
                {patientData.allergies.map((a, i) => (
                  <Badge key={i} label={a} variant={a === 'No Known Allergies' ? 'info' : 'critical'} style={{ marginRight: 6, marginBottom: 4 }} />
                ))}
              </View>
            </Card>
          )}

          {/* Current Medications */}
          {patientData.medications && patientData.medications.length > 0 && (
            <Card title="CURRENT MEDICATIONS">
              {patientData.medications.map((m, i) => (
                <View key={i} style={styles.medRow}>
                  <Text style={styles.medName}>{m.drugName} — {m.dose} ({m.route}) [{m.frequency}]</Text>
                  {m.notes ? <Text style={styles.medNote}>Note: {m.notes}</Text> : null}
                </View>
              ))}
            </Card>
          )}

          {/* Vitals */}
          {patientData.vitals && (
            <Card title="LATEST RECORDED VITALS">
              <View style={styles.vitalsGrid}>
                <View style={styles.vitalBox}><Text style={styles.vLabel}>Heart Rate</Text><Text style={styles.vVal}>{patientData.vitals.heartRate ? `${patientData.vitals.heartRate} bpm` : 'N/A'}</Text></View>
                <View style={styles.vitalBox}><Text style={styles.vLabel}>Blood Pressure</Text><Text style={styles.vVal}>{patientData.vitals.bloodPressure || 'N/A'}</Text></View>
                <View style={styles.vitalBox}><Text style={styles.vLabel}>SpO₂</Text><Text style={styles.vVal}>{patientData.vitals.spO2 ? `${patientData.vitals.spO2}%` : 'N/A'}</Text></View>
                <View style={styles.vitalBox}><Text style={styles.vLabel}>Resp Rate</Text><Text style={styles.vVal}>{patientData.vitals.respRate ? `${patientData.vitals.respRate}/min` : 'N/A'}</Text></View>
              </View>
            </Card>
          )}

          {/* Patient Safe Summary */}
          <Card title="CLINICAL SUMMARY">
            <Text style={styles.bodyText}>{patientData.clinicalSummary}</Text>
          </Card>

          <Button
            title="← Authenticate Another QR Code"
            onPress={() => setPatientData(null)}
            variant="outline"
            style={{ marginVertical: 20 }}
          />
        </View>
      )}

      {/* Universal Camera Scanner Modal for Patient Mode */}
      <UniversalQRScannerModal
        visible={showScannerModal}
        mode="patient"
        initialUuid={uuid}
        onClose={() => setShowScannerModal(false)}
        onPatientViewSuccess={handlePatientScanSuccess}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  topHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: COLORS.primary,
  },
  brandSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: COLORS.criticalBg,
    borderLeftWidth: 4,
    borderColor: COLORS.critical,
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  errorText: {
    color: COLORS.critical,
    fontSize: 13,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginHorizontal: 8,
  },
  patientName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  infoLine: {
    fontSize: 14,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  bold: {
    fontWeight: '700',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  hospitals: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  medRow: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  medName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  medNote: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  vitalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  vitalBox: {
    width: '48%',
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    borderRadius: 6,
    marginRight: '2%',
    marginBottom: 8,
    alignItems: 'center',
  },
  vLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  vVal: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primary,
    marginTop: 2,
  },
  bodyText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    lineHeight: 20,
  }
});
