import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { etaInvoices, orders, orderItems, productVariants, products, customers } from '@irth/db';
import type { DbTx } from '@irth/db';
import { eq, and, desc, isNull, or } from 'drizzle-orm';
import { issueInvoice, getInvoiceStatus, cancelInvoice, type EtaOrderInput } from '../services/eta';

/**
 * Assembles the real order/line/receiver data issueInvoice needs, from the
 * order id alone. Lives here (not in services/eta.ts) because the service
 * file is deliberately free of any `@irth/db` import — see its own comment on
 * why it stays a pure fetch-and-arithmetic module.
 *
 * Returns `null` when the order has no items to declare — issueInvoice
 * refuses that case too, but checking here avoids a wasted auth round trip.
 */
async function buildEtaOrderInput(
    db: Pick<DbTx, 'select'>,
    orgId: string,
    orderId: string,
): Promise<EtaOrderInput | null> {
    const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
        .limit(1);
    if (!order) return null;

    // Real invoice lines, not one synthetic "Order Items" row: each order_item
    // becomes its own ETA line, priced at what was actually charged
    // (order_items.price_minor), described with the real product name and
    // SKU as the item code.
    //
    // itemCode uses the SKU because nothing in this schema stores a GS1/EGS/
    // GPC-format ETA item code — the SKU is real and traceable to a specific
    // product, which the previous hardcoded 'EG-1234567' was not, but it is
    // NOT itself an ETA-conformant code. Flagged rather than silently assumed
    // correct.
    const lineRows = await db
        .select({
            quantity: orderItems.quantity,
            priceMinor: orderItems.priceMinor,
            productName: products.name,
            sku: productVariants.sku,
        })
        .from(orderItems)
        .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(eq(orderItems.orderId, orderId));

    if (lineRows.length === 0) return null;

    let customerName: string | null = null;
    if (order.customerId) {
        const [customer] = await db
            .select({ name: customers.name })
            .from(customers)
            .where(and(eq(customers.id, order.customerId), eq(customers.orgId, orgId)))
            .limit(1);
        customerName = customer?.name ?? null;
    }

    return {
        id: order.id,
        orgId,
        orderNumber: order.orderNumber,
        currency: order.currency,
        customerName,
        items: lineRows.map((r) => ({
            description: r.productName,
            itemCode: r.sku,
            quantity: r.quantity,
            unitPriceMinor: r.priceMinor,
        })),
    };
}

