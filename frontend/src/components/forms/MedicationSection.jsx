import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { checkDrugAllergyConflicts } from '../../utils/clinicalDecisionSupport';

const QUICK_DRUGS = [
  { n: 'Aspirin', d: '300 mg', r: 'PO', frequency: 'STAT', notes: 'Loading antiplatelet dose' },
  { n: 'Heparin', d: '5000 IU', r: 'IV', frequency: 'STAT', notes: 'Urgent anticoagulation' },
  { n: 'Ceftriaxone', d: '1 g', r: 'IV', frequency: 'BD', notes: 'Empirical broad-spectrum antibiotic' },
  { n: 'Normal Saline 0.9%', d: '500 ml', r: 'IV', frequency: 'Infusion', notes: 'Resuscitation bolus' },
  { n: 'Adrenaline (Epinephrine)', d: '1 mg', r: 'IV', frequency: 'STAT', notes: 'Critical resuscitation drug' }
];

const ROUTES = ['IV', 'IM', 'PO', 'SC', 'Neb'];
const FREQUENCIES = ['STAT', 'OD', 'BD', 'TDS', 'QID', 'Infusion'];

export function MedicationSection({ formData, onChange }) {
  const medications = formData.med || [];
  const allergies = formData.alg || [];
  const conflicts = checkDrugAllergyConflicts(allergies, medications);

  const addMedication = (preset = null) => {
    if (medications.length >= 50) return;
    const updated = [
      ...medications,
      preset
        ? { ...preset }
        : { n: '', d: '', r: 'IV', frequency: 'STAT', notes: '' }
    ];
    onChange('med', updated);
  };

  const updateMedicationField = (index, field, value) => {
    const updated = [...medications];
    updated[index] = { ...updated[index], [field]: value };
    onChange('med', updated);
  };

  const removeMedication = (index) => {
    const updated = medications.filter((_, i) => i !== index);
    onChange('med', updated);
  };

  return (
    <Card
      title="SECTION 06 // ACTIVE MEDICATIONS & INFUSIONS"
      subtitle="1-tap emergency drug presets or custom dosage schedule"
      style={styles.folioCard}
      headerRight={
        <Button
          title="+ Add Drug"
          onPress={() => addMedication()}
          size="small"
          disabled={medications.length >= 50}
        />
      }
    >
      {conflicts.length > 0 && (
        <View style={styles.alertBanner}>
          <Text style={styles.alertTitle}>⚠️ DRUG-ALLERGY CONFLICT DETECTED</Text>
          {conflicts.map((c, i) => (
            <Text key={i} style={styles.alertMessage}>• {c.message}</Text>
          ))}
        </View>
      )}

      <Text style={styles.quickTitle}>1-Tap Emergency Medications</Text>
      <View style={styles.quickRow}>
        {QUICK_DRUGS.map((drug) => (
          <TouchableOpacity
            key={drug.n}
            onPress={() => addMedication(drug)}
            style={styles.quickChip}
          >
            <Text style={styles.quickChipText}>+ {drug.n} ({drug.d})</Text>
          </TouchableOpacity>
        ))}
      </View>

      {medications.length === 0 ? (
        <Text style={styles.emptyText}>No active medications recorded yet. Tap a preset above or "+ Add Drug".</Text>
      ) : (
        medications.map((med, idx) => (
          <View key={idx} style={styles.medCard}>
            <View style={styles.medHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.medTitle}>Medication #{idx + 1}</Text>
                {(med.notes || '').toLowerCase().includes('critical') || med.frequency === 'STAT' ? (
                  <Badge label="STAT / PRIORITY" variant="critical" style={{ marginLeft: 8 }} />
                ) : null}
              </View>
              <TouchableOpacity onPress={() => removeMedication(idx)}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
            <Input
              label="Drug Name"
              required
              placeholder="e.g. Ceftriaxone, Dopamine"
              value={med.n}
              onChangeText={(txt) => updateMedicationField(idx, 'n', txt)}
              maxLength={150}
            />
            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Input
                  label="Dose"
                  placeholder="e.g. 1 g"
                  value={med.d}
                  onChangeText={(txt) => updateMedicationField(idx, 'd', txt)}
                  maxLength={100}
                />
              </View>
              <View style={{ flex: 1, marginHorizontal: 6 }}>
                <Input
                  label="Route"
                  placeholder="IV / PO"
                  value={med.r}
                  onChangeText={(txt) => updateMedicationField(idx, 'r', txt)}
                  maxLength={50}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Input
                  label="Frequency"
                  placeholder="STAT / BD"
                  value={med.frequency}
                  onChangeText={(txt) => updateMedicationField(idx, 'frequency', txt)}
                  maxLength={100}
                />
              </View>
            </View>
            <View style={styles.miniRow}>
              {ROUTES.map(r => (
                <TouchableOpacity
                  key={r}
                  onPress={() => updateMedicationField(idx, 'r', r)}
                  style={[styles.miniPill, med.r === r && styles.miniPillActive]}
                >
                  <Text style={[styles.miniText, med.r === r && { color: '#FFF' }]}>{r}</Text>
                </TouchableOpacity>
              ))}
              {FREQUENCIES.map(f => (
                <TouchableOpacity
                  key={f}
                  onPress={() => updateMedicationField(idx, 'frequency', f)}
                  style={[styles.miniPill, med.frequency === f && styles.miniPillFreqActive]}
                >
                  <Text style={[styles.miniText, med.frequency === f && { color: '#FFF' }]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Input
              label="Important Notes"
              placeholder="e.g. Infusion running via central line"
              value={med.notes}
              onChangeText={(txt) => updateMedicationField(idx, 'notes', txt)}
              maxLength={500}
            />
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  folioCard: {
    borderTopWidth: 3,
    borderTopColor: COLORS.primary,
  },
  quickTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  quickChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    backgroundColor: '#F0F9FF',
    marginRight: 6,
    marginBottom: 6,
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 12,
  },
  medCard: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  medHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  medTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  removeText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.critical,
  },
  row: {
    flexDirection: 'row',
  },
  miniRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  miniPill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#FFF',
    marginRight: 5,
    marginBottom: 4,
  },
  miniPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  miniPillFreqActive: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  miniText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  alertBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
    borderWidth: 1.5,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  alertTitle: {
    color: '#991B1B',
    fontWeight: '800',
    fontSize: 13,
    marginBottom: 4,
  },
  alertMessage: {
    color: '#B91C1C',
    fontSize: 12,
    marginTop: 2,
  },
});
