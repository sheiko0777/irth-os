export { ErrorBoundary } from "expo-router";
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../../lib/api';

const C = { ink: '#060A10', surface: '#0E1622', card: '#131E2E', border: '#1C2838', text: '#F0F6FF', muted: '#93A5BB', quiet: '#6D8198', gold: '#E0A23A', green: '#00C478', red: '#E83838' };

type OrderDetails = { id: string; displayId: string; status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'; total: number; date: string; customer?: { name?: string; phone?: string }; items?: Array<{ name: string; quantity: number; total?: number }>; eta?: { status?: string; uuid?: string; longId?: string } };

const statusLabel = (status: OrderDetails['status']) => ({ pending: 'قيد الانتظار', processing: 'قيد التجهيز', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغى' })[status];

export default function OrderDetailsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({ queryKey: ['order', id], queryFn: () => apiFetch<OrderDetails>(`/api/orders/${id}`) });

  if (isLoading) return <View style={styles.center}><ActivityIndicator color={C.gold} /><Text style={styles.centerText}>{t('common.loading')}</Text></View>;
  if (error || !data) return <View style={styles.center}><Ionicons name="alert-circle-outline" size={28} color={C.red} /><Text style={styles.centerText}>{t('common.error')}</Text></View>;

  const timeline = ['pending', 'processing', 'shipped', 'delivered'];
  const current = timeline.indexOf(data.status);

  return <View style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}>
        <Pressable accessibilityLabel="رجوع" onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-forward" size={20} color={C.text} /></Pressable>
        <View style={styles.topTitle}><Text style={styles.eyebrow}>ORDER</Text><Text style={styles.title}>{data.displayId}</Text></View>
        <View style={[styles.status, data.status === 'delivered' ? styles.success : data.status === 'cancelled' ? styles.danger : styles.pending]}><Text style={styles.statusText}>{statusLabel(data.status)}</Text></View>
      </View>

      <View style={styles.hero}><Text style={styles.eyebrow}>TOTAL</Text><Text style={styles.total}>{data.total.toLocaleString('ar-EG')} <Text style={styles.currency}>ج.م</Text></Text><Text style={styles.date}>{new Date(data.date).toLocaleDateString('ar-EG')}</Text></View>

      <Section title="العميل"><View><Text style={styles.value}>{data.customer?.name || '—'}</Text><Text style={styles.caption}>{data.customer?.phone || '—'}</Text></View></Section>

      <Section title="المنتجات">{data.items?.length ? data.items.map((item, i) => <View key={`${item.name}-${i}`} style={[styles.item, i > 0 && styles.itemBorder]}><View style={styles.itemIcon}><Ionicons name="cube-outline" size={16} color={C.gold} /></View><View style={styles.itemBody}><Text style={styles.value}>{item.name}</Text><Text style={styles.caption}>الكمية × {item.quantity}</Text></View><Text style={styles.itemTotal}>{item.total != null ? `${item.total.toLocaleString('ar-EG')} ج.م` : '—'}</Text></View>) : <Text style={styles.caption}>لا توجد تفاصيل منتجات متاحة.</Text>}</Section>

      <Section title="مسار الطلب"><View style={styles.timeline}>{timeline.map((step, i) => { const done = current >= i; const last = i === timeline.length - 1; return <View key={step} style={styles.timelineRow}><View style={styles.track}><View style={[styles.node, done && styles.nodeDone]}>{done && <Ionicons name="checkmark" size={10} color={C.ink} />}</View>{!last && <View style={[styles.line, current > i && styles.lineDone]} />}</View><View style={styles.timelineBody}><Text style={[styles.value, !done && styles.dim]}>{statusLabel(step as OrderDetails['status'])}</Text></View></View>})}</View></Section>

      <Section title="الفاتورة الإلكترونية"><View style={styles.etaRow}><View style={styles.etaIcon}><Ionicons name="document-text-outline" size={18} color={C.gold} /></View><View style={styles.itemBody}><Text style={styles.value}>{data.eta?.status || 'في انتظار الإرسال'}</Text><Text style={styles.caption}>{data.eta?.uuid || data.eta?.longId || 'سيظهر رقم الفاتورة عند الإرسال'}</Text></View><Ionicons name="chevron-back" size={16} color={C.quiet} /></View></Section>
    </ScrollView>
  </View>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.section}><Text style={styles.eyebrow}>{title}</Text><View style={styles.sectionBody}>{children}</View></View>; }

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: C.ink }, content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 44, gap: 18 }, topbar: { flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 44, height: 44, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, topTitle: { flex: 1 }, eyebrow: { color: C.quiet, fontSize: 9, fontWeight: '700', letterSpacing: 1.5 }, title: { color: C.text, fontSize: 21, fontWeight: '800', marginTop: 2 }, status: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 }, pending: { backgroundColor: 'rgba(224,162,58,.12)' }, success: { backgroundColor: 'rgba(0,196,120,.12)' }, danger: { backgroundColor: 'rgba(232,56,56,.12)' }, statusText: { color: C.text, fontSize: 10, fontWeight: '700' }, hero: { paddingVertical: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }, total: { color: C.gold, fontSize: 34, fontWeight: '800', marginTop: 8 }, currency: { fontSize: 13, fontWeight: '600' }, date: { color: C.quiet, fontSize: 11, marginTop: 4 }, section: { gap: 9 }, sectionBody: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, padding: 15 }, value: { color: C.text, fontSize: 13, fontWeight: '700' }, caption: { color: C.quiet, fontSize: 11, marginTop: 4, lineHeight: 17 }, item: { flexDirection: 'row', alignItems: 'center', minHeight: 54 }, itemBorder: { borderTopWidth: 1, borderTopColor: C.border }, itemIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(224,162,58,.10)', alignItems: 'center', justifyContent: 'center', marginRight: 10 }, itemBody: { flex: 1 }, itemTotal: { color: C.text, fontSize: 11, fontWeight: '700' }, timeline: { paddingVertical: 2 }, timelineRow: { flexDirection: 'row', minHeight: 47 }, track: { width: 22, alignItems: 'center' }, node: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: C.quiet, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card }, nodeDone: { backgroundColor: C.gold, borderColor: C.gold }, line: { flex: 1, width: 1, backgroundColor: C.border }, lineDone: { backgroundColor: C.gold }, timelineBody: { flex: 1, paddingTop: 0, paddingLeft: 8 }, dim: { color: C.quiet }, etaRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center' }, etaIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(224,162,58,.10)', alignItems: 'center', justifyContent: 'center', marginRight: 11 }, center: { flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', gap: 10 }, centerText: { color: C.muted, fontSize: 12 } });
