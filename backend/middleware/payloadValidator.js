const { FIELD_LIMITS, ARRAY_LIMITS, ENUMS } = require('../config/constants');

function countWords(str) {
  if (!str || typeof str !== 'string') return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

function formatValidationError(field, message) {
  return {
    success: false,
    error: {
      code: "PAYLOAD_VALIDATION_ERROR",
      field,
      message
    }
  };
}

function validateTransferPayload(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json(formatValidationError('body', 'Invalid JSON payload.'));
  }

  // Reject unexpected top-level keys if any unauthorized fields are passed
  const allowedKeys = [
    'pid', 'nam', 'age', 'gender', 'bg',
    'fh', 'th', 'pd', 'rt', 'alg', 'med', 'vit', 'pi', 'sum',
    'otherDetails', 'priority', 'referringDoctor', 'receivingDepartment',
    'transferDateTime', 'dob', 'contactNumber', 'emergencyContact', 'address',
    'secondaryDiagnosis', 'currentCondition', 'noKnownAllergies'
  ];

  for (const key of Object.keys(body)) {
    if (!allowedKeys.includes(key)) {
      return res.status(400).json(formatValidationError(key, `Unexpected field '${key}' in transfer payload.`));
    }
  }

  // Required core identity fields check
  if (body.nam && typeof body.nam === 'string' && body.nam.length > FIELD_LIMITS.PATIENT_NAME) {
    return res.status(400).json(formatValidationError('nam', `Patient name exceeds maximum length of ${FIELD_LIMITS.PATIENT_NAME} characters.`));
  }

  if (body.pid && typeof body.pid === 'string' && body.pid.length > FIELD_LIMITS.PATIENT_ID) {
    return res.status(400).json(formatValidationError('pid', `Patient ID exceeds maximum length of ${FIELD_LIMITS.PATIENT_ID} characters.`));
  }

  if (body.pd && typeof body.pd === 'string' && body.pd.length > FIELD_LIMITS.DIAGNOSIS) {
    return res.status(400).json(formatValidationError('pd', `Primary diagnosis exceeds maximum length of ${FIELD_LIMITS.DIAGNOSIS} characters.`));
  }

  if (body.rt && typeof body.rt === 'string' && body.rt.length > FIELD_LIMITS.REASON_FOR_TRANSFER) {
    return res.status(400).json(formatValidationError('rt', `Reason for transfer exceeds maximum length of ${FIELD_LIMITS.REASON_FOR_TRANSFER} characters.`));
  }

  // Age validation: Non-negative integer between 0 and 130
  if (body.age !== undefined && body.age !== null) {
    const ageNum = Number(body.age);
    if (isNaN(ageNum) || !Number.isInteger(ageNum) || ageNum < 0 || ageNum > 130) {
      return res.status(400).json(formatValidationError('age', 'Age must be a valid non-negative integer between 0 and 130.'));
    }
  }

  // Blood Group validation: Controlled vocabulary
  if (body.bg && typeof body.bg === 'string') {
    const validBloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    if (!validBloodGroups.includes(body.bg.trim().toUpperCase())) {
      return res.status(400).json(formatValidationError('bg', `Invalid blood group '${body.bg}'. Allowed values: ${validBloodGroups.join(', ')}.`));
    }
  }

  // Vitals Numeric Sanity Bounds
  if (body.vit && typeof body.vit === 'object') {
    const v = body.vit;
    if (v.hr !== null && v.hr !== undefined) {
      const hr = Number(v.hr);
      if (isNaN(hr) || hr < 20 || hr > 300) {
        return res.status(400).json(formatValidationError('vit.hr', 'Heart rate must be between 20 and 300 BPM.'));
      }
    }
    if (v.rr !== null && v.rr !== undefined) {
      const rr = Number(v.rr);
      if (isNaN(rr) || rr < 4 || rr > 80) {
        return res.status(400).json(formatValidationError('vit.rr', 'Respiratory rate must be between 4 and 80 breaths/min.'));
      }
    }
    if (v.spo2 !== null && v.spo2 !== undefined) {
      const spo2 = Number(v.spo2);
      if (isNaN(spo2) || spo2 < 30 || spo2 > 100) {
        return res.status(400).json(formatValidationError('vit.spo2', 'SpO2 must be between 30% and 100%.'));
      }
    }
    if (v.temp !== null && v.temp !== undefined) {
      const temp = Number(v.temp);
      const isCelsius = temp >= 25 && temp <= 45;
      const isFahrenheit = temp >= 77 && temp <= 113;
      if (isNaN(temp) || (!isCelsius && !isFahrenheit)) {
        return res.status(400).json(formatValidationError('vit.temp', 'Temperature must be between 25°C and 45°C (or 77°F and 113°F).'));
      }
    }
    if (v.gcs !== null && v.gcs !== undefined) {
      const gcs = Number(v.gcs);
      if (isNaN(gcs) || !Number.isInteger(gcs) || gcs < 3 || gcs > 15) {
        return res.status(400).json(formatValidationError('vit.gcs', 'Glasgow Coma Scale (GCS) must be an integer between 3 and 15.'));
      }
    }
    if (v.glucose !== null && v.glucose !== undefined) {
      const glucose = Number(v.glucose);
      if (isNaN(glucose) || glucose < 10 || glucose > 1500) {
        return res.status(400).json(formatValidationError('vit.glucose', 'Blood glucose must be between 10 and 1500 mg/dL.'));
      }
    }
  }

  // Clinical Summary Word Count Validation (Max 200 words)
  if (body.sum && typeof body.sum === 'string') {
    const wordCount = countWords(body.sum);
    if (wordCount > FIELD_LIMITS.CLINICAL_SUMMARY_MAX_WORDS) {
      return res.status(400).json(formatValidationError('sum', `Clinical summary exceeds maximum word limit of ${FIELD_LIMITS.CLINICAL_SUMMARY_MAX_WORDS} words (found ${wordCount} words).`));
    }
  }

  // Allergies Validation
  if (body.alg) {
    if (!Array.isArray(body.alg)) {
      return res.status(400).json(formatValidationError('alg', 'Allergies must be an array.'));
    }
    if (body.alg.length > ARRAY_LIMITS.ALLERGIES) {
      return res.status(400).json(formatValidationError('alg', `Allergies array exceeds maximum allowed count of ${ARRAY_LIMITS.ALLERGIES}.`));
    }
    for (let i = 0; i < body.alg.length; i++) {
      const item = body.alg[i];
      if (typeof item === 'string' && item.length > FIELD_LIMITS.ALLERGY_ITEM) {
        return res.status(400).json(formatValidationError(`alg[${i}]`, `Allergy item exceeds maximum length of ${FIELD_LIMITS.ALLERGY_ITEM} characters.`));
      }
    }
    // Rule: Prevent contradictory states: "No Known Allergies" AND specific allergies
    const hasNKDA = body.alg.some(a => typeof a === 'string' && a.trim().toLowerCase() === 'no known allergies');
    if (hasNKDA && body.alg.length > 1) {
      return res.status(400).json(formatValidationError('alg', 'Cannot specify both "No Known Allergies" and specific allergies.'));
    }
  }

  // Medications Validation
  if (body.med) {
    if (!Array.isArray(body.med)) {
      return res.status(400).json(formatValidationError('med', 'Medications must be an array.'));
    }
    if (body.med.length > ARRAY_LIMITS.MEDICATIONS) {
      return res.status(400).json(formatValidationError('med', `Medications array exceeds maximum allowed count of ${ARRAY_LIMITS.MEDICATIONS}.`));
    }
    for (let i = 0; i < body.med.length; i++) {
      const m = body.med[i];
      if (m && typeof m === 'object') {
        const drugName = m.n || m.drugName || '';
        if (typeof drugName === 'string' && drugName.length > FIELD_LIMITS.DRUG_NAME) {
          return res.status(400).json(formatValidationError(`med[${i}].n`, `Drug name exceeds maximum length of ${FIELD_LIMITS.DRUG_NAME} characters.`));
        }
        const notes = m.notes || m.importantNotes || '';
        if (typeof notes === 'string' && notes.length > FIELD_LIMITS.MEDICATION_NOTES) {
          return res.status(400).json(formatValidationError(`med[${i}].notes`, `Medication notes exceed maximum length of ${FIELD_LIMITS.MEDICATION_NOTES} characters.`));
        }
      }
    }
  }

  // Investigations Validation
  if (body.pi) {
    if (!Array.isArray(body.pi)) {
      return res.status(400).json(formatValidationError('pi', 'Investigations must be an array.'));
    }
    if (body.pi.length > ARRAY_LIMITS.INVESTIGATIONS) {
      return res.status(400).json(formatValidationError('pi', `Investigations array exceeds maximum allowed count of ${ARRAY_LIMITS.INVESTIGATIONS}.`));
    }
    for (let i = 0; i < body.pi.length; i++) {
      const item = body.pi[i];
      const text = typeof item === 'string' ? item : (item.name || item.title || JSON.stringify(item));
      if (text.length > FIELD_LIMITS.INVESTIGATION_ITEM) {
        return res.status(400).json(formatValidationError(`pi[${i}]`, `Investigation item exceeds maximum length of ${FIELD_LIMITS.INVESTIGATION_ITEM} characters.`));
      }
    }
  }

  // Other Details Validation (Mandatory requirements from section 6 & 8 & payload protection)
  if (body.otherDetails) {
    if (!Array.isArray(body.otherDetails)) {
      return res.status(400).json(formatValidationError('otherDetails', 'Other details must be an array.'));
    }
    if (body.otherDetails.length > ARRAY_LIMITS.OTHER_DETAILS) {
      return res.status(400).json(formatValidationError('otherDetails', `Other details array exceeds maximum allowed count of ${ARRAY_LIMITS.OTHER_DETAILS}.`));
    }
    for (let i = 0; i < body.otherDetails.length; i++) {
      const item = body.otherDetails[i];
      if (!item || typeof item !== 'object') {
        return res.status(400).json(formatValidationError(`otherDetails[${i}]`, 'Other detail item must be an object.'));
      }
      if (!item.title || typeof item.title !== 'string' || !item.title.trim()) {
        return res.status(400).json(formatValidationError(`otherDetails[${i}].title`, 'Other detail title is required.'));
      }
      if (item.title.length > FIELD_LIMITS.OTHER_DETAIL_TITLE) {
        return res.status(400).json(formatValidationError(`otherDetails[${i}].title`, `Other detail title exceeds maximum allowed length of ${FIELD_LIMITS.OTHER_DETAIL_TITLE} characters.`));
      }
      if (!item.value || typeof item.value !== 'string' || !item.value.trim()) {
        return res.status(400).json(formatValidationError(`otherDetails[${i}].value`, 'Other detail value is required.'));
      }
      if (item.value.length > FIELD_LIMITS.OTHER_DETAIL_VALUE) {
        return res.status(400).json(formatValidationError(`otherDetails[${i}].value`, `Other detail value exceeds maximum allowed length of ${FIELD_LIMITS.OTHER_DETAIL_VALUE} characters.`));
      }
      if (item.category && !ENUMS.OTHER_DETAIL_CATEGORIES.includes(item.category)) {
        return res.status(400).json(formatValidationError(`otherDetails[${i}].category`, `Invalid category '${item.category}'. Allowed categories: ${ENUMS.OTHER_DETAIL_CATEGORIES.join(', ')}.`));
      }
      if (item.priority && !ENUMS.OTHER_DETAIL_PRIORITIES.includes(item.priority)) {
        return res.status(400).json(formatValidationError(`otherDetails[${i}].priority`, `Invalid priority '${item.priority}'. Allowed priorities: ${ENUMS.OTHER_DETAIL_PRIORITIES.join(', ')}.`));
      }
    }
  }

  next();
}

module.exports = {
  validateTransferPayload,
  formatValidationError,
  countWords
};
