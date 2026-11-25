import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, SafeAreaView, Image, Modal, Linking } from 'react-native';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { Card, Button, Input, Badge } from './src/components/ui/Controls';
import { TransferForm } from './src/components/forms/TransferForm';
import { EmergencyReceiverScreen } from './src/components/emergency/EmergencyReceiverScreen';
import { SecureHandoffScreen } from './src/components/emergency/SecureHandoffScreen';
import { PatientQRView } from './src/components/patient/PatientQRView';
import { PatientDashboard } from './src/components/patient/PatientDashboard';
import { QRGeneratorModal } from './src/components/qr/QRGeneratorModal';
import { QRScannerModal } from './src/components/qr/QRScannerModal';
import { TransferHistoryView } from './src/components/history/TransferHistoryView';
import { PatientTimelineView } from './src/components/history/PatientTimelineView';
import { ScreeningReferralView } from './src/components/screening/ScreeningReferralView';
import { DoctorFollowUpView } from './src/components/screening/DoctorFollowUpView';
import { DoctorMonitoringView } from './src/components/screening/DoctorMonitoringView';
import { DoctorProfileView } from './src/components/doctor/DoctorProfileView';
import { DoctorNotificationsView } from './src/components/doctor/DoctorNotificationsView';
import { SubscriptionPlansView } from './src/components/doctor/SubscriptionPlansView';
import { InstitutionalVerifierView } from './src/components/verification/InstitutionalVerifierView';
import { SplashScreenLoader } from './src/components/ui/SplashScreenLoader';
import { COLORS } from './src/constants/theme';
import { api } from './src/services/api';
import {
  FilePlus2,
  History,
  Bell,
  AlertTriangle,
  Activity,
  CalendarClock,
  UserCheck,
  ShieldCheck,
  Crown,
  QrCode
} from 'lucide-react-native';

