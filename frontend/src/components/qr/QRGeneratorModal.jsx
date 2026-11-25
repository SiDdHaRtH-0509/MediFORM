import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform, ScrollView } from 'react-native';
import { QRCodeSVG } from 'qrcode.react';
import { Button, Input, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { ShieldAlert, X, Send, MessageSquare, PhoneCall, Copy, Printer } from 'lucide-react-native';
import {
  copyText,
  copyHandoffLink,
  shareHandoffLink,
  shareQrImage,
  downloadQrImage,
  openExternalUrl
} from '../../utils/qrShareUtils';

export function QRGeneratorModal({ visible, transfer, onClose }) {
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [revoked, setRevoked] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);

  // Inter-Hospital Dispatch state
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [includePinInShare, setIncludePinInShare] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(null);

  const qrContainerRef = useRef(null);
  const svgNativeRef = useRef(null);

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
      if (transfer?.emsDispatch?.receivingHospitalPhone) {
        setRecipientPhone(transfer.emsDispatch.receivingHospitalPhone);
      }
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
      setRemainingSeconds(null);
    }
  }, [visible, transfer]);

  // Live Expiry Countdown
  useEffect(() => {
    if (!qrData?.expiresAt || revoked) return;
    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((new Date(qrData.expiresAt).getTime() - Date.now()) / 1000));
      setRemainingSeconds(diff);
    };
    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [qrData, revoked]);

  const getSvgElement = () => {
    if (qrContainerRef.current && typeof qrContainerRef.current.querySelector === 'function') {
      const svg = qrContainerRef.current.querySelector('svg');
      if (svg) return svg;
    }
    if (typeof document !== 'undefined') {
      return document.querySelector('#mediform-qr-wrapper svg') || document.querySelector('svg');
    }
    return null;
  };

  const getEffectiveShareUrl = () => {
    if (!qrData) return '';
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location && window.location.origin) {
      const origin = window.location.origin;
      if (origin.startsWith('http')) {
        return `${origin}/handoff/${qrData.uuid}`;
      }
    }
    return qrData.shareUrl || `https://mediform.health/handoff/${qrData.uuid}`;
  };

  const formatPacketText = (withPin = includePinInShare) => {
    const url = getEffectiveShareUrl();
    const lines = [
      `🏥 MEDIFORM SECURE PATIENT HANDOFF (${qrData.priority || 'Urgent'})`,
      `Route: ${qrData.fromHospital} ➔ ${qrData.toHospital}`,
      `Open Transfer Folio: ${url}`,
      `Handoff Token: ${qrData.uuid}`
    ];
    if (withPin) {
      lines.push(`6-Digit Access PIN: ${qrData.pin}`);
    } else {
      lines.push(`(6-Digit Access PIN sent separately for security)`);
    }
    return lines.join('\n');
  };

  const handleCopyLink = async () => {
    const targetUrl = getEffectiveShareUrl();
    if (!targetUrl || actionLoading) return;
    setActionLoading('copy');
    const res = await copyHandoffLink(targetUrl);
    setActionLoading(null);
    setStatusMessage(res.success
      ? { type: 'success', text: 'Secure handoff link copied (zero PHI).' }
      : { type: 'error', text: res.error || 'Failed to copy link.' }
    );
  };

  const handleCopyPin = async () => {
    if (!qrData?.pin) return;
    const res = await copyText(qrData.pin);
    setStatusMessage(res.success
      ? { type: 'success', text: `6-digit PIN (${qrData.pin}) copied to clipboard.` }
      : { type: 'error', text: res.error || 'Failed to copy PIN.' }
    );
  };

  const handleCopyFullPacket = async () => {
    if (!qrData) return;
    const res = await copyText(formatPacketText(true));
    setStatusMessage(res.success
      ? { type: 'success', text: 'Complete Handoff Link + PIN packet copied! Paste into hospital chat or SMS.' }
      : { type: 'error', text: res.error || 'Failed to copy packet.' }
    );
  };

  const handleShareLink = async () => {
    const targetUrl = getEffectiveShareUrl();
    if (!targetUrl || actionLoading) return;
    setActionLoading('share-link');
    const res = await shareHandoffLink(targetUrl, includePinInShare ? formatPacketText(true) : null);
    setActionLoading(null);
    if (res.success) {
      setStatusMessage({ type: 'success', text: res.message || 'Handoff shared successfully.' });
    } else if (!res.cancelled) {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to share link.' });
    }
  };

  const handleShareQR = async () => {
    const targetUrl = getEffectiveShareUrl();
    if (!targetUrl || actionLoading) return;
    setActionLoading('share-qr');
    const svgElement = getSvgElement();
    const res = await shareQrImage(svgElement, targetUrl, svgNativeRef.current);
    setActionLoading(null);
    if (res.success) {
      setStatusMessage({ type: 'success', text: res.message || 'QR code shared successfully.' });
    } else if (!res.cancelled) {
      setStatusMessage({ type: 'error', text: res.error || res.message || 'Failed to share QR.' });
    }
  };

  const handleDownloadQR = async () => {
    const targetUrl = getEffectiveShareUrl();
    if (!targetUrl || actionLoading) return;
    setActionLoading('download');
    const svgElement = getSvgElement();
    const res = await downloadQrImage(svgElement, `mediform-qr-${qrData.patientId || 'handoff'}.png`, svgNativeRef.current);
    setActionLoading(null);
    if (res.success) {
      setStatusMessage({ type: 'success', text: res.filename ? `Saved ${res.filename}` : 'QR exported.' });
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to save QR image.' });
    }
  };

  const handleDispatchToHospital = async () => {
    if (!qrData?.uuid || actionLoading) return;
    setActionLoading('dispatch');
    setStatusMessage(null);
    try {
      const res = await api.dispatchQR({
        uuid: qrData.uuid,
        recipientEmail: recipientEmail.trim(),
        recipientHospital: qrData.toHospital,
        recipientPhone: recipientPhone.trim(),
        shareUrl: getEffectiveShareUrl(),
        includePinNotice: includePinInShare,
        pin: includePinInShare ? qrData.pin : ''
      });
      setStatusMessage({ type: 'success', text: res.message });
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Hospital dispatch failed.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendViaWhatsApp = async () => {
    if (!qrData) return;
    const msg = formatPacketText(includePinInShare);
    const cleanPhone = recipientPhone.replace(/[^0-9]/g, '');
    const waUrl = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    await openExternalUrl(waUrl);
  };

  const handleSendViaSms = async () => {
    if (!qrData) return;
    const msg = formatPacketText(includePinInShare);
    const cleanPhone = recipientPhone.trim();
    const smsUrl = cleanPhone
      ? `sms:${encodeURIComponent(cleanPhone)}?body=${encodeURIComponent(msg)}`
      : `sms:?body=${encodeURIComponent(msg)}`;
    await openExternalUrl(smsUrl);
  };

  const handlePrintFolioSlip = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    } else {
      handleShareQR();
    }
  };

  const handleRevokeShare = async () => {
    if (!qrData?.uuid || actionLoading) return;
    setActionLoading('revoke');
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

  const formatCountdown = (sec) => {
    if (sec === null || sec === undefined) return '120:00';
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.title}>SECURE HANDOFF QR & PIN DISPATCH</Text>
              {!revoked && qrData && (
                <Badge label={`⏳ ${formatCountdown(remainingSeconds)}`} variant="info" />
              )}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {loading && (
              <Text style={styles.infoText}>Encrypting AES-256 payload & generating secure handoff session...</Text>
            )}

            {error && <Text style={styles.errorText}>{error}</Text>}

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
                {/* QR + PIN Top Split */}
                <View style={styles.qrPinSplit}>
                  <View ref={qrContainerRef} id="mediform-qr-wrapper" style={styles.qrBox}>
                    <QRCodeSVG
                      value={getEffectiveShareUrl()}
                      size={164}
                      getRef={(c) => { svgNativeRef.current = c; }}
                    />
                  </View>

                  <View style={styles.pinColumn}>
                    <View style={styles.pinCard}>
                      <Text style={styles.pinLabel}>6-DIGIT ACCESS PIN</Text>
                      <Text style={styles.pinValue}>{qrData.pin}</Text>
                      <TouchableOpacity onPress={handleCopyPin} style={styles.copyPinBtn}>
                        <Copy size={12} color={COLORS.primary} style={{ marginRight: 4 }} />
                        <Text style={styles.copyPinText}>Copy PIN</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.detailsBlock}>
                      <Text style={styles.detailLine}><Text style={styles.bold}>Patient:</Text> {qrData.patientName || qrData.patientId}</Text>
                      <Text style={styles.detailLine}><Text style={styles.bold}>UHID:</Text> {qrData.patientId}</Text>
                      <Text style={styles.detailLine}><Text style={styles.bold}>Route:</Text> {qrData.fromHospital} ➔ {qrData.toHospital}</Text>
                    </View>
                  </View>
                </View>

                {/* Primary Share & Export Buttons */}
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
                      title={actionLoading === 'share-qr' ? 'Sharing QR...' : 'Share QR Image'}
                      onPress={handleShareQR}
                      variant="secondary"
                      size="small"
                      disabled={!!actionLoading}
                      style={styles.actionBtn}
                    />
                    <Button
                      title={Platform.OS === 'web' ? 'Download QR' : 'Save QR'}
                      onPress={handleDownloadQR}
                      variant="outline"
                      size="small"
                      disabled={!!actionLoading}
                      style={styles.actionBtn}
                    />
                  </View>

                  <View style={styles.btnRow}>
                    <Button
                      title="Copy Link + PIN Packet"
                      onPress={handleCopyFullPacket}
                      variant="outline"
                      size="small"
                      style={styles.actionBtn}
                    />
                    <Button
                      title="Print Folio Slip"
                      onPress={handlePrintFolioSlip}
                      variant="outline"
                      size="small"
                      icon={<Printer size={13} color={COLORS.primary} />}
                      style={styles.actionBtn}
                    />
                  </View>
                </View>

                {/* Inter-Hospital Instant Transfer Panel */}
                <View style={styles.dispatchPanel}>
                  <Text style={styles.dispatchTitle}>🏥 TRANSFER QR & PIN TO RECEIVING HOSPITAL</Text>
                  <Text style={styles.dispatchSub}>
                    Send directly to the receiving ER doctor via in-app MediFORM alert, Email, WhatsApp, or SMS.
                  </Text>

                  <View style={styles.row}>
                    <View style={{ flex: 1, marginRight: 6 }}>
                      <Input
                        label="Receiving Doctor Email"
                        placeholder="e.g. dr_clara@stjude.health"
                        value={recipientEmail}
                        onChangeText={setRecipientEmail}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 6 }}>
                      <Input
                        label="Receiving Phone (WhatsApp/SMS)"
                        placeholder="+9198..."
                        keyboardType="phone-pad"
                        value={recipientPhone}
                        onChangeText={setRecipientPhone}
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={() => setIncludePinInShare(!includePinInShare)}
                    style={styles.pinToggleRow}
                  >
                    <Text style={styles.pinToggleBox}>{includePinInShare ? '☑' : '☐'}</Text>
                    <Text style={styles.pinToggleText}>
                      Include 6-digit PIN in dispatch message (uncheck to share PIN separately by phone call)
                    </Text>
                  </TouchableOpacity>

                  <Button
                    title={actionLoading === 'dispatch' ? 'Dispatching to Hospital...' : 'Dispatch Alert to Hospital in MediFORM'}
                    onPress={handleDispatchToHospital}
                    disabled={!!actionLoading}
                    variant="primary"
                    icon={<Send size={14} color="#FFF" />}
                    style={{ marginBottom: 8 }}
                  />

                  <View style={styles.btnRow}>
                    <Button
                      title="WhatsApp Handoff"
                      onPress={handleSendViaWhatsApp}
                      variant="secondary"
                      size="small"
                      icon={<MessageSquare size={13} color="#FFF" />}
                      style={styles.actionBtn}
                    />
                    <Button
                      title="SMS Handoff"
                      onPress={handleSendViaSms}
                      variant="critical"
                      size="small"
                      icon={<PhoneCall size={13} color="#FFF" />}
                      style={styles.actionBtn}
                    />
                  </View>
                </View>

                <View style={styles.footerRow}>
                  <TouchableOpacity onPress={generateQR} disabled={!!actionLoading}>
                    <Text style={styles.regenText}>↻ Rotate PIN / New QR</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleRevokeShare} disabled={!!actionLoading}>
                    <Text style={styles.revokeLinkText}>Revoke Session</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.instruction}>
                  Security: Zero PHI is embedded in the QR or URL. All patient records remain AES-256-GCM encrypted until the receiving clinician enters the 6-digit PIN.
                </Text>
              </View>
            )}
          </ScrollView>

          <Button title="Done / Close" onPress={onClose} variant="outline" style={{ marginTop: 10 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  modalCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 18,
    maxWidth: 540,
    width: '100%',
    maxHeight: '94%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 14,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 0.4,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginVertical: 20,
  },
  errorText: {
    color: COLORS.critical,
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 8,
  },
  statusBanner: {
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
    alignItems: 'center',
  },
  statusSuccess: { backgroundColor: '#DCFCE7' },
  statusWarning: { backgroundColor: '#FEF9C3' },
  statusError: { backgroundColor: '#FEE2E2' },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
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
    width: '100%',
  },
  qrPinSplit: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  qrBox: {
    padding: 10,
    backgroundColor: '#FFF',
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 12,
  },
  pinColumn: {
    flex: 1,
    minWidth: 190,
  },
  pinCard: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  pinLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.8,
  },
  pinValue: {
    fontSize: 26,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 4,
    marginVertical: 2,
  },
  copyPinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 2,
  },
  copyPinText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  detailsBlock: {
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailLine: {
    fontSize: 11,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  bold: { fontWeight: '700' },
  actionColumn: {
    width: '100%',
    marginBottom: 8,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  actionBtn: {
    flex: 1,
    marginHorizontal: 3,
  },
  dispatchPanel: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  dispatchTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.primary,
    marginBottom: 2,
  },
  dispatchSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
  },
  pinToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  pinToggleBox: {
    fontSize: 16,
    color: COLORS.primary,
    marginRight: 8,
  },
  pinToggleText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  regenText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  revokeLinkText: {
    fontSize: 12,
    color: COLORS.critical,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  instruction: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 14,
    marginTop: 4,
  }
});
