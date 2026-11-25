import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';

const COMMON_ALLERGIES = ['Penicillin', 'Sulfa Drugs', 'NSAIDs / Aspirin', 'Cephalosporins', 'Latex', 'IV Contrast Dye'];

export function AllergySection({ formData, onChange }) {
  const [newAllergy, setNewAllergy] = useState('');
  const allergies = formData.alg || [];
  const noKnownAllergies = formData.noKnownAllergies || false;

  const toggleNoKnownAllergies = () => {
    if (!noKnownAllergies) {
      onChange('noKnownAllergies', true);
      onChange('alg', ['No Known Allergies']);
    } else {
      onChange('noKnownAllergies', false);
      onChange('alg', []);
    }
  };

  const addSpecificAllergy = (itemText) => {
    const trimmed = (itemText || '').trim();
    if (!trimmed) return;
    if (allergies.length >= 20) return;
    if (allergies.some(a => a.toLowerCase() === trimmed.toLowerCase())) return;

    const updated = allergies.filter(a => a !== 'No Known Allergies').concat(trimmed);
    onChange('noKnownAllergies', false);
    onChange('alg', updated);
  };

  const addAllergy = () => {
    addSpecificAllergy(newAllergy);
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
    <Card
      title="SECTION 05 // ALLERGIES & DRUG SAFETY"
      subtitle="Critical drug, contrast & food allergy alerts"
      style={styles.folioCard}
      headerRight={<Badge label={noKnownAllergies ? 'NKDA' : `${allergies.length} ALERT(S)`} variant={noKnownAllergies ? 'info' : 'critical'} />}
    >
      <TouchableOpacity
        onPress={toggleNoKnownAllergies}
        style={[
          styles.nkdaToggle,
          noKnownAllergies && styles.nkdaActive
        ]}
      >
        <Text style={[styles.nkdaText, noKnownAllergies && { color: COLORS.primary }]}>
          {noKnownAllergies ? '✓ No Known Drug Allergies (NKDA) Verified' : 'Mark as "No Known Allergies" (NKDA)'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.quickTitle}>1-Tap Common Allergies (Tap to Flag)</Text>
      <View style={styles.quickRow}>
        {COMMON_ALLERGIES.map((item) => {
          const isAdded = allergies.some(a => a.toLowerCase() === item.toLowerCase());
          return (
            <TouchableOpacity
              key={item}
              onPress={() => addSpecificAllergy(item)}
              style={[styles.quickChip, isAdded && styles.quickChipAdded]}
            >
              <Text style={[styles.quickChipText, isAdded && { color: '#FFF' }]}>
                {isAdded ? `✓ ${item}` : `+ ${item}`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.inputRow}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Input
            placeholder="Add custom allergy (e.g. Morphine, Peanuts)"
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

      <View style={styles.badgeContainer}>
        {allergies.map((item, idx) => (
          <View key={idx} style={styles.allergyChip}>
            <Badge label={item} variant={item === 'No Known Allergies' ? 'info' : 'critical'} />
            {item !== 'No Known Allergies' && (
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
  folioCard: {
    borderTopWidth: 3,
    borderTopColor: COLORS.critical,
  },
  nkdaToggle: {
    padding: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
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
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    marginRight: 6,
    marginBottom: 6,
  },
  quickChipAdded: {
    backgroundColor: COLORS.critical,
    borderColor: COLORS.critical,
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.critical,
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
