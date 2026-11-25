import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { PatientIdentitySection } from './PatientIdentitySection';
import { TransferInformationSection } from './TransferInformationSection';
import { EmsLocationContactSection } from './EmsLocationContactSection';
import { ClinicalInformationSection } from './ClinicalInformationSection';
import { AllergySection } from './AllergySection';
import { MedicationSection } from './MedicationSection';
import { VitalsSection } from './VitalsSection';
import { InvestigationSection } from './InvestigationSection';
import { OtherDetailsSection } from './OtherDetailsSection';
import { ReviewAndSubmitSection } from './ReviewAndSubmitSection';
import { Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { storage } from '../../utils/storage';
import { AlertCircle, ArrowRight, AlertTriangle, FileText, Zap, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react-native';

const DRAFT_STORAGE_KEY = 'mediform_transfer_draft_v2';

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
};

const getInitialFormData = (user) => ({
  pid: '',
  nam: '',
  age: '',
  gender: 'Male',
  bg: 'O+',
  contactNumber: '',
  emergencyContact: '',
  fh: user?.hospitalName || '',
  th: '',
  rt: '',
  priority: 'Emergency',
  referringDoctor: user?.name || user?.username || '',
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
  otherDetails: [],
  emsDispatch: {
    ambulanceId: '',
    ambulanceCrewName: '',
    ambulancePhone: '',
    referringHospitalPhone: user?.phone || '',
    receivingHospitalPhone: '',
    dispatchStatus: 'DISPATCHED',
    currentLocation: { lat: null, lng: null, address: '', landmark: '', speedKmh: 0 },
    etaMinutes: null
  }
});

const CLINICAL_TEMPLATES = [
  {
    id: 'stemi',
    label: '❤️ STEMI / Cardiac',
    patch: {
      priority: 'Emergency',
      receivingDepartment: 'Cardiology CCU',
      pd: 'Acute ST-Elevation Myocardial Infarction (STEMI)',
      rt: 'Urgent Primary PCI / Cath Lab Intervention',
      currentCondition: 'Hemodynamically monitored, on O2 & antiplatelets',
      sum: 'Acute onset retrosternal chest pain with diaphoresis. 12-lead ECG confirms ST elevation. Loading antiplatelet and anticoagulation initiated; urgent Cath Lab transfer requested.',
      med: [
        { n: 'Aspirin', d: '300 mg', r: 'PO', frequency: 'STAT', notes: 'Loading dose given' },
        { n: 'Heparin', d: '5000 IU', r: 'IV', frequency: 'STAT', notes: 'Critical anticoagulation' }
      ],
      pi: ['ECG 12-Lead [Abnormal]: ST elevation', 'Troponin-I [Pending]']
    }
  },
  {
    id: 'trauma',
    label: '🚑 Polytrauma / MVA',
    patch: {
      priority: 'Emergency',
      receivingDepartment: 'Emergency / Trauma',
      pd: 'Polytrauma Secondary to Road Traffic Accident',
      rt: 'Level-1 Trauma Center surgical & neuro-critical evaluation',
      currentCondition: 'C-spine immobilized, two 18G IV lines patent',
      sum: 'High-velocity road traffic accident. Primary survey completed (ATLS). Airway maintained, C-spine collar applied, fluid resuscitation ongoing. Requires urgent CT trauma series & surgical review.',
      med: [
        { n: 'Normal Saline 0.9%', d: '1000 ml', r: 'IV', frequency: 'Infusion', notes: 'Trauma bolus running' },
        { n: 'Tranexamic Acid', d: '1 g', r: 'IV', frequency: 'STAT', notes: 'Critical hemorrhage control' }
      ],
      pi: ['FAST Ultrasound [Completed]', 'CT Brain [Pending]']
    }
  },
  {
    id: 'stroke',
    label: '🧠 Acute Stroke',
    patch: {
      priority: 'Emergency',
      receivingDepartment: 'Neuro ICU',
      pd: 'Acute Cerebrovascular Accident (Suspected Ischemic Stroke)',
      rt: 'Urgent Neurology / Thrombolysis / Mechanical Thrombectomy window',
      currentCondition: 'Acute focal neurological deficit, airway protected',
      sum: 'Sudden onset hemiparesis and slurred speech within thrombolysis window. Airway patent, BP monitored closely. Urgent NCCT Brain & Stroke Team activation requested.',
      pi: ['CT Brain [Pending]: Rule out hemorrhage', 'Blood Glucose [Completed]']
    }
  },
  {
    id: 'sepsis',
    label: '🦠 Sepsis / ICU',
    patch: {
      priority: 'Urgent',
      receivingDepartment: 'ICU',
      pd: 'Severe Sepsis with Hemodynamic Instability',
      rt: 'Tertiary ICU care, vasopressor titration & multi-organ support',
      currentCondition: 'Unstable / On Inotropes',
      sum: 'Febrile with tachycardia, hypotension and elevated lactate. Broad-spectrum IV antibiotics and crystalloid resuscitation started. Requires ICU bed and invasive monitoring.',
      med: [
        { n: 'Ceftriaxone', d: '2 g', r: 'IV', frequency: 'STAT', notes: 'Empirical antibiotic' },
        { n: 'Noradrenaline', d: '4 mg', r: 'IV', frequency: 'Infusion', notes: 'Critical vasopressor titration' }
      ],
      pi: ['ABG [Abnormal]: Elevated lactate', 'CBC [Pending]']
    }
  }
];

const SECTIONS = [
  { key: 'sec_1', short: '01. Patient' },
  { key: 'sec_2', short: '02. Routing' },
  { key: 'sec_3', short: '03. GPS & EMS' },
  { key: 'sec_4', short: '04. Diagnosis' },
  { key: 'sec_5', short: '05. Allergies' },
  { key: 'sec_6', short: '06. Meds' },
  { key: 'sec_7', short: '07. Vitals' },
  { key: 'sec_8', short: '08. Labs' },
  { key: 'sec_9', short: '09. Orders' },
  { key: 'sec_10', short: '10. Sign & QR' }
];

export function TransferForm({ onTransferCreated, initialData }) {
  const { user } = useAuth();
  const scrollViewRef = useRef(null);
  const sectionYPositions = useRef({});
  const idempotencyKeyRef = useRef(generateUUID());

  const [formData, setFormData] = useState(() => {
    if (initialData) return initialData;
    const saved = storage.getItem(DRAFT_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...getInitialFormData(user), ...parsed };
      } catch (e) {
        // Ignore corrupted draft
      }
    }
    return getInitialFormData(user);
  });

  const [viewMode, setViewMode] = useState('folio'); // 'folio' (all separated blocks) | 'guided' (1 step at a time)
  const [guidedIndex, setGuidedIndex] = useState(0);
  const [validationErrors, setValidationErrors] = useState([]);
  const [apiErrorMsg, setApiErrorMsg] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeSectionKey, setActiveSectionKey] = useState('sec_1');
  const [showClearModal, setShowClearModal] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null);

  // Auto-populate clinician defaults if empty
  useEffect(() => {
    if (!user) return;
    setFormData(prev => ({
      ...prev,
      fh: prev.fh || user.hospitalName || '',
      referringDoctor: prev.referringDoctor || user.name || user.username || '',
      emsDispatch: {
        ...(prev.emsDispatch || {}),
        referringHospitalPhone: prev.emsDispatch?.referringHospitalPhone || user.phone || ''
      }
    }));
  }, [user]);

  // Auto-save draft locally so clinician never loses data mid-emergency
  useEffect(() => {
    const timer = setTimeout(() => {
      storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(formData));
      setDraftSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 400);
    return () => clearTimeout(timer);
  }, [formData]);

  const handleFieldChange = (field, val) => {
    setFormData(prev => ({ ...prev, [field]: val }));
    setValidationErrors([]);
    setApiErrorMsg(null);
  };

  const applyClinicalTemplate = (tpl) => {
    setFormData(prev => ({
      ...prev,
      ...tpl.patch,
      med: tpl.patch.med ? tpl.patch.med : prev.med,
      pi: tpl.patch.pi ? tpl.patch.pi : prev.pi
    }));
    setValidationErrors([]);
  };

  const handleSectionLayout = (key, event) => {
    sectionYPositions.current[key] = event.nativeEvent.layout.y;
  };

  const scrollToSection = (key) => {
    setActiveSectionKey(key);
    const idx = SECTIONS.findIndex(s => s.key === key);
    if (viewMode === 'guided' && idx >= 0) {
      setGuidedIndex(idx);
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    const targetY = sectionYPositions.current[key] || 0;
    scrollViewRef.current?.scrollTo({ y: Math.max(0, targetY - 12), animated: true });
  };

  const getSectionStatus = (key) => {
    if (validationErrors.some(e => e.sectionKey === key)) return 'error';
    if (key === 'sec_1') return (formData.nam?.trim() && formData.pid?.trim() && Number(formData.age) > 0 && formData.bg?.trim()) ? 'success' : 'pending';
    if (key === 'sec_2') return (formData.fh?.trim() && formData.th?.trim() && formData.rt?.trim()) ? 'success' : 'pending';
    if (key === 'sec_3') return (formData.emsDispatch?.ambulancePhone || formData.emsDispatch?.currentLocation?.lat != null || formData.emsDispatch?.currentLocation?.address) ? 'success' : 'pending';
    if (key === 'sec_4') {
      const words = (formData.sum || '').trim().split(/\s+/).filter(Boolean).length;
      return (formData.pd?.trim() && words <= 200) ? 'success' : 'pending';
    }
    if (key === 'sec_5') return ((formData.alg || []).length > 0) ? 'success' : 'pending';
    if (key === 'sec_6') return ((formData.med || []).length > 0) ? 'success' : 'pending';
    if (key === 'sec_7') return (formData.vit?.hr || formData.vit?.bp || formData.vit?.spo2) ? 'success' : 'pending';
    if (key === 'sec_8') return ((formData.pi || []).length > 0) ? 'success' : 'pending';
    if (key === 'sec_9') return ((formData.otherDetails || []).length > 0) ? 'success' : 'pending';
    return 'pending';
  };

  const completedCount = SECTIONS.filter(s => s.key !== 'sec_10' && getSectionStatus(s.key) === 'success').length;

  const validateAllFields = () => {
    const errors = [];
    if (!formData.nam || !formData.nam.trim()) errors.push({ id: 'nam', sectionKey: 'sec_1', message: 'Section 01 — Patient Name is required.' });
    if (!formData.pid || !formData.pid.trim()) errors.push({ id: 'pid', sectionKey: 'sec_1', message: 'Section 01 — Patient ID / UHID is required.' });
    if (!formData.age || Number(formData.age) <= 0) errors.push({ id: 'age', sectionKey: 'sec_1', message: 'Section 01 — Valid Age is required.' });
    if (!formData.bg || !formData.bg.trim()) errors.push({ id: 'bg', sectionKey: 'sec_1', message: 'Section 01 — Blood Group is required.' });

    if (!formData.fh || !formData.fh.trim()) errors.push({ id: 'fh', sectionKey: 'sec_2', message: 'Section 02 — From Hospital is required.' });
    if (!formData.th || !formData.th.trim()) errors.push({ id: 'th', sectionKey: 'sec_2', message: 'Section 02 — To Hospital is required.' });
    if (!formData.rt || !formData.rt.trim()) errors.push({ id: 'rt', sectionKey: 'sec_2', message: 'Section 02 — Reason for Transfer is required.' });

    if (!formData.pd || !formData.pd.trim()) errors.push({ id: 'pd', sectionKey: 'sec_4', message: 'Section 04 — Primary Diagnosis is required.' });
    if (formData.sum) {
      const words = formData.sum.trim().split(/\s+/).filter(Boolean).length;
      if (words > 200) {
        errors.push({ id: 'sum', sectionKey: 'sec_4', message: `Section 04 — Clinical Summary exceeds 200 words (${words} words entered).` });
      }
    }

    const algList = formData.alg || [];
    if (algList.includes('No Known Allergies') && algList.length > 1) {
      errors.push({ id: 'alg', sectionKey: 'sec_5', message: 'Section 05 — Cannot combine "No Known Allergies" with specific allergies.' });
    }

    if (formData.otherDetails && formData.otherDetails.length > 0) {
      formData.otherDetails.forEach((item, idx) => {
        if (!item.title || !item.title.trim()) errors.push({ id: `od_title_${idx}`, sectionKey: 'sec_9', message: `Section 09 — Instruction #${idx + 1} Title is required.` });
        if (!item.value || !item.value.trim()) errors.push({ id: `od_val_${idx}`, sectionKey: 'sec_9', message: `Section 09 — Instruction #${idx + 1} Value is required.` });
      });
    }

    return errors;
  };

  const handleSubmit = async () => {
    const errors = validateAllFields();
    if (errors.length > 0) {
      setValidationErrors(errors);
      scrollToSection(errors[0].sectionKey);
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

      const response = await api.createTransfer(payload, { 'Idempotency-Key': idempotencyKeyRef.current });
      idempotencyKeyRef.current = generateUUID();
      storage.removeItem(DRAFT_STORAGE_KEY);

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
    const fresh = getInitialFormData(user);
    setFormData(fresh);
    storage.removeItem(DRAFT_STORAGE_KEY);
    setValidationErrors([]);
    setApiErrorMsg(null);
    setShowClearModal(false);
    setGuidedIndex(0);
    idempotencyKeyRef.current = generateUUID();
    scrollToSection('sec_1');
  };

  const doctorName = user?.name || user?.username || 'Clinician';
  const hospitalName = user?.hospitalName || formData.fh || 'Hospital Facility';

  const renderSectionByIndex = (idx) => {
    switch (idx) {
      case 0: return <PatientIdentitySection formData={formData} onChange={handleFieldChange} />;
      case 1: return <TransferInformationSection formData={formData} onChange={handleFieldChange} />;
      case 2: return <EmsLocationContactSection formData={formData} onChange={handleFieldChange} />;
      case 3: return <ClinicalInformationSection formData={formData} onChange={handleFieldChange} />;
      case 4: return <AllergySection formData={formData} onChange={handleFieldChange} />;
      case 5: return <MedicationSection formData={formData} onChange={handleFieldChange} />;
      case 6: return <VitalsSection formData={formData} onChange={handleFieldChange} />;
      case 7: return <InvestigationSection formData={formData} onChange={handleFieldChange} />;
      case 8: return <OtherDetailsSection formData={formData} onChange={handleFieldChange} />;
      case 9: return <ReviewAndSubmitSection formData={formData} onSubmit={handleSubmit} isSubmitting={isSubmitting} />;
      default: return null;
    }
  };

  return (
    <View style={styles.outerContainer}>
      {/* OFFICIAL MEDICAL FOLIO STICKY HEADER */}
      <View style={styles.stickyHeaderContainer}>
        <View style={styles.folioMasthead}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <Text style={styles.folioCode}>FORM MF-108</Text>
              <Text style={styles.headerTitle}>PATIENT TRANSFER FOLIO</Text>
              <Badge label={`${completedCount}/9 READY`} variant={completedCount >= 4 ? 'success' : 'info'} />
            </View>
            <Text style={styles.headerSub}>
              Attending: <Text style={styles.bold}>{doctorName}</Text> | {hospitalName}
              {draftSavedAt ? `  •  Draft saved ${draftSavedAt}` : ''}
            </Text>
          </View>

          <View style={styles.headerRightActions}>
            <TouchableOpacity
              onPress={() => setViewMode(viewMode === 'folio' ? 'guided' : 'folio')}
              style={styles.modeToggleBtn}
            >
              <FileText size={13} color={COLORS.primary} style={{ marginRight: 4 }} />
              <Text style={styles.modeToggleText}>
                {viewMode === 'folio' ? 'Guided Steps' : 'Full Folio'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowClearModal(true)} style={styles.clearFormHeaderBtn}>
              <Text style={styles.clearFormHeaderBtnText}>Reset</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 1-Click Clinical Case Presets for Ultra-Fast ER Entry */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
              <Zap size={12} color={COLORS.warning} />
              <Text style={styles.presetLabel}> 1-Tap ER Presets:</Text>
            </View>
            {CLINICAL_TEMPLATES.map((tpl) => (
              <TouchableOpacity
                key={tpl.id}
                onPress={() => applyClinicalTemplate(tpl)}
                style={styles.presetChip}
              >
                <Text style={styles.presetChipText}>{tpl.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Section Stepper Navigation */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.navBarScroll}
          contentContainerStyle={styles.navBarContent}
        >
          {SECTIONS.map((sec, idx) => {
            const status = getSectionStatus(sec.key);
            const isActive = viewMode === 'guided' ? guidedIndex === idx : activeSectionKey === sec.key;
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
                {status === 'success' && !isActive && (
                  <CheckCircle2 size={12} color={COLORS.success} style={{ marginRight: 4 }} />
                )}
                <Text style={[styles.navItemText, isActive && styles.navItemTextActive]}>
                  {sec.short}
                </Text>
                {status === 'error' && (
                  <AlertCircle size={13} color={COLORS.critical} style={{ marginLeft: 4 }} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Folio Body */}
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.scrollContainer}>
        {validationErrors.length > 0 && (
          <View style={styles.errorBanner}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <AlertTriangle size={16} color={COLORS.critical} style={{ marginRight: 6 }} />
              <Text style={styles.errorBannerTitle}>Please correct {validationErrors.length} required item(s):</Text>
            </View>
            {validationErrors.map((err, idx) => (
              <TouchableOpacity
                key={idx}
                onPress={() => scrollToSection(err.sectionKey)}
                style={styles.errorItemRow}
              >
                <Text style={styles.errorItemText}>• {err.message}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                  <Text style={styles.errorItemLink}>Jump </Text>
                  <ArrowRight size={12} color={COLORS.primary} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {apiErrorMsg && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerTitle}>Transfer Submission Failed</Text>
            <Text style={styles.errorItemText}>{apiErrorMsg}</Text>
          </View>
        )}

        {showClearModal && (
          <View style={styles.clearConfirmBox}>
            <Text style={styles.clearConfirmTitle}>Reset Patient Transfer Folio?</Text>
            <Text style={styles.clearConfirmText}>All entered patient details in this draft will be cleared.</Text>
            <View style={styles.clearConfirmActions}>
              <TouchableOpacity onPress={() => setShowClearModal(false)} style={styles.clearCancelBtn}>
                <Text style={styles.clearCancelText}>Keep Draft</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmClearForm} style={styles.clearConfirmBtn}>
                <Text style={styles.clearConfirmBtnText}>Reset Folio</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {viewMode === 'guided' ? (
          <View>
            <View style={styles.guidedWrapper}>
              {renderSectionByIndex(guidedIndex)}
            </View>
            <View style={styles.guidedNavRow}>
              <Button
                title="← Previous Section"
                onPress={() => {
                  const prev = Math.max(0, guidedIndex - 1);
                  setGuidedIndex(prev);
                  setActiveSectionKey(SECTIONS[prev].key);
                }}
                disabled={guidedIndex === 0}
                variant="outline"
                style={{ flex: 1, marginRight: 8 }}
              />
              {guidedIndex < SECTIONS.length - 1 ? (
                <Button
                  title={`Next: ${SECTIONS[guidedIndex + 1].short} →`}
                  onPress={() => {
                    const next = Math.min(SECTIONS.length - 1, guidedIndex + 1);
                    setGuidedIndex(next);
                    setActiveSectionKey(SECTIONS[next].key);
                  }}
                  variant="primary"
                  style={{ flex: 1, marginLeft: 8 }}
                />
              ) : (
                <Button
                  title={isSubmitting ? 'Submitting...' : 'Submit & Generate QR'}
                  onPress={handleSubmit}
                  disabled={isSubmitting}
                  variant="secondary"
                  style={{ flex: 1, marginLeft: 8 }}
                />
              )}
            </View>
          </View>
        ) : (
          <View>
            {SECTIONS.map((sec, idx) => (
              <View key={sec.key} onLayout={(e) => handleSectionLayout(sec.key, e)} style={styles.sectionWrapper}>
                {renderSectionByIndex(idx)}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View style={styles.stickyBottomBar}>
        <View style={styles.bottomBarInner}>
          <View style={styles.bottomSummary}>
            <Text style={styles.bottomSummaryTitle} numberOfLines={1}>
              {formData.nam ? `${formData.nam} (${formData.pid || 'No UHID'})` : 'New Transfer Folio (MF-108)'}
            </Text>
            <Text style={styles.bottomSummarySub} numberOfLines={1}>
              {formData.fh || 'Origin'} ➔ {formData.th || 'Destination'} • {formData.priority}
            </Text>
          </View>
          <Button
            title={isSubmitting ? "Submitting..." : "Submit & Create QR"}
            onPress={handleSubmit}
            disabled={isSubmitting}
            variant="primary"
            style={{ paddingVertical: 11, paddingHorizontal: 18 }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#EEF2F6',
  },
  stickyHeaderContainer: {
    backgroundColor: '#FFF',
    borderBottomWidth: 1.5,
    borderBottomColor: '#CBD5E1',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    zIndex: 10,
  },
  folioMasthead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  folioCode: {
    backgroundColor: '#0F172A',
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    letterSpacing: 0.8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 0.4,
  },
  headerSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    backgroundColor: '#F0F9FF',
    marginRight: 6,
  },
  modeToggleText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  clearFormHeaderBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    backgroundColor: '#FAFAFA',
  },
  clearFormHeaderBtnText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  bold: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  presetLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textSecondary,
  },
  presetChip: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C2410C',
  },
  navBarScroll: {
    marginTop: 8,
  },
  navBarContent: {
    paddingRight: 16,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#F8FAFC',
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
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  navItemTextActive: {
    color: '#FFF',
    fontWeight: '800',
  },
  scrollContainer: {
    padding: 14,
    maxWidth: 820,
    alignSelf: 'center',
    width: '100%',
    paddingBottom: 115,
  },
  sectionWrapper: {
    marginBottom: 4,
  },
  guidedWrapper: {
    marginBottom: 8,
  },
  guidedNavRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  errorBanner: {
    backgroundColor: COLORS.criticalBg,
    borderLeftWidth: 4,
    borderColor: COLORS.critical,
    padding: 14,
    borderRadius: 8,
    marginBottom: 14,
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
    marginBottom: 14,
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
    fontWeight: '700',
  },
  stickyBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    borderTopWidth: 1.5,
    borderTopColor: '#CBD5E1',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bottomBarInner: {
    maxWidth: 820,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomSummary: {
    flex: 1,
    marginRight: 12,
  },
  bottomSummaryTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  bottomSummarySub: {
    fontSize: 11,
    color: COLORS.textSecondary,
  }
});
