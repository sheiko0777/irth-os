export { ErrorBoundary } from "expo-router";
import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../../lib/api';

type Order = {
  id: string;
  displayId: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  total: number;
  createdAt: string;
};

const C = { ink: '#11100F', surface: '#181614', text: '#F4F0E8', muted: '#AAA399', quiet: '#756F66', gold: '#B79A68', border: '#302C27' };

function StatusMark({ status }: { status: Order['status'] }) {
  const active = status === 'delivered' || status === 'shipped';
  return <View style={[styles.statusMark, active && styles.statusMarkActive]}><Ionicons name={active ? 'checkmark' : 'ellipse-outline'} size={14} color={active ? C.ink : C.muted} /></View>;
}

export default function OrdersScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['orders'], queryFn: () => apiFetch<Order[]>('/api/orders') });

  const onRefresh = React.useCallback(() => { setRefreshing(true); refetch().finally(() => setRefreshing(false)); }, [refetch]);

  if (isLoading) return <View style={styles.center}><ActivityIndicator color={C.gold} /><Text style={styles.mutedText}>{t('common.loading')}</Text></View>;
  if (error) return <View style={styles.center}><Ionicons name="alert-circle-outline" size={28} color={C.gold} /><Text style={styles.errorText}>{t('common.error')}</Text></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={data || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.gold} />}
        ListHeaderComponent={<View style={styles.header}><Text style={styles.eyebrow}>COMMERCE</Text><Text style={styles.title}>الطلبات</Text><Text style={styles.subtitle}>مسار الطلبات من الإنشاء حتى التسليم.</Text></View>}
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [styles.order, pressed && styles.pressed]} onPress={() => router.push(`/(tabs)/orders/${item.id}`)} accessibilityRole="button">
            <StatusMark status={item.status} />
            <View style={styles.body}>
              <View style={styles.topLine}><Text style={styles.orderId}>{item.displayId}</Text><Text style={styles.status}>{t(`status.${item.status}`, item.status)}</Text></View>
              <View style={styles.meta}><Text style={styles.total}>{item.total}</Text><Text style={styles.date}>{format(new Date(item.createdAt), 'dd MMM yyyy', { locale: ar })}</Text></View>
            </View>
            <Ionicons name="chevron-back" size={16} color={C.quiet} />
          </Pressable>
        )}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="layers-outline" size={24} color={C.quiet} /><Text style={styles.emptyTitle}>{t('orders.empty')}</Text><Text style={styles.emptyText}>ستظهر الطلبات هنا عند وصولها.</Text></View>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.ink },
  list: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36 },
  header: { paddingBottom: 22 },
  eyebrow: { color: C.gold, fontSize: 9, fontWeight: '700', letterSpacing: 1.8, marginBottom: 7 },
  title: { color: C.text, fontFamily: 'Cairo', fontSize: 30, fontWeight: '800' },
  subtitle: { color: C.quiet, fontFamily: 'Cairo', fontSize: 12, lineHeight: 20, marginTop: 5 },
  order: { minHeight: 82, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 15, gap: 12 },
  pressed: { opacity: 0.72 },
  statusMark: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  statusMarkActive: { backgroundColor: C.gold, borderColor: C.gold },
  body: { flex: 1 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderId: { color: C.text, fontFamily: 'Cairo', fontSize: 14, fontWeight: '700' },
  status: { color: C.muted, fontFamily: 'Cairo', fontSize: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 },
  total: { color: C.text, fontSize: 12, fontWeight: '700' },
  date: { color: C.quiet, fontFamily: 'Cairo', fontSize: 10 },
  center: { flex: 1, backgroundColor: C.ink, justifyContent: 'center', alignItems: 'center', gap: 10 },
  mutedText: { color: C.muted, fontFamily: 'Cairo', fontSize: 12 },
  errorText: { color: C.muted, fontFamily: 'Cairo', fontSize: 12 },
  empty: { minHeight: 190, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, padding: 24 },
  emptyTitle: { color: C.text, fontFamily: 'Cairo', fontSize: 14, fontWeight: '700', marginTop: 10 },
  emptyText: { color: C.quiet, fontFamily: 'Cairo', fontSize: 11, marginTop: 5 },
});
