import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { etaInvoices, orders } from '@irth/db';
import { eq, and, desc, isNull, or } from 'drizzle-orm';
import { issueInvoice, getInvoiceStatus, cancelInvoice } from '../services/eta';

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

    submit: protectedProcedure
        .input(z.object({ orderId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const [order] = await ctx.db
                .select()
                .from(orders)
                .where(and(eq(orders.id, input.orderId), eq(orders.orgId, ctx.orgId)))
                .limit(1);
            if (!order) return { data: null, error: 'Order not found', meta: null };

            const [existing] = await ctx.db
                .select()
                .from(etaInvoices)
                .where(and(eq(etaInvoices.orderId, input.orderId), eq(etaInvoices.orgId, ctx.orgId)))
                .limit(1);
            if (existing?.status === 'submitted') {
                return { data: existing, error: null, meta: null };
            }

            const result = await issueInvoice({
                id: order.id,
                orgId: ctx.orgId,
                totalAmount: String(order.totalAmount ?? 0),
            });

            if (!result) {
                await ctx.db.insert(etaInvoices).values({
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
                });
                return { data: null, error: 'ETA submission failed', meta: null };
            }

            const [row] = await ctx.db.insert(etaInvoices).values({
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
            }).returning();

            return { data: row, error: null, meta: null };
        }),

    checkStatus: protectedProcedure
        .input(z.object({ orderId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const [invoice] = await ctx.db
                .select()
                .from(etaInvoices)
                .where(and(eq(etaInvoices.orderId, input.orderId), eq(etaInvoices.orgId, ctx.orgId)))
                .limit(1);
            if (!invoice?.etaUuid) return { data: null, error: 'No ETA invoice found', meta: null };

            const statusResult = await getInvoiceStatus(invoice.etaUuid);
            await ctx.db
                .update(etaInvoices)
                .set({
                    status: statusResult.status.toLowerCase(),
                    qrCodeData: statusResult.qrCodeData ?? invoice.qrCodeData,
                    longId: statusResult.longId ?? invoice.longId,
                })
                .where(eq(etaInvoices.id, invoice.id));

            return { data: { ...invoice, status: statusResult.status }, error: null, meta: null };
        }),

    cancel: protectedProcedure
        .input(z.object({ orderId: z.string().uuid(), reason: z.string().min(1) }))
        .mutation(async ({ ctx, input }) => {
            const [invoice] = await ctx.db
                .select()
                .from(etaInvoices)
                .where(and(eq(etaInvoices.orderId, input.orderId), eq(etaInvoices.orgId, ctx.orgId)))
                .limit(1);
            if (!invoice?.etaUuid) return { data: null, error: 'No ETA invoice found', meta: null };

            const ok = await cancelInvoice(invoice.etaUuid, input.reason);
            if (ok) {
                await ctx.db
                    .update(etaInvoices)
                    .set({ status: 'cancelled' })
                    .where(eq(etaInvoices.id, invoice.id));
            }
            return { data: { cancelled: ok }, error: ok ? null : 'Cancel failed', meta: null };
        }),

    submitPending: protectedProcedure
        .mutation(async ({ ctx }) => {
            const pendingOrders = await ctx.db
                .select({ id: orders.id, totalAmount: orders.totalAmount })
                .from(orders)
                .leftJoin(etaInvoices, eq(etaInvoices.orderId, orders.id))
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    or(isNull(etaInvoices.id), eq(etaInvoices.status, 'error')),
                ))
                .limit(20);

            let submitted = 0;
            for (const order of pendingOrders) {
                const result = await issueInvoice({
                    id: order.id,
                    orgId: ctx.orgId,
                    totalAmount: String(order.totalAmount ?? 0),
                });
                if (result) {
                    await ctx.db.insert(etaInvoices).values({
                        orgId: ctx.orgId,
                        orderId: order.id,
                        etaUuid: result.uuid,
                        longId: result.longId ?? null,
                        status: 'submitted',
                        submittedAt: new Date(),
                        retryCount: 0,
                    }).onConflictDoUpdate({
                        target: etaInvoices.orderId,
                        set: { etaUuid: result.uuid, status: 'submitted', submittedAt: new Date(), retryCount: 0 },
                    });
                    submitted++;
                }
            }
            return { data: { submitted, total: pendingOrders.length }, error: null, meta: null };
        }),
});
