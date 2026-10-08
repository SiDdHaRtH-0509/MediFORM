import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { PatientIdentitySection } from './PatientIdentitySection';
import { TransferInformationSection } from './TransferInformationSection';
import { ClinicalInformationSection } from './ClinicalInformationSection';
import { AllergySection } from './AllergySection';
import { MedicationSection } from './MedicationSection';
import { VitalsSection } from './VitalsSection';
import { InvestigationSection } from './InvestigationSection';
import { OtherDetailsSection } from './OtherDetailsSection';
import { ReviewAndSubmitSection } from './ReviewAndSubmitSection';
import { Button } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';

import { AlertCircle, ArrowRight, AlertTriangle } from 'lucide-react-native';

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
};

const INITIAL_FORM_DATA = {
  pid: '',
  nam: '',
  age: '',
  gender: 'Male',
  bg: 'O+',
  contactNumber: '',
  emergencyContact: '',
  fh: '',
  th: '',
  rt: '',
  priority: 'Emergency',
  referringDoctor: '',
  receivingDepartment: 'ICU',
  pd: '',
  secondaryDiagnosis: '',
  currentCondition: '',
  sum: '',
  alg: ['No Known Allergies'],
  noKnownAllergies: true,
  med: [],
  vit: { hr: null, bp: '', rr: null, spo2: null, temp: null, gcs: null, glucose: null },
  pi: [],
  otherDetails: []
};

const SECTIONS = [
  { key: 'sec_1', label: 'Patient' },
  { key: 'sec_2', label: 'Transfer' },
  { key: 'sec_3', label: 'Clinical' },
  { key: 'sec_4', label: 'Allergies' },
  { key: 'sec_5', label: 'Meds' },
  { key: 'sec_6', label: 'Vitals' },
  { key: 'sec_7', label: 'Labs' },
  { key: 'sec_8', label: 'Custom' },
  { key: 'sec_9', label: 'Review' }
];

