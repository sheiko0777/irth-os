import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  ACCOUNT_CODES, MAX_IDEMPOTENCY_KEY_LENGTH, canAccess, deliveryAttempts, emitOutboxEvent, orderItems, orders, postJournalEntry,
  postOrderDeliveredEntry, productVariants, repCashCollections, repCashHandovers, transitionOrderStatus, withAudit, type DbTx,
} from '@irth/db';
import { assertSupportedCurrency, parseDecimal } from '@irth/domain';
import { router, requirePermission, type Context } from '../trpc';

/**
 * The delivery rep's own screen (PR-2a): the orders assigned to them, what to
 * collect, and the day's handover. Every query is limited to the caller's
 * member id here AND by 0077's policies inside ctx.withOrg — holding
 * deliveries.* never shows anyone else's orders.
 *
 * Money (CLAUDE.md rules 1, 2, 5): amounts are decimal strings parsed once
 * into minor units in the order's currency; every posting goes through
 * postJournalEntry in the same transaction as the state it records; the
 * money-moving mutations take an idempotency key, and a collection is also
 * UNIQUE per order so a second key cannot collect it twice.
 */

const amountInput = z.string().trim().max(20).regex(/^\d+(\.\d{1,2})?$/, 'اكتب المبلغ بالأرقام');
const keyInput = z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH);
const OPEN_STATUSES = ['confirmed', 'shipped'] as const;

type Ctx = Pick<Context, 'access' | 'orgId'>;

function me(ctx: Ctx): string {
  // Not a permission question: the permission was already checked. An access
  // with no membership row (system work) has no book of its own to act on.
  if (!ctx.access.memberId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No membership to act as.' });
  return ctx.access.memberId;
}

/** Cash the rep must collect for an order: its total, unless it was paid online. */
function codDue(order: { paymentMethod: 'cod' | 'online' | null; totalAmountMinor: bigint }): bigint {
  return order.paymentMethod === 'online' ? 0n : order.totalAmountMinor;
}

const orderFields = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  status: orders.status,
  paymentMethod: orders.paymentMethod,
  totalAmountMinor: orders.totalAmountMinor,
  currency: orders.currency,
  buyer: orders.buyer,
  shippingAddress: orders.shippingAddress,
  customerNote: orders.customerNote,
  createdAt: orders.createdAt,
};

/** Locks one of the caller's own orders for the rest of the transaction. */
async function lockMyOrder(tx: DbTx, ctx: Ctx, orderId: string) {
  const [order] = await tx.select(orderFields).from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, ctx.orgId), eq(orders.assignedRepMemberId, me(ctx))))
    .for('update');
  if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'الطلب مش مسند ليك.' });
  return order;
}

async function recordAttempt(
  tx: DbTx, ctx: Pick<Context, 'access' | 'orgId' | 'userId'>, orderId: string,
  outcome: 'delivered' | 'failed' | 'returned', reason: string | null,
) {
  const [row] = await tx.insert(deliveryAttempts).values({ orgId: ctx.orgId, orderId, memberId: me(ctx), outcome, reason })
    .returning({ id: deliveryAttempts.id });
  return row;
}

