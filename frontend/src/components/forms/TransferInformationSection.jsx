import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input } from '../ui/Controls';
import { COLORS, TRANSFER_PRIORITIES } from '../../constants/theme';

export function TransferInformationSection({ formData, onChange }) {
  return (
    <Card title="SECTION 2 — Transfer Information" subtitle="Transfer origin, destination, and priority">
      <Input
        label="From Hospital / Facility *"
        required
        value={formData.fh}
        onChangeText={(txt) => onChange('fh', txt)}
        placeholder="Referring facility name"
        maxLength={150}
      />
      <Input
        label="To Hospital / Facility *"
        required
        value={formData.th}
        onChangeText={(txt) => onChange('th', txt)}
        placeholder="Receiving hospital name"
        maxLength={150}
      />
      <Input
        label="Reason for Transfer *"
        required
        value={formData.rt}
        onChangeText={(txt) => onChange('rt', txt)}
        placeholder="Clinical reason (e.g. Higher level ICU care required)"
        multiline
        numberOfLines={2}
        maxLength={500}
        counterText={`${(formData.rt || '').length} / 500`}
      />
      <Text style={styles.priorityLabel}>Transfer Priority *</Text>
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
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Input
            label="Referring Doctor (optional)"
            value={formData.referringDoctor}
            onChangeText={(txt) => onChange('referringDoctor', txt)}
            placeholder="Doctor name"
            maxLength={150}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Input
            label="Receiving Dept (optional)"
            value={formData.receivingDepartment}
            onChangeText={(txt) => onChange('receivingDepartment', txt)}
            placeholder="e.g. ICU / Emergency"
            maxLength={100}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  priorityLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  priorityContainer: {
    flexDirection: 'row',
    marginBottom: 16,
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
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
  }
});