export const etaRouter = router({
    list: protectedProcedure
        .input(z.object({ status: z.string().optional() }))
        .query(async ({ ctx, input }) => {
            const conditions = [eq(etaInvoices.orgId, ctx.orgId)];
            if (input.status) conditions.push(eq(etaInvoices.status, input.status));
            const rows = await ctx.db
                .select()
                .from(etaInvoices)
                .where(and(...conditions))
                .orderBy(desc(etaInvoices.createdAt))
                .limit(50);
            return { data: rows, error: null, meta: null };
        }),

    submit: adminProcedure
        .input(z.object({ orderId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const etaInput = await buildEtaOrderInput(ctx.db, ctx.orgId, input.orderId);
            if (!etaInput) return { data: null, error: 'Order not found or has no items', meta: null };

            const [existing] = await ctx.db
                .select()
                .from(etaInvoices)
                .where(and(eq(etaInvoices.orderId, input.orderId), eq(etaInvoices.orgId, ctx.orgId)))
                .limit(1);
            if (existing?.status === 'submitted') {
                return { data: existing, error: null, meta: null };
            }

            // issueInvoice makes external HTTP calls (auth, submission). Kept
            // OUTSIDE any transaction, same reasoning as ctx.withOrg everywhere
            // else in this codebase: holding a pooled connection open across a
            // call to a government API is how the pool gets exhausted.
            const result = await issueInvoice(etaInput);

            if (!result) {
                await ctx.withOrg(async (tx) => tx.insert(etaInvoices).values({
                    orgId: ctx.orgId,
                    orderId: input.orderId,
                    status: 'error',
                    errorMessage: 'ETA service unavailable or not configured',
                    retryCount: (existing?.retryCount ?? 0) + 1,
                }).onConflictDoUpdate({
                    target: etaInvoices.orderId,
                    set: {
                        status: 'error',
                        errorMessage: 'ETA service unavailable or not configured',
                        retryCount: (existing?.retryCount ?? 0) + 1,
                    },
                }));
                return { data: null, error: 'ETA submission failed', meta: null };
            }

            const [row] = await ctx.withOrg(async (tx) => tx.insert(etaInvoices).values({
                orgId: ctx.orgId,
                orderId: input.orderId,
                etaUuid: result.uuid,
                longId: result.longId ?? null,
                qrCodeData: result.qrCodeData ?? null,
                status: 'submitted',
                submittedAt: new Date(),
                retryCount: 0,
            }).onConflictDoUpdate({
                target: etaInvoices.orderId,
                set: {
                    etaUuid: result.uuid,
                    longId: result.longId ?? null,
                    qrCodeData: result.qrCodeData ?? null,
                    status: 'submitted',
                    submittedAt: new Date(),
                    retryCount: 0,
                    errorMessage: null,
                },
            }).returning());

            return { data: row, error: null, meta: null };
        }),

    checkStatus: adminProcedure
        .input(z.object({ orderId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const [invoice] = await ctx.db
                .select()
                .from(etaInvoices)
                .where(and(eq(etaInvoices.orderId, input.orderId), eq(etaInvoices.orgId, ctx.orgId)))
                .limit(1);
            if (!invoice?.etaUuid) return { data: null, error: 'No ETA invoice found', meta: null };

            const statusResult = await getInvoiceStatus(invoice.etaUuid);
            await ctx.withOrg(async (tx) => tx
                .update(etaInvoices)
                .set({
                    status: statusResult.status.toLowerCase(),
                    qrCodeData: statusResult.qrCodeData ?? invoice.qrCodeData,
                    longId: statusResult.longId ?? invoice.longId,
                })
                .where(eq(etaInvoices.id, invoice.id)));

            return { data: { ...invoice, status: statusResult.status }, error: null, meta: null };
        }),

    cancel: adminProcedure
        .input(z.object({ orderId: z.string().uuid(), reason: z.string().min(1) }))
        .mutation(async ({ ctx, input }) => {
            const [invoice] = await ctx.db
                .select()
                .from(etaInvoices)
                .where(and(eq(etaInvoices.orderId, input.orderId), eq(etaInvoices.orgId, ctx.orgId)))
                .limit(1);
            if (!invoice?.etaUuid) return { data: null, error: 'No ETA invoice found', meta: null };

            // The window is read from ETA (Get Document Type), not hardcoded —
            // see getCancellationWindowHours's own comment for the source and
            // why an unknown window refuses rather than assumes "no limit".
            const result = await cancelInvoice(invoice.etaUuid, input.reason, invoice.submittedAt);
            if (result.ok) {
                await ctx.withOrg(async (tx) => tx
                    .update(etaInvoices)
                    .set({ status: 'cancelled' })
                    .where(eq(etaInvoices.id, invoice.id)));
            }
            return { data: { cancelled: result.ok }, error: result.ok ? null : (result.error ?? 'Cancel failed'), meta: null };
        }),

    submitPending: adminProcedure
        .mutation(async ({ ctx }) => {
            const pendingOrders = await ctx.db
                .select({ id: orders.id })
                .from(orders)
                .leftJoin(etaInvoices, eq(etaInvoices.orderId, orders.id))
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    or(isNull(etaInvoices.id), eq(etaInvoices.status, 'error')),
                ))
                .limit(20);

            let submitted = 0;
            for (const { id: orderId } of pendingOrders) {
                const etaInput = await buildEtaOrderInput(ctx.db, ctx.orgId, orderId);
                if (!etaInput) continue;

                const result = await issueInvoice(etaInput);
                if (result) {
                    await ctx.withOrg(async (tx) => tx.insert(etaInvoices).values({
                        orgId: ctx.orgId,
                        orderId,
                        etaUuid: result.uuid,
                        longId: result.longId ?? null,
                        status: 'submitted',
                        submittedAt: new Date(),
                        retryCount: 0,
                    }).onConflictDoUpdate({
                        target: etaInvoices.orderId,
                        set: { etaUuid: result.uuid, status: 'submitted', submittedAt: new Date(), retryCount: 0 },
                    }));
                    submitted++;
                }
            }
            return { data: { submitted, total: pendingOrders.length }, error: null, meta: null };
        }),
});
