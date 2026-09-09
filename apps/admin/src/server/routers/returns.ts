import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router, adminProcedure } from '../trpc';
import { db, orderReturns, returnItems, inventoryItems, inventoryMovements, orderItems, orders, products, productVariants, withAudit, nextDocumentNumber, formatDocumentNumber, postJournalEntry, ACCOUNT_CODES, type JournalLineInput } from '@irth/db';
import { EGYPT_VAT_BP, add, assertSupportedCurrency, fromMinor, multiply, netOfTax, parseDecimal, taxIncludedIn } from '@irth/domain';
import { eq, and, count, sum, sql, desc, isNull } from 'drizzle-orm';

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
        orderItemId: z.string().uuid(),
        quantity: z.number().int().min(1),
        condition: z.enum(['new', 'good', 'damaged', 'unknown']).optional()
      })),
      // A retried create (timeout, double-tap) has nothing else to key off
      // of — unlike restock/updateStatus below, which already guard against
      // concurrent processing of one EXISTING return via an atomic claim,
      // this would otherwise create a second, entirely separate return row
      // for the same customer intent.
      idempotencyKey: z.string().min(1).max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('returns.create', input.idempotencyKey, input, async () => {
      if (!ctx.orgId) throw new Error('Unauthorized');

      // Header and lines in one transaction. Separately, a failure on the
      // second insert left a return with no items — indistinguishable from a
      // genuinely empty return, and its refund total silently reads as zero.
      const createdReturn = await ctx.withOrg(async (tx) => {
        const quantities = new Map<string, number>();
        for (const item of input.items) {
          quantities.set(item.orderItemId, (quantities.get(item.orderItemId) ?? 0) + item.quantity);
        }
        const lines = new Map<string, { productName: string; variantName: string; unitPriceMinor: bigint }>();
        // Stable lock order avoids deadlocks across overlapping multi-line requests.
        // Hold each sold line until commit; sum only AFTER acquiring its lock.
        for (const orderItemId of [...quantities.keys()].sort()) {
          const [line] = await tx.select({
            id: orderItems.id, quantity: orderItems.quantity,
            unitPriceMinor: orderItems.priceMinor,
            productName: products.name, variantName: productVariants.name,
          }).from(orderItems)
            .innerJoin(orders, and(eq(orders.id, orderItems.orderId), eq(orders.orgId, ctx.orgId)))
            .innerJoin(productVariants, and(eq(productVariants.id, orderItems.variantId), eq(productVariants.orgId, ctx.orgId)))
            .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.orgId, ctx.orgId)))
            .where(and(eq(orderItems.id, orderItemId), eq(orderItems.orderId, input.orderId), eq(orderItems.orgId, ctx.orgId)))
            .for('update', { of: orderItems });
          if (!line) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order item not found in this order' });
          const [prior] = await tx.select({ quantity: sum(returnItems.quantity) }).from(returnItems)
            .where(and(eq(returnItems.orderItemId, orderItemId), eq(returnItems.orgId, ctx.orgId)));
          if (Number(prior?.quantity ?? 0) + quantities.get(orderItemId)! > line.quantity) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Returned quantity exceeds ordered quantity' });
          }
          lines.set(orderItemId, { productName: line.productName, variantName: line.variantName, unitPriceMinor: line.unitPriceMinor });
        }
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
            orderItemId: item.orderItemId,
            ...lines.get(item.orderItemId)!,
            quantity: item.quantity,
            condition: item.condition,
          }));
          await tx.insert(returnItems).values(itemsToInsert);
        }

        return created;
      });

      return { data: createdReturn, error: null, meta: null };
    })),

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

      const refundAmountMinor =
        input.refundAmount === undefined || input.refundAmount === null
          ? null
          : parseDecimal(input.refundAmount).minor;

      const setValues = {
        status: input.status,
        adminNotes: input.adminNotes,
        resolvedAt,
      };

      const updated = await ctx.withOrg(async (tx) => {
        let row;
        let isGenuineTransition = false;
        // 0030/F06: the order's real currency, not a hardcoded EGP — needed
        // whether or not this call turns out to be a genuine transition,
        // since it's used both for the bound check below and the posting
        // further down.
        let returnCurrency: ReturnType<typeof assertSupportedCurrency> | undefined;
        if (input.status === 'refunded' && refundAmountMinor !== null) {
          const [target] = await tx.select({ orderId: orderReturns.orderId }).from(orderReturns)
            .where(and(eq(orderReturns.id, input.id), eq(orderReturns.orgId, ctx.orgId)));
          if (!target) return null;

          // Lock siblings in stable order before claiming any return, so
          // concurrent partial refunds see committed posted amounts. Siblings
          // of one order share that order's currency, so summing their
          // already-posted amounts under the current return's currency is safe.
          const siblings = await tx.select({
            id: orderReturns.id, refundPostedAt: orderReturns.refundPostedAt,
            refundAmountMinor: orderReturns.refundAmountMinor,
            totalAmountMinor: orders.totalAmountMinor, orderCurrency: orders.currency,
          }).from(orderReturns)
            .innerJoin(orders, and(eq(orders.id, orderReturns.orderId), eq(orders.orgId, ctx.orgId)))
            .where(and(eq(orderReturns.orderId, target.orderId), eq(orderReturns.orgId, ctx.orgId)))
            .orderBy(orderReturns.id)
            .for('update', { of: orderReturns });
          const current = siblings.find(sibling => sibling.id === input.id);
          if (!current) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Return is not linked to a valid order' });
          returnCurrency = assertSupportedCurrency(current.orderCurrency);
          // Retries do not consume the remaining allowance again.
          if (current.refundPostedAt === null) {
            const total = siblings.filter(sibling => sibling.refundPostedAt !== null)
              .reduce((amount, sibling) => add(amount, fromMinor(sibling.refundAmountMinor ?? 0n, returnCurrency!)),
                fromMinor(refundAmountMinor, returnCurrency));
            // Order price is the ceiling; provider capture tracking does not
            // exist yet. Negative refunds must never create extra headroom.
            if (refundAmountMinor <= 0n || total.minor > current.totalAmountMinor) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'Refund amount is invalid or exceeds the order total' });
            }
          }
          // Like restock, the atomic claim guards all ledger side effects.
          // Its durable marker is independent of the editable current status.
          [row] = await tx.update(orderReturns)
            .set({ ...setValues, refundAmountMinor, refundPostedAt: sql`now()` })
            .where(and(eq(orderReturns.id, input.id), eq(orderReturns.orgId, ctx.orgId),
              isNull(orderReturns.refundPostedAt)))
            .returning();
          isGenuineTransition = !!row;
        }
        if (!row) {
          // The return's notes are still legitimately editable after it is
          // refunded. Retries and status round-trips must preserve the posted
          // amount and its durable marker.
          [row] = await tx.update(orderReturns)
            .set(setValues)
            .where(and(eq(orderReturns.id, input.id), eq(orderReturns.orgId, ctx.orgId)))
            .returning();
        }

        if (!row) return null;

        // Reverses the original sale's revenue and VAT. Only the revenue side
        // — restocking (a SEPARATE mutation, `restock` below) is what returns
        // the physical stock and reverses COGS/Inventory; this status change
        // and that action are independent today, so a refund with no restock
        // reverses revenue but not cost, and a restock with no refund status
        // change reverses cost but not revenue. Documented rather than
        // silently assumed to be linked.
        //
        // Modelled as a liability (Customer Refunds Payable) rather than a
        // direct cash credit: nothing in this codebase tracks HOW a refund is
        // actually paid out, so recognising the obligation without assuming a
        // specific cash movement is the accurate entry — a future cash
        // disbursement would debit this same liability to clear it.
        if (isGenuineTransition && input.status === 'refunded' && refundAmountMinor !== null && refundAmountMinor > 0n) {
          const gross = fromMinor(refundAmountMinor, returnCurrency!);
          const vat = taxIncludedIn(gross, EGYPT_VAT_BP);
          const net = netOfTax(gross, EGYPT_VAT_BP);

          const lines: JournalLineInput[] = [
            { accountCode: ACCOUNT_CODES.SALES_RETURNS, currency: returnCurrency!, debitMinor: net.minor },
            { accountCode: ACCOUNT_CODES.VAT_PAYABLE, currency: returnCurrency!, debitMinor: vat.minor, memo: 'Reduces VAT payable — the sale is unwinding' },
            { accountCode: ACCOUNT_CODES.CUSTOMER_REFUNDS_PAYABLE, currency: returnCurrency!, creditMinor: gross.minor },
          ];

          await postJournalEntry(tx, {
            orgId: ctx.orgId,
            journalType: 'sales',
            description: `Return refunded — ${row.returnNumber}`,
            sourceTable: 'order_returns',
            sourceId: row.id,
            createdBy: ctx.userId,
            lines,
          });
        }

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

      const result = await ctx.withOrg(async (tx) => {
        const [returnObj] = await tx.select().from(orderReturns)
          .where(and(eq(orderReturns.id, input.returnId), eq(orderReturns.orgId, ctx.orgId))).limit(1);
        if (!returnObj) throw new Error('Not found');
        const [existing] = await tx.select().from(returnItems)
          .where(and(eq(returnItems.id, input.itemId), eq(returnItems.orgId, ctx.orgId), eq(returnItems.returnId, input.returnId)));
        if (!existing) throw new Error('Item not found');

        if (!existing.orderItemId) {
          return { restocked: false, reason: 'no_order_item_link' as const };
        }

        const [orderItem] = await tx.select().from(orderItems)
          .where(and(eq(orderItems.id, existing.orderItemId), eq(orderItems.orgId, ctx.orgId), eq(orderItems.orderId, returnObj.orderId))).limit(1);
        if (!orderItem?.variantId) {
          return { restocked: false, reason: 'no_variant' as const };
        }

        const [orderObj] = await tx.select({ currency: orders.currency }).from(orders)
          .where(and(eq(orders.id, returnObj.orderId), eq(orders.orgId, ctx.orgId))).limit(1);
        if (!orderObj) throw new Error('Order not found');

        const returnCurrency = assertSupportedCurrency(orderObj.currency);

        const [invItem] = await tx.select().from(inventoryItems)
          .where(and(eq(inventoryItems.orgId, ctx.orgId), eq(inventoryItems.variantId, orderItem.variantId)))
          .limit(1);
        if (!invItem) {
          return { restocked: false, reason: 'no_inventory_item' as const };
        }

        // Validate all links before claiming so failures remain retryable.
        // The conditional UPDATE serializes retries before any stock or ledger effects.
        const [item] = await tx.update(returnItems).set({ restock: true })
          .where(and(eq(returnItems.id, input.itemId), eq(returnItems.orgId, ctx.orgId),
            eq(returnItems.returnId, input.returnId), eq(returnItems.restock, false)))
          .returning();
        if (!item) return { restocked: false, alreadyRestocked: true };

        // NULL is an unknown cost basis; zero has no financial amount to reverse.
        if (orderItem.costMinor !== null && orderItem.costMinor > 0n) {
          const cost = multiply(fromMinor(orderItem.costMinor, returnCurrency), item.quantity);
          await postJournalEntry(tx, {
            orgId: ctx.orgId, journalType: 'sales',
            description: `Return restocked - ${returnObj.returnNumber}`,
            sourceTable: 'return_items', sourceId: item.id, createdBy: ctx.userId,
            lines: [
              { accountCode: ACCOUNT_CODES.INVENTORY, currency: returnCurrency, debitMinor: cost.minor },
              { accountCode: ACCOUNT_CODES.COGS, currency: returnCurrency, creditMinor: cost.minor },
            ],
          });
        }

        const saleable = item.condition === 'new' || item.condition === 'good';
        if (saleable) await tx.update(inventoryItems)
          .set({ quantity: sql`${inventoryItems.quantity} + ${item.quantity}`, updatedAt: new Date() })
          .where(and(eq(inventoryItems.id, invItem.id), eq(inventoryItems.orgId, ctx.orgId)));

        // Ledger row, matching inventory.adjust and purchasing.receive — a
        // stock change that isn't in the movements table is invisible to audit.
        await tx.insert(inventoryMovements).values({
          orgId: ctx.orgId,
          itemId: invItem.id,
          type: saleable ? 'in' : 'adjustment',
          quantity: item.quantity,
          note: saleable ? `Return restock ${input.returnId}`
            : `Return restock ${input.returnId} - condition: ${item.condition ?? 'unknown'}, held out of saleable stock, no quarantine location configured`,
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
