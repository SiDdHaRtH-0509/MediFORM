/**
 * Clinical Decision Support (CDS) & Screening Classification Service
 *
 * Implements standard NEWS2 physiological scoring, drug-allergy conflict detection,
 * and automated clinical flagging logic matching MediFORM's clinical standards.
 * Does not introduce arbitrary thresholds.
 */

/**
 * Calculates the NEWS2 (National Early Warning Score) from vital signs.
 * Standards:
 * - Respiration Rate (rr): <=8 (3), 9-11 (1), 12-20 (0), 21-24 (2), >=25 (3)
 * - SpO2 (%): <=91 (3), 92-93 (2), 94-95 (1), >=96 (0)
 * - Systolic BP: <=90 (3), 91-100 (2), 101-110 (1), 111-219 (0), >=220 (3)
 * - Heart Rate (hr): <=40 (3), 41-50 (1), 51-90 (0), 91-110 (1), 111-130 (2), >=131 (3)
 * - Consciousness / GCS: <15 (3), 15 (0)
 * - Temperature (°C): <=35.0 (3), 35.1-36.0 (1), 36.1-38.0 (0), 38.1-39.0 (1), >=39.1 (2)
 *
 * Classification:
 * - score >= 7: HIGH RISK (Emergency alert)
 * - score >= 5 or any single score of 3: MEDIUM RISK (Urgent medical review)
 * - otherwise: LOW RISK (Routine monitoring)
 */
function calculateNEWS2(vitals = {}) {
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
    breakdown.push({ metric: 'SpO2', value: `${spo2}%`, score: s });
  }

  // 3. Systolic BP
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
    const s = gcs < 15 ? 3 : 0;
    score += s;
    if (s === 3) singleScore3 = true;
    breakdown.push({ metric: 'GCS', value: String(gcs), score: s });
  } else if (vitals.consciousness || vitals.avpu) {
    const rawC = String(vitals.consciousness || vitals.avpu).trim();
    const upperC = rawC.toUpperCase();
    const s = (upperC === 'ALERT' || upperC === 'A') ? 0 : 3;
    score += s;
    if (s === 3) singleScore3 = true;
    breakdown.push({ metric: 'Consciousness', value: rawC, score: s });
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

  return { score, riskLevel, color, label, breakdown, singleScore3 };
}

/**
 * Checks for drug-allergy conflicts between recorded allergies and active medications.
 */
function checkDrugAllergyConflicts(allergies = [], medications = []) {
  const warnings = [];
  const algList = Array.isArray(allergies) ? allergies : [];
  const medList = Array.isArray(medications) ? medications : [];

  const allergyCrossReactions = {
    penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'augmentin', 'piperacillin'],
    nsaid: ['aspirin', 'ibuprofen', 'naproxen', 'ketorolac', 'diclofenac'],
    sulfa: ['sulfamethoxazole', 'bactrim', 'septra', 'sulfasalazine'],
    opioid: ['morphine', 'codeine', 'fentanyl', 'oxycodone', 'tramadol']
  };

  algList.forEach(algItem => {
    const algName = (typeof algItem === 'string' ? algItem : (algItem.agent || algItem.name || '')).toLowerCase();
    if (!algName || algName.includes('no known')) return;

    medList.forEach(medItem => {
      const medName = (typeof medItem === 'string' ? medItem : (medItem.name || medItem.n || '')).toLowerCase();
      if (!medName) return;

      // Direct match
      if (medName.includes(algName) || algName.includes(medName)) {
        warnings.push({
          allergy: algName,
          medication: medName,
          severity: 'CRITICAL',
          message: `Direct Allergy Match: Patient allergic to "${algName.toUpperCase()}" prescribed "${medName.toUpperCase()}".`
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
 * Evaluates a patient screening record using existing MediFORM clinical classification rules.
 * A screening is flagged if:
 * 1. NEWS2 score >= 5 or any single score of 3 (Risk Level MEDIUM or HIGH)
 * 2. Any laboratory or radiology investigation is classified as 'Abnormal'
 * 3. Any drug-allergy conflict with severity 'CRITICAL' or 'HIGH'
 *
 * @param {Object} screeningData - Object containing vitals, investigations, allergies, medications
 * @returns {Object} Comprehensive evaluation result
 */
function evaluateScreening(screeningData = {}) {
  const vitals = screeningData.vitals || {};
  const investigations = screeningData.investigations || [];
  const allergies = screeningData.allergies || [];
  const medications = screeningData.medications || [];

  const news2 = calculateNEWS2(vitals);
  const conflicts = checkDrugAllergyConflicts(allergies, medications);

  const abnormalInvestigations = [];
  investigations.forEach(inv => {
    if (typeof inv === 'string') {
      if (inv.toLowerCase().includes('[abnormal]') || inv.toLowerCase().includes('abnormal')) {
        abnormalInvestigations.push(inv);
      }
    } else if (inv && inv.status === 'Abnormal') {
      abnormalInvestigations.push(`${inv.name}: ${inv.notes || 'Abnormal result'}`);
    }
  });

  const flagReasons = [];

  if (news2.riskLevel === 'HIGH') {
    flagReasons.push(`NEWS2 Aggregate Score: ${news2.score} — HIGH RISK (ICU/Emergency Alert)`);
  } else if (news2.riskLevel === 'MEDIUM') {
    flagReasons.push(`NEWS2 Aggregate Score: ${news2.score} — Medium Risk (Urgent Medical Review Required)`);
  }

  abnormalInvestigations.forEach(invText => {
    flagReasons.push(`Abnormal Investigation: ${invText}`);
  });

  conflicts.forEach(c => {
    flagReasons.push(`Allergy Alert (${c.severity}): ${c.message}`);
  });

  const isFlagged = flagReasons.length > 0;
  const requiresClinicalAttention = isFlagged;

  let recommendedPriority = 'Routine';
  if (news2.riskLevel === 'HIGH' || conflicts.some(c => c.severity === 'CRITICAL')) {
    recommendedPriority = 'Emergency';
  } else if (news2.riskLevel === 'MEDIUM' || abnormalInvestigations.length > 0 || conflicts.length > 0) {
    recommendedPriority = 'Urgent';
  }

  let summary = 'Normal physiological vitals and findings. Routine monitoring advised.';
  if (news2.riskLevel === 'HIGH') {
    summary = `CRITICAL ALERT: Patient exhibits physiological deterioration with NEWS2 score of ${news2.score}. Immediate clinical referral recommended.`;
  } else if (news2.riskLevel === 'MEDIUM') {
    summary = `URGENT ALERT: Physiological score or single vital trigger indicates medium risk (NEWS2 ${news2.score}). Clinical review recommended.`;
  } else if (abnormalInvestigations.length > 0) {
    summary = `ABNORMAL FINDINGS: ${abnormalInvestigations.length} abnormal investigation(s) detected requiring specialist review.`;
  }

  return {
    isFlagged,
    requiresClinicalAttention,
    riskLevel: news2.riskLevel,
    news2Score: news2.score,
    news2Details: news2,
    flagReasons,
    recommendedPriority,
    conflicts,
    abnormalInvestigations,
    summary
  };
}

module.exports = {
  calculateNEWS2,
  checkDrugAllergyConflicts,
  evaluateScreening
};
