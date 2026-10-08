import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../../constants/theme';

export function Button({ title, onPress, variant = 'primary', size = 'medium', disabled = false, icon = null, style = {} }) {
  const bgColors = {
    primary: COLORS.primary,
    secondary: COLORS.secondary,
    critical: COLORS.critical,
    outline: 'transparent',
    ghost: 'transparent'
  };

  const textColors = {
    primary: '#FFF',
    secondary: '#FFF',
    critical: '#FFF',
    outline: COLORS.primary,
    ghost: COLORS.textPrimary
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        { backgroundColor: bgColors[variant] || COLORS.primary },
        variant === 'outline' && { borderWidth: 1.5, borderColor: COLORS.primary },
        disabled && styles.disabled,
        style
      ]}
      activeOpacity={0.7}
    >
      <View style={styles.buttonContent}>
        {icon && <View style={{ marginRight: 6 }}>{icon}</View>}
        <Text style={[styles.buttonText, { color: textColors[variant] || '#FFF' }]}>{title}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function Card({ children, title, subtitle, style, headerRight }) {
  return (
    <View style={[styles.card, style]}>
      {(title || subtitle || headerRight) && (
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            {title && <Text style={styles.cardTitle}>{title}</Text>}
            {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
          </View>
          {headerRight}
        </View>
      )}
      {children}
    </View>
  );
}

export function Input({ label, value, onChangeText, placeholder, multiline, numberOfLines, maxLength, counterText, error, required, keyboardType, secureTextEntry, style }) {
  return (
    <View style={[styles.inputContainer, style]}>
      {label && (
        <View style={styles.labelRow}>
          <Text style={styles.label}>
            {label} {required && <Text style={{ color: COLORS.critical }}>*</Text>}
          </Text>
          {counterText && <Text style={styles.counterText}>{counterText}</Text>}
        </View>
      )}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        numberOfLines={numberOfLines}
        maxLength={maxLength}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        style={[
          styles.input,
          multiline && { height: numberOfLines ? numberOfLines * 24 + 16 : 80, textAlignVertical: 'top' },
          error && { borderColor: COLORS.critical }
        ]}
        placeholderTextColor="#9AA5B1"
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

export function Badge({ label, variant = 'info', style }) {
  const stylesMap = {
    critical: { bg: COLORS.criticalBg, color: COLORS.critical },
    warning: { bg: COLORS.warningBg, color: COLORS.warning },
    success: { bg: COLORS.successBg, color: COLORS.success },
    info: { bg: '#E3F2FD', color: COLORS.primary },
    neutral: { bg: '#ECEFF1', color: COLORS.textSecondary }
  };

  const current = stylesMap[variant] || stylesMap.info;

  return (
    <View style={[styles.badge, { backgroundColor: current.bg }, style]}>
      <Text style={[styles.badgeText, { color: current.color }]}>{label}</Text>
    </View>
  );
}

export function AlertCard({ type = 'critical', title, message }) {
  const isCrit = type === 'critical';
  return (
    <View style={[styles.alertCard, { backgroundColor: isCrit ? COLORS.criticalBg : COLORS.warningBg, borderColor: isCrit ? COLORS.critical : COLORS.warning }]}>
      <Text style={[styles.alertTitle, { color: isCrit ? COLORS.critical : COLORS.warning }]}>
        {isCrit ? '⚠️ CRITICAL ALERT' : '⚡ IMPORTANT NOTICE'}
      </Text>
      {title && <Text style={styles.alertSubTitle}>{title}</Text>}
      <Text style={styles.alertMessage}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 1,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    boxShadow: '0px 2px 8px rgba(0,0,0,0.05)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F4F8',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  cardSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  inputContainer: {
    marginBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  counterText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  errorText: {
    color: COLORS.critical,
    fontSize: 12,
    marginTop: 4,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  alertCard: {
    borderLeftWidth: 5,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  alertSubTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  alertMessage: {
    fontSize: 14,
    color: COLORS.textPrimary,
    lineHeight: 20,
  }
});