function AuthScreen({ onSwitchToPatientView, onSwitchToHandoffView }) {
  const { login, register, verifyOtp, resendOtp, forgotPassword, resetPassword } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('dr_smith@gmail.com');
  const [password, setPassword] = useState('password123');
  const [hospitalName, setHospitalName] = useState('Metropolitan Trauma Hospital');

  // 2-Phase OTP & Password Reset State
  const [step, setStep] = useState('CREDENTIALS'); // 'CREDENTIALS' | 'OTP' | 'FORGOT_PASSWORD_REQUEST' | 'FORGOT_PASSWORD_RESET'
  const [challengeId, setChallengeId] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [devOtpHint, setDevOtpHint] = useState(null);
  const [resetEmail, setResetEmail] = useState('dr_smith@gmail.com');
  const [newPassword, setNewPassword] = useState('');
  const [showOtpEmailModal, setShowOtpEmailModal] = useState(false);

  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Phase 1: Submit Credentials
  const handleCredentialsSubmit = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      let res;
      if (isRegister) {
        res = await register(username, password, 'doctor', hospitalName);
      } else {
        res = await login(username, password);
      }

      if (res && res.requireOtp) {
        setChallengeId(res.challengeId);
        setDevOtpHint(res.devOtp);
        setStep('OTP');
        setShowOtpEmailModal(true);
        startCooldownTimer();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  // Phase 2: Submit OTP Verification Code
  const handleVerifyOtpSubmit = async () => {
    if (!otpCode || otpCode.length !== 6) {
      setErrorMsg('Please enter a 6-digit numeric OTP code.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await verifyOtp(challengeId, otpCode);
    } catch (err) {
      setErrorMsg(err.message || 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  // Forgot Password Phase 1: Request Reset OTP
  const handleRequestPasswordReset = async () => {
    if (!resetEmail) {
      setErrorMsg('Please enter your doctor email address.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await forgotPassword(resetEmail);
      if (res && res.challengeId) {
        setChallengeId(res.challengeId);
        setDevOtpHint(res.devOtp);
        setStep('FORGOT_PASSWORD_RESET');
        setShowOtpEmailModal(true);
        setSuccessMsg(res.message || 'Password reset OTP code generated.');
      } else {
        setSuccessMsg('If an account associated with that email exists, a password reset code has been sent.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to request password reset.');
    } finally {
      setLoading(false);
    }
  };

  // Forgot Password Phase 2: Submit OTP & New Password
  const handleResetPasswordSubmit = async () => {
    if (!otpCode || otpCode.length !== 6) {
      setErrorMsg('Please enter the 6-digit OTP code.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setErrorMsg('New password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await resetPassword(challengeId, otpCode, newPassword);
      setSuccessMsg(res.message || 'Password reset successfully! Please log in with your new password.');
      setStep('CREDENTIALS');
      setPassword(newPassword);
      setOtpCode('');
      setNewPassword('');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await resendOtp(challengeId);
      if (res && res.challengeId) {
        setChallengeId(res.challengeId);
        setDevOtpHint(res.devOtp);
        startCooldownTimer();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to resend OTP.');
    } finally {
      setLoading(false);
    }
  };

  const startCooldownTimer = () => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  return (
    <View style={styles.authContainer}>
      {/* POPUP MODAL NOTIFYING USER WHERE OTP WAS SENT & TO CHECK SPAM BOX */}
      {showOtpEmailModal && (
        <Modal visible={showOtpEmailModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalAlertCard}>
              <View style={styles.modalIconBox}>
                <Text style={{ fontSize: 32 }}>📩</Text>
              </View>
              <Text style={styles.modalAlertTitle}>Check Your Email Inbox & Spam Folder</Text>
              <Text style={styles.modalAlertText}>
                A 6-digit verification code has been sent to:{'\n'}
                <Text style={{ fontWeight: '800', color: COLORS.primary }}>
                  {step === 'FORGOT_PASSWORD_RESET' ? resetEmail : username}
                </Text>
              </Text>
              <Text style={styles.modalAlertSub}>
                If you do not see the email in your primary inbox, please check your <Text style={{ fontWeight: '700' }}>Spam</Text> or <Text style={{ fontWeight: '700' }}>Junk</Text> folder.
              </Text>
              <Button
                title="Got It, Continue"
                onPress={() => setShowOtpEmailModal(false)}
                variant="primary"
                style={{ width: '100%', marginTop: 16 }}
              />
            </View>
          </View>
        </Modal>
      )}

      <Card style={styles.authCard}>
        <View style={styles.brandHeader}>
          <Image source={require('./assets/logo.png')} style={{ width: 76, height: 76, resizeMode: 'contain', marginBottom: 10 }} />
          <Text style={styles.brandTitle}>MediFORM V2</Text>
          <Text style={styles.brandSub}>Secure Digital Medical Transfer & Patient Handoff Platform</Text>
        </View>

        {errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>[!] {errorMsg}</Text>
          </View>
        )}

        {successMsg && (
          <View style={styles.successBanner}>
            <Text style={styles.successBannerText}>✓ {successMsg}</Text>
          </View>
        )}

        {step === 'CREDENTIALS' ? (
          <View>
            <View style={styles.tabRow}>
              <TouchableOpacity
                onPress={() => { setIsRegister(false); setErrorMsg(null); setSuccessMsg(null); }}
                style={[styles.authTab, !isRegister && styles.authTabActive]}
              >
                <Text style={[styles.authTabText, !isRegister && styles.authTabTextActive]}>Doctor Login</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setIsRegister(true); setErrorMsg(null); setSuccessMsg(null); }}
                style={[styles.authTab, isRegister && styles.authTabActive]}
              >
                <Text style={[styles.authTabText, isRegister && styles.authTabTextActive]}>Doctor Register</Text>
              </TouchableOpacity>
            </View>

            <Input
              label="Doctor Email Address"
              required
              value={username}
              onChangeText={setUsername}
              placeholder="e.g. dr_smith@gmail.com"
              maxLength={80}
            />

            <Input
              label="Password"
              required
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              maxLength={25}
            />

            {!isRegister && (
              <TouchableOpacity
                onPress={() => {
                  setResetEmail(username || 'dr_smith@gmail.com');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                  setStep('FORGOT_PASSWORD_REQUEST');
                }}
                style={{ alignSelf: 'flex-end', marginTop: 2, marginBottom: 8 }}
              >
                <Text style={{ fontSize: 13, color: COLORS.primary, fontWeight: '700' }}>
                  Forgot Password?
                </Text>
              </TouchableOpacity>
            )}

            {isRegister && (
              <Input
                label="Hospital Facility Name"
                required
                value={hospitalName}
                onChangeText={setHospitalName}
                placeholder="e.g. City General Hospital"
                maxLength={150}
              />
            )}

            <Button
              title={loading ? "Generating OTP..." : "Continue to OTP Verification"}
              onPress={handleCredentialsSubmit}
              disabled={loading}
              variant="primary"
              style={{ marginTop: 14 }}
            />

            <View style={styles.patientLinkBox}>
              <Text style={styles.patientLinkSub}>Have a Transfer QR Code or Secure Handoff Link?</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <TouchableOpacity onPress={onSwitchToPatientView}>
                  <Text style={styles.patientLinkText}>Patient QR Portal</Text>
                </TouchableOpacity>
                <Text style={{ color: COLORS.textSecondary, marginHorizontal: 8 }}>|</Text>
                <TouchableOpacity onPress={onSwitchToHandoffView}>
                  <Text style={styles.patientLinkText}>Direct Secure Handoff Link</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : step === 'FORGOT_PASSWORD_REQUEST' ? (
          /* FORGOT PASSWORD STEP 1: REQUEST OTP */
          <View>
            <Text style={styles.otpHeading}>Forgot Password</Text>
            <Text style={styles.otpSub}>
              Enter your registered doctor email address to receive a password reset OTP code.
            </Text>

            <Input
              label="Doctor Email / Username"
              required
              value={resetEmail}
              onChangeText={setResetEmail}
              placeholder="e.g. dr_smith@gmail.com"
              maxLength={80}
            />

            <Button
              title={loading ? "Sending OTP..." : "Send Password Reset OTP"}
              onPress={handleRequestPasswordReset}
              disabled={loading || !resetEmail}
              variant="primary"
              style={{ marginTop: 14 }}
            />

            <View style={styles.resendRow}>
              <TouchableOpacity onPress={() => { setStep('CREDENTIALS'); setErrorMsg(null); setSuccessMsg(null); }}>
                <Text style={styles.backLink}>← Back to Login</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : step === 'FORGOT_PASSWORD_RESET' ? (
          /* FORGOT PASSWORD STEP 2: VERIFY OTP & SET NEW PASSWORD */
          <View>
            <Text style={styles.otpHeading}>Reset Doctor Password</Text>
            <Text style={styles.otpSub}>
              Enter the 6-digit OTP reset code and choose your new password.
            </Text>

            {/* EMAIL & SPAM BOX NOTIFICATION BANNER */}
            <View style={styles.emailNoticeBox}>
              <Text style={styles.emailNoticeTitle}>📩 Check Your Email Inbox & Spam Folder</Text>
              <Text style={styles.emailNoticeText}>
                A 6-digit password reset code has been sent to <Text style={{ fontWeight: '800', color: '#0369a1' }}>{resetEmail}</Text>. If you do not see the email in your inbox, please check your <Text style={{ fontWeight: '700' }}>Spam</Text> or <Text style={{ fontWeight: '700' }}>Junk</Text> folder.
              </Text>
            </View>

            {devOtpHint && (
              <View style={styles.devOtpBanner}>
                <Text style={styles.devOtpText}>[DEV MODE OTP CODE]: <Text style={{ fontWeight: '900', fontSize: 18 }}>{devOtpHint}</Text></Text>
              </View>
            )}

            <Input
              label="6-Digit Reset OTP Code"
              required
              value={otpCode}
              onChangeText={(txt) => setOtpCode(txt.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="e.g. 123456"
              keyboardType="numeric"
              maxLength={6}
            />

            <Input
              label="New Password"
              required
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Minimum 6 characters (max 25)"
              secureTextEntry
              maxLength={25}
            />

            <Button
              title={loading ? "Resetting Password..." : "Reset Password & Invalidate Old Sessions"}
              onPress={handleResetPasswordSubmit}
              disabled={loading || otpCode.length !== 6 || !newPassword}
              variant="primary"
              style={{ marginTop: 14 }}
            />

            <View style={styles.resendRow}>
              <TouchableOpacity onPress={() => { setStep('CREDENTIALS'); setErrorMsg(null); setSuccessMsg(null); }}>
                <Text style={styles.backLink}>← Back to Login</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* STEP 2: 2-PHASE LOGIN / REGISTRATION OTP VERIFICATION SCREEN */
          <View>
            <Text style={styles.otpHeading}>Doctor OTP Verification</Text>
            <Text style={styles.otpSub}>
              Enter the 6-digit security code sent to <Text style={{ fontWeight: '700' }}>{username}</Text>
            </Text>

            {/* EMAIL & SPAM BOX NOTIFICATION BANNER */}
            <View style={styles.emailNoticeBox}>
              <Text style={styles.emailNoticeTitle}>📩 Check Your Email Inbox & Spam Folder</Text>
              <Text style={styles.emailNoticeText}>
                A 6-digit verification code has been sent to <Text style={{ fontWeight: '800', color: '#0369a1' }}>{username}</Text>. If you do not see the email in your inbox, please check your <Text style={{ fontWeight: '700' }}>Spam</Text> or <Text style={{ fontWeight: '700' }}>Junk</Text> folder.
              </Text>
            </View>

            {devOtpHint && (
              <View style={styles.devOtpBanner}>
                <Text style={styles.devOtpText}>[DEV MODE OTP CODE]: <Text style={{ fontWeight: '900', fontSize: 18 }}>{devOtpHint}</Text></Text>
              </View>
            )}

            <Input
              label="6-Digit OTP Code"
              required
              value={otpCode}
              onChangeText={(txt) => setOtpCode(txt.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="e.g. 123456"
              keyboardType="numeric"
              maxLength={6}
            />

            <Button
              title={loading ? "Verifying..." : "Verify OTP & Sign In"}
              onPress={handleVerifyOtpSubmit}
              disabled={loading || otpCode.length !== 6}
              variant="primary"
              style={{ marginTop: 10 }}
            />

            <View style={styles.resendRow}>
              <TouchableOpacity onPress={handleResend} disabled={resendCooldown > 0}>
                <Text style={[styles.resendText, resendCooldown > 0 && { color: COLORS.textSecondary }]}>
                  {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : "Resend OTP Code"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('CREDENTIALS')}>
                <Text style={styles.backLink}>← Back</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}

function DoctorDashboard({ initialHandoffUuid = '', onOpenHandoffUuid }) {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState(initialHandoffUuid ? 'handoff' : 'new');
  const [selectedTransfer, setSelectedTransfer] = useState(null);
  const [selectedQrAuth, setSelectedQrAuth] = useState(null);
  const [selectedPid, setSelectedPid] = useState('');
  const [generatedTransferForQR, setGeneratedTransferForQR] = useState(null);
  const [showQRGenModal, setShowQRGenModal] = useState(false);
  const [showQRScanModal, setShowQRScanModal] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [activeAlertsCount, setActiveAlertsCount] = useState(0);

  useEffect(() => {
    const refreshBadges = async () => {
      try {
        const [notifRes, alertRes] = await Promise.all([
          api.getUnreadNotificationCount().catch(() => null),
          api.getMonitoringAlerts('status=ACTIVE').catch(() => null)
        ]);
        if (notifRes?.unreadCount !== undefined) setUnreadNotifs(notifRes.unreadCount);
        if (alertRes?.summary?.totalActiveAlerts !== undefined) setActiveAlertsCount(alertRes.summary.totalActiveAlerts);
      } catch (e) {}
    };
    refreshBadges();
    const timer = setInterval(refreshBadges, 20000);
    return () => clearInterval(timer);
  }, []);

  const handleTransferCreated = (transfer) => {
    setSelectedTransfer(transfer);
    setSelectedQrAuth(null);
    setGeneratedTransferForQR(transfer);
    setShowQRGenModal(true);
    setActiveTab('receiver');
  };

  const handleShowQR = (transfer) => {
    setGeneratedTransferForQR(transfer);
    setShowQRGenModal(true);
  };

  const handleDecryptedSuccess = (transfer, qrAuth = null) => {
    setSelectedTransfer(transfer);
    setSelectedQrAuth(qrAuth);
    setActiveTab('receiver');
  };

  const navItems = [
    { key: 'new', label: 'Transfer Folio', Icon: FilePlus2 },
    { key: 'history', label: 'Transfers & History', Icon: History },
    { key: 'notifications', label: 'Alerts & Inbox', Icon: Bell, count: unreadNotifs },
    { key: 'monitoring', label: 'Risk Monitor', Icon: AlertTriangle, count: activeAlertsCount },
    { key: 'screenings', label: 'Screenings', Icon: Activity },
    { key: 'followups', label: 'Follow-Ups', Icon: CalendarClock },
    { key: 'plans', label: 'Plans & License', Icon: Crown },
    { key: 'profile', label: 'Profile', Icon: UserCheck },
    { key: 'verifier', label: 'Verifier', Icon: ShieldCheck }
  ];

  return (
    <SafeAreaView style={styles.dashboardContainer}>
      {/* Top Navbar */}
      <View style={styles.navBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Image source={require('./assets/logo.png')} style={{ width: 38, height: 38, resizeMode: 'contain', marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={styles.logoText}>MediFORM</Text>
              <Badge label="COLIN TECH" variant="info" />
              <TouchableOpacity onPress={() => setActiveTab('profile')}>
                <Badge
                  label={
                    user.verificationStatus === 'VERIFIED' ? '✓ Verified' :
                    user.verificationStatus === 'PENDING' ? '⏳ Pending' :
                    user.verificationStatus === 'RESUBMISSION_REQUIRED' ? '⚠️ Resubmit' :
                    user.verificationStatus === 'REJECTED' ? '✕ Rejected' :
                    'Unverified'
                  }
                  variant={
                    user.verificationStatus === 'VERIFIED' ? 'success' :
                    user.verificationStatus === 'PENDING' ? 'warning' :
                    user.verificationStatus === 'RESUBMISSION_REQUIRED' ? 'warning' :
                    user.verificationStatus === 'REJECTED' ? 'danger' :
                    'secondary'
                  }
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.userSub} numberOfLines={1}>
              {user.name || user.username} | {user.hospitalName || 'Hospital'}
            </Text>
          </View>
        </View>

        <View style={styles.navActions}>
          <Button
            title="Scan QR"
            onPress={() => setShowQRScanModal(true)}
            variant="secondary"
            size="small"
            icon={<QrCode size={14} color="#FFF" />}
            style={{ marginRight: 8 }}
          />
          <Button
            title="Logout"
            onPress={logout}
            variant="outline"
            size="small"
          />
        </View>
      </View>

      {/* Clean Separated Horizontal Navigation Pills */}
      <View style={styles.menuBarWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.menuBar}>
          {navItems.map(({ key, label, Icon, count }) => {
            const active = activeTab === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setActiveTab(key)}
                style={[styles.menuItem, active && styles.menuItemActive]}
              >
                <Icon size={14} color={active ? '#FFF' : COLORS.textSecondary} style={{ marginRight: 6 }} />
                <Text style={[styles.menuText, active && styles.menuTextActive]}>{label}</Text>
                {count > 0 && (
                  <View style={styles.navBadge}>
                    <Text style={styles.navBadgeText}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
          {selectedTransfer && (
            <TouchableOpacity
              onPress={() => setActiveTab('receiver')}
              style={[styles.menuItem, activeTab === 'receiver' && styles.menuItemActive, { borderColor: COLORS.critical }]}
            >
              <Text style={[styles.menuText, activeTab === 'receiver' && styles.menuTextActive, activeTab !== 'receiver' && { color: COLORS.critical }]}>
                🚑 Live Folio View
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {/* Main Content Area */}
      <View style={{ flex: 1 }}>
        {activeTab === 'new' && (
          <TransferForm onTransferCreated={handleTransferCreated} />
        )}

        {activeTab === 'notifications' && (
          <DoctorNotificationsView
            onUnreadChanged={(cnt) => setUnreadNotifs(cnt)}
            onOpenHandoffUuid={(uuid) => {
              if (onOpenHandoffUuid) onOpenHandoffUuid(uuid);
            }}
          />
        )}

        {activeTab === 'plans' && (
          <SubscriptionPlansView />
        )}

        {activeTab === 'screenings' && (
          <ScreeningReferralView
            onShowQR={handleShowQR}
            onSelectTransfer={(tr) => {
              setSelectedTransfer(tr);
              setSelectedQrAuth(null);
              setActiveTab('receiver');
            }}
          />
        )}

        {activeTab === 'followups' && (
          <DoctorFollowUpView />
        )}

        {activeTab === 'monitoring' && (
          <DoctorMonitoringView />
        )}

        {activeTab === 'history' && (
          <TransferHistoryView
            onSelectTransfer={(tr) => {
              setSelectedTransfer(tr);
              setSelectedQrAuth(null);
              setActiveTab('receiver');
            }}
            onViewTimeline={(pid) => {
              setSelectedPid(pid);
              setActiveTab('timeline');
            }}
            onShowQR={handleShowQR}
          />
        )}

        {activeTab === 'profile' && (
          <DoctorProfileView onProfileUpdated={() => {}} />
        )}

        {activeTab === 'verifier' && (
          <InstitutionalVerifierView />
        )}

        {activeTab === 'timeline' && (
          <PatientTimelineView
            pid={selectedPid || (selectedTransfer ? selectedTransfer.pid : 'PAT-2026')}
            onSelectVersion={(ver) => {
              setSelectedTransfer(ver);
              setSelectedQrAuth(null);
              setActiveTab('receiver');
            }}
            onBack={() => setActiveTab('history')}
          />
        )}

        {activeTab === 'receiver' && selectedTransfer && (
          <EmergencyReceiverScreen
            transfer={selectedTransfer}
            qrAuth={selectedQrAuth}
            onAcknowledgeComplete={(updated) => setSelectedTransfer(updated)}
            onShowQR={handleShowQR}
            onClose={() => setActiveTab('history')}
          />
        )}
      </View>

      {/* QR Modals */}
      <QRGeneratorModal
        visible={showQRGenModal}
        transfer={generatedTransferForQR}
        onClose={() => setShowQRGenModal(false)}
      />

      <QRScannerModal
        visible={showQRScanModal}
        onClose={() => setShowQRScanModal(false)}
        onDecryptedSuccess={handleDecryptedSuccess}
      />
    </SafeAreaView>
  );
}

function parseHandoffFromUrl(urlString) {
  if (!urlString) return '';
  if (urlString.includes('/handoff/')) {
    const parts = urlString.split('/handoff/');
    return parts[parts.length - 1].split('?')[0].split('#')[0] || '';
  }
  if (urlString.includes('handoff?id=')) {
    const parts = urlString.split('handoff?id=');
    return parts[parts.length - 1].split('&')[0] || '';
  }
  if (urlString.startsWith('mediform://handoff/')) {
    return urlString.replace('mediform://handoff/', '').split('?')[0] || '';
  }
  return '';
}

function MainApp() {
  const { user, loading, logout } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const [handoffUuid, setHandoffUuid] = useState(() => {
    if (typeof window !== 'undefined' && window.location) {
      return parseHandoffFromUrl(window.location.href);
    }
    return '';
  });
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined' && window.location && parseHandoffFromUrl(window.location.href)) {
      return 'HANDOFF';
    }
    return 'AUTH';
  });

  // Native iOS / Android Deep Link Listener (mediform://handoff/:uuid or https://.../handoff/:uuid)
  useEffect(() => {
    Linking.getInitialURL().then((initialUrl) => {
      const uuid = parseHandoffFromUrl(initialUrl);
      if (uuid) {
        setHandoffUuid(uuid);
        setViewMode('HANDOFF');
      }
    }).catch(() => {});

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const uuid = parseHandoffFromUrl(url);
      if (uuid) {
        setHandoffUuid(uuid);
        setViewMode('HANDOFF');
      }
    });
    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  if (showSplash) {
    return <SplashScreenLoader duration={1500} onFinish={() => setShowSplash(false)} />;
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={{ fontSize: 16, color: COLORS.primary }}>Loading MediFORM Clinical Network...</Text>
      </View>
    );
  }

  if (viewMode === 'HANDOFF') {
    return (
      <SecureHandoffScreen
        uuid={handoffUuid}
        onReset={() => {
          setHandoffUuid('');
          setViewMode('AUTH');
        }}
      />
    );
  }

  if (viewMode === 'PATIENT_QR') {
    return <PatientQRView onReset={() => setViewMode('AUTH')} />;
  }

  if (!user) {
    return (
      <AuthScreen
        onSwitchToPatientView={() => setViewMode('PATIENT_QR')}
        onSwitchToHandoffView={() => setViewMode('HANDOFF')}
      />
    );
  }

  if (user.role === 'patient') {
    return <PatientDashboard user={user} onLogout={logout} />;
  }

  return (
    <DoctorDashboard
      onOpenHandoffUuid={(uuid) => {
        setHandoffUuid(uuid);
        setViewMode('HANDOFF');
      }}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  authContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  authCard: {
    maxWidth: 450,
    width: '100%',
    padding: 24,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 1,
  },
  brandSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  errorBox: {
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
  },
  successBanner: {
    backgroundColor: '#E6F4EA',
    borderLeftWidth: 4,
    borderColor: '#137333',
    padding: 10,
    borderRadius: 6,
    marginBottom: 14,
  },
  successBannerText: {
    color: '#137333',
    fontSize: 13,
    fontWeight: '600',
  },
  tabRow: {
    flexDirection: 'row',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  authTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  authTabActive: {
    borderBottomWidth: 3,
    borderBottomColor: COLORS.primary,
  },
  authTabText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  authTabTextActive: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  patientLinkBox: {
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    alignItems: 'center',
  },
  patientLinkSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  patientLinkText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  otpHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
    marginBottom: 4,
  },
  otpSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  devOtpBanner: {
    backgroundColor: '#E3F2FD',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    padding: 12,
    borderRadius: 8,
    marginBottom: 14,
    alignItems: 'center',
  },
  devOtpText: {
    fontSize: 13,
    color: COLORS.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 99999,
  },
  modalAlertCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    maxWidth: 420,
    width: '100%',
    alignItems: 'center',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
  },
  modalIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalAlertTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
    textAlign: 'center',
    marginBottom: 10,
  },
  modalAlertText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 10,
  },
  modalAlertSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    width: '100%',
  },
  emailNoticeBox: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1.5,
    borderColor: '#0284c7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  emailNoticeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0369a1',
    marginBottom: 4,
  },
  emailNoticeText: {
    fontSize: 12,
    color: '#0c4a6e',
    lineHeight: 18,
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  resendText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  backLink: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  dashboardContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  logoText: {
    fontSize: 20,
    fontWeight: '900',
    color: COLORS.primary,
  },
  userSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuBarWrapper: {
    backgroundColor: '#FFF',
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.border,
  },
  menuBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#F8FAFC',
  },
  menuItemActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  menuText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  menuTextActive: {
    color: '#FFF',
    fontWeight: '800',
  },
  navBadge: {
    marginLeft: 6,
    backgroundColor: COLORS.critical,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  navBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  }
});
