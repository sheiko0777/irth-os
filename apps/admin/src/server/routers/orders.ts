import { router, requirePermission } from '../trpc';
import { orders, orderItems, shipmentTracking, productVariants, orderStatusEnum, notifications, customers, orgSettings } from '@irth/db';
import { eq, and, desc, sql, count, ilike, gte, lte, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withAudit, emitOutboxEvent, buildOrderNotification, OUTBOX_EVENT_BY_STATUS, postOrderDeliveredEntry } from '@irth/db';
import type { DbTx, OutboxEventType, OrderNotificationPayload } from '@irth/db';

const statusEnum = z.enum(orderStatusEnum.enumValues);


/**
 * org_settings key holding the courier's public tracking page, with `{tracking}`
 * standing in for the waybill number — e.g.
 * `https://example-courier.com/track?id={tracking}`.
 *
 * Read from settings rather than hardcoded per provider ON PURPOSE. This string
 * is pasted straight into a customer's WhatsApp message, and there is no source
 * in this repo for what any courier's public tracker URL is: `shippingProviderEnum`
 * is ('bosta','mylerz'), `courier_shipments.courier` is free text that the
 * webhooks fill with 'bosta' or 'aramex', and nothing anywhere records a URL
 * format for any of them. Guessing one would send every customer to a link the
 * author never opened. Unset simply omits `trackingUrl`, which the worker
 * already handles (`payload.trackingUrl || ''`).
 *
 * Settable today without new UI: settings.set takes an arbitrary `key`.
 */

/**
 * Builds the outbox payload for an order status transition, reading everything
 * it needs through `tx` so it commits or rolls back with the status change.
 *
 * Returns undefined when the event has no channel it could act on. The worker's
 * branches are all sends: order.confirmed reaches the customer by WhatsApp
 * (phone) or email, order.shipped only by WhatsApp. Writing a row with neither
 * produces a guaranteed no-op that is then marked processed — noise that makes
 * the outbox unreadable as a record of what was actually delivered. The state
 * change and its audit row still happen either way.
 */
