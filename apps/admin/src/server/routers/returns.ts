import { z } from 'zod';
import { protectedProcedure, router, adminProcedure } from '../trpc';
import { db, orderReturns, returnItems, inventoryItems, inventoryMovements, orderItems, withAudit } from '@irth/db';
import { eq, and, count, sum, sql, desc } from 'drizzle-orm';

export const returnsRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(['requested', 'approved', 'rejected', 'received', 'restocked', 'refunded', 'exchanged']).optional(),
      orderId: z.string().optional(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(10),
    }))
    .query(async ({ ctx, input }) => {
      if (!ctx.orgId) throw new Error('Unauthorized');

      const conditions = [eq(orderReturns.orgId, ctx.orgId)];
      if (input.status) {
        conditions.push(eq(orderReturns.status, input.status));
      }
      if (input.orderId) {
        conditions.push(eq(orderReturns.orderId, input.orderId));
      }

      const offset = (input.page - 1) * input.pageSize;

      // Execute list and count queries concurrently to reduce latency
      const [data, totalResult] = await Promise.all([
        db.query.orderReturns.findMany({
          where: and(...conditions),
          orderBy: [desc(orderReturns.createdAt)],
          limit: input.pageSize,
          offset,
        }),
        db
          .select({ count: count() })
          .from(orderReturns)
          .where(and(...conditions))
      ]);

      const total = totalResult[0].count;

      return {
        data,
        error: null,
        meta: {
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.orgId) throw new Error('Unauthorized');

      const returnObj = await db.query.orderReturns.findFirst({
        where: and(eq(orderReturns.id, input.id), eq(orderReturns.orgId, ctx.orgId)),
        with: {
          returnItems: true, // Assuming relation exists, else manual fetch
        }
      });

      const items = returnObj
        ? await db.select().from(returnItems).where(eq(returnItems.returnId, returnObj.id))
        : [];

      const data = returnObj ? { ...returnObj, items } : null;

      return { data, error: null, meta: null };
    }),

  create: adminProcedure
    .input(z.object({
      orderId: z.string(),
      reason: z.enum(['damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other']),
      resolutionType: z.enum(['refund', 'exchange', 'store_credit', 'none']).default('none'),
      notes: z.string().optional(),
      items: z.array(z.object({
        productName: z.string(),
        variantName: z.string().optional(),
        quantity: z.number().min(1),
        unitPrice: z.string().optional(),
        condition: z.enum(['new', 'good', 'damaged', 'unknown']).optional()
      }))
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.orgId) throw new Error('Unauthorized');

      const [{ count: currentCount }] = await db
        .select({ count: count() })
        .from(orderReturns)
        .where(eq(orderReturns.orgId, ctx.orgId));

      const nextNumber = currentCount + 1;
      const returnNumber = `RMA-${String(nextNumber).padStart(4, '0')}`;

      const [createdReturn] = await db.insert(orderReturns).values({
        orgId: ctx.orgId,
        orderId: input.orderId,
        returnNumber,
        reason: input.reason,
        resolutionType: input.resolutionType,
        notes: input.notes,
      }).returning();

      if (input.items.length > 0) {
        const itemsToInsert = input.items.map(item => ({
          returnId: createdReturn.id,
          productName: item.productName,
          variantName: item.variantName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          condition: item.condition,
        }));
        await db.insert(returnItems).values(itemsToInsert);
      }

      return { data: createdReturn, error: null, meta: null };
    }),

  updateStatus: adminProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(['requested', 'approved', 'rejected', 'received', 'restocked', 'refunded', 'exchanged']),
      adminNotes: z.string().optional(),
      refundAmount: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.orgId) throw new Error('Unauthorized');

      // Ensure org scoped
      const existing = await db.select().from(orderReturns).where(and(eq(orderReturns.id, input.id), eq(orderReturns.orgId, ctx.orgId))).limit(1);
      if (existing.length === 0) {
        throw new Error('Not found');
      }

      let resolvedAt: Date | undefined;
      if (['refunded', 'exchanged', 'rejected'].includes(input.status)) {
        resolvedAt = new Date();
      }

      const [updated] = await db.update(orderReturns)
        .set({
          status: input.status,
          adminNotes: input.adminNotes,
          refundAmount: input.refundAmount,
          resolvedAt: resolvedAt,
        })
        .where(and(eq(orderReturns.id, input.id), eq(orderReturns.orgId, ctx.orgId)))
        .returning();

      return { data: updated, error: null, meta: null };
    }),

  restock: adminProcedure
    .input(z.object({
      returnId: z.string(),
      itemId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.orgId) throw new Error('Unauthorized');

      const returnObj = await db.select().from(orderReturns).where(and(eq(orderReturns.id, input.returnId), eq(orderReturns.orgId, ctx.orgId))).limit(1);
      if (returnObj.length === 0) {
        throw new Error('Not found');
      }

      const [item] = await db.select().from(returnItems).where(eq(returnItems.id, input.itemId));
      if (!item || item.returnId !== input.returnId) {
        throw new Error('Item not found');
      }

      // Idempotency guard: restocking is additive, so a second call would
      // invent stock that never came back. The `restock` flag is the record
      // of "this item's units already went back on the shelf".
      if (item.restock) {
        return { data: { restocked: false, alreadyRestocked: true }, error: null, meta: null };
      }

      // Return lines only carry product/variant NAMES, so inventory can only be
      // resolved through orderItemId -> orderItems.variantId. Without that link
      // there is no variant to credit: flag the line and write nothing, rather
      // than guessing at a match by name.
      const result = await db.transaction(async (tx) => {
        await tx.update(returnItems).set({ restock: true }).where(eq(returnItems.id, input.itemId));

        if (!item.orderItemId) {
          return { restocked: false, reason: 'no_order_item_link' as const };
        }

        const [orderItem] = await tx.select().from(orderItems)
          .where(eq(orderItems.id, item.orderItemId)).limit(1);
        if (!orderItem?.variantId) {
          return { restocked: false, reason: 'no_variant' as const };
        }

        const [invItem] = await tx.select().from(inventoryItems)
          .where(and(eq(inventoryItems.orgId, ctx.orgId), eq(inventoryItems.variantId, orderItem.variantId)))
          .limit(1);
        if (!invItem) {
          return { restocked: false, reason: 'no_inventory_item' as const };
        }

        await tx.update(inventoryItems)
          .set({ quantity: sql`${inventoryItems.quantity} + ${item.quantity}`, updatedAt: new Date() })
          .where(eq(inventoryItems.id, invItem.id));

        // Ledger row, matching inventory.adjust and purchasing.receive — a
        // stock change that isn't in the movements table is invisible to audit.
        await tx.insert(inventoryMovements).values({
          orgId: ctx.orgId,
          itemId: invItem.id,
          type: 'in',
          quantity: item.quantity,
          note: `Return restock ${input.returnId}`,
        });

        await withAudit(
          tx,
          async () => ({ id: invItem.id }),
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'RESTOCK_RETURN_ITEM',
            tableName: 'inventory_items',
            changes: { returnId: input.returnId, itemId: input.itemId, quantity: item.quantity },
          }
        );

        return { restocked: true, reason: null };
      });

      return { data: result, error: null, meta: null };
    }),

  summary: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.orgId) throw new Error('Unauthorized');

      const returns = await db.select().from(orderReturns).where(eq(orderReturns.orgId, ctx.orgId));

      const total = returns.length;
      const byStatus = {
        requested: 0,
        approved: 0,
        rejected: 0,
        received: 0,
        restocked: 0,
        refunded: 0,
        exchanged: 0,
      };

      let pendingRefundAmount = 0;

      for (const r of returns) {
        if (byStatus[r.status as keyof typeof byStatus] !== undefined) {
           byStatus[r.status as keyof typeof byStatus]++;
        }
        if (r.status === 'approved' && r.refundAmount) {
          pendingRefundAmount += parseFloat(r.refundAmount);
        }
      }

      return {
        data: {
          total,
          byStatus,
          pendingRefundAmount
        },
        error: null,
        meta: null
      };
    })
});
