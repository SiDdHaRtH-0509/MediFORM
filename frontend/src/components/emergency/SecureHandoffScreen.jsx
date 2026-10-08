import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Card, Button, Badge, Input } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { EmergencyReceiverScreen } from './EmergencyReceiverScreen';
import { UniversalQRScannerModal } from '../qr/UniversalQRScannerModal';
import { ShieldCheck, Lock, AlertTriangle, ArrowRight, Building2, Camera } from 'lucide-react-native';

export function SecureHandoffScreen({ uuid: initialUuid = '', onReset }) {
  const [uuid, setUuid] = useState(initialUuid);
  const [shareInfo, setShareInfo] = useState(null);
  const [pin, setPin] = useState('');
  const [decryptedTransfer, setDecryptedTransfer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [showScannerModal, setShowScannerModal] = useState(false);

  useEffect(() => {
    if (uuid) {
      fetchShareMetadata(uuid);
    }
  }, [uuid]);

  const fetchShareMetadata = async (targetUuid) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getShareInfo(targetUuid);
      setShareInfo(res);
    } catch (err) {
      setErrorMsg(err.message || 'Unable to retrieve transfer handoff session.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAccess = async () => {
    if (!uuid || !pin) {
      setErrorMsg('Please enter the 6-digit PIN provided by issuing facility.');
      return;
    }
    if (pin.length !== 6) {
      setErrorMsg('PIN must be exactly 6 numeric digits.');
      return;
    }

    setVerifying(true);
    setErrorMsg(null);
    try {
      const res = await api.validateQR(uuid.trim(), pin.trim());
      setDecryptedTransfer(res.transfer);
    } catch (err) {
      setErrorMsg(err.message || 'Access verification failed. Incorrect PIN, expired, or revoked share session.');
    } finally {
      setVerifying(false);
    }
  };

  const handleClinicalScanSuccess = (transfer) => {
    setDecryptedTransfer(transfer);
  };

  if (decryptedTransfer) {
    return (
      <EmergencyReceiverScreen
        transfer={decryptedTransfer}
        onAcknowledgeComplete={(updated) => setDecryptedTransfer(updated)}
        onClose={onReset}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBrand}>
        <Image source={require('../../../assets/logo.png')} style={{ width: 68, height: 68, resizeMode: 'contain', marginBottom: 8 }} />
        <Text style={styles.brandTitle}>MediFORM V2</Text>
        <Text style={styles.brandSub}>Secure Inter-Hospital Patient Handoff Platform</Text>
      </View>

      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Lock size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
          <Text style={styles.cardTitle}>SECURE HANDOFF VERIFICATION</Text>
        </View>

        {/* Scan with Camera Action Button */}
        <Button
          title="Scan QR with Camera"
          onPress={() => setShowScannerModal(true)}
          variant="secondary"
          accessibilityLabel="Scan QR code with camera"
          style={{ marginBottom: 14 }}
        />

        {loading && <Text style={styles.infoText}>Connecting to MediFORM secure handoff network...</Text>}

        {errorMsg && (
          <View style={styles.errorBox}>
            <AlertTriangle size={18} color={COLORS.critical} style={{ marginRight: 6 }} />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {shareInfo && (
          <View style={styles.infoBlock}>
            <View style={styles.hospitalRow}>
              <Building2 size={18} color={COLORS.primary} style={{ marginRight: 6 }} />
              <Text style={styles.hospitalsText}>{shareInfo.fromHospital} ➔ {shareInfo.toHospital}</Text>
            </View>

            <View style={styles.metaRow}>
              <Badge
                label={`Priority: ${shareInfo.priority || 'Emergency'}`}
                variant={shareInfo.priority === 'Emergency' ? 'critical' : 'warning'}
              />
              {shareInfo.isRevoked ? (
                <Badge label="REVOKED" variant="critical" style={{ marginLeft: 8 }} />
              ) : shareInfo.isExpired ? (
                <Badge label="EXPIRED" variant="warning" style={{ marginLeft: 8 }} />
              ) : (
                <Badge label="ACTIVE SESSION" variant="success" style={{ marginLeft: 8 }} />
              )}
            </View>

            <Text style={styles.noticeText}>
              This clinical transfer is encrypted with AES-256-GCM. Enter the 6-digit security PIN provided by the referring doctor to authenticate and view the complete handoff record.
            </Text>

            <Input
              label="6-Digit Security PIN *"
              placeholder="e.g. 654321"
              value={pin}
              onChangeText={(txt) => setPin(txt.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="numeric"
              maxLength={6}
            />

            <Button
              title={verifying ? "Verifying PIN & Decrypting..." : "Verify & Access Transfer"}
              onPress={handleVerifyAccess}
              disabled={verifying || pin.length !== 6 || shareInfo.isRevoked || shareInfo.isExpired}
              variant="primary"
              style={{ marginTop: 12 }}
            />
          </View>
        )}

        {onReset && (
          <Button
            title="← Back to Main Menu"
            onPress={onReset}
            variant="outline"
            style={{ marginTop: 14 }}
          />
        )}
      </Card>

      {/* Universal Camera Scanner Modal for Handoff Screen */}
      <UniversalQRScannerModal
        visible={showScannerModal}
        mode="clinical"
        initialUuid={uuid}
        onClose={() => setShowScannerModal(false)}
        onDecryptedSuccess={handleClinicalScanSuccess}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxWidth: 540,
    alignSelf: 'center',
    width: '100%',
  },
  topBrand: {
    alignItems: 'center',
    marginBottom: 16,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 1,
  },
  brandSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  card: {
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginVertical: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.criticalBg,
    borderLeftWidth: 4,
    borderColor: COLORS.critical,
    padding: 10,
    borderRadius: 6,
    marginBottom: 14,
  },
  errorText: {
    color: COLORS.critical,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  infoBlock: {
    marginTop: 4,
  },
  hospitalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  hospitalsText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  noticeText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 16,
    backgroundColor: '#FAFAFA',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  }
});
