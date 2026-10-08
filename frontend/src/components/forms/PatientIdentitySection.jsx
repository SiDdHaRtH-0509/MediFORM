import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Input } from '../ui/Controls';

export function PatientIdentitySection({ formData, onChange }) {
  return (
    <Card title="SECTION 1 — Patient Information" subtitle="Identify the patient being transferred">
      <Input
        label="Patient Name *"
        required
        value={formData.nam}
        onChangeText={(txt) => onChange('nam', txt)}
        placeholder="Full name (e.g. John Doe)"
        maxLength={150}
        counterText={`${(formData.nam || '').length} / 150`}
      />
      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Input
            label="Patient ID / UHID *"
            required
            value={formData.pid}
            onChangeText={(txt) => onChange('pid', txt)}
            placeholder="e.g. PAT-98765"
            maxLength={64}
            counterText={`${(formData.pid || '').length} / 64`}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Input
            label="Age *"
            required
            keyboardType="numeric"
            value={formData.age ? String(formData.age) : ''}
            onChangeText={(txt) => onChange('age', txt.replace(/[^0-9]/g, ''))}
            placeholder="Age in years"
            maxLength={3}
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Input
            label="Gender (optional)"
            value={formData.gender}
            onChangeText={(txt) => onChange('gender', txt)}
            placeholder="Male / Female / Other"
            maxLength={30}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Input
            label="Blood Group *"
            required
            value={formData.bg}
            onChangeText={(txt) => onChange('bg', txt)}
            placeholder="e.g. O+, A-, B+"
            maxLength={10}
          />
        </View>
      </View>
      <Input
        label="Contact Number (optional)"
        value={formData.contactNumber}
        onChangeText={(txt) => onChange('contactNumber', txt)}
        placeholder="Primary phone number"
        maxLength={20}
      />
      <Input
        label="Emergency Contact (optional)"
        value={formData.emergencyContact}
        onChangeText={(txt) => onChange('emergencyContact', txt)}
        placeholder="Next of kin / Emergency contact"
        maxLength={150}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  }
});
