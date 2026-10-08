import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Button, Badge } from '../ui/Controls';
import { COLORS, OTHER_DETAIL_CATEGORIES, OTHER_DETAIL_PRIORITIES } from '../../constants/theme';

export function OtherDetailsSection({ formData, onChange }) {
  const otherDetails = formData.otherDetails || [];

  const addOtherDetail = () => {
    if (otherDetails.length >= 20) return;
    const newDetail = {
      title: '',
      value: '',
      category: 'SPECIAL_INSTRUCTIONS',
      priority: 'CRITICAL', // Defaulting new cards to prominent option
      timestamp: new Date().toISOString()
    };
    onChange('otherDetails', [...otherDetails, newDetail]);
  };

  const updateDetailField = (index, field, val) => {
    const updated = [...otherDetails];
    updated[index] = { ...updated[index], [field]: val };
    onChange('otherDetails', updated);
  };

  const removeDetail = (index) => {
    onChange('otherDetails', otherDetails.filter((_, i) => i !== index));
  };

  return (
    <Card
      title="SECTION 8 — Other Details"
      subtitle="Extensible clinical instructions (Dietary, Mobility, Devices, Nursing, Special Instructions)"
      headerRight={
        <Button
          title="+ Add Other Detail"
          onPress={addOtherDetail}
          disabled={otherDetails.length >= 20}
          size="small"
        />
      }
    >
      {otherDetails.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No Custom Details Added Yet</Text>
          <Text style={styles.emptyText}>
            Doctors can record unformatted clinical notes, special instructions, dietary rules, or device warnings here without breaking the standardized data model.
          </Text>
        </View>
      ) : (
        otherDetails.map((detail, idx) => (
          <View key={idx} style={styles.detailCard}>
            <View style={styles.cardTopHeader}>
              <Text style={styles.detailCardNumber}>Custom Detail #{idx + 1}</Text>
              <TouchableOpacity onPress={() => removeDetail(idx)}>
                <Text style={styles.deleteText}>Remove Card</Text>
              </TouchableOpacity>
            </View>

            <Input
              label="Detail Title"
              required
              placeholder="e.g. Dietary Restrictions, Special Instruction"
              value={detail.title}
              onChangeText={(txt) => updateDetailField(idx, 'title', txt)}
              maxLength={100}
              counterText={`${(detail.title || '').length} / 100`}
            />

            <Input
              label="Detail Value / Instruction"
              required
              placeholder="e.g. Monitor urine output hourly, NPO until further evaluation"
              value={detail.value}
              onChangeText={(txt) => updateDetailField(idx, 'value', txt)}
              multiline
              numberOfLines={3}
              maxLength={2000}
              counterText={`${(detail.value || '').length} / 2000`}
            />

            <Text style={styles.subLabel}>Category</Text>
            <View style={styles.categoryContainer}>
              {OTHER_DETAIL_CATEGORIES.map((cat) => {
                const isSelected = detail.category === cat.value;
                return (
                  <TouchableOpacity
                    key={cat.value}
                    onPress={() => updateDetailField(idx, 'category', cat.value)}
                    style={[
                      styles.categoryChip,
                      isSelected && styles.categoryChipSelected
                    ]}
                  >
                    <Text style={[styles.categoryChipText, isSelected && { color: '#FFF' }]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.subLabel}>Priority Level</Text>
            <View style={styles.priorityRow}>
              {OTHER_DETAIL_PRIORITIES.map((p) => {
                const isSelected = detail.priority === p.value;
                return (
                  <TouchableOpacity
                    key={p.value}
                    onPress={() => updateDetailField(idx, 'priority', p.value)}
                    style={[
                      styles.priorityBadge,
                      { borderColor: p.color },
                      isSelected && { backgroundColor: p.color }
                    ]}
                  >
                    <Text style={[styles.priorityBadgeText, { color: isSelected ? '#FFF' : p.color }]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  emptyBox: {
    padding: 16,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  detailCard: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  cardTopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailCardNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  deleteText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.critical,
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 6,
  },
  categoryContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  categoryChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#FFF',
    marginRight: 6,
    marginBottom: 6,
  },
  categoryChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  priorityRow: {
    flexDirection: 'row',
  },
  priorityBadge: {
    flex: 1,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderRadius: 6,
    alignItems: 'center',
    marginRight: 6,
  },
  priorityBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  }
});
