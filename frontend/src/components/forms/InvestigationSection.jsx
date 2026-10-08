import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';

export function InvestigationSection({ formData, onChange }) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('Pending');
  const [notes, setNotes] = useState('');

  const investigations = formData.pi || [];

  const addInvestigation = () => {
    if (!name.trim()) return;
    if (investigations.length >= 50) return;
    const entry = `${name.trim()} [${status}]${notes.trim() ? `: ${notes.trim()}` : ''}`;
    onChange('pi', [...investigations, entry]);
    setName('');
    setNotes('');
  };

  const removeInvestigation = (index) => {
    onChange('pi', investigations.filter((_, i) => i !== index));
  };

  return (
    <Card title="SECTION 7 — Investigations" subtitle="Pending, completed, or abnormal lab & radiology findings">
      <Input
        label="Investigation Name"
        placeholder="e.g. CBC, Chest X-Ray, CT Brain"
        value={name}
        onChangeText={setName}
        maxLength={150}
      />
      <View style={styles.statusRow}>
        {['Pending', 'Completed', 'Abnormal'].map((st) => (
          <TouchableOpacity
            key={st}
            onPress={() => setStatus(st)}
            style={[
              styles.statusChip,
              status === st && styles.statusChipActive
            ]}
          >
            <Text style={[styles.statusChipText, status === st && { color: '#FFF' }]}>{st}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Input
        label="Findings / Notes"
        placeholder="e.g. Hb 8.4 g/dL, Infiltration in lower lobe"
        value={notes}
        onChangeText={setNotes}
        maxLength={300}
      />
      <Button
        title="+ Add Investigation Record"
        onPress={addInvestigation}
        disabled={!name.trim() || investigations.length >= 50}
        variant="secondary"
        style={{ marginBottom: 12 }}
      />

      {investigations.map((item, idx) => (
        <View key={idx} style={styles.itemRow}>
          <Text style={styles.itemText}>{typeof item === 'string' ? item : JSON.stringify(item)}</Text>
          <TouchableOpacity onPress={() => removeInvestigation(idx)}>
            <Text style={styles.removeText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  statusChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  statusChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
  },
  itemText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  removeText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.critical,
    marginLeft: 8,
  }
});
