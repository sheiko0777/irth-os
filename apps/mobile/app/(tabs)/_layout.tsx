export { ErrorBoundary } from "expo-router";
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

const INK = '#060A10';
const GOLD = '#E0A23A';
const MUTED = '#7F8DA1';
const BORDER = '#1C2838';

export default function TabLayout() {
  const { t } = useTranslation();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: GOLD,
      tabBarInactiveTintColor: MUTED,
      tabBarStyle: { backgroundColor: INK, borderTopColor: BORDER, height: 78, paddingTop: 8, paddingBottom: 10 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      sceneStyle: { backgroundColor: INK },
    }}>
      <Tabs.Screen name="index" options={{ title: 'الرئيسية', tabBarLabel: 'الرئيسية', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="orders" options={{ title: t('tabs.orders'), headerTitle: t('tabs.orders'), tabBarLabel: t('tabs.orders'), tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="products" options={{ title: t('tabs.products'), headerTitle: t('tabs.products'), tabBarLabel: t('tabs.products'), tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