export function TransferForm({ onTransferCreated, initialData }) {
  const { user } = useAuth();
  const scrollViewRef = useRef(null);
  const sectionYPositions = useRef({});
  const idempotencyKeyRef = useRef(generateUUID());

  const [formData, setFormData] = useState(initialData || INITIAL_FORM_DATA);
  const [validationErrors, setValidationErrors] = useState([]);
  const [apiErrorMsg, setApiErrorMsg] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeSectionKey, setActiveSectionKey] = useState('sec_1');
  const [showClearModal, setShowClearModal] = useState(false);

  React.useEffect(() => {
    const isDirty = Boolean(
      formData.nam?.trim() ||
      formData.pid?.trim() ||
      formData.age ||
      formData.pd?.trim() ||
      formData.rt?.trim()
    );

    const handleBeforeUnload = (e) => {
      if (isDirty && !isSubmitting) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes in your transfer form. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, [formData, isSubmitting]);

  const handleFieldChange = (field, val) => {
    setFormData(prev => ({ ...prev, [field]: val }));
    setValidationErrors([]);
    setApiErrorMsg(null);
  };

  const handleSectionLayout = (key, event) => {
    const layout = event.nativeEvent.layout;
    sectionYPositions.current[key] = layout.y;
  };

  const scrollToSection = (key) => {
    setActiveSectionKey(key);
    const targetY = sectionYPositions.current[key] || 0;
    scrollViewRef.current?.scrollTo({ y: Math.max(0, targetY - 70), animated: true });
  };

  const getSectionStatus = (key) => {
    if (key === 'sec_1') {
      const valid = formData.nam?.trim() && formData.pid?.trim() && Number(formData.age) > 0 && formData.bg?.trim();
      const hasErrors = validationErrors.some(e => e.sectionKey === 'sec_1');
      return hasErrors ? 'error' : (valid ? 'success' : 'pending');
    }
    if (key === 'sec_2') {
      const valid = formData.fh?.trim() && formData.th?.trim() && formData.rt?.trim();
      const hasErrors = validationErrors.some(e => e.sectionKey === 'sec_2');
      return hasErrors ? 'error' : (valid ? 'success' : 'pending');
    }
    if (key === 'sec_3') {
      const words = (formData.sum || '').trim().split(/\s+/).filter(Boolean).length;
      const valid = formData.pd?.trim() && words <= 200;
      const hasErrors = validationErrors.some(e => e.sectionKey === 'sec_3');
      return hasErrors ? 'error' : (valid ? 'success' : 'pending');
    }
    if (key === 'sec_4') {
      const algList = formData.alg || [];
      const isConflict = algList.includes('No Known Allergies') && algList.length > 1;
      return isConflict ? 'error' : 'success';
    }
    if (key === 'sec_8') {
      const hasErrors = validationErrors.some(e => e.sectionKey === 'sec_8');
      return hasErrors ? 'error' : 'pending';
    }
    return 'pending';
  };

  const validateAllFields = () => {
    const errors = [];

    // 1. Patient Identity Validation
    if (!formData.nam || !formData.nam.trim()) {
      errors.push({ id: 'nam', sectionKey: 'sec_1', message: 'Patient Information — Patient Name is required.' });
    }
    if (!formData.pid || !formData.pid.trim()) {
      errors.push({ id: 'pid', sectionKey: 'sec_1', message: 'Patient Information — UHID is required.' });
    }
    if (!formData.age || Number(formData.age) <= 0) {
      errors.push({ id: 'age', sectionKey: 'sec_1', message: 'Patient Information — Valid Age is required.' });
    }
    if (!formData.bg || !formData.bg.trim()) {
      errors.push({ id: 'bg', sectionKey: 'sec_1', message: 'Patient Information — Blood Group is required.' });
    }

    // 2. Transfer Information Validation
    if (!formData.fh || !formData.fh.trim()) {
      errors.push({ id: 'fh', sectionKey: 'sec_2', message: 'Transfer Information — From Hospital is required.' });
    }
    if (!formData.th || !formData.th.trim()) {
      errors.push({ id: 'th', sectionKey: 'sec_2', message: 'Transfer Information — To Hospital is required.' });
    }
    if (!formData.rt || !formData.rt.trim()) {
      errors.push({ id: 'rt', sectionKey: 'sec_2', message: 'Transfer Information — Reason for Transfer is required.' });
    }

    // 3. Clinical Information Validation
    if (!formData.pd || !formData.pd.trim()) {
      errors.push({ id: 'pd', sectionKey: 'sec_3', message: 'Clinical Information — Primary Diagnosis is required.' });
    }
    if (formData.sum) {
      const words = formData.sum.trim().split(/\s+/).filter(Boolean).length;
      if (words > 200) {
        errors.push({ id: 'sum', sectionKey: 'sec_3', message: `Clinical Information — Summary exceeds 200 words (${words} words entered).` });
      }
    }

    // 4. Allergy State Validation
    const algList = formData.alg || [];
    if (algList.includes('No Known Allergies') && algList.length > 1) {
      errors.push({ id: 'alg', sectionKey: 'sec_4', message: 'Allergies — Cannot combine "No Known Allergies" with specific allergies.' });
    }

    // 5. Other Details Validation
    if (formData.otherDetails && formData.otherDetails.length > 0) {
      formData.otherDetails.forEach((item, idx) => {
        if (!item.title || !item.title.trim()) {
          errors.push({ id: `od_title_${idx}`, sectionKey: 'sec_8', message: `Other Details — Detail #${idx + 1} Title is required.` });
        }
        if (!item.value || !item.value.trim()) {
          errors.push({ id: `od_val_${idx}`, sectionKey: 'sec_8', message: `Other Details — Detail #${idx + 1} Value is required.` });
        }
      });
    }

    return errors;
  };

  const handleSubmit = async () => {
    const errors = validateAllFields();
    if (errors.length > 0) {
      setValidationErrors(errors);
      const firstErrorSectionKey = errors[0].sectionKey;
      scrollToSection(firstErrorSectionKey);
      return;
    }

    setIsSubmitting(true);
    setValidationErrors([]);
    setApiErrorMsg(null);

    try {
      const payload = {
        ...formData,
        age: Number(formData.age)
      };

      // Pass client-generated Idempotency-Key header for duplicate creation prevention
      const response = await api.createTransfer(payload, { 'Idempotency-Key': idempotencyKeyRef.current });
      
      // Reset key after successful creation
      idempotencyKeyRef.current = generateUUID();

      if (onTransferCreated) {
        onTransferCreated(response.transfer);
      }
    } catch (err) {
      setApiErrorMsg(err.message || 'Failed to create transfer record. Please try again.');
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmClearForm = () => {
    setFormData(INITIAL_FORM_DATA);
    setValidationErrors([]);
    setApiErrorMsg(null);
    setShowClearModal(false);
    idempotencyKeyRef.current = generateUUID();
    scrollToSection('sec_1');
  };

  const doctorName = user?.name || user?.username || 'Clinician';
  const hospitalName = user?.hospitalName || formData.fh || 'Hospital Facility';

  return (
    <View style={styles.outerContainer}>
      {/* Top Header & Quick Section Navigation Anchor Bar */}
      <View style={styles.stickyHeaderContainer}>
        <View style={styles.headerBar}>
          <View>
            <Text style={styles.headerTitle}>Create Medical Transfer</Text>
            <Text style={styles.headerSub}>Complete the patient's transfer record below on one single screen.</Text>
          </View>
          <View style={styles.headerRightActions}>
            <View style={styles.doctorBadge}>
              <Text style={styles.doctorBadgeText}>
                Doctor: <Text style={styles.bold}>{doctorName}</Text> | Facility: <Text style={styles.bold}>{hospitalName}</Text>
              </Text>
            </View>
            <TouchableOpacity onPress={() => setShowClearModal(true)} style={styles.clearFormHeaderBtn}>
              <Text style={styles.clearFormHeaderBtnText}>Clear Form</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Compact Horizontal Quick Section Anchor Bar (Clean visual design without repetitive checkmark noise) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.navBarScroll}
          contentContainerStyle={styles.navBarContent}
        >
          {SECTIONS.map((sec, idx) => {
            const status = getSectionStatus(sec.key);
            const isActive = activeSectionKey === sec.key;
            return (
              <TouchableOpacity
                key={sec.key}
                onPress={() => scrollToSection(sec.key)}
                style={[
                  styles.navItem,
                  isActive && styles.navItemActive,
                  status === 'error' && styles.navItemError
                ]}
              >
                <Text style={[styles.navItemText, isActive && styles.navItemTextActive]}>
                  {idx + 1}. {sec.label}
                </Text>
                {status === 'error' && (
                  <View style={{ marginLeft: 4 }}>
                    <AlertCircle size={13} color={COLORS.critical} accessibilityLabel="Section error alert" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Single Page Scroll Area */}
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.scrollContainer}>
        {/* Interactive Clickable Validation Error Summary Banner */}
        {validationErrors.length > 0 && (
          <View style={styles.errorBanner}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <AlertTriangle size={16} color={COLORS.critical} style={{ marginRight: 6 }} />
              <Text style={styles.errorBannerTitle}>Please correct {validationErrors.length} issue(s) before submitting:</Text>
            </View>
            {validationErrors.map((err, idx) => (
              <TouchableOpacity
                key={idx}
                onPress={() => scrollToSection(err.sectionKey)}
                style={styles.errorItemRow}
                accessibilityRole="button"
                accessibilityLabel={`Go to section for ${err.message}`}
              >
                <Text style={styles.errorItemText}>• {err.message}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                  <Text style={styles.errorItemLink}>Go to field </Text>
                  <ArrowRight size={12} color={COLORS.primary} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* API Error Banner */}
        {apiErrorMsg && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerTitle}>Transfer Submission Failed</Text>
            <Text style={styles.errorItemText}>{apiErrorMsg}</Text>
          </View>
        )}

        {/* Clear Form Confirmation Modal Box */}
        {showClearModal && (
          <View style={styles.clearConfirmBox}>
            <Text style={styles.clearConfirmTitle}>Clear Transfer Form?</Text>
            <Text style={styles.clearConfirmText}>All entered information will be removed from this transfer draft.</Text>
            <View style={styles.clearConfirmActions}>
              <TouchableOpacity onPress={() => setShowClearModal(false)} style={styles.clearCancelBtn}>
                <Text style={styles.clearCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmClearForm} style={styles.clearConfirmBtn}>
                <Text style={styles.clearConfirmBtnText}>Clear Form</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Vertical Section Renderers */}
        <View onLayout={(e) => handleSectionLayout('sec_1', e)} style={styles.sectionWrapper}>
          <PatientIdentitySection formData={formData} onChange={handleFieldChange} />
        </View>

        <View onLayout={(e) => handleSectionLayout('sec_2', e)} style={styles.sectionWrapper}>
          <TransferInformationSection formData={formData} onChange={handleFieldChange} />
        </View>

        <View onLayout={(e) => handleSectionLayout('sec_3', e)} style={styles.sectionWrapper}>
          <ClinicalInformationSection formData={formData} onChange={handleFieldChange} />
        </View>

        <View onLayout={(e) => handleSectionLayout('sec_4', e)} style={styles.sectionWrapper}>
          <AllergySection formData={formData} onChange={handleFieldChange} />
        </View>

        <View onLayout={(e) => handleSectionLayout('sec_5', e)} style={styles.sectionWrapper}>
          <MedicationSection formData={formData} onChange={handleFieldChange} />
        </View>

        <View onLayout={(e) => handleSectionLayout('sec_6', e)} style={styles.sectionWrapper}>
          <VitalsSection formData={formData} onChange={handleFieldChange} />
        </View>

        <View onLayout={(e) => handleSectionLayout('sec_7', e)} style={styles.sectionWrapper}>
          <InvestigationSection formData={formData} onChange={handleFieldChange} />
        </View>

        <View onLayout={(e) => handleSectionLayout('sec_8', e)} style={styles.sectionWrapper}>
          <OtherDetailsSection formData={formData} onChange={handleFieldChange} />
        </View>

        <View onLayout={(e) => handleSectionLayout('sec_9', e)} style={styles.sectionWrapper}>
          <ReviewAndSubmitSection
            formData={formData}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
          />
        </View>
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View style={styles.stickyBottomBar}>
        <Button
          title={isSubmitting ? "Submitting Transfer..." : "Submit Medical Transfer"}
          onPress={handleSubmit}
          disabled={isSubmitting}
          variant="primary"
          style={{ width: '100%', paddingVertical: 14 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  stickyHeaderContainer: {
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    zIndex: 10,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primary,
  },
  headerSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  doctorBadge: {
    backgroundColor: '#E0F2FE',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginRight: 8,
  },
  doctorBadgeText: {
    fontSize: 12,
    color: COLORS.primary,
  },
  clearFormHeaderBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    backgroundColor: '#FAFAFA',
  },
  clearFormHeaderBtnText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  bold: {
    fontWeight: '700',
  },
  navBarScroll: {
    marginTop: 4,
  },
  navBarContent: {
    paddingRight: 16,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#FAFAFA',
    marginRight: 6,
  },
  navItemActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  navItemError: {
    borderColor: COLORS.critical,
    backgroundColor: COLORS.criticalBg,
  },
  navItemText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  navItemTextActive: {
    color: '#FFF',
    fontWeight: '800',
  },
  errorBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.critical,
    marginLeft: 4,
  },
  scrollContainer: {
    padding: 16,
    maxWidth: 750,
    alignSelf: 'center',
    width: '100%',
    paddingBottom: 110,
  },
  errorBanner: {
    backgroundColor: COLORS.criticalBg,
    borderLeftWidth: 4,
    borderColor: COLORS.critical,
    padding: 14,
    borderRadius: 6,
    marginBottom: 16,
  },
  errorBannerTitle: {
    color: COLORS.critical,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  errorItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  errorItemText: {
    color: COLORS.critical,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  errorItemLink: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 8,
  },
  clearConfirmBox: {
    backgroundColor: '#FFF1F2',
    borderWidth: 1.5,
    borderColor: COLORS.critical,
    padding: 14,
    borderRadius: 8,
    marginBottom: 16,
  },
  clearConfirmTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.critical,
    marginBottom: 4,
  },
  clearConfirmText: {
    fontSize: 13,
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  clearConfirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  clearCancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
    backgroundColor: '#FFF',
  },
  clearCancelText: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  clearConfirmBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: COLORS.critical,
  },
  clearConfirmBtnText: {
    fontSize: 13,
    color: '#FFF',
    fontWeight: '800',
  },
  sectionWrapper: {
    marginBottom: 16,
  },
  stickyBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    maxWidth: 750,
    alignSelf: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  }
});



