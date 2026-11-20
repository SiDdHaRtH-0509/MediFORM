import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Modal, Alert, ActivityIndicator } from 'react-native';
import { Card, Button, Input, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import api from '../../services/api';

export function DoctorProfileView({ onProfileUpdated }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Edit form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [department, setDepartment] = useState('');
  const [yearsOfExperience, setYearsOfExperience] = useState('');
  const [professionalDesignation, setProfessionalDesignation] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [institutionalAffiliationDetails, setInstitutionalAffiliationDetails] = useState('');
  const [medicalRegistrationNumber, setMedicalRegistrationNumber] = useState('');
  const [registrationAuthority, setRegistrationAuthority] = useState('');
  const [registrationJurisdiction, setRegistrationJurisdiction] = useState('');

  // Credential submission modal/section state
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submittingCreds, setSubmittingCreds] = useState(false);
  const [credRegNumber, setCredRegNumber] = useState('');
  const [credAuthority, setCredAuthority] = useState('');
  const [credJurisdiction, setCredJurisdiction] = useState('');
  const [credDesignation, setCredDesignation] = useState('');
  const [documentFileName, setDocumentFileName] = useState('medical_council_license_2026.pdf');
  const [documentFileType, setDocumentFileType] = useState('application/pdf');
  const [documentBase64, setDocumentBase64] = useState('data:application/pdf;base64,JVBERi0xLjQKJVRlc3QgTWVkaWNhbCBDZXJ0aWZpY2F0ZQo=');

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getDoctorProfile();
      if (res && res.profile) {
        setProfile(res.profile);
        initForm(res.profile);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load doctor profile.');
    } finally {
      setLoading(false);
    }
  };

  const initForm = (p) => {
    setName(p.name || '');
    setPhone(p.phone || '');
    setBio(p.bio || '');
    setSpecialization(p.specialization || '');
    setDepartment(p.department || '');
    setYearsOfExperience(p.yearsOfExperience !== undefined ? String(p.yearsOfExperience) : '');
    setProfessionalDesignation(p.professionalDesignation || '');
    setHospitalName(p.hospitalName || '');
    setInstitutionalAffiliationDetails(p.institutionalAffiliationDetails || '');
    setMedicalRegistrationNumber(p.medicalRegistrationNumber || '');
    setRegistrationAuthority(p.registrationAuthority || '');
    setRegistrationJurisdiction(p.registrationJurisdiction || '');

    setCredRegNumber(p.medicalRegistrationNumber || '');
    setCredAuthority(p.registrationAuthority || 'National Medical Commission');
    setCredJurisdiction(p.registrationJurisdiction || 'State Board of Medical Examiners');
    setCredDesignation(p.professionalDesignation || 'Attending Physician');
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const expNum = parseInt(yearsOfExperience, 10);
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        bio: bio.trim(),
        specialization: specialization.trim(),
        department: department.trim(),
        yearsOfExperience: isNaN(expNum) ? 0 : expNum,
        professionalDesignation: professionalDesignation.trim(),
        hospitalName: hospitalName.trim(),
        institutionalAffiliationDetails: institutionalAffiliationDetails.trim(),
        medicalRegistrationNumber: medicalRegistrationNumber.trim(),
        registrationAuthority: registrationAuthority.trim(),
        registrationJurisdiction: registrationJurisdiction.trim()
      };

      const res = await api.updateDoctorProfile(payload);
      if (res && res.profile) {
        setProfile(res.profile);
        setIsEditing(false);
        if (res.reverificationTriggered) {
          setSuccessMsg('Profile updated. Professional re-verification required due to material credential/affiliation change.');
        } else {
          setSuccessMsg('Profile updated successfully.');
        }
        if (onProfileUpdated) onProfileUpdated(res.profile);
        fetchProfile();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleCredentialSubmit = async () => {
    if (!credRegNumber || !credAuthority || !credJurisdiction) {
      setErrorMsg('Medical registration number, authority, and jurisdiction are required.');
      return;
    }

    setSubmittingCreds(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const payload = {
        medicalRegistrationNumber: credRegNumber.trim(),
        registrationAuthority: credAuthority.trim(),
        registrationJurisdiction: credJurisdiction.trim(),
        professionalDesignation: credDesignation.trim(),
        hospitalAffiliation: hospitalName || profile.hospitalName,
        documents: [
          {
            fileName: documentFileName,
            fileType: documentFileType,
            fileSize: 1024 * 1024,
            fileData: documentBase64,
            documentType: 'REGISTRATION_CERTIFICATE'
          }
        ]
      };

      const res = await api.submitDoctorCredentials(payload);
      if (res && res.success) {
        setSuccessMsg('Professional credentials submitted successfully. Status updated to PENDING verification.');
        setShowSubmitModal(false);
        fetchProfile();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit credentials.');
    } finally {
      setSubmittingCreds(false);
    }
  };

  const renderVerificationBadge = (status) => {
    switch (status) {
      case 'VERIFIED':
        return <Badge label="✓ Institutionally Verified" variant="success" />;
      case 'PENDING':
        return <Badge label="⏳ Verification Pending" variant="warning" />;
      case 'RESUBMISSION_REQUIRED':
        return <Badge label="⚠️ Resubmission Required" variant="warning" />;
      case 'REJECTED':
        return <Badge label="✕ Verification Rejected" variant="danger" />;
      default:
        return <Badge label="Unverified Account" variant="secondary" />;
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading Doctor Profile & Credential Records...</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Doctor profile record could not be loaded.</Text>
        <Button title="Retry" onPress={fetchProfile} variant="primary" style={{ marginTop: 12 }} />
      </View>
    );
  }

  const verifDetails = profile.verificationDetails;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header Banner */}
      <Card style={styles.headerCard}>
        <View style={styles.headerRow}>
          <View style={styles.avatarBox}>
            {profile.profilePhoto ? (
              <Image source={{ uri: profile.profilePhoto }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {(profile.name || profile.username || 'DR').substring(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.headerMeta}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
              <Text style={styles.doctorName}>{profile.name || profile.username}</Text>
              {renderVerificationBadge(profile.verificationStatus)}
            </View>
            <Text style={styles.doctorSub}>
              {profile.professionalDesignation || 'Medical Clinician'} • {profile.department || 'Clinical Services'}
            </Text>
            <Text style={styles.hospitalSub}>{profile.hospitalName || 'Medical Center'}</Text>
          </View>

          <View style={styles.headerActions}>
            {!isEditing ? (
              <Button
                title="Edit Profile"
                onPress={() => setIsEditing(true)}
                variant="primary"
                size="small"
              />
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  title="Cancel"
                  onPress={() => { setIsEditing(false); initForm(profile); setErrorMsg(null); }}
                  variant="outline"
                  size="small"
                />
                <Button
                  title={saving ? "Saving..." : "Save Changes"}
                  onPress={handleSaveProfile}
                  disabled={saving}
                  variant="success"
                  size="small"
                />
              </View>
            )}
          </View>
        </View>

        {errorMsg && (
          <View style={styles.alertError}>
            <Text style={styles.alertErrorText}>[!] {errorMsg}</Text>
          </View>
        )}

        {successMsg && (
          <View style={styles.alertSuccess}>
            <Text style={styles.alertSuccessText}>✓ {successMsg}</Text>
          </View>
        )}
      </Card>

      {/* Re-Verification Warning if editing material fields on a VERIFIED account */}
      {isEditing && profile.verificationStatus === 'VERIFIED' && (
        <View style={styles.warningNotice}>
          <Text style={styles.warningTitle}>⚠️ Professional Verification Notice</Text>
          <Text style={styles.warningText}>
            Modifying medical registration details or hospital affiliation on a verified profile will invalidate the active badge and require institutional re-verification.
          </Text>
        </View>
      )}

      {/* Verification Status Details & Action Card */}
      <Card style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Professional Account Verification Status</Text>
          {profile.verificationStatus !== 'VERIFIED' && profile.verificationStatus !== 'PENDING' && (
            <Button
              title="Submit Credentials for Verification"
              onPress={() => setShowSubmitModal(true)}
              variant="primary"
              size="small"
            />
          )}
        </View>

        <View style={styles.statusGrid}>
          <View style={styles.statusItem}>
            <Text style={styles.labelMuted}>Verification State</Text>
            <View style={{ marginTop: 4 }}>{renderVerificationBadge(profile.verificationStatus)}</View>
          </View>
          <View style={styles.statusItem}>
            <Text style={styles.labelMuted}>Medical Reg. Number</Text>
            <Text style={styles.valueStrong}>{profile.medicalRegistrationNumber || 'Not registered'}</Text>
          </View>
          <View style={styles.statusItem}>
            <Text style={styles.labelMuted}>Authority / Jurisdiction</Text>
            <Text style={styles.valueStrong}>
              {profile.registrationAuthority ? `${profile.registrationAuthority} (${profile.registrationJurisdiction || 'State'})` : 'Not recorded'}
            </Text>
          </View>
          <View style={styles.statusItem}>
            <Text style={styles.labelMuted}>Institutional Verifier Authority</Text>
            <Text style={styles.valueStrong}>
              {profile.isInstitutionalVerifier ? '✓ Authorized Institutional Verifier' : 'Standard Doctor Account'}
            </Text>
          </View>
        </View>

        {verifDetails && verifDetails.reviewNotes ? (
          <View style={[
            styles.reviewNotesBox,
            profile.verificationStatus === 'REJECTED' ? styles.reviewNotesBoxRejected : styles.reviewNotesBoxInfo
          ]}>
            <Text style={styles.reviewNotesTitle}>
              {profile.verificationStatus === 'REJECTED' ? 'Rejection Reason Note' : 'Verification Review Note'}:
            </Text>
            <Text style={styles.reviewNotesText}>"{verifDetails.reviewNotes}"</Text>
            {verifDetails.reviewerName ? (
              <Text style={styles.reviewNotesAuthor}>Reviewed by: {verifDetails.reviewerName}</Text>
            ) : null}
          </View>
        ) : null}

        {profile.verificationStatus === 'PENDING' && (
          <View style={styles.pendingInfoBox}>
            <Text style={styles.pendingInfoText}>
              ℹ️ Your credentials and registration certificate have been received. An authorized institutional verifier is currently reviewing your documentation.
            </Text>
          </View>
        )}
      </Card>

      {/* Section A: Personal Information */}
      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>A. Personal Information</Text>
        <View style={styles.grid2Col}>
          <Input
            label="Full Name"
            value={name}
            onChangeText={setName}
            editable={isEditing}
            placeholder="Dr. Full Name"
          />
          <Input
            label="Email Address (Login Identity)"
            value={profile.email}
            editable={false}
          />
        </View>

        <View style={styles.grid2Col}>
          <Input
            label="Direct Phone Number"
            value={phone}
            onChangeText={setPhone}
            editable={isEditing}
            placeholder="+1 (555) 000-0000"
          />
          <Input
            label="Professional Designation"
            value={professionalDesignation}
            onChangeText={setProfessionalDesignation}
            editable={isEditing}
            placeholder="e.g. Attending Physician / Senior Consultant"
          />
        </View>

        <Input
          label="Professional Biography"
          value={bio}
          onChangeText={setBio}
          editable={isEditing}
          placeholder="Brief clinical background, clinical interests, or research specializations..."
          multiline
          numberOfLines={3}
        />
      </Card>

      {/* Section B: Professional Information */}
      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>B. Professional & Credential Details</Text>
        <View style={styles.grid3Col}>
          <Input
            label="Specialization"
            value={specialization}
            onChangeText={setSpecialization}
            editable={isEditing}
            placeholder="e.g. Cardiology, Emergency Medicine"
          />
          <Input
            label="Clinical Department"
            value={department}
            onChangeText={setDepartment}
            editable={isEditing}
            placeholder="e.g. Emergency / Triage"
          />
          <Input
            label="Years of Experience"
            value={yearsOfExperience}
            onChangeText={setYearsOfExperience}
            editable={isEditing}
            keyboardType="numeric"
            placeholder="e.g. 10"
          />
        </View>

        <View style={styles.grid3Col}>
          <Input
            label="Medical Registration No."
            value={medicalRegistrationNumber}
            onChangeText={setMedicalRegistrationNumber}
            editable={isEditing}
            placeholder="e.g. MED-REG-2026-99"
          />
          <Input
            label="Registration Authority"
            value={registrationAuthority}
            onChangeText={setRegistrationAuthority}
            editable={isEditing}
            placeholder="e.g. National Medical Commission"
          />
          <Input
            label="Registration Jurisdiction"
            value={registrationJurisdiction}
            onChangeText={setRegistrationJurisdiction}
            editable={isEditing}
            placeholder="e.g. State / National Board"
          />
        </View>
      </Card>

      {/* Section C: Institutional Affiliation */}
      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>C. Institutional Information</Text>
        <View style={styles.grid2Col}>
          <Input
            label="Hospital / Institution Facility"
            value={hospitalName}
            onChangeText={setHospitalName}
            editable={isEditing}
            placeholder="Facility name"
          />
          <Input
            label="Department Assignment"
            value={department}
            onChangeText={setDepartment}
            editable={isEditing}
            placeholder="Assigned clinical department"
          />
        </View>

        <Input
          label="Institutional Affiliation Details"
          value={institutionalAffiliationDetails}
          onChangeText={setInstitutionalAffiliationDetails}
          editable={isEditing}
          placeholder="Details on clinical privileges, faculty appointments, or trauma system affiliations..."
        />
      </Card>

      {/* Section D: Account Metadata */}
      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>D. Account & System Metadata</Text>
        <View style={styles.grid4Col}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Account Created</Text>
            <Text style={styles.metaVal}>{new Date(profile.createdAt).toLocaleDateString()}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Last Profile Update</Text>
            <Text style={styles.metaVal}>
              {profile.lastProfileUpdate ? new Date(profile.lastProfileUpdate).toLocaleDateString() : 'Initial'}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Email Verification</Text>
            <Text style={[styles.metaVal, { color: COLORS.success }]}>
              {profile.isEmailVerified ? '✓ Verified' : 'Pending'}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Professional Status</Text>
            <Text style={styles.metaVal}>{profile.verificationStatus}</Text>
          </View>
        </View>
      </Card>

      {/* Verification History & Uploaded Documents Section */}
      {verifDetails && verifDetails.documents && verifDetails.documents.length > 0 && (
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Submitted Credential Documents (Secure Access)</Text>
          <Text style={styles.helperText}>
            Uploaded professional credentials are encrypted and accessible only to authorized institutional verifiers.
          </Text>

          {verifDetails.documents.map((doc, idx) => (
            <View key={doc.documentId || idx} style={styles.docItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.docName}>📄 {doc.fileName}</Text>
                <Text style={styles.docMeta}>
                  {doc.documentType} • {(doc.fileSize / 1024).toFixed(1)} KB • Uploaded {new Date(doc.uploadedAt || Date.now()).toLocaleDateString()}
                </Text>
              </View>
              <Badge label="Secure Document" variant="secondary" />
            </View>
          ))}

          {verifDetails.resubmissionHistory && verifDetails.resubmissionHistory.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.subHeading}>Previous Verification History</Text>
              {verifDetails.resubmissionHistory.map((item, idx) => (
                <View key={idx} style={styles.historyItem}>
                  <Text style={styles.historyMeta}>
                    Decision: <Text style={{ fontWeight: '700' }}>{item.decision}</Text> • {new Date(item.reviewedAt || item.submissionTimestamp).toLocaleDateString()}
                  </Text>
                  {item.decisionNotes ? (
                    <Text style={styles.historyNotes}>Note: {item.decisionNotes}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Card>
      )}

      {/* Modal: Submit Professional Credentials */}
      <Modal visible={showSubmitModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Submit Credentials for Verification</Text>
              <TouchableOpacity onPress={() => setShowSubmitModal(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalSub}>
                Provide your official medical licensing credentials and upload your registration certificate. An authorized independent verifier will review and authenticate your status.
              </Text>

              <Input
                label="Medical Registration / License Number"
                required
                value={credRegNumber}
                onChangeText={setCredRegNumber}
                placeholder="e.g. MED-REG-2026-99124"
              />

              <Input
                label="Issuing Registration Authority"
                required
                value={credAuthority}
                onChangeText={setCredAuthority}
                placeholder="e.g. National Medical Commission / State Medical Council"
              />

              <Input
                label="Registration Jurisdiction / State"
                required
                value={credJurisdiction}
                onChangeText={setCredJurisdiction}
                placeholder="e.g. California / Maharashtra / New York"
              />

              <Input
                label="Professional Designation"
                value={credDesignation}
                onChangeText={setCredDesignation}
                placeholder="e.g. Attending Trauma Surgeon"
              />

              <View style={styles.docUploadBox}>
                <Text style={styles.docUploadLabel}>Registration Certificate Document</Text>
                <View style={styles.docUploadRow}>
                  <Text style={styles.docUploadFile}>📄 {documentFileName}</Text>
                  <Badge label="PDF / Ready" variant="success" />
                </View>
                <Text style={styles.docUploadHint}>
                  Simulated secure upload prepared: Registration Certificate (PDF format, encrypted storage).
                </Text>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Button
                title="Cancel"
                onPress={() => setShowSubmitModal(false)}
                variant="outline"
                style={{ flex: 1, marginRight: 8 }}
              />
              <Button
                title={submittingCreds ? "Submitting..." : "Submit for Verification"}
                onPress={handleCredentialSubmit}
                disabled={submittingCreds}
                variant="primary"
                style={{ flex: 2 }}
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
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 16
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textSecondary
  },
  headerCard: {
    marginBottom: 16,
    padding: 20
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  avatarBox: {
    marginRight: 16
  },
  avatarImg: {
    width: 64,
    height: 64,
    borderRadius: 32
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#0284c7',
    justifyContent: 'center',
    alignItems: 'center'
  },
  avatarText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800'
  },
  headerMeta: {
    flex: 1
  },
  doctorName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  doctorSub: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  hospitalSub: {
    fontSize: 13,
    color: '#0284c7',
    fontWeight: '600',
    marginTop: 2
  },
  headerActions: {
    marginLeft: 12
  },
  alertError: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
    padding: 12,
    borderRadius: 4,
    marginTop: 14
  },
  alertErrorText: {
    color: '#991b1b',
    fontSize: 13,
    fontWeight: '600'
  },
  alertSuccess: {
    backgroundColor: '#f0fdf4',
    borderLeftWidth: 4,
    borderLeftColor: '#16a34a',
    padding: 12,
    borderRadius: 4,
    marginTop: 14
  },
  alertSuccessText: {
    color: '#15803d',
    fontSize: 13,
    fontWeight: '600'
  },
  warningNotice: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
    padding: 14,
    marginBottom: 16
  },
  warningTitle: {
    color: '#92400e',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 4
  },
  warningText: {
    color: '#78350f',
    fontSize: 13,
    lineHeight: 18
  },
  sectionCard: {
    marginBottom: 16,
    padding: 18
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 12
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 12
  },
  statusItem: {
    flex: 1,
    minWidth: 160
  },
  labelMuted: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    fontWeight: '600'
  },
  valueStrong: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '700',
    marginTop: 4
  },
  reviewNotesBox: {
    padding: 12,
    borderRadius: 6,
    marginTop: 12
  },
  reviewNotesBoxRejected: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626'
  },
  reviewNotesBoxInfo: {
    backgroundColor: '#f0f9ff',
    borderLeftWidth: 4,
    borderLeftColor: '#0284c7'
  },
  reviewNotesTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    marginBottom: 4
  },
  reviewNotesText: {
    fontSize: 14,
    color: '#1e293b',
    fontStyle: 'italic'
  },
  reviewNotesAuthor: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    fontWeight: '600'
  },
  pendingInfoBox: {
    backgroundColor: '#eff6ff',
    padding: 12,
    borderRadius: 6,
    marginTop: 10
  },
  pendingInfoText: {
    color: '#1e40af',
    fontSize: 13,
    lineHeight: 18
  },
  grid2Col: {
    flexDirection: 'row',
    gap: 12
  },
  grid3Col: {
    flexDirection: 'row',
    gap: 12
  },
  grid4Col: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap'
  },
  metaCell: {
    flex: 1,
    minWidth: 120,
    backgroundColor: '#f1f5f9',
    padding: 10,
    borderRadius: 6
  },
  metaLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  metaVal: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 2
  },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    padding: 12,
    marginTop: 8
  },
  docName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary
  },
  docMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  helperText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 6
  },
  subHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6
  },
  historyItem: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  historyMeta: {
    fontSize: 12,
    color: COLORS.textPrimary
  },
  historyNotes: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: 2
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 580,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  closeBtn: {
    fontSize: 18,
    color: COLORS.textSecondary,
    padding: 4
  },
  modalSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 14
  },
  docUploadBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 14,
    marginTop: 10,
    marginBottom: 10
  },
  docUploadLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 6
  },
  docUploadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  docUploadFile: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284c7'
  },
  docUploadHint: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 6
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 18
  }
});

export default DoctorProfileView;
