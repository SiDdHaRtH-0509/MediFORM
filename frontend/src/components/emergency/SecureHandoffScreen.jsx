import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { Card, Button, Badge, Input } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { EmergencyReceiverScreen } from './EmergencyReceiverScreen';
import { UniversalQRScannerModal } from '../qr/UniversalQRScannerModal';
import { pasteTextFromClipboard } from '../../utils/qrShareUtils';
import { Lock, AlertTriangle, Building2 } from 'lucide-react-native';

function extractUuid(rawInput) {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('/handoff/')) {
    const parts = trimmed.split('/handoff/');
    return parts[parts.length - 1].split('?')[0].split('#')[0];
  }
  return trimmed;
}

export function SecureHandoffScreen({ uuid: initialUuid = '', onReset }) {
  const [uuidInput, setUuidInput] = useState(initialUuid);
  const [uuid, setUuid] = useState(extractUuid(initialUuid));
  const [shareInfo, setShareInfo] = useState(null);
  const [pin, setPin] = useState('');
  const [decryptedTransfer, setDecryptedTransfer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [showScannerModal, setShowScannerModal] = useState(false);

  useEffect(() => {
    const parsed = extractUuid(initialUuid);
    setUuidInput(initialUuid);
    setUuid(parsed);
  }, [initialUuid]);

  useEffect(() => {
    if (uuid) {
      fetchShareMetadata(uuid);
    } else {
      setShareInfo(null);
    }
  }, [uuid]);

  const fetchShareMetadata = async (targetUuid) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getShareInfo(targetUuid);
      setShareInfo(res);
    } catch (err) {
      setShareInfo(null);
      setErrorMsg(err.message || 'Unable to retrieve transfer handoff session.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSessionFromInput = () => {
    const extracted = extractUuid(uuidInput);
    if (!extracted) {
      setErrorMsg('Please paste a valid Handoff Link or QR Token.');
      return;
    }
    setUuid(extracted);
  };

  const handlePasteLink = async () => {
    const txt = await pasteTextFromClipboard();
    if (txt) {
      setUuidInput(txt);
      const extracted = extractUuid(txt);
      if (extracted) setUuid(extracted);
    }
  };

  const handleVerifyAccess = async () => {
    const targetUuid = extractUuid(uuid || uuidInput);
    if (!targetUuid || !pin) {
      setErrorMsg('Please enter the Handoff Token/Link and 6-digit PIN provided by the referring facility.');
      return;
    }
    if (pin.length !== 6) {
      setErrorMsg('PIN must be exactly 6 numeric digits.');
      return;
    }

    setVerifying(true);
    setErrorMsg(null);
    try {
      const res = await api.validateQR(targetUuid, pin.trim());
      setUuid(targetUuid);
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
        qrAuth={uuid && pin ? { uuid, pin } : null}
        onAcknowledgeComplete={(updated) => setDecryptedTransfer(updated)}
        onClose={onReset}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBrand}>
        <Image source={require('../../../assets/logo.png')} style={{ width: 64, height: 64, resizeMode: 'contain', marginBottom: 8 }} />
        <Text style={styles.brandTitle}>MediFORM</Text>
        <Text style={styles.brandSub}>Secure Inter-Hospital Patient Handoff & Folio Access</Text>
      </View>

      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Lock size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
          <Text style={styles.cardTitle}>OPEN PATIENT TRANSFER FOLIO</Text>
        </View>

        <Button
          title="📷 Scan Handoff QR with Camera"
          onPress={() => setShowScannerModal(true)}
          variant="secondary"
          accessibilityLabel="Scan QR code with camera"
          style={{ marginBottom: 14 }}
        />

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR PASTE LINK / TOKEN + ENTER PIN</Text>
          <View style={styles.dividerLine} />
        </View>

        <Input
          label="Handoff Link or Session Token"
          placeholder="https://mediform.health/handoff/... or UUID"
          value={uuidInput}
          onChangeText={setUuidInput}
          maxLength={256}
        />

        <View style={styles.tokenActionRow}>
          <Button title="Paste Link" onPress={handlePasteLink} variant="outline" size="small" style={{ flex: 1, marginRight: 6 }} />
          <Button title="Check Session" onPress={handleLoadSessionFromInput} variant="outline" size="small" style={{ flex: 1, marginLeft: 6 }} />
        </View>

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
                <Badge label="ACTIVE FOLIO" variant="success" style={{ marginLeft: 8 }} />
              )}
            </View>
          </View>
        )}

        <Input
          label="6-Digit Security PIN *"
          placeholder="Enter 6-digit PIN from referring hospital"
          value={pin}
          onChangeText={(txt) => setPin(txt.replace(/[^0-9]/g, '').slice(0, 6))}
          keyboardType="numeric"
          maxLength={6}
        />

        <Button
          title={verifying ? "Decrypting Transfer Folio..." : "Unlock Full Transfer Folio & Live GPS"}
          onPress={handleVerifyAccess}
          disabled={verifying || pin.length !== 6 || (!uuid && !uuidInput.trim()) || shareInfo?.isRevoked || shareInfo?.isExpired}
          variant="primary"
          style={{ marginTop: 8 }}
        />

        {onReset && (
          <Button
            title="← Back to Main Screen"
            onPress={onReset}
            variant="outline"
            style={{ marginTop: 12 }}
          />
        )}
      </Card>

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
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  topBrand: {
    alignItems: 'center',
    marginBottom: 14,
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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textSecondary,
    marginHorizontal: 8,
  },
  tokenActionRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginVertical: 10,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
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
    flex: 1,
  },
  infoBlock: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  hospitalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  hospitalsText: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
