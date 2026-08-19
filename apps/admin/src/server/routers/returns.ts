import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router, adminProcedure } from '../trpc';
import { db, orderReturns, returnItems, inventoryItems, inventoryMovements, orderItems, withAudit, nextDocumentNumber, formatDocumentNumber } from '@irth/db';
import { fromMinor, parseDecimal } from '@irth/domain';
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

      // Header and lines in one transaction. Separately, a failure on the
      // second insert left a return with no items — indistinguishable from a
      // genuinely empty return, and its refund total silently reads as zero.
      const createdReturn = await ctx.withOrg(async (tx) => {
        // Claimed from the tenant's counter, not counted. The old
        // `count(*) + 1` was read-then-write: at READ COMMITTED two concurrent
        // creates both saw N and both built RMA-{N+1}. The row lock inside
        // nextDocumentNumber serialises them, and because the claim shares this
        // transaction, a rollback releases the number rather than burning it.
        const returnNumber = formatDocumentNumber(
          'return',
          await nextDocumentNumber(tx, ctx.orgId, 'return'),
        );

        const [created] = await tx.insert(orderReturns).values({
          orgId: ctx.orgId,
          orderId: input.orderId,
          returnNumber,
          reason: input.reason,
          resolutionType: input.resolutionType,
          notes: input.notes,
        }).returning();

        if (input.items.length > 0) {
          const itemsToInsert = input.items.map(item => ({
            // See 0030: denormalised org_id, guarded by a composite FK against
            // the parent return so the two can never disagree.
            orgId: ctx.orgId,
            returnId: created.id,
            productName: item.productName,
            variantName: item.variantName,
            quantity: item.quantity,
            unitPriceMinor:
              item.unitPrice === undefined || item.unitPrice === null
                ? null
                : parseDecimal(String(item.unitPrice)).minor,
            condition: item.condition,
          }));
          await tx.insert(returnItems).values(itemsToInsert);
        }

        return created;
      });

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

      let resolvedAt: Date | undefined;
      if (['refunded', 'exchanged', 'rejected'].includes(input.status)) {
        resolvedAt = new Date();
      }

      // The org check is the UPDATE's own WHERE, not a SELECT before it. The
      // separate existence read added nothing — the UPDATE already carried the
      // same predicate — while giving a concurrent delete a window to land
      // between the two, and costing a round trip on every call.
      const updated = await ctx.withOrg(async (tx) => {
        const [row] = await tx.update(orderReturns)
          .set({
            status: input.status,
            adminNotes: input.adminNotes,
            refundAmountMinor:
              input.refundAmount === undefined || input.refundAmount === null
                ? null
                : parseDecimal(input.refundAmount).minor,
            resolvedAt: resolvedAt,
          })
          .where(and(eq(orderReturns.id, input.id), eq(orderReturns.orgId, ctx.orgId)))
          .returning();
        return row;
      });

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Return not found' });
      }

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
      const result = await ctx.withOrg(async (tx) => {
        await tx.update(returnItems).set({ restock: true })
          .where(and(eq(returnItems.id, input.itemId), eq(returnItems.orgId, ctx.orgId)));

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
          .where(and(eq(inventoryItems.id, invItem.id), eq(inventoryItems.orgId, ctx.orgId)));

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

      // Accumulated in minor units. The float version compounded its error on
      // every approved return, so the pending-refund figure drifted further
      // from the truth the more returns an org processed.
      let pendingRefundMinor = 0n;

      for (const r of returns) {
        if (byStatus[r.status as keyof typeof byStatus] !== undefined) {
           byStatus[r.status as keyof typeof byStatus]++;
        }
        if (r.status === 'approved' && r.refundAmountMinor !== null) {
          pendingRefundMinor += r.refundAmountMinor;
        }
      }
      const pendingRefundAmount = fromMinor(pendingRefundMinor);

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
