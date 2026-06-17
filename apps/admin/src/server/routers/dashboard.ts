import { router, protectedProcedure } from '../trpc';
import { orders, orderItems, shipmentTracking, productVariants, products } from '@irth/db';
import { eq, and, desc, sql, count, sum, ilike, gte, lte, lt } from 'drizzle-orm';
import { z } from 'zod';

export const dashboardRouter = router({
    getStats: protectedProcedure.query(async ({ ctx }) => {
        // Total orders today
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        // Batch independent queries — O(max latency) instead of O(4 × latency)
        const [
            ordersTodayQuery,
            revenueTodayQuery,
            pendingOrdersQuery,
            activeProductsQuery
        ] = await Promise.all([
            ctx.db
                .select({ count: count() })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, startOfDay))),
            ctx.db
                .select({ total: sum(orders.totalAmount) })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, startOfDay), eq(orders.status, 'delivered'))),
            ctx.db
                .select({ count: count() })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), eq(orders.status, 'pending'))),
            ctx.db
                .select({ count: count() })
                .from(products)
                .where(and(eq(products.orgId, ctx.orgId), eq(products.status, 'active'))),
        ]);

        return {
            data: {
                ordersToday: ordersTodayQuery[0]?.count ?? 0,
                revenueToday: parseFloat((revenueTodayQuery[0]?.total as unknown as string) ?? '0'),
                pendingOrders: pendingOrdersQuery[0]?.count ?? 0,
                activeProducts: activeProductsQuery[0]?.count ?? 0,
            },
            error: null,
            meta: null
        };
    }),

    getRecentOrders: protectedProcedure.query(async ({ ctx }) => {
        const recentOrders = await ctx.db
            .select({
                id: orders.id,
                orderNumber: orders.orderNumber,
                status: orders.status,
                totalAmount: orders.totalAmount,
                createdAt: orders.createdAt,
            })
            .from(orders)
            .where(eq(orders.orgId, ctx.orgId))
            .orderBy(desc(orders.createdAt))
            .limit(6);

        return { data: recentOrders, error: null, meta: null };
    }),
});
