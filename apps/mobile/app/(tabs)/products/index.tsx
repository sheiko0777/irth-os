export { ErrorBoundary } from "expo-router";
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TextInput, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';

type Product = {
  id: string;
  name: string;
  price: number;
  stock: number;
};

export default function ProductsScreen() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['products'],
    queryFn: () => apiFetch<Product[]>('/api/products'),
  });

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    refetch().finally(() => setRefreshing(false));
  }, [refetch]);

  const filteredData = useMemo(() => {
    if (!data) return [];
    if (!searchQuery) return data;
    return data.filter(product => product.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [data, searchQuery]);

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
      <TextInput
        style={styles.searchInput}
        placeholder={t('products.searchPlaceholder')}
        value={searchQuery}
        onChangeText={setSearchQuery}
        textAlign="right"
      />
      <FlatList
        data={filteredData}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.detailText}>{t('products.price')}: {item.price}</Text>
            {item.stock !== undefined && (
              <Text style={styles.detailText}>{t('products.stock')}: {item.stock}</Text>
            )}
          </Card>
        )}
        ListEmptyComponent={() => (
          <Text style={styles.emptyText}>{t('products.empty')}</Text>
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
  searchInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontFamily: 'Cairo',
    textAlign: 'right',
  },
  name: {
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
