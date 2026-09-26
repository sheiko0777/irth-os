import { router, requirePermission } from '../trpc';
import { orders, orderItems, shipmentTracking, products, productVariants, orderStatusEnum, notifications, paginationMeta, paginationOffset } from '@irth/db';
import { paginationInputSchema } from '../pagination';
import { orderRepScope } from '../scopes';
import { orderAssignmentProcedures } from './orderAssignment';
import { eq, and, desc, count, ilike, gte, lte, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withAudit, emitOutboxEvent, buildOrderNotification, OUTBOX_EVENT_BY_STATUS, postOrderDeliveredEntry, transitionOrderStatus, type DbTx } from '@irth/db';
import { parseDecimal } from '@irth/domain';

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
/** The subset of a stored Shopify line the order page needs. */
interface StoredShopifyLine {
    sku?: string | null;
    variant_id?: number | string | null;
    name?: string | null;
    title?: string | null;
    quantity?: number;
    price?: string;
}

function shopifyVariantGid(id: number | string): string {
    const raw = String(id);
    return raw.startsWith('gid://') ? raw : `gid://shopify/ProductVariant/${raw}`;
}

/** Unknown, never zero, when the stored price is not a decimal. */
function lineUnitPriceMinor(price: string | undefined): bigint | null {
    if (!price) return null;
    try {
        return parseDecimal(price).minor;
    } catch {
        return null;
    }
}

/**
 * Every line the provider sent, as stored on `orders.source_payload` (0073),
 * each with the local variant it maps to or null. For a blocked order this is
 * the only place its lines exist — no order_items were written.
 */
async function sourceLinesOf(tx: DbTx, orgId: string, sourcePayload: unknown) {
    const raw = (sourcePayload as { line_items?: StoredShopifyLine[] } | null)?.line_items;
    const lines = Array.isArray(raw) ? raw : [];
    const gids = [...new Set(lines.filter((l) => l.variant_id).map((l) => shopifyVariantGid(l.variant_id as string)))];
    const mapped = gids.length === 0 ? [] : await tx
        .select({ id: productVariants.id, sku: productVariants.sku, name: productVariants.name, shopifyVariantId: productVariants.shopifyVariantId })
        .from(productVariants)
        .where(and(eq(productVariants.orgId, orgId), inArray(productVariants.shopifyVariantId, gids)));
    const byGid = new Map(mapped.map((v) => [v.shopifyVariantId, v]));
    return lines.map((line) => {
        const shopifyVariantId = line.variant_id ? shopifyVariantGid(line.variant_id) : null;
        const variant = shopifyVariantId ? byGid.get(shopifyVariantId) : undefined;
        return {
            label: line.name || line.title || line.sku || '—',
            sku: line.sku ?? null,
            shopifyVariantId,
            quantity: typeof line.quantity === 'number' ? line.quantity : 0,
            unitPriceMinor: lineUnitPriceMinor(line.price),
            mappedVariant: variant ? { id: variant.id, sku: variant.sku, name: variant.name } : null,
        };
    });
}

