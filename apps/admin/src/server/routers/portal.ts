import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  MAX_IDEMPOTENCY_KEY_LENGTH, purchaseOrderItems, purchaseOrderShipmentItems, purchaseOrderShipments, purchaseOrders,
  suppliers, withAudit, type DbTx,
} from '@irth/db';
import { router, requirePermission, type Context } from '../trpc';

/**
 * بوابة المورد (PR-3): what a supplier sees of this org — only the purchase
 * orders sent to them, their answer to each, their shipping notices and what
 * they are owed.
 *
 * Three locks on every procedure: the portal.* permission; the caller must
 * BE a supplier account with exactly one supplier in scope (mySupplier); and
 * in the database 0076/0079 narrow the transaction to that supplier and close
 * the ledger to supplier accounts entirely. Every response is an explicit
 * whitelist — no internal notes, no costs of other suppliers, and prices
 * under the supplier's own field names (their price is not a secret from
 * them, unlike unitCostMinor from staff without sensitive.supplierPrice).
 */

type Ctx = Pick<Context, 'access' | 'orgId'>;

const VISIBLE_STATUSES = ['ordered', 'partial', 'received'] as const;
const OPEN_STATUSES = ['ordered', 'partial'] as const;
const keyInput = z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH);

/** The one supplier this account speaks for — or no portal at all. */
export function mySupplier(ctx: Ctx): string {
  // Not a permission question (the permission was checked): an account that
  // is not a supplier, or not tied to exactly one, has no portal.
  if (ctx.access.principalKind !== 'supplier' || ctx.access.scopes.supplier.length !== 1) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'الحساب ده مش حساب مورد.' });
  }
  return ctx.access.scopes.supplier[0];
}

async function lockMyOrder(tx: DbTx, ctx: Ctx, poId: string) {
  const [po] = await tx.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.supplierId, mySupplier(ctx))))
    .for('update');
  if (!po) throw new TRPCError({ code: 'NOT_FOUND' });
  return po;
}

/** Quantity already announced per PO line, across every shipping notice. */
async function shippedByItem(tx: DbTx, ctx: Ctx, poId: string) {
  const rows = await tx.select({
    poItemId: purchaseOrderShipmentItems.poItemId,
    shipped: sql<number>`SUM(${purchaseOrderShipmentItems.quantity})::int`,
  })
    .from(purchaseOrderShipmentItems)
    .innerJoin(purchaseOrderShipments, and(
      eq(purchaseOrderShipments.id, purchaseOrderShipmentItems.shipmentId), eq(purchaseOrderShipments.orgId, ctx.orgId),
    ))
    .where(and(eq(purchaseOrderShipmentItems.orgId, ctx.orgId), eq(purchaseOrderShipments.poId, poId)))
    .groupBy(purchaseOrderShipmentItems.poItemId);
  return new Map(rows.map((r) => [r.poItemId, r.shipped]));
}