export const deliveriesRouter = router({
  /** Orders assigned to me and still out for delivery. */
  today: requirePermission('deliveries', 'view')
    .query(async ({ ctx }) => {
      const rows = await ctx.withOrg((tx) => tx.select(orderFields).from(orders)
        .where(and(
          eq(orders.orgId, ctx.orgId),
          eq(orders.assignedRepMemberId, me(ctx)),
          inArray(orders.status, [...OPEN_STATUSES]),
          eq(orders.importStatus, 'complete'),
        ))
        .orderBy(asc(orders.createdAt))
        .limit(200));
      return { data: rows.map((o) => ({ ...o, codDueMinor: codDue(o) })), error: null, meta: null };
    }),

  get: requirePermission('deliveries', 'view')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.withOrg(async (tx) => {
        const [order] = await tx.select(orderFields).from(orders)
          .where(and(eq(orders.id, input.id), eq(orders.orgId, ctx.orgId), eq(orders.assignedRepMemberId, me(ctx))));
        if (!order) return null;
        const items = await tx.select({
          id: orderItems.id, quantity: orderItems.quantity, priceMinor: orderItems.priceMinor,
          sku: productVariants.sku, name: productVariants.name,
        })
          .from(orderItems)
          .innerJoin(productVariants, and(eq(productVariants.id, orderItems.variantId), eq(productVariants.orgId, ctx.orgId)))
          .where(and(eq(orderItems.orderId, order.id), eq(orderItems.orgId, ctx.orgId)));
        const attempts = await tx.select().from(deliveryAttempts)
          .where(and(eq(deliveryAttempts.orgId, ctx.orgId), eq(deliveryAttempts.orderId, order.id), eq(deliveryAttempts.memberId, me(ctx))))
          .orderBy(desc(deliveryAttempts.createdAt));
        const [collection] = await tx.select().from(repCashCollections)
          .where(and(eq(repCashCollections.orgId, ctx.orgId), eq(repCashCollections.orderId, order.id)));
        return { order: { ...order, codDueMinor: codDue(order) }, items, attempts, collection: collection ?? null };
      });
      if (!result) throw new TRPCError({ code: 'NOT_FOUND' });
      return { data: result, error: null, meta: null };
    }),

  /**
   * Delivered — and, for a cash order, the cash collected — in one
   * transaction: the status change, the sale's revenue entry, the ETA
   * invoice, the collection row, the custody entry (Dr 1060 / Cr 1030), the
   * attempt and the audit row all land together or not at all.
   */
  markDelivered: requirePermission('deliveries', 'update')
    .input(z.object({ orderId: z.string().uuid(), collected: amountInput.optional(), idempotencyKey: keyInput }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('deliveries.markDelivered', input.idempotencyKey, input, async () => {
        const result = await ctx.withOrg(async (tx) => {
          const order = await lockMyOrder(tx, ctx, input.orderId);
          const due = codDue(order);
          const orderCurrency = assertSupportedCurrency(order.currency);
          let collectedMinor = 0n;
          if (due > 0n) {
            // Cash is collected here or the order is not delivered here: a
            // partial or different amount goes to the office, not the ledger.
            if (!canAccess(ctx.access, 'deliveries', 'collect')) {
              throw new TRPCError({ code: 'FORBIDDEN', message: 'مالكش صلاحية تحصيل الدفع عند الاستلام.' });
            }
            if (input.collected === undefined) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'اكتب المبلغ اللي حصّلته.' });
            }
            collectedMinor = parseDecimal(input.collected, orderCurrency).minor;
            if (collectedMinor !== due) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'المبلغ المحصّل لازم يساوي قيمة الطلب. لو العميل دفع مبلغ مختلف، سجّل فشل التسليم وكلّم المكتب.' });
            }
          }

          const transition = await transitionOrderStatus(tx, {
            orgId: ctx.orgId, orderId: order.id, newStatus: 'delivered', onlyIfPreviousStatusIn: [...OPEN_STATUSES],
          });
          if (!transition) throw new TRPCError({ code: 'CONFLICT', message: 'الطلب مش في حالة توصيل.' });

          return withAudit(tx, async () => {
            await emitOutboxEvent(tx, { orgId: ctx.orgId, eventType: 'eta.invoice.issue', payload: { orgId: ctx.orgId, orderId: order.id } });
            await postOrderDeliveredEntry(tx, {
              orgId: ctx.orgId, order, previousStatus: transition.previousStatus, newStatus: 'delivered', createdBy: ctx.userId,
            });
            if (collectedMinor > 0n) {
              const [collection] = await tx.insert(repCashCollections).values({
                orgId: ctx.orgId, memberId: me(ctx), orderId: order.id, amountMinor: collectedMinor, currency: orderCurrency,
              }).returning({ id: repCashCollections.id });
              await postJournalEntry(tx, {
                orgId: ctx.orgId,
                journalType: 'cash',
                description: `تحصيل مندوب — طلب ${order.orderNumber}`,
                sourceTable: 'rep_cash_collections',
                sourceId: collection.id,
                createdBy: ctx.userId,
                lines: [
                  { accountCode: ACCOUNT_CODES.REP_CUSTODY, currency: orderCurrency, debitMinor: collectedMinor },
                  { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD, currency: orderCurrency, creditMinor: collectedMinor },
                ],
              });
            }
            await recordAttempt(tx, ctx, order.id, 'delivered', null);
            // No bigint in an idempotent response: a replay is read back from
            // jsonb, where it would come back a string (idempotency.ts).
            return { id: order.id, orderId: order.id, collected: collectedMinor > 0n };
          }, {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'REP_ORDER_DELIVERED',
            tableName: 'orders',
            changes: { orderId: order.id, from: transition.previousStatus, collectedMinor: collectedMinor.toString() },
          });
        });
        return { data: result, error: null, meta: null };
      })),

  /**
   * Not delivered this time (failed) or refused and brought back (returned).
   * The order stays out for delivery; the office decides what happens next
   * (reassign, retry, or cancel through the orders screen).
   */
  markUndelivered: requirePermission('deliveries', 'update')
    .input(z.object({
      orderId: z.string().uuid(),
      outcome: z.enum(['failed', 'returned']),
      reason: z.string().trim().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.withOrg(async (tx) => {
        const order = await lockMyOrder(tx, ctx, input.orderId);
        if (!(OPEN_STATUSES as readonly string[]).includes(order.status)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'الطلب مش في حالة توصيل.' });
        }
        await withAudit(tx, () => recordAttempt(tx, ctx, order.id, input.outcome, input.reason), {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: input.outcome === 'failed' ? 'REP_DELIVERY_FAILED' : 'REP_DELIVERY_RETURNED',
          tableName: 'delivery_attempts',
          changes: { orderId: order.id, reason: input.reason },
        });
      });
      return { data: { orderId: input.orderId }, error: null, meta: null };
    }),

  /** Cash I hold: collected and not yet handed over, plus my recent handovers. */
  myCash: requirePermission('deliveries', 'view')
    .query(async ({ ctx }) => {
      const data = await ctx.withOrg(async (tx) => {
        const open = await tx.select({
          id: repCashCollections.id, orderId: repCashCollections.orderId, orderNumber: orders.orderNumber,
          amountMinor: repCashCollections.amountMinor, currency: repCashCollections.currency, collectedAt: repCashCollections.collectedAt,
        })
          .from(repCashCollections)
          .innerJoin(orders, and(eq(orders.id, repCashCollections.orderId), eq(orders.orgId, ctx.orgId)))
          .where(and(eq(repCashCollections.orgId, ctx.orgId), eq(repCashCollections.memberId, me(ctx)), isNull(repCashCollections.handoverId)))
          .orderBy(asc(repCashCollections.collectedAt));
        const handovers = await tx.select().from(repCashHandovers)
          .where(and(eq(repCashHandovers.orgId, ctx.orgId), eq(repCashHandovers.memberId, me(ctx))))
          .orderBy(desc(repCashHandovers.submittedAt))
          .limit(20);
        return { open, handovers };
      });
      return { data, error: null, meta: null };
    }),

  /**
   * End of day: every open collection joins one handover, in one UPDATE whose
   * WHERE is the guard — two concurrent submissions cannot both take the same
   * collection (0077's trigger also refuses moving one between handovers).
   * No ledger entry yet: the cash is still with the rep until it is counted.
   */
  submitHandover: requirePermission('repCash', 'handover')
    .input(z.object({ declared: amountInput, currency: z.literal('EGP').default('EGP'), idempotencyKey: keyInput }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('deliveries.submitHandover', input.idempotencyKey, input, async () => {
        const handoverCurrency = assertSupportedCurrency(input.currency);
        const declaredMinor = parseDecimal(input.declared, handoverCurrency).minor;
        const result = await ctx.withOrg(async (tx) => {
          const [handover] = await tx.insert(repCashHandovers).values({
            orgId: ctx.orgId, memberId: me(ctx), currency: handoverCurrency, declaredMinor,
            // Placeholder until the collections are claimed below; the CHECK
            // (expected > 0) and the final UPDATE keep it honest.
            expectedMinor: 1n,
          }).returning({ id: repCashHandovers.id });
          const claimed = await tx.update(repCashCollections)
            .set({ handoverId: handover.id })
            .where(and(
              eq(repCashCollections.orgId, ctx.orgId),
              eq(repCashCollections.memberId, me(ctx)),
              eq(repCashCollections.currency, handoverCurrency),
              isNull(repCashCollections.handoverId),
            ))
            .returning({ amountMinor: repCashCollections.amountMinor });
          if (claimed.length === 0) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'مفيش فلوس محصّلة لسه تتسلّم.' });
          }
          const expectedMinor = claimed.reduce((sum, c) => sum + c.amountMinor, 0n);
          return withAudit(tx, async () => {
            const [row] = await tx.update(repCashHandovers)
              .set({ expectedMinor })
              .where(and(eq(repCashHandovers.id, handover.id), eq(repCashHandovers.orgId, ctx.orgId), eq(repCashHandovers.status, 'submitted')))
              .returning({ id: repCashHandovers.id });
            return { id: row.id, collections: claimed.length };
          }, {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'REP_CASH_HANDOVER_SUBMITTED',
            tableName: 'rep_cash_handovers',
            changes: { handoverId: handover.id, declaredMinor: declaredMinor.toString(), expectedMinor: expectedMinor.toString(), collections: claimed.length },
          });
        });
        return { data: result, error: null, meta: null };
      })),
});
