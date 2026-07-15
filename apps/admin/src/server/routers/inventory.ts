import { z } from 'zod';
import { protectedProcedure, router, adminProcedure } from '../trpc';
import { inventoryItems, inventoryMovements, productVariants, products, withAudit } from '@irth/db';
import { eq, and, desc, asc, lte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const inventoryRouter = router({
  list: protectedProcedure
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
        .where(eq(inventoryItems.orgId, ctx.orgId))
        .orderBy(asc(inventoryItems.quantity));

      return { data: items, error: null, meta: null };
    }),

  alerts: protectedProcedure
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

  movements: protectedProcedure
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

  adjust: adminProcedure
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

      return await ctx.db.transaction(async (tx) => {
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
                .set({ quantity: newQuantity, updatedAt: new Date() })
                .where(eq(inventoryItems.id, parsedInput.itemId))
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
