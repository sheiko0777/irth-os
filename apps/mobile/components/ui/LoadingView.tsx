import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

/**
 * Full-screen centred spinner + "loading" label. The identical block was
 * copied into orders/index, orders/[id] and products/index — see Phase I of
 * the anti-koshary Pass 2 plan.
 */
export const LoadingView: React.FC = () => {
  const { t } = useTranslation();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text>{t('common.loading')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
