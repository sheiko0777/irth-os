export { ErrorBoundary } from "expo-router";
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nManager } from 'react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';

// Force RTL
I18nManager.forceRTL(true);
I18nManager.allowRTL(true);

const queryClient = new QueryClient();

export default function RootLayout() {
  const { t, i18n } = useTranslation();
  const [isI18nInitialized, setIsI18nInitialized] = useState(false);

  useEffect(() => {
    if (i18n.isInitialized) {
      setIsI18nInitialized(true);
    } else {
      i18n.on('initialized', () => setIsI18nInitialized(true));
    }
  }, [i18n]);

  if (!isI18nInitialized) {
    return null; // Or a loading spinner
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </QueryClientProvider>
  );
}
