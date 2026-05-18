export { ErrorBoundary } from "expo-router";
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

type OrderDetails = {
  id: string;
  displayId: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  total: number;
  date: string;
};

export default function OrderDetailsScreen() {
  const { id } = useLocalSearchParams();
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: () => apiFetch<OrderDetails>(`/api/orders/${id}`),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>{t('common.loading')}</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t('common.error')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Card>
        <View style={styles.header}>
          <Text style={styles.title}>{t('orders.details')}</Text>
          <Badge status={data.status} label={t(`status.${data.status}`, data.status)} />
        </View>
        <View style={styles.details}>
          <Text style={styles.label}>ID: <Text style={styles.value}>{data.displayId}</Text></Text>
          <Text style={styles.label}>{t('orders.total')}: <Text style={styles.value}>{data.total}</Text></Text>
          <Text style={styles.label}>Date: <Text style={styles.value}>{new Date(data.date).toLocaleDateString()}</Text></Text>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f3f4f6',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: 'red',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  details: {
    gap: 8,
  },
  label: {
    fontSize: 16,
    color: '#6b7280',
  },
  value: {
    color: '#111827',
    fontWeight: '500',
  },
});
