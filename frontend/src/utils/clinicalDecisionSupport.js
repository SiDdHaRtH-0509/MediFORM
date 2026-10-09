/**
 * Clinical Decision Support (CDS) Utilities
 * Includes NEWS2 Calculation, Drug-Allergy Conflict Detection, and AI Handover Summarization.
 */

/**
 * Calculates the NEWS2 (National Early Warning Score) from vital signs.
 * @param {Object} vitals - Object containing vitals (hr, bp, rr, spo2, temp, gcs)
 * @returns {Object} { score: number, riskLevel: 'LOW'|'MEDIUM'|'HIGH', color: string, breakdown: Array }
 */
export function calculateNEWS2(vitals = {}) {
  let score = 0;
  let singleScore3 = false;
  const breakdown = [];

  // 1. Respiration Rate (rr)
  const rr = Number(vitals.rr);
  if (!isNaN(rr) && vitals.rr !== null && vitals.rr !== '') {
    let s = 0;
    if (rr <= 8) s = 3;
    else if (rr >= 9 && rr <= 11) s = 1;
    else if (rr >= 12 && rr <= 20) s = 0;
    else if (rr >= 21 && rr <= 24) s = 2;
    else if (rr >= 25) s = 3;

    score += s;
    if (s === 3) singleScore3 = true;
    breakdown.push({ metric: 'Resp Rate', value: `${rr}/min`, score: s });
  }

  // 2. SpO2 (%)
  const spo2 = Number(vitals.spo2);
  if (!isNaN(spo2) && vitals.spo2 !== null && vitals.spo2 !== '') {
    let s = 0;
    if (spo2 <= 91) s = 3;
    else if (spo2 >= 92 && spo2 <= 93) s = 2;
    else if (spo2 >= 94 && spo2 <= 95) s = 1;
    else if (spo2 >= 96) s = 0;

    score += s;
    if (s === 3) singleScore3 = true;
    breakdown.push({ metric: 'SpO₂', value: `${spo2}%`, score: s });
  }

  // 3. Systolic BP (extracted from bp string e.g. "120/80")
  let sbp = null;
  if (vitals.bp) {
    const bpMatch = String(vitals.bp).match(/^(\d{2,3})/);
    if (bpMatch) sbp = Number(bpMatch[1]);
  }
  if (sbp !== null && !isNaN(sbp)) {
    let s = 0;
    if (sbp <= 90) s = 3;
    else if (sbp >= 91 && sbp <= 100) s = 2;
    else if (sbp >= 101 && sbp <= 110) s = 1;
    else if (sbp >= 111 && sbp <= 219) s = 0;
    else if (sbp >= 220) s = 3;

    score += s;
    if (s === 3) singleScore3 = true;
    breakdown.push({ metric: 'Systolic BP', value: `${sbp} mmHg`, score: s });
  }

  // 4. Heart Rate (hr)
  const hr = Number(vitals.hr);
  if (!isNaN(hr) && vitals.hr !== null && vitals.hr !== '') {
    let s = 0;
    if (hr <= 40) s = 3;
    else if (hr >= 41 && hr <= 50) s = 1;
    else if (hr >= 51 && hr <= 90) s = 0;
    else if (hr >= 91 && hr <= 110) s = 1;
    else if (hr >= 111 && hr <= 130) s = 2;
    else if (hr >= 131) s = 3;

    score += s;
    if (s === 3) singleScore3 = true;
    breakdown.push({ metric: 'Heart Rate', value: `${hr} bpm`, score: s });
  }

  // 5. Consciousness / GCS
  const gcs = Number(vitals.gcs);
  if (!isNaN(gcs) && vitals.gcs !== null && vitals.gcs !== '') {
    let s = gcs < 15 ? 3 : 0;
    score += s;
    if (s === 3) singleScore3 = true;
    breakdown.push({ metric: 'GCS', value: String(gcs), score: s });
  }

  // 6. Temperature (°C)
  const temp = Number(vitals.temp);
  if (!isNaN(temp) && vitals.temp !== null && vitals.temp !== '') {
    let s = 0;
    if (temp <= 35.0) s = 3;
    else if (temp >= 35.1 && temp <= 36.0) s = 1;
    else if (temp >= 36.1 && temp <= 38.0) s = 0;
    else if (temp >= 38.1 && temp <= 39.0) s = 1;
    else if (temp >= 39.1) s = 2;

    score += s;
    if (s === 3) singleScore3 = true;
    breakdown.push({ metric: 'Temp', value: `${temp}°C`, score: s });
  }

  // Risk Classification
  let riskLevel = 'LOW';
  let color = '#10B981'; // Green
  let label = 'Low Risk (Routine monitoring)';

  if (score >= 7) {
    riskLevel = 'HIGH';
    color = '#EF4444'; // Red
    label = 'HIGH RISK (Emergency / ICU Alert)';
  } else if (score >= 5 || singleScore3) {
    riskLevel = 'MEDIUM';
    color = '#F59E0B'; // Amber
    label = 'Medium Risk (Urgent Medical Review)';
  }

  return { score, riskLevel, color, label, breakdown };
}

