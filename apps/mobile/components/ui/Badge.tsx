import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { OrderStatus } from '@irth/types';

// Only ever used for order status (see app/(tabs)/orders/*). Typed against
// the real OrderStatus enum from @irth/types rather than a hand-rolled union
// — the old local union had 'processing' (not a real status) and was missing
// 'confirmed'/'payment_failed', which is exactly the drift this component was
// part of.
type BadgeProps = {
  status: OrderStatus;
  label: string;
};

const statusColors: Record<OrderStatus, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#d97706' }, // amber-100, amber-600
  confirmed: { bg: '#dbeafe', text: '#2563eb' }, // blue-100, blue-600
  payment_failed: { bg: '#fee2e2', text: '#dc2626' }, // red-100, red-600
  shipped: { bg: '#e0e7ff', text: '#4f46e5' }, // indigo-100, indigo-600
  delivered: { bg: '#dcfce7', text: '#16a34a' }, // green-100, green-600
  cancelled: { bg: '#fee2e2', text: '#dc2626' }, // red-100, red-600
};

export const Badge: React.FC<BadgeProps> = ({ status, label }) => {
  const colors = statusColors[status] || statusColors.pending;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
