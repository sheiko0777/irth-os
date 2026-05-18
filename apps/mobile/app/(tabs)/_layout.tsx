export { ErrorBoundary } from "expo-router";
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function TabLayout() {
  const { t } = useTranslation();

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: 'blue' }}>
      <Tabs.Screen
        name="orders"
        options={{
          title: t('tabs.orders'),
          headerTitle: t('tabs.orders'),
          tabBarLabel: t('tabs.orders'),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: t('tabs.products'),
          headerTitle: t('tabs.products'),
          tabBarLabel: t('tabs.products'),
        }}
      />
    </Tabs>
  );
}
