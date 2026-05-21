export { ErrorBoundary } from "expo-router";
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../../lib/api";
import { Card } from "../../../components/ui/Card";

type Product = {
  id: string;
  name: string;
  price: number;
};

export default function ProductsScreen() {
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: ["products"],
    queryFn: () => apiFetch<Product[]>("/api/products"),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>{t("common.loading")}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t("common.error")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={data || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.price}>{item.price}</Text>
          </Card>
        )}
        ListEmptyComponent={() => (
          <Text style={styles.emptyText}>{t("products.empty")}</Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    color: "red",
  },
  emptyText: {
    textAlign: "center",
    marginTop: 20,
    color: "#6b7280",
  },
  card: {
    marginBottom: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: "bold",
  },
  price: {
    fontSize: 14,
    color: "#374151",
    marginTop: 4,
  },
});
