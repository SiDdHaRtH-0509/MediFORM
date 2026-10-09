import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Button } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { checkDrugAllergyConflicts } from '../../utils/clinicalDecisionSupport';

export function MedicationSection({ formData, onChange }) {
  const medications = formData.med || [];
  const allergies = formData.alg || [];
  const conflicts = checkDrugAllergyConflicts(allergies, medications);

  const addMedication = () => {
    if (medications.length >= 50) return;
    const updated = [
      ...medications,
      { n: '', d: '', r: '', frequency: '', notes: '' }
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
      title="SECTION 5 — Active Medications"
      subtitle="Current dynamic medication schedule"
      headerRight={
        <Button
          title="+ Add Drug"
          onPress={addMedication}
          size="small"
          disabled={medications.length >= 50}
        />
      }
    >
      {conflicts.length > 0 && (
        <View style={styles.alertBanner}>
          <Text style={styles.alertTitle}>⚠️ DRUG-ALLERGY ALERT DETECTED</Text>
          {conflicts.map((c, i) => (
            <Text key={i} style={styles.alertMessage}>• {c.message}</Text>
          ))}
        </View>
      )}
      {medications.length === 0 ? (
        <Text style={styles.emptyText}>No active medications recorded yet. Click "+ Add Drug" above.</Text>
      ) : (
        medications.map((med, idx) => (
          <View key={idx} style={styles.medCard}>
            <View style={styles.medHeader}>
              <Text style={styles.medTitle}>Medication #{idx + 1}</Text>
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
                  placeholder="e.g. IV, PO"
                  value={med.r}
                  onChangeText={(txt) => updateMedicationField(idx, 'r', txt)}
                  maxLength={50}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Input
                  label="Frequency"
                  placeholder="e.g. BD, STAT"
                  value={med.frequency}
                  onChangeText={(txt) => updateMedicationField(idx, 'frequency', txt)}
                  maxLength={100}
                />
              </View>
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