/**
 * Checks for drug-allergy conflicts between recorded allergies and active medications.
 * @param {Array|Object} allergies - List or object of allergies
 * @param {Array|Object} medications - List or object of medications
 * @returns {Array} List of warnings [{ allergy, medication, severity, message }]
 */
export function checkDrugAllergyConflicts(allergies = [], medications = []) {
  const warnings = [];
  const algList = Array.isArray(allergies) ? allergies : (allergies.list || []);
  const medList = Array.isArray(medications) ? medications : (medications.list || []);

  const allergyCrossReactions = {
    penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'augmentin', 'piperacillin'],
    nsaid: ['aspirin', 'ibuprofen', 'naproxen', 'ketorolac', 'diclofenac'],
    sulfa: ['sulfamethoxazole', 'bactrim', 'septra', 'sulfasalazine'],
    opioid: ['morphine', 'codeine', 'fentanyl', 'oxycodone', 'tramadol']
  };

  algList.forEach(algItem => {
    const algName = (typeof algItem === 'string' ? algItem : (algItem.agent || algItem.name || '')).toLowerCase();
    if (!algName) return;

    medList.forEach(medItem => {
      const medName = (typeof medItem === 'string' ? medItem : (medItem.name || medItem.drug || '')).toLowerCase();
      if (!medName) return;

      // Direct match
      if (medName.includes(algName) || algName.includes(medName)) {
        warnings.push({
          allergy: algName,
          medication: medName,
          severity: 'CRITICAL',
          message: `Direct Allergy Match: Patient is allergic to "${algName.toUpperCase()}" and is currently prescribed "${medName.toUpperCase()}".`
        });
        return;
      }

      // Cross-reactivity check
      for (const [group, drugs] of Object.entries(allergyCrossReactions)) {
        const isAllergicToGroup = algName.includes(group) || drugs.some(d => algName.includes(d));
        const isMedInGroup = drugs.some(d => medName.includes(d));

        if (isAllergicToGroup && isMedInGroup) {
          warnings.push({
            allergy: algName,
            medication: medName,
            severity: 'HIGH',
            message: `Cross-Reactivity Alert: Patient allergy "${algName}" may cross-react with drug "${medName}".`
          });
        }
      }
    });
  });

  return warnings;
}

/**
 * Generates an executive AI handover summary brief.
 * @param {Object} formData 
 * @returns {Object} Structured handover brief
 */
export function generateAIHandoverBrief(formData = {}) {
  const news2 = calculateNEWS2(formData.vit || {});
  const conflicts = checkDrugAllergyConflicts(formData.alg || [], formData.med || []);
  const patient = formData.id || {};
  const clinical = formData.clin || {};

  const name = patient.name || patient.fullName || 'Unknown Patient';
  const ageSex = `${patient.age ? patient.age + 'y' : ''} ${patient.gender || ''}`.trim() || 'Unspecified';
  const mrn = patient.mrn || patient.id || 'N/A';

  return {
    title: `AI Clinical Handoff Brief — ${name}`,
    timestamp: new Date().toLocaleString(),
    patientOverview: `Patient: ${name} (${ageSex}) | MRN: ${mrn}`,
    triageRisk: news2,
    drugAlerts: conflicts,
    chiefComplaint: clinical.chiefComplaint || clinical.primaryDiagnosis || 'No chief complaint documented.',
    summaryBullets: [
      `Vitals Score: NEWS2 Aggregate ${news2.score} (${news2.label})`,
      conflicts.length > 0 ? `CRITICAL ALERT: ${conflicts.length} Drug-Allergy conflict(s) detected!` : 'No immediate drug-allergy conflicts detected.',
      clinical.summary || clinical.historyOfPresentIllness || 'Clinical summary pending attending evaluation.',
    ],
    recommendedActions: [
      news2.score >= 5 ? 'Initiate immediate medical review upon arrival.' : 'Proceed with standard triage intake.',
      conflicts.length > 0 ? 'Review prescribed medications against patient allergy profile prior to administration.' : 'Verify current medication list.',
      'Perform handover verification with receiving charge nurse.'
    ]
  };
}
