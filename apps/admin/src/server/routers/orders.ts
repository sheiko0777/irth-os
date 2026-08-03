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

            const conditions = [eq(orders.orgId, ctx.orgId)];
            
            if (status) {
                conditions.push(eq(orders.status, status));
            }
            if (search) {
                conditions.push(ilike(orders.orderNumber, `%${search}%`));
            }
            if (dateRange?.from) {
                conditions.push(gte(orders.createdAt, dateRange.from));
            }
            if (dateRange?.to) {
                conditions.push(lte(orders.createdAt, dateRange.to));
            }

            // Execute list and count queries concurrently to reduce latency
            const [data, totalQuery] = await Promise.all([
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
                    .where(and(...conditions))
            ]);

            return {
                data,
                error: null,
                meta: {
                    total: totalQuery[0].count,
                    page,
                    pageSize,
                }
            };
        }),

    getById: protectedProcedure
        .input(z.object({
            id: z.string().uuid()
        }))
        .query(async ({ ctx, input }) => {
            // Execute order, items, and history queries concurrently to reduce latency
            const [order, items, history] = await Promise.all([
                ctx.db.query.orders.findFirst({
                    where: and(
                        eq(orders.id, input.id),
                        eq(orders.orgId, ctx.orgId)
                    )
                }),
                ctx.db
                    .select({
                        id: orderItems.id,
                        quantity: orderItems.quantity,
                        price: orderItems.price,
                        sku: productVariants.sku,
                    })
                    .from(orderItems)
                    .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
                    .where(and(
                        // Break sequential dependency by using input.id
                        eq(orderItems.orderId, input.id),
                        eq(orderItems.orgId, ctx.orgId)
                    )),
                ctx.db
                    .select()
                    .from(shipmentTracking)
                    .where(and(
                        // Break sequential dependency by using input.id
                        eq(shipmentTracking.orderId, input.id),
                        eq(shipmentTracking.orgId, ctx.orgId)
                    ))
                    .orderBy(desc(shipmentTracking.createdAt))
            ]);

            if (!order) {
                throw new TRPCError({ code: 'NOT_FOUND' });
            }

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

            const result = await withAudit(
                ctx.db,
                async () => {
                    const [updated] = await ctx.db.update(orders)
                        .set({ status: input.status, updatedAt: new Date() })
                        .where(and(
                            eq(orders.id, input.id),
                            eq(orders.orgId, ctx.orgId)
                        ))
                        .returning();
                    return updated;
                },
                {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    action: 'UPDATE_ORDER_STATUS',
                    tableName: 'orders',
                    changes: { from: order.status, to: input.status }
                }
            );

            // Trigger notification for status change
            await ctx.db.insert(notifications).values({
                orgId: ctx.orgId,
                userId: ctx.userId,
                type: 'order_status',
                title: `تحديث الطلب ${order.orderNumber}`,
                body: `تم تغيير حالة الطلب إلى: ${input.status}`,
                read: false,
            });

            return { data: result, error: null, meta: null };
        }),
});
