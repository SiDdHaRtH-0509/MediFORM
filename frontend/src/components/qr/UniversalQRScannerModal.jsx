import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Card, Button, Input, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { Camera, CheckCircle2, AlertTriangle, Lock, RefreshCw, X, ShieldCheck } from 'lucide-react-native';

/**
 * Universal QR Camera Scanner for MediFORM V2.
 * Serves as the single camera scanner for:
 * 1. Doctor / Receiving Doctor clinical handoff (mode="clinical")
 * 2. Inter-Hospital Secure Handoff (mode="clinical")
 * 3. Patient Read-Only access (mode="patient")
 * 4. Token-only extraction (mode="token_only")
 */
export function UniversalQRScannerModal({
  visible,
  mode = 'clinical', // 'clinical' | 'patient' | 'token_only'
  initialUuid = '',
  onClose,
  onDecryptedSuccess,
  onPatientViewSuccess,
  onTokenScanned
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualEntryMode, setManualEntryMode] = useState(false);
  const [scannedUuid, setScannedUuid] = useState(initialUuid);
  const [pin, setPin] = useState('');
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [scanStatus, setScanStatus] = useState('IDLE');
  // 'IDLE' | 'SCANNING' | 'PROCESSING' | 'PIN_PROMPT' | 'INVALID_QR' | 'QR_EXPIRED' | 'QR_REVOKED' | 'TRANSFER_ACCESS_DENIED' | 'NETWORK_ERROR' | 'CAMERA_PERMISSION_DENIED'

  // Reset state on modal visibility change
  useEffect(() => {
    if (visible) {
      setScannedUuid(initialUuid || '');
      setPin('');
      setIsProcessingScan(false);
      setLoading(false);
      setErrorMsg(null);
      setScanStatus('SCANNING');
      setManualEntryMode(false);

      if (permission && !permission.granted && permission.canAskAgain) {
        requestPermission().catch(() => {});
      }
    } else {
      setScannedUuid('');
      setPin('');
      setIsProcessingScan(false);
      setLoading(false);
      setErrorMsg(null);
      setScanStatus('IDLE');
    }
  }, [visible, initialUuid]);

  // Parse scanned barcode data safely
  const parseBarcodeData = (data) => {
    if (!data) return null;
    let extractedUuid = null;
    try {
      const trimmed = typeof data === 'string' ? data.trim() : '';
      if (trimmed.includes('/handoff/')) {
        const parts = trimmed.split('/handoff/');
        extractedUuid = parts[parts.length - 1].split('?')[0].split('#')[0];
      } else if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        extractedUuid = parsed.uuid || parsed.transferId || parsed.id || null;
      } else {
        extractedUuid = trimmed || null;
      }
    } catch (e) {
      extractedUuid = typeof data === 'string' ? data.trim() : null;
    }

    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (extractedUuid && (uuidRegex.test(extractedUuid) || extractedUuid.length >= 8)) {
      return extractedUuid;
    }
    return null;
  };

  // Handle QR barcode detection with duplicate scan protection
  const handleBarCodeScanned = ({ type, data }) => {
    if (isProcessingScan || !data || scanStatus !== 'SCANNING') return;

    // Immediately lock duplicate callbacks
    setIsProcessingScan(true);
    setScanStatus('PROCESSING');

    const parsedUuid = parseBarcodeData(data);

    if (!parsedUuid) {
      setErrorMsg('This QR code is not a valid MediFORM handoff.');
      setScanStatus('INVALID_QR');
      return;
    }

    setScannedUuid(parsedUuid);
    setErrorMsg(null);

    // If caller mode is token_only, return token directly
    if (mode === 'token_only' && onTokenScanned) {
      onClose();
      onTokenScanned(parsedUuid);
      return;
    }

    // Proceed to PIN prompt
    setScanStatus('PIN_PROMPT');
  };

  const handleResetScan = () => {
    setScannedUuid('');
    setIsProcessingScan(false);
    setErrorMsg(null);
    setScanStatus('SCANNING');
  };

  // Perform backend validation with strict role / DTO mode isolation
  const handleValidate = async () => {
    let targetUuid = (scannedUuid || '').trim();
    if (targetUuid.includes('/handoff/')) {
      const parts = targetUuid.split('/handoff/');
      targetUuid = parts[parts.length - 1].split('?')[0].split('#')[0];
    }
    const targetPin = pin.trim();

    if (!targetUuid || !targetPin) {
      setErrorMsg('Please provide both Transfer UUID and 6-digit Security PIN.');
      return;
    }
    if (targetPin.length !== 6) {
      setErrorMsg('PIN must be exactly 6 numeric digits.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      if (mode === 'patient') {
        // STRICT PATIENT-SAFE VALIDATION PATH
        // Calls validatePatientQR ONLY — NEVER calls validateQR
        const res = await api.validatePatientQR(targetUuid, targetPin);

        onClose();
        if (onPatientViewSuccess) {
          onPatientViewSuccess(res.patientView);
        } else if (onDecryptedSuccess) {
          onDecryptedSuccess(res.patientView);
        }
      } else {
        // CLINICAL DOCTOR / HANDOFF VALIDATION PATH
        const res = await api.validateQR(targetUuid, targetPin);

        if (res.transfer && res.transfer._id) {
          api.recordScanEvent(res.transfer._id).catch(() => {});
        }

        onClose();
        if (onDecryptedSuccess) {
          onDecryptedSuccess(res.transfer);
        }
      }
    } catch (err) {
      const errCode = err.code || '';
      const errMsg = err.message || '';

      if (errCode === 'QR_EXPIRED' || errMsg.includes('expired')) {
        setScanStatus('QR_EXPIRED');
        setErrorMsg('This MediFORM access link has expired.');
      } else if (errCode === 'QR_REVOKED' || errMsg.includes('revoked')) {
        setScanStatus('QR_REVOKED');
        setErrorMsg('This MediFORM access link has been revoked.');
      } else if (errCode === 'TRANSFER_ACCESS_DENIED' || err.status === 403) {
        setScanStatus('TRANSFER_ACCESS_DENIED');
        setErrorMsg('You are not authorized to access this handoff.');
      } else if (errCode === 'QR_DECRYPTION_FAILED') {
        setErrorMsg('This QR code could not be validated.');
      } else if (!err.status || errMsg.includes('Network')) {
        setScanStatus('NETWORK_ERROR');
        setErrorMsg('Unable to contact MediFORM. Check your connection and try again.');
      } else {
        setErrorMsg(errMsg || 'Validation or decryption failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  const cameraAvailable = permission?.granted;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Camera size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={styles.title}>
                {mode === 'patient' ? 'SCAN PATIENT READ-ONLY QR' : 'SCAN SECURE QR'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Error Banner */}
          {errorMsg && (
            <View style={styles.errorBox}>
              <AlertTriangle size={16} color={COLORS.critical} style={{ marginRight: 6 }} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          {/* 1. PERMISSION DENIED / UNAVAILABLE STATE */}
          {!cameraAvailable && !manualEntryMode && (
            <View style={styles.permissionBox}>
              <AlertTriangle size={32} color={COLORS.warning} style={{ marginBottom: 12 }} />
              <Text style={styles.permissionTitle}>Camera Access Required</Text>
              <Text style={styles.permissionDesc}>
                Camera access is required to scan a QR code. Allow camera permissions or use manual entry below.
              </Text>
              <View style={styles.btnStack}>
                {permission?.canAskAgain !== false && (
                  <Button
                    title="Allow Camera"
                    onPress={() => requestPermission()}
                    variant="primary"
                    style={{ marginBottom: 8 }}
                  />
                )}
                <Button
                  title="Enter Code Manually"
                  onPress={() => setManualEntryMode(true)}
                  variant="outline"
                  style={{ marginBottom: 8 }}
                />
                <Button
                  title="Cancel"
                  onPress={onClose}
                  variant="outline"
                />
              </View>
            </View>
          )}

          {/* 2. CAMERA SCANNING VIEW */}
          {cameraAvailable && !manualEntryMode && (scanStatus === 'SCANNING' || scanStatus === 'PROCESSING') && (
            <View style={styles.cameraContainer}>
              <CameraView
                style={styles.cameraPreview}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ['qr'],
                }}
                onBarcodeScanned={isProcessingScan ? undefined : handleBarCodeScanned}
                active={visible && (scanStatus === 'SCANNING' || scanStatus === 'PROCESSING')}
              >
                <View style={styles.viewfinderOverlay}>
                  <View style={styles.viewfinderBox}>
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                  </View>
                  <Text style={styles.viewfinderText}>
                    {scanStatus === 'PROCESSING' ? 'Processing QR Code...' : 'Align the QR code inside the frame'}
                  </Text>
                </View>
              </CameraView>

              <View style={styles.cameraActionRow}>
                <Button
                  title="Enter Code Manually"
                  onPress={() => setManualEntryMode(true)}
                  variant="outline"
                  size="small"
                  style={{ flex: 1, marginRight: 4 }}
                />
                <Button
                  title="Cancel"
                  onPress={onClose}
                  variant="outline"
                  size="small"
                  style={{ flex: 1, marginLeft: 4 }}
                />
              </View>
            </View>
          )}

          {/* 3. INVALID QR STATE */}
          {scanStatus === 'INVALID_QR' && (
            <View style={styles.statusBox}>
              <AlertTriangle size={36} color={COLORS.critical} style={{ marginBottom: 10 }} />
              <Text style={styles.statusTitle}>Invalid MediFORM QR Code</Text>
              <Text style={styles.statusDesc}>This QR code is not a valid MediFORM handoff.</Text>
              <View style={styles.actionRow}>
                <Button title="Scan Again" onPress={handleResetScan} variant="primary" style={{ flex: 1, marginRight: 6 }} />
                <Button title="Enter Code Manually" onPress={() => setManualEntryMode(true)} variant="outline" style={{ flex: 1, marginLeft: 6 }} />
              </View>
            </View>
          )}

          {/* 4. QR EXPIRED STATE */}
          {scanStatus === 'QR_EXPIRED' && (
            <View style={styles.statusBox}>
              <AlertTriangle size={36} color={COLORS.warning} style={{ marginBottom: 10 }} />
              <Text style={styles.statusTitle}>Transfer Link Expired</Text>
              <Text style={styles.statusDesc}>This MediFORM access link has expired.</Text>
              <Button title="Scan New QR" onPress={handleResetScan} variant="primary" style={{ marginTop: 12 }} />
            </View>
          )}

          {/* 5. QR REVOKED STATE */}
          {scanStatus === 'QR_REVOKED' && (
            <View style={styles.statusBox}>
              <AlertTriangle size={36} color={COLORS.critical} style={{ marginBottom: 10 }} />
              <Text style={styles.statusTitle}>Transfer Link Revoked</Text>
              <Text style={styles.statusDesc}>This MediFORM access link has been revoked.</Text>
              <Button title="Scan New QR" onPress={handleResetScan} variant="primary" style={{ marginTop: 12 }} />
            </View>
          )}

          {/* 6. ACCESS DENIED STATE */}
          {scanStatus === 'TRANSFER_ACCESS_DENIED' && (
            <View style={styles.statusBox}>
              <Lock size={36} color={COLORS.critical} style={{ marginBottom: 10 }} />
              <Text style={styles.statusTitle}>Access Denied</Text>
              <Text style={styles.statusDesc}>You are not authorized to access this handoff.</Text>
              <Button title="Scan New QR" onPress={handleResetScan} variant="primary" style={{ marginTop: 12 }} />
            </View>
          )}

          {/* 7. NETWORK ERROR STATE */}
          {scanStatus === 'NETWORK_ERROR' && (
            <View style={styles.statusBox}>
              <AlertTriangle size={36} color={COLORS.critical} style={{ marginBottom: 10 }} />
              <Text style={styles.statusTitle}>Network Connection Failed</Text>
              <Text style={styles.statusDesc}>Unable to contact MediFORM. Check your connection and try again.</Text>
              <Button title="Retry Verification" onPress={handleValidate} variant="primary" style={{ marginTop: 12 }} />
            </View>
          )}

          {/* 8. PIN PROMPT / MANUAL ENTRY VIEW */}
          {(scanStatus === 'PIN_PROMPT' || manualEntryMode) && (
            <View style={styles.formContainer}>
              {scannedUuid ? (
                <View style={styles.scannedBadge}>
                  <CheckCircle2 size={18} color={COLORS.success} style={{ marginRight: 6 }} />
                  <Text style={styles.scannedBadgeText}>
                    QR Detected: <Text style={styles.bold}>{scannedUuid.slice(0, 18)}...</Text>
                  </Text>
                </View>
              ) : null}

              {manualEntryMode && (
                <Input
                  label="QR Token / UUID"
                  placeholder="Paste or enter UUID (e.g. 550e8400-e29b-41d4...)"
                  value={scannedUuid}
                  onChangeText={setScannedUuid}
                  maxLength={128}
                />
              )}

              <Input
                label="6-Digit Security PIN"
                placeholder="Enter 6-digit PIN provided by sender"
                value={pin}
                onChangeText={(txt) => setPin(txt.replace(/[^0-9]/g, '').slice(0, 6))}
                keyboardType="numeric"
                maxLength={6}
              />

              <View style={styles.actionRow}>
                {cameraAvailable && (
                  <Button
                    title="Rescan QR"
                    onPress={handleResetScan}
                    variant="outline"
                    style={{ flex: 1, marginRight: 6 }}
                  />
                )}
                <Button
                  title={loading ? "Decrypting..." : (mode === 'patient' ? "Verify Patient Access" : "Verify & Decrypt")}
                  onPress={handleValidate}
                  disabled={loading || !scannedUuid || pin.length !== 6}
                  variant="primary"
                  style={{ flex: 1, marginLeft: cameraAvailable ? 6 : 0 }}
                />
              </View>
            </View>
          )}

          {/* Cancel Button */}
          {!(cameraAvailable && !manualEntryMode && (scanStatus === 'SCANNING' || scanStatus === 'PROCESSING')) && (
            <Button
              title="Cancel"
              onPress={onClose}
              variant="outline"
              style={{ marginTop: 12 }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 20,
    maxWidth: 480,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.5,
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
  permissionBox: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  permissionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  permissionDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  btnStack: {
    width: '100%',
  },
  cameraContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  cameraPreview: {
    height: 260,
    width: '100%',
    borderRadius: 12,
  },
  viewfinderOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinderBox: {
    width: 180,
    height: 180,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#0284c7',
  },
  topLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  topRight: {
    top: -2,
    right: -2,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  viewfinderText: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 4,
  },
  cameraActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  statusBox: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  statusTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  statusDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  formContainer: {
    marginVertical: 4,
  },
  scannedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#0284c7',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
  },
  scannedBadgeText: {
    fontSize: 13,
    color: '#0369a1',
  },
  bold: {
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 10,
  }
});