export const ordersRouter = router({
    ...orderAssignmentProcedures,
    list: requirePermission('orders', 'view')
        .input(z.object({
            ...paginationInputSchema(20),
            status: statusEnum.optional(),
            blockedOnly: z.boolean().optional(),
            search: z.string().max(100).optional(),
            dateRange: z.object({
                from: z.date().optional(),
                to: z.date().optional(),
            }).optional(),
        }))
        .query(async ({ ctx, input }) => {
            const { page, pageSize, status, blockedOnly, search, dateRange } = input;
            const offset = paginationOffset(page, pageSize);

            // Everything except the status filter. The status tab counts have to
            // respect the search and date narrowing, but not the tab the user is
            // standing on — otherwise every tab but the active one reads zero.
            const scope = [eq(orders.orgId, ctx.orgId)];
            // A rep granted orders.view sees only their own (PR-2a/2b).
            const rep = orderRepScope(ctx);
            if (rep) scope.push(rep);

            if (search) {
                scope.push(ilike(orders.orderNumber, `%${search}%`));
            }
            if (dateRange?.from) {
                scope.push(gte(orders.createdAt, dateRange.from));
            }
            if (dateRange?.to) {
                scope.push(lte(orders.createdAt, dateRange.to));
            }

            const conditions = status ? [...scope, eq(orders.status, status)] : [...scope];
            if (blockedOnly) conditions.push(eq(orders.importStatus, 'blocked'));

            // Execute list, count and status breakdown concurrently
            const [data, totalQuery, statusCountsQuery, blockedQuery] = await Promise.all([
                ctx.withOrg(async (tx) => tx
                    .select()
                    .from(orders)
                    .where(and(...conditions))
                    .orderBy(desc(orders.createdAt))
                    .limit(pageSize)
                    .offset(offset)),
                ctx.withOrg(async (tx) => tx
                    .select({ count: count() })
                    .from(orders)
                    .where(and(...conditions))),
                ctx.withOrg(async (tx) => tx
                    .select({ status: orders.status, count: count() })
                    .from(orders)
                    .where(and(...scope))
                    .groupBy(orders.status)),
                ctx.withOrg(async (tx) => tx
                    .select({ count: count() })
                    .from(orders)
                    .where(and(eq(orders.orgId, ctx.orgId), eq(orders.importStatus, 'blocked'), rep))),
            ]);

            return {
                data,
                error: null,
                meta: {
                    ...paginationMeta(page, pageSize, totalQuery[0].count),
                    statusCounts: statusCountsQuery.map((r) => ({ status: r.status, count: r.count })),
                    // Org-wide, not narrowed by the filters above: a blocked
                    // import is always worth surfacing.
                    blockedCount: blockedQuery[0]?.count ?? 0,
                }
            };
        }),

    getById: requirePermission('orders', 'view')
        .input(z.object({
            id: z.string().uuid()
        }))
        .query(async ({ ctx, input }) => {
            // order, items and history are all keyed by input.id (the order id
            // in the where clause is `eq(orders.id, input.id)`), so none of the
            // three reads depends on the others' results — run them in one
            // org-scoped transaction concurrently instead of three sequential
            // round-trips, matching the `list` procedure above. On the rare
            // not-found path the two extra queries just return empty.
            const [order, items, history] = await Promise.all([
                ctx.withOrg(async (tx) => tx.query.orders.findFirst({
                    where: and(
                        eq(orders.id, input.id),
                        eq(orders.orgId, ctx.orgId),
                        orderRepScope(ctx),
                    )
                })),
                ctx.withOrg(async (tx) => tx
                    .select({
                        id: orderItems.id,
                        quantity: orderItems.quantity,
                        priceMinor: orderItems.priceMinor,
                        sku: productVariants.sku,
                    })
                    .from(orderItems)
                    .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
                    .where(and(
                        eq(orderItems.orderId, input.id),
                        eq(orderItems.orgId, ctx.orgId)
                    ))),
                ctx.withOrg(async (tx) => tx
                    .select()
                    .from(shipmentTracking)
                    .where(and(
                        eq(shipmentTracking.orderId, input.id),
                        eq(shipmentTracking.orgId, ctx.orgId)
                    ))
                    .orderBy(desc(shipmentTracking.createdAt))),
            ]);

            if (!order) {
                throw new TRPCError({ code: 'NOT_FOUND' });
            }

            const sourceLines = order.sourcePayload
                ? await ctx.withOrg((tx) => sourceLinesOf(tx, ctx.orgId, order.sourcePayload))
                : [];

            return {
                data: { order: { ...order, sourcePayload: undefined }, items, history, sourceLines },
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
            const order = await ctx.withOrg(async (tx) => tx.query.orders.findFirst({
                where: and(
                    eq(orders.id, input.id),
                    eq(orders.orgId, ctx.orgId)
                )
            }));

            if (!order) {
                throw new TRPCError({ code: 'NOT_FOUND' });
            }

            // UX only: transitionOrderStatus refuses this in its WHERE clause
            // anyway. Without this the operator would see "not found".
            if (order.importStatus === 'blocked' && input.status !== 'cancelled') {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: 'الطلب متوقف لأن فيه بنود غير مربوطة. اربط البنود وأعد الاستيراد أولاً، أو ألغِ الطلب.',
                });
            }

            // Status change, audit row, staff notification and the customer
            // outbox event in one transaction. As separate autocommits, a
            // failure between them left the order advanced with no audit trail
            // and no notification — the customer never heard about a change
            // that had in fact happened, and in the other direction an outbox
            // row written outside the transaction would tell the customer about
            // a change that then rolled back.
            const result = await ctx.withOrg(async (tx) => {
                const transition = await transitionOrderStatus(tx, {
                    orgId: ctx.orgId, orderId: input.id, newStatus: input.status,
                });
                if (!transition) throw new TRPCError({ code: 'NOT_FOUND' });
                const { previousStatus } = transition;
                const updated = await withAudit(
                    tx,
                    async () => {
                        // Preserve the response shape and database timestamp after the raw update.
                        const [row] = await tx.select().from(orders)
                            .where(and(
                                eq(orders.id, input.id),
                                eq(orders.orgId, ctx.orgId)
                            ));
                        return row;
                    },
                    {
                        orgId: ctx.orgId,
                        userId: ctx.userId,
                        action: 'UPDATE_ORDER_STATUS',
                        tableName: 'orders',
                        changes: { from: previousStatus, to: input.status }
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
                // The locked transition result also prevents concurrent re-notification.
                if (eventType && previousStatus !== input.status) {
                    const payload = await buildOrderNotification(tx, ctx.orgId, order, eventType);
                    if (payload) {
                        await emitOutboxEvent(tx, { orgId: ctx.orgId, eventType, payload });
                    }
                }

                // Same as apps/api's PATCH /:id/status and the Bosta webhook:
                // a delivery marked here must file its ETA tax invoice too.
                if (input.status === 'delivered' && previousStatus !== input.status) {
                    await emitOutboxEvent(tx, {
                        orgId: ctx.orgId,
                        eventType: 'eta.invoice.issue',
                        payload: { orgId: ctx.orgId, orderId: order.id },
                    });
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
                    previousStatus,
                    newStatus: input.status,
                    createdBy: ctx.userId,
                });

                return updated;
            });

            return { data: result, error: null, meta: null };
        }),
    /**
     * Variants the operator can link a blocked Shopify line to: only ones not
     * already linked to a Shopify variant, since that link is one-to-one per
     * org (product_variants_org_id_shopify_variant_id_idx).
     */
    mappableVariants: requirePermission('orders', 'write')
        .input(z.object({ search: z.string().max(100).optional() }))
        .query(async ({ ctx, input }) => {
            const term = input.search?.trim();
            const rows = await ctx.withOrg(async (tx) => tx
                .select({ id: productVariants.id, sku: productVariants.sku, name: productVariants.name, productName: products.name })
                .from(productVariants)
                .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.orgId, ctx.orgId)))
                .where(and(
                    eq(productVariants.orgId, ctx.orgId),
                    isNull(productVariants.shopifyVariantId),
                    term ? or(ilike(productVariants.sku, `%${term}%`), ilike(productVariants.name, `%${term}%`), ilike(products.name, `%${term}%`)) : undefined,
                ))
                .orderBy(productVariants.sku)
                .limit(50));
            return { data: rows, error: null, meta: null };
        }),

    /**
     * Links a blocked order's Shopify lines to local variants, then queues the
     * re-import (outbox `shopify.order.reimport`, run by apps/api's worker with
     * the same line logic as the webhook).
     *
     * The link is permanent: the next Shopify order with that variant imports
     * without blocking. Each link is guarded in the UPDATE's WHERE — the
     * variant must belong to this org and not already point at a different
     * Shopify variant — so a stale form cannot re-point a linked product.
     * Items and stock are the worker's job, which is idempotent on the order's
     * 'blocked' status, so calling this twice queues a harmless no-op.
     */
    resolveBlocked: requirePermission('orders', 'write')
        .input(z.object({
            orderId: z.string().uuid(),
            mappings: z.array(z.object({
                shopifyVariantId: z.string().min(1).max(200).regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
                variantId: z.string().uuid(),
            })).max(100),
        }))
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.withOrg(async (tx) => {
                const [order] = await tx.select({ id: orders.id, orderNumber: orders.orderNumber, importStatus: orders.importStatus, status: orders.status })
                    .from(orders)
                    .where(and(eq(orders.id, input.orderId), eq(orders.orgId, ctx.orgId)))
                    .for('update');
                if (!order) throw new TRPCError({ code: 'NOT_FOUND' });
                if (order.importStatus !== 'blocked') {
                    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'الطلب ليس متوقفاً.' });
                }
                if (order.status === 'cancelled') {
                    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'لا يمكن استيراد طلب ملغي.' });
                }

                return withAudit(tx, async () => {
                    for (const mapping of input.mappings) {
                        const linked = await tx.update(productVariants)
                            .set({ shopifyVariantId: mapping.shopifyVariantId })
                            .where(and(
                                eq(productVariants.id, mapping.variantId),
                                eq(productVariants.orgId, ctx.orgId),
                                or(isNull(productVariants.shopifyVariantId), eq(productVariants.shopifyVariantId, mapping.shopifyVariantId)),
                            ))
                            .returning({ id: productVariants.id });
                        if (linked.length === 0) {
                            throw new TRPCError({
                                code: 'CONFLICT',
                                message: 'المنتج المختار مربوط بالفعل بمنتج آخر في Shopify أو غير موجود.',
                            });
                        }
                    }
                    await emitOutboxEvent(tx, {
                        orgId: ctx.orgId,
                        eventType: 'shopify.order.reimport',
                        payload: { orderId: order.id },
                    });
                    return { id: order.id, queued: true };
                }, {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    action: 'ORDER_IMPORT_LINES_MAPPED',
                    tableName: 'orders',
                    changes: { orderNumber: order.orderNumber, mappings: input.mappings },
                });
            });
            return { data: result, error: null, meta: null };
        }),
});
