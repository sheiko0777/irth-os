import { router, protectedProcedure, adminProcedure } from '../trpc';
import { orders, orderItems, shipmentTracking, productVariants, orderStatusEnum, notifications, customers, orgSettings } from '@irth/db';
import { eq, and, desc, sql, count, ilike, gte, lte, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withAudit, emitOutboxEvent } from '@irth/db';
import type { DbTx, OutboxEventType, OrderNotificationPayload } from '@irth/db';

const statusEnum = z.enum(orderStatusEnum.enumValues);

/**
 * Which order statuses the customer is told about, and under which event type.
 *
 * Derived from the consumer, not from what feels notification-worthy:
 * `apps/api/src/workers/outboxWorker.ts` branches on exactly `order.confirmed`
 * and `order.shipped`. An event for `delivered` or `cancelled` would be polled,
 * match no branch, and be marked processed having sent nothing — indistinguish-
 * able from a successful send on the Integrations screen. Add the worker branch
 * first, then the entry here.
 */
const OUTBOX_EVENT_BY_STATUS: Partial<Record<(typeof orderStatusEnum.enumValues)[number], OutboxEventType>> = {
    confirmed: 'order.confirmed',
    shipped: 'order.shipped',
};

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
const TRACKING_URL_TEMPLATE_KEY = 'shipping.tracking_url_template';

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
async function buildOrderNotification(
    tx: Pick<DbTx, 'select' | 'rollback'>,
    orgId: string,
    order: { id: string; orderNumber: string; customerId: string | null },
    eventType: OutboxEventType,
): Promise<OrderNotificationPayload | undefined> {
    // orders.customerId is nullable and is NOT a user id — it references
    // customers.id, which is where the contact details live. An order placed
    // before a customer record exists has nobody to notify.
    const [contact] = order.customerId
        ? await tx
              .select({ name: customers.name, email: customers.email, phone: customers.phone })
              .from(customers)
              .where(and(eq(customers.id, order.customerId), eq(customers.orgId, orgId)))
              .limit(1)
        : [];

    const phone = contact?.phone ?? undefined;
    const email = contact?.email ?? undefined;

    const reachable = eventType === 'order.shipped' ? Boolean(phone) : Boolean(phone || email);
    if (!reachable) return undefined;

    return {
        orderNumber: order.orderNumber,
        customerName: contact?.name ?? undefined,
        customerPhone: phone,
        customerEmail: email,
        trackingUrl: eventType === 'order.shipped' ? await trackingUrlFor(tx, orgId, order.id) : undefined,
    };
}

/** Latest waybill for the order rendered into the org's tracking URL template, or undefined. */
async function trackingUrlFor(
    tx: Pick<DbTx, 'select' | 'rollback'>,
    orgId: string,
    orderId: string,
): Promise<string | undefined> {
    const [tracked] = await tx
        .select({ trackingNumber: shipmentTracking.trackingNumber })
        .from(shipmentTracking)
        .where(and(
            eq(shipmentTracking.orderId, orderId),
            eq(shipmentTracking.orgId, orgId),
            // A shipment row is created before the waybill comes back from the
            // courier, so the most recent row is not necessarily the one that
            // has a number. Skip the ones that do not.
            isNotNull(shipmentTracking.trackingNumber),
        ))
        .orderBy(desc(shipmentTracking.createdAt))
        .limit(1);

    if (!tracked?.trackingNumber) return undefined;

    const [template] = await tx
        .select({ value: orgSettings.value })
        .from(orgSettings)
        .where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, TRACKING_URL_TEMPLATE_KEY)))
        .limit(1);

    if (!template?.value) return undefined;

    return template.value.replace('{tracking}', tracked.trackingNumber);
}

export const ordersRouter = router({
    list: protectedProcedure
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

    getById: protectedProcedure
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

    updateStatus: adminProcedure
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

                return updated;
            });

            return { data: result, error: null, meta: null };
        }),
});
