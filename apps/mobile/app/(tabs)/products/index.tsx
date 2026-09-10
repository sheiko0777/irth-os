export { ErrorBoundary } from "expo-router";
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TextInput, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { z } from 'zod';
import { ProductSchema } from '@irth/types';
import { formatMoney, fromMinor, EGP } from '@irth/domain';
import { apiFetchWithMeta } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { LoadingView } from '../../../components/ui/LoadingView';
import { ErrorView } from '../../../components/ui/ErrorView';

const PAGE_SIZE = 20;
const productsPageSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

type ProductsPage = {
  data: z.infer<typeof ProductSchema>[];
  meta: z.infer<typeof productsPageSchema>;
};

export default function ProductsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const queryKey = ['products', debouncedSearchQuery] as const;
  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => apiFetchWithMeta(
      `/api/products?page=${pageParam}&limit=${PAGE_SIZE}&q=${encodeURIComponent(debouncedSearchQuery)}`,
      z.array(ProductSchema),
      productsPageSchema,
    ),
    getNextPageParam: (lastPage) => {
      const loadedCount = lastPage.meta.page * lastPage.meta.limit;
      return loadedCount < lastPage.meta.total ? lastPage.meta.page + 1 : undefined;
    },
  });

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    queryClient.setQueryData<InfiniteData<ProductsPage>>(queryKey, (current) => current && ({
      pages: current.pages.slice(0, 1),
      pageParams: current.pageParams.slice(0, 1),
    }));
    refetch().finally(() => setRefreshing(false));
  }, [queryClient, queryKey, refetch]);

  const products = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data]);

  if (isLoading) {
    return <LoadingView />;
  }

  if (error) {
    return <ErrorView />;
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
        data={products}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.detailText}>
              {t('products.price')}: {formatMoney(fromMinor(BigInt(item.priceMinor), EGP))}
            </Text>
            {item.stock !== undefined && (
              <Text style={styles.detailText}>{t('products.stock')}: {item.stock}</Text>
            )}
          </Card>
        )}
        ListEmptyComponent={() => (
          <Text style={styles.emptyText}>{t('products.empty')}</Text>
        )}
        ListFooterComponent={isFetchingNextPage ? (
          <ActivityIndicator style={styles.loadingFooter} />
        ) : null}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
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
  loadingFooter: {
    marginVertical: 12,
  },
});
