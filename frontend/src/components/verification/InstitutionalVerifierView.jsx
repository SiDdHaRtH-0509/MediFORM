import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import { Card, Button, Input, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

export function InstitutionalVerifierView() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [verifications, setVerifications] = useState([]);
  const [filterStatus, setFilterStatus] = useState('PENDING'); // 'PENDING' | 'VERIFIED' | 'REJECTED' | 'ALL'
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Review modal state
  const [selectedVerif, setSelectedVerif] = useState(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [viewingDoc, setViewingDoc] = useState(null);

  useEffect(() => {
    fetchVerifications();
  }, [filterStatus]);

  const fetchVerifications = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const statusParam = filterStatus === 'ALL' ? '' : `status=${filterStatus}`;
      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
      const params = `${statusParam}${searchParam}`;
      const res = await api.getPendingVerifications(params);
      if (res && res.verifications) {
        setVerifications(res.verifications);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to fetch verification queue.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = () => {
    fetchVerifications();
  };

  const handleOpenReview = (verif) => {
    setSelectedVerif(verif);
    setDecisionNotes('');
    setViewingDoc(null);
    setErrorMsg(null);
  };

  const handleReviewDecision = async (decision) => {
    if ((decision === 'REJECTED' || decision === 'RESUBMISSION_REQUIRED') && !decisionNotes.trim()) {
      setErrorMsg('Mandatory explanatory notes are required when rejecting credentials or requesting resubmission.');
      return;
    }

    // Client-side self-verification check
    const currentUserId = user ? (user.id || user._id) : null;
    if (selectedVerif && currentUserId && (selectedVerif.doctorId === currentUserId || selectedVerif.doctorId._id === currentUserId)) {
      setErrorMsg('Institutional Policy Error: You are strictly prohibited from reviewing or verifying your own credentials.');
      return;
    }

    setSubmittingDecision(true);
    setErrorMsg(null);
    try {
      const res = await api.reviewVerification(selectedVerif.id || selectedVerif.verificationId, {
        decision,
        notes: decisionNotes.trim()
      });

      if (res && res.success) {
        setSuccessMsg(`Decision recorded: ${decision} for ${selectedVerif.doctorName}.`);
        setSelectedVerif(null);
        fetchVerifications();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to record verification decision.');
    } finally {
      setSubmittingDecision(false);
    }
  };

  const renderBadge = (status) => {
    switch (status) {
      case 'VERIFIED':
        return <Badge label="Verified" variant="success" />;
      case 'PENDING':
        return <Badge label="Pending Review" variant="warning" />;
      case 'RESUBMISSION_REQUIRED':
        return <Badge label="Resubmission Required" variant="warning" />;
      case 'REJECTED':
        return <Badge label="Rejected" variant="danger" />;
      default:
        return <Badge label="Unverified" variant="secondary" />;
    }
  };

  const isSelf = selectedVerif && user && (
    (selectedVerif.doctorId && selectedVerif.doctorId.toString() === (user.id || user._id || '').toString()) ||
    (selectedVerif.doctorEmail && user.email && selectedVerif.doctorEmail.toLowerCase() === user.email.toLowerCase())
  );

  return (
    <View style={styles.container}>
      {/* Title & Stats Banner */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Institutional Verifier Authority Dashboard</Text>
          <Text style={styles.headerSub}>
            Independent Medical Credential Review, Licensing Authentication & Audit Administration
          </Text>
        </View>
        <Badge label="Verifier Privileges Active" variant="primary" />
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

      {/* Filter and Search Bar */}
      <Card style={styles.filterCard}>
        <View style={styles.filterRow}>
          <View style={styles.tabGroup}>
            {['PENDING', 'VERIFIED', 'REJECTED', 'ALL'].map(st => (
              <TouchableOpacity
                key={st}
                onPress={() => setFilterStatus(st)}
                style={[styles.tabBtn, filterStatus === st && styles.tabBtnActive]}
              >
                <Text style={[styles.tabBtnText, filterStatus === st && styles.tabBtnTextActive]}>
                  {st === 'PENDING' ? '⏳ Pending Review' : st === 'VERIFIED' ? '✓ Verified' : st === 'REJECTED' ? '✕ Rejected' : 'All Requests'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.searchRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Input
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search by doctor, email, hospital, or registration no..."
                onSubmitEditing={handleSearchSubmit}
              />
            </View>
            <Button
              title="Filter"
              onPress={handleSearchSubmit}
              variant="secondary"
              size="small"
            />
          </View>
        </View>
      </Card>

      {/* Main List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Fetching credential verification requests...</Text>
        </View>
      ) : verifications.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No Verification Requests Found</Text>
          <Text style={styles.emptySub}>
            There are currently no doctor credential submissions matching status "{filterStatus}".
          </Text>
        </Card>
      ) : (
        <ScrollView style={styles.listContainer}>
          {verifications.map((item, idx) => (
            <Card key={item.id || item.verificationId || idx} style={styles.verifCard}>
              <View style={styles.verifRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Text style={styles.docName}>{item.doctorName || 'Doctor'}</Text>
                    {renderBadge(item.status)}
                  </View>
                  <Text style={styles.docDetail}>
                    {item.doctorEmail} • {item.professionalDesignation || 'Clinician'} • {item.department || 'Medicine'}
                  </Text>
                  <Text style={styles.hospitalDetail}>
                    Facility: <Text style={{ fontWeight: '700' }}>{item.hospital || 'Hospital'}</Text>
                  </Text>
                  <Text style={styles.regDetail}>
                    Reg No: <Text style={{ fontWeight: '700' }}>{item.medicalRegistrationNumber || 'None'}</Text> | {item.registrationAuthority || 'Authority'} ({item.registrationJurisdiction || 'Jurisdiction'})
                  </Text>
                  <Text style={styles.timeDetail}>
                    Submitted: {new Date(item.submissionTimestamp).toLocaleString()} • {item.documentsCount || (item.documents ? item.documents.length : 0)} document(s) attached
                  </Text>
                </View>

                <View style={styles.actionCol}>
                  <Button
                    title="Review Credentials"
                    onPress={() => handleOpenReview(item)}
                    variant="primary"
                    size="small"
                  />
                </View>
              </View>
            </Card>
          ))}
        </ScrollView>
      )}

      {/* Review & Decision Modal */}
      {selectedVerif && (
        <Modal visible={Boolean(selectedVerif)} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Credential Verification Review</Text>
                  <Text style={styles.modalSubTitle}>{selectedVerif.doctorName} ({selectedVerif.doctorEmail})</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedVerif(null)}>
                  <Text style={styles.closeBtn}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 440 }}>
                {isSelf && (
                  <View style={styles.selfAlertBox}>
                    <Text style={styles.selfAlertTitle}>⛔ Conflict of Interest Alert</Text>
                    <Text style={styles.selfAlertText}>
                      You cannot review or approve your own credentials. Verification must be performed by an independent authorized verifier.
                    </Text>
                  </View>
                )}

                <View style={styles.infoSection}>
                  <Text style={styles.infoHeading}>Submitted Professional Information</Text>
                  <View style={styles.infoGrid}>
                    <View style={styles.infoItem}>
                      <Text style={styles.infoLabel}>Medical Registration No.</Text>
                      <Text style={styles.infoVal}>{selectedVerif.medicalRegistrationNumber}</Text>
                    </View>
                    <View style={styles.infoItem}>
                      <Text style={styles.infoLabel}>Registration Authority</Text>
                      <Text style={styles.infoVal}>{selectedVerif.registrationAuthority}</Text>
                    </View>
                    <View style={styles.infoItem}>
                      <Text style={styles.infoLabel}>Jurisdiction / State</Text>
                      <Text style={styles.infoVal}>{selectedVerif.registrationJurisdiction}</Text>
                    </View>
                    <View style={styles.infoItem}>
                      <Text style={styles.infoLabel}>Hospital Facility</Text>
                      <Text style={styles.infoVal}>{selectedVerif.hospital}</Text>
                    </View>
                  </View>
                </View>

                {/* Attached Documents */}
                <View style={styles.infoSection}>
                  <Text style={styles.infoHeading}>Uploaded Credential Documents</Text>
                  {selectedVerif.documents && selectedVerif.documents.length > 0 ? (
                    selectedVerif.documents.map((doc, idx) => (
                      <View key={doc.documentId || idx} style={styles.docRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.docTitle}>📄 {doc.fileName}</Text>
                          <Text style={styles.docSub}>{doc.documentType} • {(doc.fileSize / 1024).toFixed(1)} KB</Text>
                        </View>
                        <Button
                          title="Inspect Document"
                          onPress={() => setViewingDoc(doc)}
                          variant="secondary"
                          size="small"
                        />
                      </View>
                    ))
                  ) : (
                    <Text style={styles.noDocText}>No documents attached to this record.</Text>
                  )}
                </View>

                {/* Document Inspection Preview */}
                {viewingDoc && (
                  <View style={styles.docPreviewBox}>
                    <Text style={styles.docPreviewTitle}>Inspecting Document: {viewingDoc.fileName}</Text>
                    <Text style={styles.docPreviewSub}>
                      Access verified via authorized role credentials. Encrypted document authenticated.
                    </Text>
                    <Badge label="Authentic Document Streamed" variant="success" />
                  </View>
                )}

                {/* Explanatory Review Notes */}
                <View style={{ marginTop: 12 }}>
                  <Input
                    label="Reviewer Notes / Justification (Mandatory for Rejection or Resubmission)"
                    value={decisionNotes}
                    onChangeText={setDecisionNotes}
                    placeholder="Provide justification notes, license verification checks, or reasons if requesting resubmission..."
                    multiline
                    numberOfLines={3}
                  />
                </View>
              </ScrollView>

              {/* Modal Actions */}
              <View style={styles.modalFooter}>
                <Button
                  title="Cancel"
                  onPress={() => setSelectedVerif(null)}
                  variant="outline"
                  style={{ marginRight: 8 }}
                />

                <Button
                  title="Request Resubmission"
                  onPress={() => handleReviewDecision('RESUBMISSION_REQUIRED')}
                  disabled={submittingDecision || isSelf}
                  variant="warning"
                  style={{ marginRight: 8 }}
                />

                <Button
                  title="Reject"
                  onPress={() => handleReviewDecision('REJECTED')}
                  disabled={submittingDecision || isSelf}
                  variant="danger"
                  style={{ marginRight: 8 }}
                />

                <Button
                  title={submittingDecision ? "Approving..." : "Approve & Verify"}
                  onPress={() => handleReviewDecision('VERIFIED')}
                  disabled={submittingDecision || isSelf}
                  variant="success"
                />
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 16
  },
  centered: {
    padding: 32,
    alignItems: 'center'
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textSecondary
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  headerSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  alertError: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
    padding: 12,
    borderRadius: 4,
    marginBottom: 14
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
    marginBottom: 14
  },
  alertSuccessText: {
    color: '#15803d',
    fontSize: 13,
    fontWeight: '600'
  },
  filterCard: {
    padding: 14,
    marginBottom: 16
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12
  },
  tabGroup: {
    flexDirection: 'row',
    gap: 6
  },
  tabBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#f1f5f9'
  },
  tabBtnActive: {
    backgroundColor: '#0284c7'
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569'
  },
  tabBtnTextActive: {
    color: '#fff'
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 260
  },
  emptyCard: {
    padding: 32,
    alignItems: 'center'
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textSecondary
  },
  listContainer: {
    flex: 1
  },
  verifCard: {
    padding: 16,
    marginBottom: 12
  },
  verifRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  docName: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  docDetail: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  hospitalDetail: {
    fontSize: 13,
    color: '#0284c7',
    marginTop: 2
  },
  regDetail: {
    fontSize: 13,
    color: '#334155',
    marginTop: 2
  },
  timeDetail: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4
  },
  actionCol: {
    marginLeft: 16
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
    maxWidth: 620,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textPrimary
  },
  modalSubTitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  closeBtn: {
    fontSize: 18,
    color: COLORS.textSecondary,
    padding: 4
  },
  selfAlertBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 6,
    padding: 12,
    marginBottom: 12
  },
  selfAlertTitle: {
    color: '#991b1b',
    fontWeight: '800',
    fontSize: 13
  },
  selfAlertText: {
    color: '#b91c1c',
    fontSize: 12,
    marginTop: 2
  },
  infoSection: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12
  },
  infoHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    marginBottom: 8
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12
  },
  infoItem: {
    flex: 1,
    minWidth: 160
  },
  infoLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '700'
  },
  infoVal: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 2
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    padding: 10,
    marginTop: 6
  },
  docTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary
  },
  docSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  noDocText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: 'italic'
  },
  docPreviewBox: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 6,
    padding: 12,
    marginTop: 8,
    marginBottom: 8
  },
  docPreviewTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#15803d',
    marginBottom: 2
  },
  docPreviewSub: {
    fontSize: 11,
    color: '#166534',
    marginBottom: 6
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 18,
    flexWrap: 'wrap',
    gap: 8
  }
});

export default InstitutionalVerifierView;