export const portalRouter = router({
  /** Who I am here: my supplier's name. */
  me: requirePermission('portal', 'view')
    .query(async ({ ctx }) => {
      const [row] = await ctx.withOrg((tx) => tx.select({ name: suppliers.name }).from(suppliers)
        .where(and(eq(suppliers.id, mySupplier(ctx)), eq(suppliers.orgId, ctx.orgId))));
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return { data: row, error: null, meta: null };
    }),

  orders: requirePermission('portal', 'view')
    .query(async ({ ctx }) => {
      const rows = await ctx.withOrg((tx) => tx.select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        supplierStatus: purchaseOrders.supplierStatus,
        orderedAt: purchaseOrders.orderedAt,
        expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
        proposedDeliveryAt: purchaseOrders.proposedDeliveryAt,
        currency: purchaseOrders.currency,
        orderTotalMinor: purchaseOrders.totalAmountMinor,
      })
        .from(purchaseOrders)
        .where(and(
          eq(purchaseOrders.orgId, ctx.orgId),
          eq(purchaseOrders.supplierId, mySupplier(ctx)),
          inArray(purchaseOrders.status, [...VISIBLE_STATUSES]),
        ))
        .orderBy(desc(purchaseOrders.orderedAt))
        .limit(200));
      return { data: rows, error: null, meta: null };
    }),

  get: requirePermission('portal', 'view')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const data = await ctx.withOrg(async (tx) => {
        const [po] = await tx.select({
          id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, status: purchaseOrders.status,
          supplierStatus: purchaseOrders.supplierStatus, orderedAt: purchaseOrders.orderedAt,
          expectedDeliveryAt: purchaseOrders.expectedDeliveryAt, proposedDeliveryAt: purchaseOrders.proposedDeliveryAt,
          supplierNote: purchaseOrders.supplierNote, currency: purchaseOrders.currency, orderTotalMinor: purchaseOrders.totalAmountMinor,
        })
          .from(purchaseOrders)
          .where(and(
            eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId),
            eq(purchaseOrders.supplierId, mySupplier(ctx)), inArray(purchaseOrders.status, [...VISIBLE_STATUSES]),
          ));
        if (!po) return null;
        const items = await tx.select({
          id: purchaseOrderItems.id, productName: purchaseOrderItems.productName, variantName: purchaseOrderItems.variantName,
          sku: purchaseOrderItems.sku, quantity: purchaseOrderItems.quantity, unitPriceMinor: purchaseOrderItems.unitCostMinor,
          receivedQuantity: purchaseOrderItems.receivedQuantity,
        })
          .from(purchaseOrderItems)
          .where(and(eq(purchaseOrderItems.poId, po.id), eq(purchaseOrderItems.orgId, ctx.orgId)))
          .orderBy(asc(purchaseOrderItems.productName));
        const shipped = await shippedByItem(tx, ctx, po.id);
        const shipments = await tx.select({
          id: purchaseOrderShipments.id, shippedAt: purchaseOrderShipments.shippedAt,
          expectedArrivalAt: purchaseOrderShipments.expectedArrivalAt, reference: purchaseOrderShipments.reference,
        })
          .from(purchaseOrderShipments)
          .where(and(eq(purchaseOrderShipments.poId, po.id), eq(purchaseOrderShipments.orgId, ctx.orgId)))
          .orderBy(desc(purchaseOrderShipments.shippedAt));
        return { order: po, items: items.map((i) => ({ ...i, shippedQuantity: shipped.get(i.id) ?? 0 })), shipments };
      });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND' });
      return { data, error: null, meta: null };
    }),

  /** I will deliver as ordered. Once; the guard is in the WHERE. */
  confirm: requirePermission('portal', 'respond')
    .input(z.object({ poId: z.string().uuid(), note: z.string().trim().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.withOrg((tx) => withAudit(tx, async () => {
        const [po] = await tx.update(purchaseOrders)
          .set({ supplierStatus: 'confirmed', proposedDeliveryAt: null, supplierNote: input.note ?? null, supplierRespondedAt: sql`now()`, updatedAt: new Date() })
          .where(and(
            eq(purchaseOrders.id, input.poId), eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.supplierId, mySupplier(ctx)),
            inArray(purchaseOrders.status, [...OPEN_STATUSES]), sql`${purchaseOrders.supplierStatus} <> 'confirmed'`,
          ))
          .returning({ id: purchaseOrders.id });
        if (!po) throw new TRPCError({ code: 'CONFLICT', message: 'أمر الشراء اتأكد قبل كده أو مش مفتوح.' });
        return po;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'SUPPLIER_CONFIRMED_PO', tableName: 'purchase_orders', changes: { poId: input.poId } }));
      return { data: row, error: null, meta: null };
    }),

  /** Another delivery date; waits for the buyer to accept or reject it. */
  proposeDate: requirePermission('portal', 'respond')
    .input(z.object({ poId: z.string().uuid(), date: z.coerce.date(), note: z.string().trim().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.date.getTime() < Date.now()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'التاريخ المقترح لازم يكون في المستقبل.' });
      }
      const row = await ctx.withOrg((tx) => withAudit(tx, async () => {
        const [po] = await tx.update(purchaseOrders)
          .set({ supplierStatus: 'date_proposed', proposedDeliveryAt: input.date, supplierNote: input.note ?? null, supplierRespondedAt: sql`now()`, updatedAt: new Date() })
          .where(and(
            eq(purchaseOrders.id, input.poId), eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.supplierId, mySupplier(ctx)),
            inArray(purchaseOrders.status, [...OPEN_STATUSES]),
          ))
          .returning({ id: purchaseOrders.id });
        if (!po) throw new TRPCError({ code: 'NOT_FOUND' });
        return po;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'SUPPLIER_PROPOSED_DATE', tableName: 'purchase_orders', changes: { poId: input.poId, date: input.date.toISOString() } }));
      return { data: row, error: null, meta: null };
    }),

  /**
   * A shipping notice. Each line at most what is still unannounced on that PO
   * line, checked under a lock on the PO, so two notices sent at once cannot
   * both announce the same remaining quantity.
   */
  shipNotice: requirePermission('portal', 'ship')
    .input(z.object({
      poId: z.string().uuid(),
      shippedAt: z.coerce.date().optional(),
      expectedArrivalAt: z.coerce.date().optional(),
      reference: z.string().trim().max(200).optional(),
      note: z.string().trim().max(1000).optional(),
      lines: z.array(z.object({ poItemId: z.string().uuid(), quantity: z.number().int().positive().max(1_000_000) })).min(1).max(200),
      idempotencyKey: keyInput,
    }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('portal.shipNotice', input.idempotencyKey, input, async () => {
        const shipment = await ctx.withOrg(async (tx) => {
          const po = await lockMyOrder(tx, ctx, input.poId);
          if (!(OPEN_STATUSES as readonly string[]).includes(po.status)) {
            throw new TRPCError({ code: 'CONFLICT', message: 'أمر الشراء مش مفتوح.' });
          }
          const items = await tx.select({ id: purchaseOrderItems.id, quantity: purchaseOrderItems.quantity })
            .from(purchaseOrderItems)
            .where(and(eq(purchaseOrderItems.poId, po.id), eq(purchaseOrderItems.orgId, ctx.orgId)));
          const ordered = new Map(items.map((i) => [i.id, i.quantity]));
          const shipped = await shippedByItem(tx, ctx, po.id);
          const wanted = new Map<string, number>();
          for (const l of input.lines) wanted.set(l.poItemId, (wanted.get(l.poItemId) ?? 0) + l.quantity);
          for (const [itemId, qty] of wanted) {
            const q = ordered.get(itemId);
            if (q === undefined) throw new TRPCError({ code: 'NOT_FOUND', message: 'بند مش في أمر الشراء ده.' });
            if (qty > q - (shipped.get(itemId) ?? 0)) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'الكمية أكبر من المتبقي على البند.' });
            }
          }
          return withAudit(tx, async () => {
            const [s] = await tx.insert(purchaseOrderShipments).values({
              orgId: ctx.orgId, poId: po.id, shippedAt: input.shippedAt ?? new Date(),
              expectedArrivalAt: input.expectedArrivalAt ?? null, reference: input.reference ?? null, note: input.note ?? null,
              createdByMemberId: ctx.access.memberId,
            }).returning({ id: purchaseOrderShipments.id });
            await tx.insert(purchaseOrderShipmentItems).values(
              [...wanted].map(([poItemId, quantity]) => ({ orgId: ctx.orgId, shipmentId: s.id, poItemId, quantity })),
            );
            return s;
          }, { orgId: ctx.orgId, userId: ctx.userId, action: 'SUPPLIER_SHIP_NOTICE', tableName: 'purchase_order_shipments', changes: { poId: po.id, lines: input.lines } });
        });
        return { data: shipment, error: null, meta: null };
      })),

  /** What I am owed: received (from the ledger) and paid, per purchase order. */
  statement: requirePermission('portal', 'payments')
    .query(async ({ ctx }) => {
      const supplierId = mySupplier(ctx);
      const rows = await ctx.withOrg((tx) => supplierStatement(tx, ctx.orgId, supplierId));
      return { data: rows, error: null, meta: null };
    }),
});

