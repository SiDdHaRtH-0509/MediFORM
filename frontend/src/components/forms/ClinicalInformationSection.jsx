import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';

const CONDITION_PRESETS = [
  'Conscious & Oriented',
  'Hemodynamically Stable',
  'Unstable / On Inotropes',
  'Intubated & Ventilated',
  'On Supplemental O2',
  'Sedated'
];

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
    <Card
      title="SECTION 04 // CLINICAL DIAGNOSIS & CONDITION"
      subtitle="Primary diagnosis, acuity status & concise handoff clinical summary"
      style={styles.folioCard}
      headerRight={<Badge label="CLINICAL" variant="info" />}
    >
      <Input
        label="Primary Diagnosis"
        required
        value={formData.pd}
        onChangeText={(txt) => onChange('pd', txt)}
        placeholder="e.g. Acute Anterior Wall STEMI / Polytrauma"
        maxLength={500}
        counterText={`${(formData.pd || '').length} / 500`}
      />
      <Input
        label="Secondary Diagnosis / Comorbidities (optional)"
        value={formData.secondaryDiagnosis}
        onChangeText={(txt) => onChange('secondaryDiagnosis', txt)}
        placeholder="e.g. Type 2 DM, Hypertension, CKD Stage 3"
        maxLength={500}
      />

      <Text style={styles.quickLabel}>Quick Current Condition Stamp</Text>
      <View style={styles.chipRow}>
        {CONDITION_PRESETS.map((cond) => {
          const active = (formData.currentCondition || '').includes(cond);
          return (
            <TouchableOpacity
              key={cond}
              onPress={() => onChange('currentCondition', cond)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && { color: '#FFF' }]}>{cond}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Input
        label="Current Clinical Condition"
        value={formData.currentCondition}
        onChangeText={(txt) => onChange('currentCondition', txt)}
        placeholder="e.g. Intubated, Sedated, Hemodynamically stable"
        maxLength={300}
      />
      <Input
        label="Clinical Summary & Course (Max 200 Words)"
        value={summaryText}
        onChangeText={(txt) => onChange('sum', txt)}
        placeholder="Summarize onset, initial ER stabilization, procedures done, and critical transfer notes..."
        multiline
        numberOfLines={4}
        maxLength={1500}
        counterText={isOverWordLimit ? `⚠️ ${wordCount} / 200 words` : `${wordCount} / 200 words`}
        error={isOverWordLimit ? `⚠️ Clinical summary exceeds 200 words limit. Please reduce by ${excessWords} word${excessWords > 1 ? 's' : ''}.` : null}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  folioCard: {
    borderTopWidth: 3,
    borderTopColor: COLORS.primary,
  },
  quickLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#F8FAFC',
    marginRight: 6,
    marginBottom: 6,
  },
  chipActive: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
  }
});
