import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Badge } from '../ui/Controls';
import { COLORS, TRANSFER_PRIORITIES } from '../../constants/theme';

const DEPARTMENTS = [
  'ICU',
  'Emergency / Trauma',
  'Cardiology CCU',
  'Neuro ICU',
  'NICU / PICU',
  'Surgery',
  'General Ward'
];

export function TransferInformationSection({ formData, onChange }) {
  return (
    <Card
      title="SECTION 02 // HOSPITAL ROUTING & TRANSFER PRIORITY"
      subtitle="Originating facility, receiving hospital, specialty unit & urgency stamp"
      style={styles.folioCard}
      headerRight={<Badge label="REQUIRED" variant="info" />}
    >
      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Input
            label="From Hospital / Facility"
            required
            value={formData.fh}
            onChangeText={(txt) => onChange('fh', txt)}
            placeholder="Referring hospital name"
            maxLength={150}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Input
            label="To Hospital / Facility"
            required
            value={formData.th}
            onChangeText={(txt) => onChange('th', txt)}
            placeholder="Receiving hospital name"
            maxLength={150}
          />
        </View>
      </View>

      <Text style={styles.priorityLabel}>Transfer Priority Stamp <Text style={{ color: COLORS.critical }}>*</Text></Text>
      <View style={styles.priorityContainer}>
        {TRANSFER_PRIORITIES.map((p) => {
          const isSelected = formData.priority === p.value;
          return (
            <TouchableOpacity
              key={p.value}
              onPress={() => onChange('priority', p.value)}
              style={[
                styles.priorityOption,
                { borderColor: p.color },
                isSelected && { backgroundColor: p.color }
              ]}
            >
              <Text style={[styles.priorityText, { color: isSelected ? '#FFF' : p.color }]}>
                {p.value === 'Emergency' ? '🚨 ' : p.value === 'Urgent' ? '⚡ ' : ''}{p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.priorityLabel}>Receiving Department</Text>
      <View style={styles.deptRow}>
        {DEPARTMENTS.map((dept) => {
          const selected = (formData.receivingDepartment || '') === dept;
          return (
            <TouchableOpacity
              key={dept}
              onPress={() => onChange('receivingDepartment', dept)}
              style={[styles.deptChip, selected && styles.deptChipActive]}
            >
              <Text style={[styles.deptText, selected && { color: '#FFF' }]}>{dept}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Input
        label="Clinical Reason for Transfer"
        required
        value={formData.rt}
        onChangeText={(txt) => onChange('rt', txt)}
        placeholder="e.g. Primary PCI / Higher level Trauma ICU & ventilator support required"
        multiline
        numberOfLines={2}
        maxLength={500}
        counterText={`${(formData.rt || '').length} / 500`}
      />

      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Input
            label="Referring Clinician Name"
            value={formData.referringDoctor}
            onChangeText={(txt) => onChange('referringDoctor', txt)}
            placeholder="Attending physician"
            maxLength={150}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Input
            label="Custom Dept (if other)"
            value={formData.receivingDepartment}
            onChangeText={(txt) => onChange('receivingDepartment', txt)}
            placeholder="e.g. Burn Unit"
            maxLength={100}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  folioCard: {
    borderTopWidth: 3,
    borderTopColor: COLORS.primary,
  },
  priorityLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  priorityContainer: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  priorityOption: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 8,
  },
  priorityText: {
    fontSize: 14,
    fontWeight: '800',
  },
  deptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  deptChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#F8FAFC',
    marginRight: 6,
    marginBottom: 6,
  },
  deptChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  deptText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  row: {
    flexDirection: 'row',
  }
});
