import { z } from 'zod';
// Import from ./enums, NOT ./index — index.ts re-exports this module (`export
// * from './order'`), so importing OrderStatusSchema back from './index'
// would form a real circular ES module dependency. That throws
// "ReferenceError: Cannot access 'OrderStatusSchema' before initialization"
// at import time (confirmed empirically), because order.ts's body would run
// before index.ts's own top-level `const OrderStatusSchema = …` has executed.
import { OrderStatusSchema } from './enums';

/**
 * A bigint minor-units column as it actually arrives over apps/api's plain
 * REST responses — jsonSafe() (packages/db/src/json.ts) stringifies every
 * bigint before JSON.stringify can throw on it, so this is NOT the same
 * shape as MoneySchema (a decimal-formatted amount like "125.50"): this is
 * an integer count of minor units, e.g. "12550" for 125.50 EGP. Keeping it
 * a separate schema, rather than reusing MoneySchema, keeps the two wire
 * conventions from being silently conflated.
 */
export const MinorUnitsSchema = z.string().regex(/^-?\d+$/, 'expected an integer minor-units string');

export const OrderSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: OrderStatusSchema,
  totalAmountMinor: MinorUnitsSchema,
  currency: z.string().length(3),
  customerId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

export const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  priceMinor: MinorUnitsSchema,
  stock: z.number().int(),
});
export type Product = z.infer<typeof ProductSchema>;
