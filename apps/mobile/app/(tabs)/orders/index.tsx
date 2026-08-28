export { ErrorBoundary } from "expo-router";
import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { z } from 'zod';
import { OrderSchema, type Order } from '@irth/types';
import { currency, formatMoney, fromMinor } from '@irth/domain';
import { apiFetch } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

export default function OrdersScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['orders'],
    queryFn: () => apiFetch('/api/orders', z.array(OrderSchema)),
  });

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    refetch().finally(() => setRefreshing(false));
  }, [refetch]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>{t('common.loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t('common.error')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={data || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }: { item: Order }) => (
          <TouchableOpacity onPress={() => router.push(`/(tabs)/orders/${item.id}`)}>
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.orderId}>{item.orderNumber}</Text>
                <Badge status={item.status} label={t(`status.${item.status}`, item.status)} />
              </View>
              <Text style={styles.detailText}>
                {t('orders.total')}: {formatMoney(fromMinor(BigInt(item.totalAmountMinor), currency(item.currency)))}
              </Text>
              {item.createdAt && (
                <Text style={styles.detailText}>{t('orders.createdAt')}: {format(new Date(item.createdAt), 'PP', { locale: ar })}</Text>
              )}
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <Text style={styles.emptyText}>{t('orders.empty')}</Text>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: 'red',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 20,
    color: '#6b7280',
  },
  card: {
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderId: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'Cairo',
  },
  detailText: {
    fontSize: 14,
    color: '#374151',
    marginTop: 4,
    fontFamily: 'Cairo',
    textAlign: 'auto', 
  },
});
