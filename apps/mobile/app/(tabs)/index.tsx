import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const C = { ink: '#060A10', surface: '#0E1622', card: '#131E2E', raised: '#182436', border: '#1A2840', text: '#F0F6FF', muted: '#93B0D0', quiet: '#6D90B0', gold: '#E0A23A', green: '#00C478', red: '#E83838' };

function Metric({ label, value, caption, emphasis }: { label: string; value: string; caption: string; emphasis?: boolean }) {
  return <View style={[styles.metric, emphasis && styles.metricHero]}><Text style={styles.eyebrow}>{label}</Text><Text style={[styles.metricValue, emphasis && styles.metricGold]}>{value}</Text><Text style={styles.caption}>{caption}</Text></View>;
}

export default function CommandCenter() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View><Text style={styles.brand}>IRTH OS</Text><Text style={styles.title}>مركز التشغيل</Text><Text style={styles.subtitle}>كل ما يحتاج قرارًا اليوم، في مكان واحد.</Text></View>
          <Pressable accessibilityLabel="الإشعارات" style={styles.iconButton}><Ionicons name="notifications-outline" size={20} color={C.text}/><View style={styles.dot}/></Pressable>
        </View>

        <View style={styles.grid}>
          <Metric label="REVENUE" value="—" caption="إيراد اليوم" emphasis />
          <Metric label="ORDERS" value="—" caption="طلبات اليوم" />
          <Metric label="ATTENTION" value="—" caption="تحتاج متابعة" />
          <Metric label="PRODUCTS" value="—" caption="نشطة للبيع" />
        </View>

        <View style={styles.sectionHeader}><View><Text style={styles.eyebrow}>ATTENTION</Text><Text style={styles.sectionTitle}>ما يحتاج قرارًا الآن</Text></View><Ionicons name="pulse-outline" size={18} color={C.gold}/></View>
        <View style={styles.panel}>
          <Pressable style={styles.row}><View style={[styles.statusIcon, { backgroundColor: 'rgba(224,162,58,.10)' }]}><Ionicons name="receipt-outline" size={17} color={C.gold}/></View><View style={styles.rowBody}><Text style={styles.rowTitle}>طلبات تحتاج متابعة</Text><Text style={styles.rowCaption}>راجع الحالات المعلقة قبل نهاية اليوم</Text></View><Ionicons name="chevron-back" size={16} color={C.quiet}/></Pressable>
          <View style={styles.divider}/>
          <Pressable style={styles.row}><View style={[styles.statusIcon, { backgroundColor: 'rgba(232,56,56,.10)' }]}><Ionicons name="cube-outline" size={17} color={C.red}/></View><View style={styles.rowBody}><Text style={styles.rowTitle}>مخزون منخفض</Text><Text style={styles.rowCaption}>راجع المنتجات التي تقترب من النفاد</Text></View><Ionicons name="chevron-back" size={16} color={C.quiet}/></Pressable>
          <View style={styles.divider}/>
          <Pressable style={styles.row}><View style={[styles.statusIcon, { backgroundColor: 'rgba(0,196,120,.10)' }]}><Ionicons name="checkmark-circle-outline" size={17} color={C.green}/></View><View style={styles.rowBody}><Text style={styles.rowTitle}>حالة ETA</Text><Text style={styles.rowCaption}>المتابعة من مركز الفوترة الإلكترونية</Text></View><Ionicons name="chevron-back" size={16} color={C.quiet}/></Pressable>
        </View>

        <View style={styles.sectionHeader}><View><Text style={styles.eyebrow}>RECENT</Text><Text style={styles.sectionTitle}>آخر النشاط</Text></View><Pressable><Text style={styles.link}>عرض الكل</Text></Pressable></View>
        <View style={styles.empty}><Ionicons name="layers-outline" size={22} color={C.quiet}/><Text style={styles.emptyTitle}>النشاط سيظهر هنا</Text><Text style={styles.emptyText}>عند وصول الطلبات وتغيّر الحالات، ستجد آخر الأحداث في هذا المسار.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ink },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 4 },
  brand: { color: C.gold, fontSize: 11, fontWeight: '700', letterSpacing: 2.4, marginBottom: 8 },
  title: { color: C.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: C.quiet, fontSize: 13, marginTop: 6, lineHeight: 21 },
  iconButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  dot: { position: 'absolute', top: 10, right: 11, width: 5, height: 5, borderRadius: 3, backgroundColor: C.gold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 1, backgroundColor: C.border, borderWidth: 1, borderColor: C.border },
  metric: { width: '49.8%', minHeight: 126, backgroundColor: C.card, padding: 16, justifyContent: 'space-between' },
  metricHero: { backgroundColor: '#171C22' },
  eyebrow: { color: C.quiet, fontSize: 9, fontWeight: '700', letterSpacing: 1.7 },
  metricValue: { color: C.text, fontSize: 27, fontWeight: '800', marginTop: 10 },
  metricGold: { color: C.gold },
  caption: { color: C.muted, fontSize: 11, marginTop: 6 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  sectionTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 4 },
  panel: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  row: { minHeight: 82, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  rowTitle: { color: C.text, fontSize: 13, fontWeight: '700' },
  rowCaption: { color: C.quiet, fontSize: 11, marginTop: 4, lineHeight: 17 },
  divider: { height: 1, backgroundColor: C.border, marginLeft: 65 },
  link: { color: C.gold, fontSize: 11, fontWeight: '700' },
  empty: { minHeight: 150, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '700', marginTop: 10 },
  emptyText: { color: C.quiet, fontSize: 11, textAlign: 'center', lineHeight: 18, marginTop: 6 },
});
