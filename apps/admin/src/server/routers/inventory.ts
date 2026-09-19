import { z } from 'zod';
import { router, requirePermission } from '../trpc';
import { inventoryItems, inventoryMovements, productVariants, products, withAudit } from '@irth/db';
import { eq, and, desc, asc, lte, gt, sql, count, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

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

  lookupByBarcode: requirePermission('inventory', 'view')
    .input(z.object({
      code: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      let raw = input.code.trim();
      if (raw.toLowerCase().startsWith('irth:sku:')) {
        raw = raw.slice(9);
      } else if (raw.toLowerCase().startsWith('sku:')) {
        raw = raw.slice(4);
      }

      // 1. Try finding in productVariants first
      const variantRows = await ctx.db
        .select({
          variant: productVariants,
          product: products,
          item: inventoryItems,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .leftJoin(inventoryItems, and(
          eq(inventoryItems.variantId, productVariants.id),
          eq(inventoryItems.orgId, ctx.orgId)
        ))
        .where(
          and(
            eq(products.orgId, ctx.orgId),
            eq(productVariants.sku, raw)
          )
        )
        .limit(1);

      if (variantRows.length > 0) {
        const row = variantRows[0];
        return {
          found: true,
          item: {
            inventoryItemId: row.item?.id ?? null,
            variantId: row.variant.id,
            productId: row.product.id,
            productName: row.product.name,
            productNameAr: row.product.nameAr,
            variantName: row.variant.name,
            sku: row.variant.sku,
            quantity: row.item?.quantity ?? 0,
            reorderPoint: row.item?.reorderPoint ?? 10,
            priceMinor: row.variant.priceMinor ?? row.product.priceMinor,
          },
        };
      }

      // 2. Try finding in products
      const productRows = await ctx.db
        .select({
          product: products,
          variant: productVariants,
          item: inventoryItems,
        })
        .from(products)
        .leftJoin(productVariants, eq(productVariants.productId, products.id))
        .leftJoin(inventoryItems, and(
          eq(inventoryItems.variantId, productVariants.id),
          eq(inventoryItems.orgId, ctx.orgId)
        ))
        .where(
          and(
            eq(products.orgId, ctx.orgId),
            eq(products.sku, raw)
          )
        )
        .limit(1);

      if (productRows.length > 0) {
        const row = productRows[0];
        return {
          found: true,
          item: {
            inventoryItemId: row.item?.id ?? null,
            variantId: row.variant?.id ?? null,
            productId: row.product.id,
            productName: row.product.name,
            productNameAr: row.product.nameAr,
            variantName: row.variant?.name ?? 'الأساسي',
            sku: row.product.sku,
            quantity: row.item?.quantity ?? row.product.stock ?? 0,
            reorderPoint: row.item?.reorderPoint ?? 10,
            priceMinor: row.product.priceMinor,
          },
        };
      }

      return { found: false, item: null };
    }),

  batchAdjust: requirePermission('inventory', 'write')
    .input(z.object({
      type: z.enum(['in', 'out', 'adjustment']),
      items: z.array(z.object({
        itemId: z.string().uuid(),
        quantity: z.number().int().positive(),
      })).min(1),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.withOrg(async (tx) => {
        const itemIds = input.items.map((i) => i.itemId);
        const existingItems = await tx
          .select()
          .from(inventoryItems)
          .where(
            and(
              inArray(inventoryItems.id, itemIds),
              eq(inventoryItems.orgId, ctx.orgId)
            )
          );

        const existingMap = new Map(existingItems.map((i) => [i.id, i]));
        const adjustedItems: Array<{ id: string; oldQuantity: number; newQuantity: number }> = [];

        for (const line of input.items) {
          const item = existingMap.get(line.itemId);
          if (!item) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `العنصر ${line.itemId} غير موجود في المخزون`,
            });
          }

          const quantityUpdate =
            input.type === 'in'
              ? sql`${inventoryItems.quantity} + ${line.quantity}`
              : input.type === 'out'
                ? sql`${inventoryItems.quantity} - ${line.quantity}`
                : line.quantity;

          let newQuantity = item.quantity;
          if (input.type === 'in') newQuantity += line.quantity;
          else if (input.type === 'out') newQuantity -= line.quantity;
          else newQuantity = line.quantity;

          await tx
            .update(inventoryItems)
            .set({ quantity: quantityUpdate, updatedAt: new Date() })
            .where(
              and(
                eq(inventoryItems.id, line.itemId),
                eq(inventoryItems.orgId, ctx.orgId)
              )
            );

          await tx.insert(inventoryMovements).values({
            orgId: ctx.orgId,
            itemId: line.itemId,
            type: input.type,
            quantity: line.quantity,
            note: input.note ?? `مسح باركود دفعة: ${input.type}`,
          });

          adjustedItems.push({ id: line.itemId, oldQuantity: item.quantity, newQuantity });
        }

        await withAudit(
          tx,
          async () => adjustedItems,
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'inventory_batch_adjust',
            tableName: 'inventory_items',
            changes: { type: input.type, count: input.items.length, items: adjustedItems },
          }
        );

        return { data: { success: true, count: adjustedItems.length }, error: null };
      });
    }),
});
