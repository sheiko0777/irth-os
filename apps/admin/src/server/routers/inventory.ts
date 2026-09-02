import { z } from 'zod';
import { requirePermission, router } from '../trpc';
import { inventoryItems, inventoryMovements, productVariants, products, withAudit } from '@irth/db';
import { eq, and, desc, asc, lte, gt, sql, count } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

// Historical inventory rows predate warehouse attribution. A scoped employee
// must not see that whole-org aggregate just because an old row has no
// warehouse_id; they use the lot ledger introduced with warehouse scopes.
function rejectUnattributedInventoryScope(ctx: { role: string; accessPolicy: unknown; assignedWarehouseIds: string[] }) {
  if (ctx.role !== 'owner' && ctx.accessPolicy && ctx.assignedWarehouseIds.length > 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Use warehouse lots for scoped inventory access.' });
  }
}

export const inventoryRouter = router({
  list: requirePermission('inventory', 'view')
    .input(z.object({
      /**
       * `out` is stock at or below zero — unsellable right now.
       * `low` is at or below the reorder point but still sellable.
       * They are separate because they demand different actions, and the
       * sidebar alert panel deep-links straight to `out`.
       */
      stock: z.enum(['out', 'low', 'ok']).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      rejectUnattributedInventoryScope(ctx);
      const scope = eq(inventoryItems.orgId, ctx.orgId);

      const stockFilter =
        input?.stock === 'out' ? lte(inventoryItems.quantity, 0)
        : input?.stock === 'low' ? and(
            gt(inventoryItems.quantity, 0),
            lte(inventoryItems.quantity, inventoryItems.reorderPoint),
          )
        : input?.stock === 'ok' ? gt(inventoryItems.quantity, inventoryItems.reorderPoint)
        : undefined;

      const base = ctx.db
        .select({
          item: inventoryItems,
          variant: productVariants,
          product: products,
        })
        .from(inventoryItems)
        .innerJoin(productVariants, eq(inventoryItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id));

      // Counts always span the whole org, never the active filter — a tab that
      // showed its own filtered count would read zero on every other tab.
      const [items, tally] = await Promise.all([
        base
          .where(stockFilter ? and(scope, stockFilter) : scope)
          .orderBy(asc(inventoryItems.quantity)),
        ctx.db
          .select({
            out: sql<number>`count(*) filter (where ${inventoryItems.quantity} <= 0)`.mapWith(Number),
            low: sql<number>`count(*) filter (where ${inventoryItems.quantity} > 0 and ${inventoryItems.quantity} <= ${inventoryItems.reorderPoint})`.mapWith(Number),
            ok: sql<number>`count(*) filter (where ${inventoryItems.quantity} > ${inventoryItems.reorderPoint})`.mapWith(Number),
            all: count(),
          })
          .from(inventoryItems)
          .where(scope),
      ]);

      return {
        data: items,
        error: null,
        meta: {
          counts: tally[0] ?? { out: 0, low: 0, ok: 0, all: 0 },
        },
      };
    }),

  alerts: requirePermission('inventory', 'view')
    .query(async ({ ctx }) => {
      rejectUnattributedInventoryScope(ctx);
      const items = await ctx.db
        .select({
          item: inventoryItems,
          variant: productVariants,
          product: products,
        })
        .from(inventoryItems)
        .innerJoin(productVariants, eq(inventoryItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(
          and(
            eq(inventoryItems.orgId, ctx.orgId),
            lte(inventoryItems.quantity, inventoryItems.reorderPoint)
          )
        )
        .orderBy(asc(inventoryItems.quantity));

      return { data: items, error: null, meta: null };
    }),

  movements: requirePermission('inventory', 'view')
    .input(z.object({
      itemId: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      rejectUnattributedInventoryScope(ctx);
      const parsedInput = z.object({ itemId: z.string().uuid() }).parse(input);
      const movements = await ctx.db
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.orgId, ctx.orgId),
            eq(inventoryMovements.itemId, parsedInput.itemId)
          )
        )
        .orderBy(desc(inventoryMovements.createdAt))
        .limit(50);

      return { data: movements, error: null, meta: null };
    }),

  adjust: requirePermission('inventory', 'write')
    .input(z.object({
      itemId: z.string().uuid(),
      type: z.enum(['in', 'out', 'adjustment']),
      quantity: z.number().int().positive(),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      rejectUnattributedInventoryScope(ctx);
      const parsedInput = z.object({
        itemId: z.string().uuid(),
        type: z.enum(['in', 'out', 'adjustment']),
        quantity: z.number().int().positive(),
        note: z.string().optional(),
      }).parse(input);

      return await ctx.withOrg(async (tx) => {
        // Fetch item to ensure it belongs to org
        const [item] = await tx
          .select()
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.id, parsedInput.itemId),
              eq(inventoryItems.orgId, ctx.orgId)
            )
          )
          .limit(1);

        if (!item) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory item not found' });
        }

        // 'in' and 'out' are RELATIVE, so they are applied in SQL rather than
        // computed here: reading item.quantity and writing back an absolute
        // total is a lost update — two concurrent adjustments both read the
        // same starting quantity and the second silently discards the first.
        //
        // 'set' is genuinely absolute (a correction states what the quantity
        // IS), so it stays a plain value.
        const quantityUpdate =
          parsedInput.type === 'in'
            ? sql`${inventoryItems.quantity} + ${parsedInput.quantity}`
            : parsedInput.type === 'out'
              ? sql`${inventoryItems.quantity} - ${parsedInput.quantity}`
              : parsedInput.quantity;

        // Reported in the audit row and the response. For in/out this is the
        // value as of the read above; the authoritative post-write figure comes
        // back from RETURNING below.
        let newQuantity = item.quantity;
        if (parsedInput.type === 'in') {
          newQuantity += parsedInput.quantity;
        } else if (parsedInput.type === 'out') {
          newQuantity -= parsedInput.quantity;
        } else {
          newQuantity = parsedInput.quantity;
        }

        await withAudit(
            tx,
            async () => {
              const [updated] = await tx.update(inventoryItems)
                .set({ quantity: quantityUpdate, updatedAt: new Date() })
                // orgId as well as id: the read above was org-scoped, but a
                // write must be correct on its own rather than relying on an
                // earlier statement having been right.
                .where(and(
                  eq(inventoryItems.id, parsedInput.itemId),
                  eq(inventoryItems.orgId, ctx.orgId),
                ))
                .returning();
              return updated;
            },
            {
                orgId: ctx.orgId,
                userId: ctx.userId,
                action: 'inventory_adjust',
                tableName: 'inventory_items',
                changes: { from: item.quantity, to: newQuantity, type: parsedInput.type, adjustmentQty: parsedInput.quantity }
            }
        );

        await tx.insert(inventoryMovements).values({
          orgId: ctx.orgId,
          itemId: parsedInput.itemId,
          type: parsedInput.type,
          quantity: parsedInput.quantity,
          note: parsedInput.note,
        });

        return { data: { newQuantity }, error: null, meta: null };
      });
    }),
});
