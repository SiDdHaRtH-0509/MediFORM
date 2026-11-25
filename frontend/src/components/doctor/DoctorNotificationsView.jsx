import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Card, Button, Badge } from '../ui/Controls';
import { COLORS } from '../../constants/theme';
import { api } from '../../services/api';
import { Bell, CheckCheck, AlertTriangle, RefreshCw, ArrowUpRight } from 'lucide-react-native';

export function DoctorNotificationsView({ onOpenHandoffUuid, onUnreadChanged }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadNotifications = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = filter === 'unread' ? 'isRead=false' : '';
      const res = await api.getNotifications(params);
      setNotifications(res.notifications || []);
      const count = res.totalUnread ?? (res.notifications || []).filter(n => !n.isRead).length;
      setUnreadCount(count);
      if (onUnreadChanged) onUnreadChanged(count);
    } catch (err) {
      setError(err.message || 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [filter]);

  const handleMarkRead = async (id) => {
    try {
      await api.markNotificationAsRead(id);
      loadNotifications();
    } catch (e) {}
  };

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsAsRead();
      loadNotifications();
    } catch (e) {}
  };

  const extractHandoffUuid = (text) => {
    if (!text) return null;
    const match = text.match(/\/handoff\/([0-9a-fA-F-]{8,})/);
    return match ? match[1] : null;
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Bell size={20} color={COLORS.primary} />
          <View>
            <Text style={styles.title}>EMERGENCY ALERTS & NOTIFICATIONS</Text>
            <Text style={styles.sub}>Real-time handoff dispatches, critical patient vitals & SMS logs</Text>
          </View>
        </View>
        <Badge label={`${unreadCount} UNREAD`} variant={unreadCount > 0 ? 'critical' : 'success'} />
      </View>

      <View style={styles.actionBar}>
        <View style={styles.filterRow}>
          <TouchableOpacity
            onPress={() => setFilter('all')}
            style={[styles.filterPill, filter === 'all' && styles.filterActive]}
          >
            <Text style={[styles.filterText, filter === 'all' && { color: '#FFF' }]}>All Alerts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFilter('unread')}
            style={[styles.filterPill, filter === 'unread' && styles.filterActive]}
          >
            <Text style={[styles.filterText, filter === 'unread' && { color: '#FFF' }]}>Unread Only</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Refresh" onPress={loadNotifications} variant="outline" size="small" icon={<RefreshCw size={12} color={COLORS.primary} />} />
          {unreadCount > 0 && (
            <Button title="Mark All Read" onPress={handleMarkAllRead} variant="secondary" size="small" icon={<CheckCheck size={12} color="#FFF" />} />
          )}
        </View>
      </View>

      {loading && <Text style={styles.infoText}>Syncing emergency notifications...</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {!loading && notifications.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
          <Bell size={28} color={COLORS.textSecondary} style={{ marginBottom: 8 }} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.textPrimary }}>All Caught Up</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4 }}>
            Incoming hospital QR dispatches and critical EMS alerts will appear here immediately.
          </Text>
        </Card>
      )}

      {notifications.map((n) => {
        const handoffUuid = extractHandoffUuid(n.message);
        const isCritical = n.isEssential || n.category === 'EMERGENCY_TRANSFER' || n.category === 'MONITORING_ALERT';
        return (
          <Card
            key={n._id || n.notificationId}
            style={[
              styles.notifCard,
              !n.isRead && styles.unreadCard,
              isCritical && { borderLeftWidth: 4, borderLeftColor: COLORS.critical }
            ]}
          >
            <View style={styles.notifHeader}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.notifTitle}>{n.title}</Text>
                <Text style={styles.notifTime}>
                  {n.createdAt ? new Date(n.createdAt).toLocaleString() : 'Just now'}
                </Text>
              </View>
              <Badge
                label={n.isRead ? 'READ' : 'NEW'}
                variant={n.isRead ? 'neutral' : (isCritical ? 'critical' : 'info')}
              />
            </View>

            <Text style={styles.notifMessage}>{n.message}</Text>

            <View style={styles.notifFooter}>
              {handoffUuid && onOpenHandoffUuid && (
                <Button
                  title="Open Transfer Folio"
                  onPress={() => onOpenHandoffUuid(handoffUuid)}
                  variant="primary"
                  size="small"
                  icon={<ArrowUpRight size={13} color="#FFF" />}
                />
              )}
              {!n.isRead && (
                <Button
                  title="Mark Read"
                  onPress={() => handleMarkRead(n._id || n.notificationId)}
                  variant="outline"
                  size="small"
                />
              )}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxWidth: 780,
    alignSelf: 'center',
    width: '100%',
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '900',
    color: COLORS.primary,
  },
  sub: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  actionBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#FFF',
  },
  filterActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  infoText: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    marginVertical: 16,
  },
  errorText: {
    textAlign: 'center',
    color: COLORS.critical,
    marginVertical: 10,
  },
  notifCard: {
    marginBottom: 10,
  },
  unreadCard: {
    backgroundColor: '#F8FAFC',
    borderColor: COLORS.primary,
  },
  notifHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  notifTime: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  notifMessage: {
    fontSize: 13,
    color: COLORS.textPrimary,
    lineHeight: 19,
    marginBottom: 10,
  },
  notifFooter: {
    flexDirection: 'row',
    gap: 8,
  }
});