export const ordersRouter = router({
    list: requirePermission('orders', 'view')
        .input(z.object({
            page: z.number().default(1),
            pageSize: z.number().default(20),
            status: statusEnum.optional(),
            search: z.string().optional(),
            dateRange: z.object({
                from: z.date().optional(),
                to: z.date().optional(),
            }).optional(),
        }))
        .query(async ({ ctx, input }) => {
            const { page, pageSize, status, search, dateRange } = input;
            const offset = (page - 1) * pageSize;

            // Everything except the status filter. The status tab counts have to
            // respect the search and date narrowing, but not the tab the user is
            // standing on — otherwise every tab but the active one reads zero.
            const scope = [eq(orders.orgId, ctx.orgId)];

            if (search) {
                scope.push(ilike(orders.orderNumber, `%${search}%`));
            }
            if (dateRange?.from) {
                scope.push(gte(orders.createdAt, dateRange.from));
            }
            if (dateRange?.to) {
                scope.push(lte(orders.createdAt, dateRange.to));
            }

            const conditions = status ? [...scope, eq(orders.status, status)] : scope;

            // Execute list, count and status breakdown concurrently
            const [data, totalQuery, statusCountsQuery] = await Promise.all([
                ctx.db
                    .select()
                    .from(orders)
                    .where(and(...conditions))
                    .orderBy(desc(orders.createdAt))
                    .limit(pageSize)
                    .offset(offset),
                ctx.db
                    .select({ count: count() })
                    .from(orders)
                    .where(and(...conditions)),
                ctx.db
                    .select({ status: orders.status, count: count() })
                    .from(orders)
                    .where(and(...scope))
                    .groupBy(orders.status),
            ]);

            return {
                data,
                error: null,
                meta: {
                    total: totalQuery[0].count,
                    page,
                    pageSize,
                    statusCounts: statusCountsQuery.map((r) => ({ status: r.status, count: r.count })),
                }
            };
        }),

    getById: requirePermission('orders', 'view')
        .input(z.object({
            id: z.string().uuid()
        }))
        .query(async ({ ctx, input }) => {
            const order = await ctx.db.query.orders.findFirst({
                where: and(
                    eq(orders.id, input.id),
                    eq(orders.orgId, ctx.orgId)
                )
            });

            if (!order) {
                throw new TRPCError({ code: 'NOT_FOUND' });
            }

            const items = await ctx.db
                .select({
                    id: orderItems.id,
                    quantity: orderItems.quantity,
                    priceMinor: orderItems.priceMinor,
                    sku: productVariants.sku,
                })
                .from(orderItems)
                .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
                .where(and(
                    eq(orderItems.orderId, order.id),
                    eq(orderItems.orgId, ctx.orgId)
                ));
            
            const history = await ctx.db
                .select()
                .from(shipmentTracking)
                .where(and(
                    eq(shipmentTracking.orderId, order.id),
                    eq(shipmentTracking.orgId, ctx.orgId)
                ))
                .orderBy(desc(shipmentTracking.createdAt));

            return {
                data: { order, items, history },
                error: null,
                meta: null
            };
        }),

    updateStatus: requirePermission('orders', 'write')
        .input(z.object({
            id: z.string().uuid(),
            status: statusEnum
        }))
        .mutation(async ({ ctx, input }) => {
            const order = await ctx.db.query.orders.findFirst({
                where: and(
                    eq(orders.id, input.id),
                    eq(orders.orgId, ctx.orgId)
                )
            });

            if (!order) {
                throw new TRPCError({ code: 'NOT_FOUND' });
            }

            // Status change, audit row, staff notification and the customer
            // outbox event in one transaction. As separate autocommits, a
            // failure between them left the order advanced with no audit trail
            // and no notification — the customer never heard about a change
            // that had in fact happened, and in the other direction an outbox
            // row written outside the transaction would tell the customer about
            // a change that then rolled back.
            const result = await ctx.withOrg(async (tx) => {
                const updated = await withAudit(
                    tx,
                    async () => {
                        const [row] = await tx.update(orders)
                            .set({ status: input.status, updatedAt: new Date() })
                            .where(and(
                                eq(orders.id, input.id),
                                eq(orders.orgId, ctx.orgId)
                            ))
                            .returning();
                        return row;
                    },
                    {
                        orgId: ctx.orgId,
                        userId: ctx.userId,
                        action: 'UPDATE_ORDER_STATUS',
                        tableName: 'orders',
                        changes: { from: order.status, to: input.status }
                    }
                );

                await tx.insert(notifications).values({
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    type: 'order_status',
                    title: `تحديث الطلب ${order.orderNumber}`,
                    body: `تم تغيير حالة الطلب إلى: ${input.status}`,
                    read: false,
                });

                // The customer-facing side. `notifications` above is the STAFF
                // feed inside the admin — nothing has ever read a row out of it
                // and messaged a customer. outbox_events is what the worker in
                // apps/api polls, and until now nothing wrote to it, so no
                // customer notification has ever been sent by this system.
                //
                // Emitted through `tx`, never ctx.db: the event and the state
                // change commit together or not at all. That is the whole point
                // of the outbox pattern.
                const eventType = OUTBOX_EVENT_BY_STATUS[input.status];
                // Only on an actual transition. The UPDATE above has no
                // `ne(status, input.status)` guard, so re-saving 'confirmed' on
                // an already-confirmed order returns a row perfectly happily —
                // and would re-send the confirmation WhatsApp and email every
                // time somebody clicked. The read is the one from the top of
                // the procedure; a concurrent double-click can still race it,
                // which is what `ctx.idempotent` is for if this ever needs to
                // be exactly-once rather than nearly-always-once.
                if (eventType && order.status !== input.status) {
                    const payload = await buildOrderNotification(tx, ctx.orgId, order, eventType);
                    if (payload) {
                        await emitOutboxEvent(tx, { orgId: ctx.orgId, eventType, payload });
                    }
                }

                // Revenue, VAT and COGS, recognised together at the point
                // the sale becomes final. The posting, and the transition
                // guard in front of it, live in @irth/db's
                // postOrderDeliveredEntry so that this router, apps/api's
                // PATCH /:id/status and the Bosta delivery webhook all book
                // the same entry from one implementation. They did not:
                // until that helper existed this was the ONLY one of the
                // three paths that posted anything at all.
                await postOrderDeliveredEntry(tx, {
                    orgId: ctx.orgId,
                    order,
                    previousStatus: order.status,
                    newStatus: input.status,
                    createdBy: ctx.userId,
                });

                return updated;
            });

            return { data: result, error: null, meta: null };
        }),
});
