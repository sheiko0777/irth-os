import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type BadgeProps = {
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  label: string;
};

const statusColors = {
  pending: { bg: '#fef3c7', text: '#d97706' }, // amber-100, amber-600
  processing: { bg: '#dbeafe', text: '#2563eb' }, // blue-100, blue-600
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
