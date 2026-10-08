import React from 'react';
import { Card, Input } from '../ui/Controls';
import { COLORS } from '../../constants/theme';

function countWords(str) {
  if (!str || typeof str !== 'string') return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

export function ClinicalInformationSection({ formData, onChange }) {
  const summaryText = formData.sum || '';
  const wordCount = countWords(summaryText);
  const isOverWordLimit = wordCount > 200;
  const excessWords = wordCount - 200;

  return (
    <Card title="SECTION 3 — Clinical Information" subtitle="Diagnoses and concise clinical context">
      <Input
        label="Primary Diagnosis *"
        required
        value={formData.pd}
        onChangeText={(txt) => onChange('pd', txt)}
        placeholder="Primary clinical diagnosis"
        maxLength={500}
        counterText={`${(formData.pd || '').length} / 500`}
      />
      <Input
        label="Secondary Diagnosis (optional)"
        value={formData.secondaryDiagnosis}
        onChangeText={(txt) => onChange('secondaryDiagnosis', txt)}
        placeholder="Comorbidities / Secondary diagnoses"
        maxLength={500}
      />
      <Input
        label="Current Clinical Condition (optional)"
        value={formData.currentCondition}
        onChangeText={(txt) => onChange('currentCondition', txt)}
        placeholder="e.g. Intubated, Sedated, Hemodynamically stable"
        maxLength={300}
      />
      <Input
        label="Clinical Summary (Max 200 Words)"
        value={summaryText}
        onChangeText={(txt) => onChange('sum', txt)}
        placeholder="Provide essential clinical background and transfer notes..."
        multiline
        numberOfLines={5}
        maxLength={1500}
        counterText={isOverWordLimit ? `⚠️ ${wordCount} / 200 words` : `${wordCount} / 200 words`}
        error={isOverWordLimit ? `⚠️ Clinical summary exceeds 200 words limit. Please reduce by ${excessWords} word${excessWords > 1 ? 's' : ''}.` : null}
      />
    </Card>
  );
}
