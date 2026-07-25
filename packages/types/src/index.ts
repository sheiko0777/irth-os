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

// Shipping Provider Enum
export const ShippingProviderSchema = z.enum([
  'bosta',
  'mylerz'
]);
export type ShippingProvider = z.infer<typeof ShippingProviderSchema>;

// Money Type (Decimal as string)
export const MoneySchema = z.string().regex(/^\d+(\.\d+)?$/);
export type Money = z.infer<typeof MoneySchema>;

// Pagination Envelope Type
export const PaginationMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

// Generic Pagination Response schema factory
export function createPaginatedSchema<ItemType extends z.ZodTypeAny>(itemSchema: ItemType) {
  return z.object({
    data: z.array(itemSchema),
    meta: PaginationMetaSchema,
  });
}
