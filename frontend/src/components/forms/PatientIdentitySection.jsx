import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card, Input, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';

const GENDERS = ['Male', 'Female', 'Other'];
const BLOOD_GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

export function PatientIdentitySection({ formData, onChange }) {
  const generateQuickPid = () => {
    const code = `PAT-${new Date().getFullYear().toString().slice(-2)}${Math.floor(10000 + Math.random() * 90000)}`;
    onChange('pid', code);
  };

  return (
    <Card
      title="SECTION 01 // PATIENT DEMOGRAPHICS & IDENTITY"
      subtitle="Verify patient identity, blood group & emergency family contact"
      style={styles.folioCard}
      headerRight={<Badge label="REQUIRED" variant="info" />}
    >
      <Input
        label="Patient Full Name"
        required
        value={formData.nam}
        onChangeText={(txt) => onChange('nam', txt)}
        placeholder="Full legal name (e.g. Rajesh Sharma)"
        maxLength={150}
        counterText={`${(formData.nam || '').length} / 150`}
      />

      <View style={styles.row}>
        <View style={{ flex: 2, marginRight: 8 }}>
          <View style={styles.uhidHeader}>
            <Text style={styles.inlineLabel}>Patient ID / UHID <Text style={{ color: COLORS.critical }}>*</Text></Text>
            <TouchableOpacity onPress={generateQuickPid} style={styles.autoBtn}>
              <Text style={styles.autoBtnText}>⚡ Auto-Generate</Text>
            </TouchableOpacity>
          </View>
          <Input
            value={formData.pid}
            onChangeText={(txt) => onChange('pid', txt)}
            placeholder="e.g. PAT-260142"
            maxLength={64}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 4 }}>
          <Input
            label="Age (yrs)"
            required
            keyboardType="numeric"
            value={formData.age ? String(formData.age) : ''}
            onChangeText={(txt) => onChange('age', txt.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 48"
            maxLength={3}
          />
        </View>
      </View>

      {/* Quick Gender Selector */}
      <Text style={styles.fieldLabel}>Gender</Text>
      <View style={styles.pillRow}>
        {GENDERS.map((g) => {
          const selected = (formData.gender || 'Male') === g;
          return (
            <TouchableOpacity
              key={g}
              onPress={() => onChange('gender', g)}
              style={[styles.genderPill, selected && styles.pillActive]}
            >
              <Text style={[styles.pillText, selected && styles.pillTextActive]}>{g}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Quick Blood Group Selector */}
      <Text style={styles.fieldLabel}>Blood Group <Text style={{ color: COLORS.critical }}>*</Text></Text>
      <View style={styles.pillRow}>
        {BLOOD_GROUPS.map((bg) => {
          const selected = (formData.bg || '').toUpperCase() === bg;
          return (
            <TouchableOpacity
              key={bg}
              onPress={() => onChange('bg', bg)}
              style={[styles.bgPill, selected && styles.bgPillActive]}
            >
              <Text style={[styles.pillText, selected && styles.pillTextActive]}>{bg}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Input
            label="Patient Contact Phone"
            keyboardType="phone-pad"
            value={formData.contactNumber}
            onChangeText={(txt) => onChange('contactNumber', txt)}
            placeholder="e.g. +919876543210"
            maxLength={20}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Input
            label="Next of Kin / Emergency Contact"
            value={formData.emergencyContact}
            onChangeText={(txt) => onChange('emergencyContact', txt)}
            placeholder="Name & phone (+91...)"
            maxLength={150}
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
  row: {
    flexDirection: 'row',
  },
  uhidHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  inlineLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  autoBtn: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  autoBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  genderPill: {
    flex: 1,
    minWidth: 70,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    marginRight: 8,
  },
  bgPill: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: '#F8FAFC',
    marginRight: 6,
    marginBottom: 6,
  },
  pillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  bgPillActive: {
    backgroundColor: COLORS.critical,
    borderColor: COLORS.critical,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  pillTextActive: {
    color: '#FFFFFF',
  }
});
