import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Input } from '../ui/Controls';

export function VitalsSection({ formData, onChange }) {
  const vitals = formData.vit || {};

  const updateVital = (field, val) => {
    onChange('vit', { ...vitals, [field]: val });
  };

  return (
    <Card title="SECTION 6 — Vitals" subtitle="Latest recorded physiological vitals (Missing fields stay blank)">
      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Input
            label="Heart Rate (bpm)"
            keyboardType="numeric"
            value={vitals.hr !== undefined && vitals.hr !== null ? String(vitals.hr) : ''}
            onChangeText={(txt) => updateVital('hr', txt ? Number(txt) : null)}
            placeholder="e.g. 88"
            maxLength={4}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Input
            label="Blood Pressure"
            value={vitals.bp || ''}
            onChangeText={(txt) => updateVital('bp', txt)}
            placeholder="e.g. 120/80"
            maxLength={15}
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Input
            label="Resp Rate (/min)"
            keyboardType="numeric"
            value={vitals.rr !== undefined && vitals.rr !== null ? String(vitals.rr) : ''}
            onChangeText={(txt) => updateVital('rr', txt ? Number(txt) : null)}
            placeholder="e.g. 18"
            maxLength={3}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Input
            label="SpO₂ (%)"
            keyboardType="numeric"
            value={vitals.spo2 !== undefined && vitals.spo2 !== null ? String(vitals.spo2) : ''}
            onChangeText={(txt) => updateVital('spo2', txt ? Number(txt) : null)}
            placeholder="e.g. 98"
            maxLength={4}
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Input
            label="Temp (°C)"
            keyboardType="numeric"
            value={vitals.temp !== undefined && vitals.temp !== null ? String(vitals.temp) : ''}
            onChangeText={(txt) => updateVital('temp', txt ? Number(txt) : null)}
            placeholder="e.g. 37.0"
            maxLength={5}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Input
            label="GCS Score (3-15)"
            keyboardType="numeric"
            value={vitals.gcs !== undefined && vitals.gcs !== null ? String(vitals.gcs) : ''}
            onChangeText={(txt) => updateVital('gcs', txt ? Number(txt) : null)}
            placeholder="e.g. 15"
            maxLength={2}
          />
        </View>
      </View>
      <Input
        label="Blood Glucose (mg/dL)"
        keyboardType="numeric"
        value={vitals.glucose !== undefined && vitals.glucose !== null ? String(vitals.glucose) : ''}
        onChangeText={(txt) => updateVital('glucose', txt ? Number(txt) : null)}
        placeholder="e.g. 110"
        maxLength={5}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  }
});
