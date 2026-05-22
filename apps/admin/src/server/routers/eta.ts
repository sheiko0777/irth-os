import { router, protectedProcedure } from '../trpc';
import { orders, etaInvoices } from '@irth/db';
import { eq, and, desc, isNull, inArray, lt, sql, or } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { issueInvoice, getInvoiceStatus } from '@irth/api/src/services/eta';

export const etaRouter = router({
    list: protectedProcedure
        .query(async ({ ctx }) => {
            const data = await ctx.db
                .select({
                    id: etaInvoices.id,
                    orderId: etaInvoices.orderId,
                    orderNumber: orders.orderNumber,
                    totalAmount: orders.totalAmount,
                    status: etaInvoices.status,
                    etaUuid: etaInvoices.etaUuid,
                    submittedAt: etaInvoices.submittedAt,
                    createdAt: etaInvoices.createdAt,
                    errorMessage: etaInvoices.errorMessage,
                })
                .from(etaInvoices)
                .innerJoin(orders, eq(etaInvoices.orderId, orders.id))
                .where(eq(etaInvoices.orgId, ctx.orgId))
                .orderBy(desc(etaInvoices.createdAt))
                .limit(50);

            return {
                data,
                error: null,
                meta: null
            };
        }),

    submit: protectedProcedure
        .input(z.object({
            orderId: z.string().uuid()
        }))
        .mutation(async ({ ctx, input }) => {
            const order = await ctx.db.query.orders.findFirst({
                where: and(
                    eq(orders.id, input.orderId),
                    eq(orders.orgId, ctx.orgId)
                )
            });

            if (!order) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
            }

            try {
                const result = await issueInvoice({
                    id: order.id,
                    orgId: order.orgId,
                    totalAmount: order.totalAmount,
                });

                if (!result) {
                     throw new Error('Failed to issue ETA invoice: missing credentials');
                }

                // Insert or Upsert into eta_invoices
                const [record] = await ctx.db.insert(etaInvoices)
                    .values({
                        orgId: order.orgId,
                        orderId: order.id,
                        etaUuid: result.uuid,
                        status: result.status,
                        longId: result.longId,
                        qrCodeData: result.qrData,
                        submittedAt: new Date(),
                    })
                    .onConflictDoUpdate({
                        target: etaInvoices.orderId,
                        set: {
                            etaUuid: result.uuid,
                            status: result.status,
                            longId: result.longId,
                            qrCodeData: result.qrData,
                            submittedAt: new Date(),
                            errorMessage: null,
                        }
                    })
                    .returning();

                return { data: { etaUuid: record.etaUuid, status: record.status }, error: null, meta: null };
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';

                await ctx.db.insert(etaInvoices)
                    .values({
                        orgId: order.orgId,
                        orderId: order.id,
                        status: 'rejected',
                        errorMessage: message,
                        retryCount: 1,
                    })
                    .onConflictDoUpdate({
                        target: etaInvoices.orderId,
                        set: {
                            status: 'rejected',
                            errorMessage: message,
                            retryCount: sql`${etaInvoices.retryCount} + 1`
                        }
                    });

                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
            }
        }),

    checkStatus: protectedProcedure
        .input(z.object({
            etaUuid: z.string()
        }))
        .mutation(async ({ ctx, input }) => {
            const etaRecord = await ctx.db.query.etaInvoices.findFirst({
                where: and(
                    eq(etaInvoices.etaUuid, input.etaUuid),
                    eq(etaInvoices.orgId, ctx.orgId)
                )
            });

            if (!etaRecord) {
                 throw new TRPCError({ code: 'NOT_FOUND', message: 'ETA invoice record not found' });
            }

            const result = await getInvoiceStatus(input.etaUuid);

            const statusMap: Record<string, string> = {
                'Valid': 'valid',
                'Invalid': 'rejected',
                'Cancelled': 'cancelled',
                'Submitted': 'submitted',
                'Pending': 'pending',
                'Rejected': 'rejected'
            };

            const mappedStatus = statusMap[result.status] || result.status.toLowerCase();

            await ctx.db.update(etaInvoices)
                .set({
                    status: mappedStatus,
                    longId: result.longId || etaRecord.longId
                })
                .where(eq(etaInvoices.id, etaRecord.id));

            return { data: { status: mappedStatus, longId: result.longId }, error: null, meta: null };
        }),

    submitPending: protectedProcedure
        .mutation(async ({ ctx }) => {
            // Find delivered orders without valid ETA invoice
            const eligibleOrders = await ctx.db
                .select({
                    id: orders.id,
                    orgId: orders.orgId,
                    totalAmount: orders.totalAmount,
                    etaInvoiceId: etaInvoices.id,
                    retryCount: etaInvoices.retryCount,
                })
                .from(orders)
                .leftJoin(etaInvoices, eq(orders.id, etaInvoices.orderId))
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    eq(orders.status, 'delivered'),
                    // Either no ETA invoice, or it's pending/rejected and retryCount < 3
                    or(
                        isNull(etaInvoices.id),
                        and(
                            inArray(etaInvoices.status, ['pending', 'rejected']),
                            lt(etaInvoices.retryCount, 3)
                        )
                    )
                ))
                .limit(10);

            let successCount = 0;

            for (const order of eligibleOrders) {
                try {
                    const result = await issueInvoice({
                        id: order.id,
                        orgId: order.orgId,
                        totalAmount: order.totalAmount,
                    });

                    if (result) {
                        await ctx.db.insert(etaInvoices)
                            .values({
                                orgId: order.orgId,
                                orderId: order.id,
                                etaUuid: result.uuid,
                                status: result.status,
                                longId: result.longId,
                                qrCodeData: result.qrData,
                                submittedAt: new Date(),
                            })
                            .onConflictDoUpdate({
                                target: etaInvoices.orderId,
                                set: {
                                    etaUuid: result.uuid,
                                    status: result.status,
                                    longId: result.longId,
                                    qrCodeData: result.qrData,
                                    submittedAt: new Date(),
                                    errorMessage: null,
                                }
                            });
                        successCount++;
                    }
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    await ctx.db.insert(etaInvoices)
                        .values({
                            orgId: order.orgId,
                            orderId: order.id,
                            status: 'rejected',
                            errorMessage: message,
                            retryCount: 1,
                        })
                        .onConflictDoUpdate({
                            target: etaInvoices.orderId,
                            set: {
                                status: 'rejected',
                                errorMessage: message,
                                retryCount: sql`${etaInvoices.retryCount} + 1`
                            }
                        });
                }
            }

            return { data: { count: successCount }, error: null, meta: null };
        }),
});
