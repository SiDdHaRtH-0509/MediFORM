/**
 * Multilingual Handoff Translation Dictionary & Utility
 * Translates clinical transfer labels and emergency cards into patient-preferred languages.
 */

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español (Spanish)' },
  { code: 'fr', label: 'Français (French)' },
  { code: 'de', label: 'Deutsch (German)' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'zh', label: '中文 (Mandarin)' },
];

const TRANSLATIONS = {
  en: {
    portalTitle: 'MediFORM Patient Portal',
    activeTransfer: 'MY CURRENT TRANSFER',
    fromFacility: 'From Facility',
    toFacility: 'To Facility',
    patientId: 'Patient ID / UHID',
    diagnosis: 'Primary Diagnosis',
    reasonForTransfer: 'Reason for Transfer',
    clinicalSummary: 'Clinical Summary',
    allergies: 'Known Allergies',
    medications: 'Active Medications',
    vitals: 'Physiological Vitals',
    heartRate: 'Heart Rate',
    bloodPressure: 'Blood Pressure',
    respRate: 'Resp Rate',
    spo2: 'SpO₂ Level',
    emergencyCard: 'Emergency Patient Card',
    downloadPdf: 'Download Record (PDF/JSON)',
    selectLanguage: 'Preferred Language'
  },
  es: {
    portalTitle: 'Portal del Paciente MediFORM',
    activeTransfer: 'MI TRANSFERENCIA ACTUAL',
    fromFacility: 'Hospital de Origen',
    toFacility: 'Hospital de Destino',
    patientId: 'ID del Paciente',
    diagnosis: 'Diagnóstico Principal',
    reasonForTransfer: 'Razón de Transferencia',
    clinicalSummary: 'Resumen Clínico',
    allergies: 'Alergias Conocidas',
    medications: 'Medicamentos Activos',
    vitals: 'Signos Vitales',
    heartRate: 'Ritmo Cardíaco',
    bloodPressure: 'Presión Arterial',
    respRate: 'Frecuencia Respiratoria',
    spo2: 'Saturación de Oxígeno',
    emergencyCard: 'Tarjeta de Emergencia del Paciente',
    downloadPdf: 'Descargar Registro (PDF/JSON)',
    selectLanguage: 'Idioma Preferido'
  },
  fr: {
    portalTitle: 'Portail Patient MediFORM',
    activeTransfer: 'MON TRANSFERT ACTIF',
    fromFacility: 'Établissement d\'Origine',
    toFacility: 'Établissement d\'Accueil',
    patientId: 'ID Patient',
    diagnosis: 'Diagnostic Principal',
    reasonForTransfer: 'Motif du Transfert',
    clinicalSummary: 'Résumé Clinique',
    allergies: 'Allergies Connues',
    medications: 'Médicaments Actifs',
    vitals: 'Signes Vitaux',
    heartRate: 'Fréquence Cardiaque',
    bloodPressure: 'Tension Artérielle',
    respRate: 'Fréquence Respiratoire',
    spo2: 'SpO₂ Niveau',
    emergencyCard: 'Carte d\'Urgence Patient',
    downloadPdf: 'Télécharger le Dossier (PDF/JSON)',
    selectLanguage: 'Langue Préférée'
  },
  de: {
    portalTitle: 'MediFORM Patientenportal',
    activeTransfer: 'MEIN AKTUELLER TRANSFER',
    fromFacility: 'Quellkrankenhaus',
    toFacility: 'Zielkrankenhaus',
    patientId: 'Patienten-ID',
    diagnosis: 'Hauptdiagnose',
    reasonForTransfer: 'Grund für Transfer',
    clinicalSummary: 'Klinische Zusammenfassung',
    allergies: 'Bekannte Allergien',
    medications: 'Aktive Medikamente',
    vitals: 'Vitalzeichen',
    heartRate: 'Herzfrequenz',
    bloodPressure: 'Blutdruck',
    respRate: 'Atemfrequenz',
    spo2: 'Sauerstoffsättigung',
    emergencyCard: 'Patienten-Notfallkarte',
    downloadPdf: 'Akte Herunterladen (PDF/JSON)',
    selectLanguage: 'Bevorzugte Sprache'
  },
  hi: {
    portalTitle: 'मेडीफॉर्म पेशेंट पोर्टल',
    activeTransfer: 'मेरा वर्तमान स्थानांतरण',
    fromFacility: 'भेजने वाला अस्पताल',
    toFacility: 'प्राप्तकर्ता अस्पताल',
    patientId: 'मरीज़ की आईडी',
    diagnosis: 'मुख्य निदान',
    reasonForTransfer: 'स्थानांतरण का कारण',
    clinicalSummary: 'चिकित्सा सारांश',
    allergies: 'ज्ञात एलर्जी',
    medications: 'सक्रिय दवाएं',
    vitals: 'शारीरिक वाइटल्स',
    heartRate: 'हृदय गति',
    bloodPressure: 'रक्तचाप',
    respRate: 'श्वसन दर',
    spo2: 'ऑक्सीजन स्तर',
    emergencyCard: 'आपातकालीन रोगी कार्ड',
    downloadPdf: 'रिकॉर्ड डाउनलोड करें (PDF/JSON)',
    selectLanguage: 'पसंदीदा भाषा'
  },
  zh: {
    portalTitle: 'MediFORM 患者门户',
    activeTransfer: '我当前的转院记录',
    fromFacility: '转出医院',
    toFacility: '接收医院',
    patientId: '患者编号',
    diagnosis: '主要诊断',
    reasonForTransfer: '转院原因',
    clinicalSummary: '临床摘要',
    allergies: '已知过敏史',
    medications: '正在使用的药物',
    vitals: '生命体征',
    heartRate: '心率',
    bloodPressure: '血压',
    respRate: '呼吸频率',
    spo2: '血氧饱和度',
    emergencyCard: '患者急救卡',
    downloadPdf: '下载医疗记录 (PDF/JSON)',
    selectLanguage: '首选语言'
  }
};

/**
 * Gets translation dictionary for specified language code.
 * @param {string} langCode 
 * @returns {Object} Translation dictionary
 */
export function getTranslations(langCode = 'en') {
  return TRANSLATIONS[langCode] || TRANSLATIONS.en;
}
