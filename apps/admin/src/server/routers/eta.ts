import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { etaInvoices, orders, buildEtaOrderInput } from '@irth/db';
import { eq, and, desc, isNull, or } from 'drizzle-orm';
import { issueInvoice, getInvoiceStatus, cancelInvoice, buildEtaConfig } from '@irth/domain';

// Config is process.env directly here (not envVar() from apps/api/src/utils/
// env.ts) — this is Next.js, not a Worker, so process.env is populated at
// runtime. Built once per call rather than cached at module scope so a
// changed env var (e.g. after a redeploy) takes effect immediately.
const etaConfig = () => buildEtaConfig((k) => process.env[k]);

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
            const result = await issueInvoice(etaInput, etaConfig());

            if (!result.ok) {
                // A manual "Submit Now" click failing does not need the
                // retryable/nextRetryAt bookkeeping the outbox worker uses —
                // an admin can just click again. Still record what happened,
                // consistent with every other write to this row.
                await ctx.withOrg(async (tx) => tx.insert(etaInvoices).values({
                    orgId: ctx.orgId,
                    orderId: input.orderId,
                    status: 'error',
                    errorMessage: result.message,
                    retryCount: (existing?.retryCount ?? 0) + 1,
                }).onConflictDoUpdate({
                    target: etaInvoices.orderId,
                    set: {
                        status: 'error',
                        errorMessage: result.message,
                        retryCount: (existing?.retryCount ?? 0) + 1,
                        updatedAt: new Date(),
                    },
                }));
                return { data: null, error: result.message, meta: null };
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
                nextRetryAt: null,
            }).onConflictDoUpdate({
                target: etaInvoices.orderId,
                set: {
                    etaUuid: result.uuid,
                    longId: result.longId ?? null,
                    qrCodeData: result.qrCodeData ?? null,
                    status: 'submitted',
                    submittedAt: new Date(),
                    retryCount: 0,
                    nextRetryAt: null,
                    errorMessage: null,
                    updatedAt: new Date(),
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

            const statusResult = await getInvoiceStatus(invoice.etaUuid, etaConfig());
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
            const result = await cancelInvoice(invoice.etaUuid, input.reason, invoice.submittedAt, etaConfig());
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

                const result = await issueInvoice(etaInput, etaConfig());
                if (result.ok) {
                    await ctx.withOrg(async (tx) => tx.insert(etaInvoices).values({
                        orgId: ctx.orgId,
                        orderId,
                        etaUuid: result.uuid,
                        longId: result.longId ?? null,
                        status: 'submitted',
                        submittedAt: new Date(),
                        retryCount: 0,
                        nextRetryAt: null,
                    }).onConflictDoUpdate({
                        target: etaInvoices.orderId,
                        set: {
                            etaUuid: result.uuid, status: 'submitted', submittedAt: new Date(),
                            retryCount: 0, nextRetryAt: null, errorMessage: null, updatedAt: new Date(),
                        },
                    }));
                    submitted++;
                } else {
                    // Matches `submit`'s own behaviour of always recording a
                    // failure — previously this left a failed bulk-retry
                    // silent (no row written at all for an order with no
                    // prior invoice, and an untouched errorMessage for one
                    // that already had an error row).
                    await ctx.withOrg(async (tx) => tx.insert(etaInvoices).values({
                        orgId: ctx.orgId, orderId, status: 'error', errorMessage: result.message,
                    }).onConflictDoUpdate({
                        target: etaInvoices.orderId,
                        set: { status: 'error', errorMessage: result.message, updatedAt: new Date() },
                    }));
                }
            }
            return { data: { submitted, total: pendingOrders.length }, error: null, meta: null };
        }),
});
