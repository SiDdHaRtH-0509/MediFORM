import React from 'react';
import { View, Text, Modal, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Button } from './Controls';
import { COLORS } from '../../constants/theme';
import { generateAIHandoverBrief } from '../../utils/clinicalDecisionSupport';

export function AIHandoverModal({ visible, onClose, formData }) {
  if (!visible) return null;

  const brief = generateAIHandoverBrief(formData || {});

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>🤖 {brief.title}</Text>
              <Text style={styles.subtitle}>{brief.timestamp}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Patient Overview */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PATIENT OVERVIEW</Text>
              <Text style={styles.text}>{brief.patientOverview}</Text>
            </View>

            {/* Triage & NEWS2 Risk */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>TRIAGE & NEWS2 RISK EVALUATION</Text>
              <View style={[styles.riskBadge, { backgroundColor: brief.triageRisk.color }]}>
                <Text style={styles.riskBadgeText}>
                  NEWS2 SCORE: {brief.triageRisk.score} — {brief.triageRisk.riskLevel} RISK
                </Text>
              </View>
              <Text style={[styles.text, { marginTop: 6 }]}>{brief.triageRisk.label}</Text>
            </View>

            {/* Critical Drug-Allergy Alerts */}
            {brief.drugAlerts.length > 0 && (
              <View style={[styles.section, styles.alertSection]}>
                <Text style={styles.alertTitle}>⚠️ CRITICAL DRUG-ALLERGY ALERTS ({brief.drugAlerts.length})</Text>
                {brief.drugAlerts.map((alt, idx) => (
                  <Text key={idx} style={styles.alertText}>• {alt.message}</Text>
                ))}
              </View>
            )}

            {/* Chief Complaint & Handoff Bullets */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>EXECUTIVE CLINICAL SUMMARY</Text>
              <Text style={[styles.text, { fontWeight: '700', marginBottom: 6 }]}>
                Chief Complaint: {brief.chiefComplaint}
              </Text>
              {brief.summaryBullets.map((bullet, idx) => (
                <Text key={idx} style={styles.bulletText}>• {bullet}</Text>
              ))}
            </View>

            {/* Recommended Actions */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>RECOMMENDED ACTION ITEMS FOR RECEIVING UNIT</Text>
              {brief.recommendedActions.map((action, idx) => (
                <View key={idx} style={styles.actionRow}>
                  <Text style={styles.actionNum}>{idx + 1}.</Text>
                  <Text style={styles.actionText}>{action}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button title="Close Handover Brief" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 12,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primary,
  },
  subtitle: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  closeText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  body: {
    flex: 1,
  },
  section: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  text: {
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  riskBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  riskBadgeText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  alertSection: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#991B1B',
    marginBottom: 4,
  },
  alertText: {
    fontSize: 12,
    color: '#B91C1C',
    marginTop: 2,
  },
  bulletText: {
    fontSize: 13,
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  actionNum: {
    fontWeight: '800',
    color: COLORS.primary,
    marginRight: 6,
  },
  actionText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 12,
    marginTop: 8,
  },
});
