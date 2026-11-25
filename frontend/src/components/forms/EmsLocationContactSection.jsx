import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import * as Location from 'expo-location';
import { Card, Input, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { MapPin, Phone, Truck, Navigation } from 'lucide-react-native';

const DISPATCH_STATUSES = [
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'EN_ROUTE', label: 'En Route' },
  { value: 'CRITICAL_DIVERT', label: 'Critical Divert' }
];

export function EmsLocationContactSection({ formData, onChange }) {
  const [locating, setLocating] = useState(false);
  const [locMsg, setLocMsg] = useState(null);

  const ems = formData.emsDispatch || {};
  const currentLocation = ems.currentLocation || {};

  const updateEms = (patch) => {
    onChange('emsDispatch', { ...ems, ...patch });
  };

  const updateLocationField = (field, value) => {
    updateEms({
      currentLocation: {
        ...currentLocation,
        [field]: value,
        updatedAt: new Date().toISOString()
      }
    });
  };

  const handleCaptureGps = async () => {
    setLocating(true);
    setLocMsg(null);
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const { latitude, longitude, accuracy, speed } = pos.coords;
              updateEms({
                currentLocation: {
                  ...currentLocation,
                  lat: Number(latitude.toFixed(6)),
                  lng: Number(longitude.toFixed(6)),
                  accuracyMeters: accuracy ? Math.round(accuracy) : null,
                  speedKmh: speed ? Math.round(speed * 3.6) : (currentLocation.speedKmh || 0),
                  address: currentLocation.address || `GPS Fix (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
                  updatedAt: new Date().toISOString()
                }
              });
              setLocMsg(`Live GPS locked: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
              resolve();
            },
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 10000 }
          );
        });
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLocMsg('Location permission denied. You can enter landmark or coordinates manually.');
          setLocating(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude, accuracy, speed } = pos.coords;
        let resolvedAddress = currentLocation.address || '';
        try {
          const rev = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (rev && rev[0]) {
            const r = rev[0];
            resolvedAddress = [r.name, r.street, r.city, r.region].filter(Boolean).join(', ');
          }
        } catch (e) {
          // Reverse geocoding optional
        }
        updateEms({
          currentLocation: {
            ...currentLocation,
            lat: Number(latitude.toFixed(6)),
            lng: Number(longitude.toFixed(6)),
            accuracyMeters: accuracy ? Math.round(accuracy) : null,
            speedKmh: speed ? Math.round(speed * 3.6) : (currentLocation.speedKmh || 0),
            address: resolvedAddress || `GPS (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
            updatedAt: new Date().toISOString()
          }
        });
        setLocMsg(`Live GPS locked: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      }
    } catch (err) {
      setLocMsg('Could not acquire GPS fix automatically. Enter landmark/address below.');
    } finally {
      setLocating(false);
    }
  };

  return (
    <Card
      title="SECTION 03 // LIVE LOCATION, AMBULANCE & DIRECT CONTACT"
      subtitle="GPS tracking, dispatch status & direct Call / Emergency SMS contacts for receiving doctors"
      style={styles.folioCard}
      headerRight={<Badge label="GPS + EMS" variant="info" />}
    >
      {/* Dispatch Status Pills */}
      <Text style={styles.fieldLabel}>Ambulance / Transit Status</Text>
      <View style={styles.chipRow}>
        {DISPATCH_STATUSES.map((st) => {
          const selected = (ems.dispatchStatus || 'PREPARING') === st.value;
          const isCrit = st.value === 'CRITICAL_DIVERT';
          return (
            <TouchableOpacity
              key={st.value}
              onPress={() => updateEms({ dispatchStatus: st.value })}
              style={[
                styles.statusChip,
                selected && { backgroundColor: isCrit ? COLORS.critical : COLORS.primary, borderColor: isCrit ? COLORS.critical : COLORS.primary }
              ]}
            >
              <Text style={[styles.chipText, selected && { color: '#FFF' }]}>{st.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* GPS Capture Banner */}
      <View style={styles.gpsBanner}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
            <MapPin size={15} color={COLORS.primary} style={{ marginRight: 5 }} />
            <Text style={styles.gpsTitle}>Patient / Ambulance Live GPS</Text>
          </View>
          <Text style={styles.gpsSub}>
            {currentLocation.lat != null && currentLocation.lng != null
              ? `Locked: ${currentLocation.lat}, ${currentLocation.lng}${currentLocation.accuracyMeters ? ` (±${currentLocation.accuracyMeters}m)` : ''}`
              : 'Tap to capture real-time GPS coordinates from this device'}
          </Text>
        </View>
        <Button
          title={locating ? 'Locating...' : 'Capture GPS'}
          onPress={handleCaptureGps}
          disabled={locating}
          variant="secondary"
          size="small"
          icon={<Navigation size={14} color="#FFF" />}
        />
      </View>

      {locMsg && (
        <Text style={styles.locFeedback}>{locMsg}</Text>
      )}

      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Input
            label="Latitude"
            keyboardType="numeric"
            value={currentLocation.lat !== undefined && currentLocation.lat !== null ? String(currentLocation.lat) : ''}
            onChangeText={(txt) => updateLocationField('lat', txt ? txt.replace(/[^0-9.-]/g, '') : null)}
            placeholder="e.g. 28.6139"
          />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Input
            label="Longitude"
            keyboardType="numeric"
            value={currentLocation.lng !== undefined && currentLocation.lng !== null ? String(currentLocation.lng) : ''}
            onChangeText={(txt) => updateLocationField('lng', txt ? txt.replace(/[^0-9.-]/g, '') : null)}
            placeholder="e.g. 77.2090"
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={{ flex: 2, marginRight: 6 }}>
          <Input
            label="Current Location / Road Landmark"
            value={currentLocation.address || ''}
            onChangeText={(txt) => updateLocationField('address', txt)}
            placeholder="e.g. NH-48 Toll Plaza, Sector 42"
            maxLength={200}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Input
            label="Est. ETA (mins)"
            keyboardType="numeric"
            value={ems.etaMinutes !== undefined && ems.etaMinutes !== null ? String(ems.etaMinutes) : ''}
            onChangeText={(txt) => updateEms({ etaMinutes: txt ? Number(txt.replace(/[^0-9]/g, '')) : null })}
            placeholder="e.g. 14"
            maxLength={3}
          />
        </View>
      </View>

      {/* Ambulance & Hospital Direct Contact Numbers */}
      <View style={styles.contactSectionBox}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Truck size={16} color={COLORS.primary} style={{ marginRight: 6 }} />
          <Text style={styles.contactBoxTitle}>DIRECT AMBULANCE & HOSPITAL CALL / SMS CHANNELS</Text>
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 6 }}>
            <Input
              label="Ambulance Unit / Vehicle ID"
              value={ems.ambulanceId || ''}
              onChangeText={(txt) => updateEms({ ambulanceId: txt })}
              placeholder="e.g. AMB-108-A"
              maxLength={40}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Input
              label="Paramedic / Crew Lead"
              value={ems.ambulanceCrewName || ''}
              onChangeText={(txt) => updateEms({ ambulanceCrewName: txt })}
              placeholder="e.g. EMT R. Kumar"
              maxLength={80}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 6 }}>
            <Input
              label="Ambulance Direct Phone (Call / SMS)"
              keyboardType="phone-pad"
              value={ems.ambulancePhone || ''}
              onChangeText={(txt) => updateEms({ ambulancePhone: txt })}
              placeholder="e.g. +919876543210"
              maxLength={25}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Input
              label="Referring Hospital Desk Phone"
              keyboardType="phone-pad"
              value={ems.referringHospitalPhone || ''}
              onChangeText={(txt) => updateEms({ referringHospitalPhone: txt })}
              placeholder="e.g. +911126590000"
              maxLength={25}
            />
          </View>
        </View>

        <Input
          label="Receiving Hospital ER Desk Phone (optional)"
          keyboardType="phone-pad"
          value={ems.receivingHospitalPhone || ''}
          onChangeText={(txt) => updateEms({ receivingHospitalPhone: txt })}
          placeholder="e.g. +911126591111"
          maxLength={25}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  folioCard: {
    borderTopWidth: 3,
    borderTopColor: COLORS.secondary,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  statusChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: '#F8FAFC',
    marginRight: 8,
    marginBottom: 6,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  gpsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  gpsTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.primary,
  },
  gpsSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  locFeedback: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
  },
  contactSectionBox: {
    marginTop: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 12,
  },
  contactBoxTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.6,
  }
});
