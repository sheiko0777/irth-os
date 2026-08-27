export { ErrorBoundary } from "expo-router";
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

const C = { ink: '#11100F', ivory: '#F4F0E8', gold: '#B79A68', muted: '#8F8A80', border: '#302C27' };

export default function TabLayout() {
  const { t } = useTranslation();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: C.gold,
      tabBarInactiveTintColor: C.muted,
      tabBarStyle: { backgroundColor: C.ink, borderTopColor: C.border, height: 78, paddingTop: 8, paddingBottom: 10 },
      tabBarLabelStyle: { fontFamily: 'Cairo', fontSize: 11, fontWeight: '600' },
      sceneStyle: { backgroundColor: C.ink },
    }}>
      <Tabs.Screen name="index" options={{ title: 'الرئيسية', tabBarLabel: 'الرئيسية', tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="orders" options={{ title: t('tabs.orders'), headerTitle: t('tabs.orders'), tabBarLabel: t('tabs.orders'), tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="products" options={{ title: t('tabs.products'), headerTitle: t('tabs.products'), tabBarLabel: t('tabs.products'), tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
