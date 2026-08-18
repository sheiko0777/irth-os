import { router, protectedProcedure, adminProcedure } from '../trpc';
import { orders, orderItems, shipmentTracking, productVariants, orderStatusEnum, notifications } from '@irth/db';
import { eq, and, desc, sql, count, ilike, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withAudit } from '@irth/db';

const statusEnum = z.enum(orderStatusEnum.enumValues);

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

            // Status change, audit row and notification in one transaction.
            // As three autocommits, a failure between them left the order
            // advanced with no audit trail and no notification — the customer
            // never heard about a change that had in fact happened.
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

                return updated;
            });

            return { data: result, error: null, meta: null };
        }),
});
