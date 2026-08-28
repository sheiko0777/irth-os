import { z } from 'zod';

// OrderStatusSchema lives in ./enums, not here — see the comment on that file
// for why: order.ts needs it too, and this barrel needing order.ts (below)
// would otherwise make a genuine circular ES module import, which throws
// "Cannot access 'OrderStatusSchema' before initialization" the moment
// anything imports this file (verified empirically; it is not a hypothetical).
export * from './enums';

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

export * from './order';
