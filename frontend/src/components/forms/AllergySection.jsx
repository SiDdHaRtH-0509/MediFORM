import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';

export function AllergySection({ formData, onChange }) {
  const [newAllergy, setNewAllergy] = useState('');
  const allergies = formData.alg || [];
  const noKnownAllergies = formData.noKnownAllergies || false;

  const toggleNoKnownAllergies = () => {
    if (!noKnownAllergies) {
      // Enabling No Known Allergies clears individual items to prevent contradictory state
      onChange('noKnownAllergies', true);
      onChange('alg', ['No Known Allergies']);
    } else {
      onChange('noKnownAllergies', false);
      onChange('alg', []);
    }
  };

  const addAllergy = () => {
    const trimmed = newAllergy.trim();
    if (!trimmed) return;
    if (allergies.length >= 20) return;

    // Remove NKDA if user adds specific allergy
    const updated = allergies.filter(a => a !== 'No Known Allergies').concat(trimmed);
    onChange('noKnownAllergies', false);
    onChange('alg', updated);
    setNewAllergy('');
  };

  const removeAllergy = (index) => {
    const updated = allergies.filter((_, i) => i !== index);
    onChange('alg', updated);
    if (updated.length === 0) {
      onChange('noKnownAllergies', false);
    }
  };

  return (
    <Card title="SECTION 4 — Allergies" subtitle="Critical drug and food allergy record">
      <TouchableOpacity
        onPress={toggleNoKnownAllergies}
        style={[
          styles.nkdaToggle,
          noKnownAllergies && styles.nkdaActive
        ]}
      >
        <Text style={[styles.nkdaText, noKnownAllergies && { color: COLORS.primary }]}>
          {noKnownAllergies ? '✓ No Known Allergies Selected' : 'Select "No Known Allergies"'}
        </Text>
      </TouchableOpacity>

      {!noKnownAllergies && (
        <View>
          <View style={styles.inputRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Input
                placeholder="Enter allergy (e.g. Penicillin, Latex)"
                value={newAllergy}
                onChangeText={setNewAllergy}
                maxLength={150}
              />
            </View>
            <Button
              title="+ Add"
              onPress={addAllergy}
              disabled={!newAllergy.trim() || allergies.length >= 20}
              style={{ marginTop: 2 }}
            />
          </View>
        </View>
      )}

      <View style={styles.badgeContainer}>
        {allergies.map((item, idx) => (
          <View key={idx} style={styles.allergyChip}>
            <Badge label={item} variant={item === 'No Known Allergies' ? 'info' : 'critical'} />
            {!noKnownAllergies && (
              <TouchableOpacity onPress={() => removeAllergy(idx)} style={styles.removeChipBtn}>
                <Text style={styles.removeChipText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  nkdaToggle: {
    padding: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 14,
    backgroundColor: '#FAFAFA',
  },
  nkdaActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#E3F2FD',
  },
  nkdaText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  allergyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 8,
  },
  removeChipBtn: {
    marginLeft: 4,
    padding: 4,
  },
  removeChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.critical,
  }
});
