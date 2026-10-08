export const COLORS = {
  primary: '#0A5C8C',      // Medical Blue
  secondary: '#00897B',    // Teal
  critical: '#D32F2F',     // Critical Red
  criticalBg: '#FFEBEE',
  warning: '#F57C00',      // Orange
  warningBg: '#FFF3E0',
  success: '#2E7D32',
  successBg: '#E8F5E9',
  background: '#F4F6F8',
  card: '#FFFFFF',
  textPrimary: '#1D1D1D',
  textSecondary: '#5C6670',
  border: '#E0E6ED',
  inputBg: '#FAFAFA'
};

export const OTHER_DETAIL_CATEGORIES = [
  { label: 'Nursing Notes', value: 'NURSING' },
  { label: 'Dietary', value: 'DIETARY' },
  { label: 'Mobility', value: 'MOBILITY' },
  { label: 'Procedure', value: 'PROCEDURE' },
  { label: 'Device / Equipment', value: 'DEVICE' },
  { label: 'Family Information', value: 'FAMILY' },
  { label: 'Social Information', value: 'SOCIAL' },
  { label: 'Administrative', value: 'ADMINISTRATIVE' },
  { label: 'Follow-up', value: 'FOLLOW_UP' },
  { label: 'Special Instructions', value: 'SPECIAL_INSTRUCTIONS' },
  { label: 'Other', value: 'OTHER' }
];

export const OTHER_DETAIL_PRIORITIES = [
  { label: 'Normal', value: 'NORMAL', color: '#5C6670' },
  { label: 'Important', value: 'IMPORTANT', color: '#F57C00' },
  { label: 'Critical', value: 'CRITICAL', color: '#D32F2F' }
];

export const TRANSFER_PRIORITIES = [
  { label: 'Routine', value: 'Routine', color: '#0A5C8C' },
  { label: 'Urgent', value: 'Urgent', color: '#F57C00' },
  { label: 'Emergency', value: 'Emergency', color: '#D32F2F' }
];
