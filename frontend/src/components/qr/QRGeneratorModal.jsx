import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform } from 'react-native';
import { QRCodeSVG } from 'qrcode.react';
import { Card, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { Share2, Copy, ShieldAlert, Check, X, Download, Image as ImageIcon } from 'lucide-react-native';
import {
  copyHandoffLink,
  shareHandoffLink,
  shareQrImage,
  downloadQrImage
} from '../../utils/qrShareUtils';

export function QRGeneratorModal({ visible, transfer, onClose }) {
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [revoked, setRevoked] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);

  const qrContainerRef = useRef(null);

  const generateQR = async () => {
    const targetId = typeof transfer === 'string' ? transfer : (transfer?._id || transfer?.id);
    if (!targetId) return;
    setLoading(true);
    setError(null);
    setRevoked(false);
    setStatusMessage(null);
    try {
      const res = await api.generateQR(targetId);
      setQrData(res);
    } catch (err) {
      setError(err.message || 'Failed to generate QR session.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible && transfer) {
      generateQR();
    } else {
      setQrData(null);
      setRevoked(false);
      setStatusMessage(null);
      setActionLoading(null);
    }
  }, [visible, transfer]);

  const getSvgElement = () => {
    if (qrContainerRef.current) {
      if (typeof qrContainerRef.current.querySelector === 'function') {
        const svg = qrContainerRef.current.querySelector('svg');
        if (svg) return svg;
      }
    }
    if (typeof document !== 'undefined') {
      return document.querySelector('#mediform-qr-wrapper svg') || document.querySelector('svg');
    }
    return null;
  };

  const getEffectiveShareUrl = () => {
    if (!qrData) return '';
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      const origin = window.location.origin;
      if (origin.startsWith('http')) {
        return `${origin}/handoff/${qrData.uuid}`;
      }
    }
    return qrData.shareUrl || `https://mediform.health/handoff/${qrData.uuid}`;
  };

  // Step 2: Copy Link
  const handleCopyLink = async () => {
    const targetUrl = getEffectiveShareUrl();
    if (!targetUrl || actionLoading) return;
    setActionLoading('copy');
    setStatusMessage(null);

    const res = await copyHandoffLink(targetUrl);
    setActionLoading(null);

    if (res.success) {
      setStatusMessage({ type: 'success', text: 'Link copied to clipboard.' });
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to copy link.' });
    }
  };

  // Step 3: Share Link
  const handleShareLink = async () => {
    const targetUrl = getEffectiveShareUrl();
    if (!targetUrl || actionLoading) return;
    setActionLoading('share-link');
    setStatusMessage(null);

    const res = await shareHandoffLink(targetUrl);
    setActionLoading(null);

    if (res.success) {
      if (res.message) {
        setStatusMessage({ type: 'warning', text: res.message });
      } else {
        setStatusMessage({ type: 'success', text: 'Link shared successfully.' });
      }
    } else if (res.cancelled) {
      // User cancelled share dialog - do not display error
      setStatusMessage(null);
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to share link.' });
    }
  };

  // Step 4 & 6: Share QR Image
  const handleShareQR = async () => {
    const targetUrl = getEffectiveShareUrl();
    if (!targetUrl || actionLoading) return;
    setActionLoading('share-qr');
    setStatusMessage(null);

    const svgElement = getSvgElement();
    const res = await shareQrImage(svgElement, targetUrl);
    setActionLoading(null);

    if (res.success) {
      if (res.message) {
        setStatusMessage({ type: 'warning', text: res.message });
      } else {
        setStatusMessage({ type: 'success', text: 'QR Code image shared successfully.' });
      }
    } else if (res.cancelled) {
      setStatusMessage(null);
    } else {
      setStatusMessage({ type: 'error', text: res.error || res.message || 'Failed to share QR image.' });
    }
  };

  // Step 5: Download QR (Web)
  const handleDownloadQR = async () => {
    const targetUrl = getEffectiveShareUrl();
    if (!targetUrl || actionLoading) return;
    setActionLoading('download');
    setStatusMessage(null);

    const svgElement = getSvgElement();
    const res = await downloadQrImage(svgElement, 'mediform-handoff-qr.png');
    setActionLoading(null);

    if (res.success) {
      setStatusMessage({ type: 'success', text: `Downloaded ${res.filename}` });
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to download QR image.' });
    }
  };

  // Revoke Share Session
  const handleRevokeShare = async () => {
    if (!qrData?.uuid || actionLoading) return;
    setActionLoading('revoke');
    setStatusMessage(null);

    try {
      await api.revokeQR(qrData.uuid);
      setRevoked(true);
      setStatusMessage({ type: 'error', text: 'Share session revoked.' });
    } catch (err) {
      setError(err.message || 'Failed to revoke share session.');
    } finally {
      setActionLoading(null);
    }
  };

  if (!visible) return null;

  const expirationText = qrData?.expiresAt
    ? new Date(qrData.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '120 mins';

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>SECURE HANDOFF QR</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading && (
            <Text style={styles.infoText}>Encrypting AES-256 payload & generating share session...</Text>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}

          {/* Status feedback banner */}
          {statusMessage && (
            <View style={[
              styles.statusBanner,
              statusMessage.type === 'success' && styles.statusSuccess,
              statusMessage.type === 'warning' && styles.statusWarning,
              statusMessage.type === 'error' && styles.statusError
            ]}>
              <Text style={styles.statusText}>{statusMessage.text}</Text>
            </View>
          )}

          {revoked && (
            <View style={styles.revokedBox}>
              <ShieldAlert size={32} color={COLORS.critical} style={{ marginBottom: 6 }} />
              <Text style={styles.revokedTitle}>Share Access Revoked</Text>
              <Text style={styles.revokedDesc}>
                This QR code and secure link have been invalidated. Receiving facility can no longer use this session.
              </Text>
              <Button title="Generate New Secure Share" onPress={generateQR} variant="primary" style={{ marginTop: 10 }} />
            </View>
          )}

          {!revoked && qrData && (
            <View style={styles.qrContainer}>
              {/* QR Image Display Container */}
              <View ref={qrContainerRef} id="mediform-qr-wrapper" style={styles.qrBox}>
                <QRCodeSVG
                  value={getEffectiveShareUrl()}
                  size={200}
                />
              </View>

              <Text style={styles.expirationText}>Expires: {expirationText}</Text>

              {/* 6-Digit Access PIN Box */}
              <View style={styles.pinCard}>
                <Text style={styles.pinLabel}>6-DIGIT ACCESS PIN</Text>
                <Text style={styles.pinValue}>{qrData.pin}</Text>
                <Text style={styles.pinSub}>Receiving doctor enters this PIN after opening link or scanning QR</Text>
              </View>

              {/* Handoff Details Summary */}
              <View style={styles.detailsBlock}>
                <Text style={styles.detailLine}><Text style={styles.bold}>Patient ID:</Text> {qrData.patientId}</Text>
                <Text style={styles.detailLine}><Text style={styles.bold}>Handoff:</Text> {qrData.fromHospital} ➔ {qrData.toHospital}</Text>
              </View>

              {/* Action Buttons as specified in Step 7 */}
              <View style={styles.actionColumn}>
                <View style={styles.btnRow}>
                  <Button
                    title={actionLoading === 'copy' ? 'Copying...' : 'Copy Link'}
                    onPress={handleCopyLink}
                    variant="outline"
                    size="small"
                    disabled={!!actionLoading}
                    style={styles.actionBtn}
                  />
                  <Button
                    title={actionLoading === 'share-link' ? 'Sharing...' : 'Share Link'}
                    onPress={handleShareLink}
                    variant="primary"
                    size="small"
                    disabled={!!actionLoading}
                    style={styles.actionBtn}
                  />
                </View>

                <View style={styles.btnRow}>
                  <Button
                    title={actionLoading === 'share-qr' ? 'Sharing QR...' : 'Share QR'}
                    onPress={handleShareQR}
                    variant="primary"
                    size="small"
                    disabled={!!actionLoading}
                    style={styles.actionBtn}
                  />
                  {Platform.OS === 'web' && (
                    <Button
                      title={actionLoading === 'download' ? 'Downloading...' : 'Download QR'}
                      onPress={handleDownloadQR}
                      variant="outline"
                      size="small"
                      disabled={!!actionLoading}
                      style={styles.actionBtn}
                    />
                  )}
                </View>

                <TouchableOpacity
                  onPress={handleRevokeShare}
                  disabled={!!actionLoading}
                  style={styles.revokeLink}
                >
                  <Text style={styles.revokeLinkText}>Revoke Shared Access Session</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.instruction}>
                Instructions: Zero PHI is contained in the link or QR payload. Clinical data is AES-256 encrypted on the server and accessed only with the 6-digit PIN.
              </Text>
            </View>
          )}

          <Button title="Done / Close" onPress={onClose} variant="outline" style={{ marginTop: 14 }} />
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
  title: {
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
  errorText: {
    color: COLORS.critical,
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 8,
  },
  statusBanner: {
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
    alignItems: 'center',
  },
  statusSuccess: {
    backgroundColor: '#DCFCE7',
  },
  statusWarning: {
    backgroundColor: '#FEF9C3',
  },
  statusError: {
    backgroundColor: '#FEE2E2',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  revokedBox: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  revokedTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.critical,
  },
  revokedDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  qrContainer: {
    alignItems: 'center',
  },
  qrBox: {
    padding: 14,
    backgroundColor: '#FFF',
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 12,
    marginBottom: 6,
  },
  expirationText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  pinCard: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  pinLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 1,
  },
  pinValue: {
    fontSize: 26,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 4,
    marginVertical: 2,
  },
  pinSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  detailsBlock: {
    width: '100%',
    backgroundColor: '#FAFAFA',
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
  },
  detailLine: {
    fontSize: 12,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  bold: {
    fontWeight: '700',
  },
  actionColumn: {
    width: '100%',
    marginBottom: 8,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  actionBtn: {
    flex: 1,
    marginHorizontal: 3,
  },
  revokeLink: {
    alignSelf: 'center',
    paddingVertical: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  revokeLinkText: {
    fontSize: 12,
    color: COLORS.critical,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  instruction: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 15,
  }
});
