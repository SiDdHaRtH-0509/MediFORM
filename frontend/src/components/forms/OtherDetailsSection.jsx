import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Button, Badge } from '../ui/Controls';
import { COLORS, OTHER_DETAIL_CATEGORIES, OTHER_DETAIL_PRIORITIES } from '../../constants/theme';

const QUICK_OTHER_TEMPLATES = [
  { title: 'NPO / Fasting Status', value: 'Keep NPO for urgent intervention / surgery', category: 'DIETARY', priority: 'CRITICAL' },
  { title: 'Airway / O2 Support', value: 'High-flow O2 mask @ 10L/min; prepare airway kit', category: 'DEVICE', priority: 'CRITICAL' },
  { title: 'IV Access & Lines', value: 'Two 18G peripheral IV cannulas patent', category: 'NURSING', priority: 'IMPORTANT' },
  { title: 'Isolation / Precaution', value: 'Contact & droplet isolation protocol active', category: 'SPECIAL_INSTRUCTIONS', priority: 'IMPORTANT' }
];

export function OtherDetailsSection({ formData, onChange }) {
  const otherDetails = formData.otherDetails || [];

  const addOtherDetail = (template = null) => {
    if (otherDetails.length >= 20) return;
    const newDetail = template
      ? { ...template, timestamp: new Date().toISOString() }
      : {
          title: '',
          value: '',
          category: 'SPECIAL_INSTRUCTIONS',
          priority: 'CRITICAL',
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
      title="SECTION 09 // SPECIAL INSTRUCTIONS & NURSING NOTES"
      subtitle="Dietary, mobility, ventilator/device warnings & custom handoff orders"
      style={styles.folioCard}
      headerRight={
        <Button
          title="+ Add Note"
          onPress={() => addOtherDetail()}
          disabled={otherDetails.length >= 20}
          size="small"
        />
      }
    >
      <Text style={styles.quickTitle}>1-Tap Clinical Orders</Text>
      <View style={styles.quickRow}>
        {QUICK_OTHER_TEMPLATES.map((tpl) => (
          <TouchableOpacity
            key={tpl.title}
            onPress={() => addOtherDetail(tpl)}
            style={styles.quickChip}
          >
            <Text style={styles.quickChipText}>+ {tpl.title}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {otherDetails.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No Custom Instructions Added</Text>
          <Text style={styles.emptyText}>
            Tap a 1-click template above or "+ Add Note" for NPO orders, lines/tubes, or critical precautions.
          </Text>
        </View>
      ) : (
        otherDetails.map((detail, idx) => (
          <View key={idx} style={styles.detailCard}>
            <View style={styles.cardTopHeader}>
              <Text style={styles.detailCardNumber}>Instruction #{idx + 1}</Text>
              <TouchableOpacity onPress={() => removeDetail(idx)}>
                <Text style={styles.deleteText}>Remove</Text>
              </TouchableOpacity>
            </View>

            <Input
              label="Instruction Title"
              required
              placeholder="e.g. Dietary Restrictions, Ventilator Settings"
              value={detail.title}
              onChangeText={(txt) => updateDetailField(idx, 'title', txt)}
              maxLength={100}
              counterText={`${(detail.title || '').length} / 100`}
            />

            <Input
              label="Instruction Details"
              required
              placeholder="e.g. Monitor urine output hourly, NPO until further evaluation"
              value={detail.value}
              onChangeText={(txt) => updateDetailField(idx, 'value', txt)}
              multiline
              numberOfLines={2}
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
  emptyBox: {
    padding: 14,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
  },
  detailCard: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  cardTopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailCardNumber: {
    fontSize: 14,
    fontWeight: '800',
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
