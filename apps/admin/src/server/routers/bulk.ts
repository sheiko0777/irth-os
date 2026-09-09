import { router, protectedProcedure, adminProcedure } from '../trpc';
import { orders, customers, inventoryItems, productVariants, products, orderStatusEnum, withAudit,
         emitOutboxEvent, buildOrderNotification, OUTBOX_EVENT_BY_STATUS,
         postOrderDeliveredEntry } from '@irth/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

export const bulkRouter = router({
    bulkUpdateOrderStatus: adminProcedure
        .input(z.object({
            ids: z.array(z.string().uuid()).min(1).max(100),
            status: z.enum(orderStatusEnum.enumValues),
        }))
        .mutation(async ({ ctx, input }) => {
            const { ids, status } = input;
            const eventType = OUTBOX_EVENT_BY_STATUS[status];

            const changed = await ctx.withOrg(async (tx) => {
                // Captured out of the callback rather than returned through it:
                // withAudit's operation is typed `T extends { id?: string }`
                // because it reads result.id for record_id, and a batch has no
                // single subject row. Returning {} keeps that contract honest
                // (record_id stays NULL, per 0033) while still giving the
                // producer below the rows that actually moved.
                let changedRows: {
                    id: string;
                    orderNumber: string;
                    customerId: string | null;
                    currency: string;
                    totalAmountMinor: bigint;
                    paymentMethod: 'cod' | 'online' | null;
                    previousStatus: string;
                }[] = [];

                await withAudit(
                    tx,
                    async () => {
                        // `ne(status)` is not just an optimisation. Without it,
                        // re-applying a status every row already has reports 100
                        // orders updated and — now that this emits events —
                        // re-notifies all 100 customers. RETURNING then gives
                        // exactly the rows that genuinely transitioned.
                        // total_amount_minor comes back as a string, not a bigint:
                        // postgres-js returns int8/bigint columns as strings by
                        // default (see packages/db/src/index.ts:283 for the same
                        // note against the same driver behaviour) since this is a
                        // raw tx.execute, not a Drizzle-schema-typed query. Typed
                        // honestly here and converted below before it reaches
                        // postOrderDeliveredEntry.
                        const rows = await tx.execute<{
                            id: string;
                            order_number: string;
                            customer_id: string | null;
                            currency: string;
                            total_amount_minor: string;
                            payment_method: 'cod' | 'online' | null;
                            previous_status: string;
                        }>(sql`
                            WITH before AS (
                                SELECT id, status
                                FROM orders
                                WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
                                  AND org_id = ${ctx.orgId}
                                  AND status != ${status}
                                FOR UPDATE
                            )
                            UPDATE orders
                            SET status = ${status}, updated_at = now()
                            FROM before
                            WHERE orders.id = before.id
                              AND orders.org_id = ${ctx.orgId}
                            RETURNING orders.id, orders.order_number, orders.customer_id,
                                      orders.currency, orders.total_amount_minor,
                                      orders.payment_method,
                                      before.status AS previous_status
                        `);
                        changedRows = [...rows].map((row) => ({
                            id: row.id,
                            orderNumber: row.order_number,
                            customerId: row.customer_id,
                            currency: row.currency,
                            totalAmountMinor: BigInt(row.total_amount_minor),
                            paymentMethod: row.payment_method,
                            previousStatus: row.previous_status,
                        }));
                        // No id on purpose. This updates up to 100 orders, so
                        // there is no single subject row; `ids[0]` was only ever
                        // there to satisfy a NOT NULL, and it made the audit row
                        // name one arbitrary order out of the batch. record_id
                        // is nullable since 0033 and `changes` carries the list.
                        return {};
                    },
                    {
                        orgId: ctx.orgId,
                        userId: ctx.userId,
                        action: 'bulk_update_status',
                        tableName: 'orders',
                        changes: { ids, newStatus: status },
                    }
                );

                for (const order of changedRows) {
                    await postOrderDeliveredEntry(tx, {
                        orgId: ctx.orgId,
                        order,
                        previousStatus: order.previousStatus,
                        newStatus: status,
                        createdBy: ctx.userId,
                    });
                }

                // One event per order that actually moved, in the same
                // transaction as the move. Bulk-confirming a hundred orders
                // previously notified nobody at all.
                if (eventType) {
                    for (const order of changedRows) {
                        const payload = await buildOrderNotification(tx, ctx.orgId, order, eventType);
                        if (payload) {
                            await emitOutboxEvent(tx, { orgId: ctx.orgId, eventType, payload });
                        }
                    }
                }

                return changedRows.length;
            });

            // The real count, not ids.length. Ids belonging to another tenant,
            // ids that do not exist, and rows already in the target status are
            // all excluded by the WHERE — reporting the input length claimed
            // success for writes that never happened.
            return { data: { updated: changed }, error: null, meta: null };
        }),

    exportOrders: protectedProcedure
        .input(z.object({
            startDate: z.string(),
            endDate: z.string(),
            status: z.enum(orderStatusEnum.enumValues).optional(),
        }))
        .query(async ({ ctx, input }) => {
            const { startDate, endDate, status } = input;
            const conditions = [
                eq(orders.orgId, ctx.orgId),
                gte(orders.createdAt, new Date(startDate)),
                lte(orders.createdAt, new Date(endDate)),
            ];
            if (status) conditions.push(eq(orders.status, status));

            const rows = await ctx.db
                .select({
                    orderNumber: orders.orderNumber,
                    customerName: customers.name,
                    status: orders.status,
                    totalAmountMinor: orders.totalAmountMinor,
                    createdAt: orders.createdAt,
                    paymentMethod: sql<string>`''`,
                })
                .from(orders)
                .leftJoin(customers, eq(orders.customerId, customers.id))
                .where(and(...conditions))
                .limit(5000);

            return { data: rows, error: null, meta: null };
        }),

    exportInventory: protectedProcedure
        .query(async ({ ctx }) => {
            const rows = await ctx.db
                .select({
                    productName: products.name,
                    variantName: productVariants.name,
                    sku: productVariants.sku,
                    quantity: inventoryItems.quantity,
                    reorderPoint: inventoryItems.reorderPoint,
                    isLow: sql<boolean>`${inventoryItems.quantity} <= ${inventoryItems.reorderPoint}`,
                })
                .from(inventoryItems)
                .innerJoin(productVariants, eq(inventoryItems.variantId, productVariants.id))
                .innerJoin(products, eq(productVariants.productId, products.id))
                .where(eq(inventoryItems.orgId, ctx.orgId));

            return { data: rows, error: null, meta: null };
        }),

    exportCustomers: protectedProcedure
        .query(async ({ ctx }) => {
            const rows = await ctx.db
                .select({
                    name: customers.name,
                    email: customers.email,
                    phone: customers.phone,
                    loyaltyPoints: customers.loyaltyPoints,
                    totalOrders: customers.totalOrders,
                    totalSpentMinor: customers.totalSpentMinor,
                    createdAt: customers.createdAt,
                })
                .from(customers)
                .where(eq(customers.orgId, ctx.orgId))
                .limit(5000);

            return { data: rows, error: null, meta: null };
        }),
});

