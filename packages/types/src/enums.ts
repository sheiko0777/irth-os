import { z } from 'zod';

// Order Status Enum
export const OrderStatusSchema = z.enum([
  'pending',
  'confirmed',
  'payment_failed',
  'shipped',
  'delivered',
  'cancelled'
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