export interface StatementRow { poId: string | null; poNumber: string | null; receivedMinor: bigint; paidMinor: bigint }

/**
 * Per purchase order: the payable goods receipts credited (read from the
 * ledger by 0079's supplier_statement, which a supplier account may call but
 * whose tables it cannot read) and the payments recorded against it. A
 * payment not tied to a purchase order is its own row with no poId.
 */
export async function supplierStatement(tx: DbTx, orgId: string, supplierId: string) {
  const rows = await tx.execute<{ po_id: string | null; received_minor: string; paid_minor: string }>(
    sql`SELECT po_id, received_minor::text, paid_minor::text FROM supplier_statement(${supplierId}::uuid)`,
  );
  const list = [...rows];
  const poIds = list.map((r) => r.po_id).filter((id): id is string => id !== null);
  const numbers = poIds.length === 0 ? [] : await tx.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.orgId, orgId), inArray(purchaseOrders.id, poIds)));
  const byId = new Map(numbers.map((n) => [n.id, n.poNumber]));
  const out: StatementRow[] = list.map((r) => ({
    poId: r.po_id, poNumber: r.po_id ? byId.get(r.po_id) ?? null : null,
    receivedMinor: BigInt(r.received_minor), paidMinor: BigInt(r.paid_minor),
  }));
  const receivedMinor = out.reduce((s, r) => s + r.receivedMinor, 0n);
  const paidMinor = out.reduce((s, r) => s + r.paidMinor, 0n);
  return { rows: out, receivedMinor, paidMinor, outstandingMinor: receivedMinor - paidMinor };
}
