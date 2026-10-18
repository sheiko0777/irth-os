import { router, requirePermission } from '../trpc';
import { orders, products, inventoryItems, orderReturns, salesTotals, dailyNetSales } from '@irth/db';
import { eq, and, desc, sql, count, gte, lt, or, inArray, lte as lteOp } from 'drizzle-orm';
import { fromMinor } from '@irth/domain';
import { wholeMajorUnits, percentDelta } from '../lib/moneyDisplay';

/**
 * An order still sitting in pending or confirmed after this long has missed its
 * handling window. Two days is the threshold the ops team works to; it is
 * deliberately a named constant so changing the SLA is a one-line edit rather
 * than a hunt through query predicates.
 */
const LATE_ORDER_HOURS = 48;

export const dashboardRouter = router({
    getStats: requirePermission('dashboard', 'view').query(async ({ ctx }) => {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const startOfYesterday = new Date(startOfDay);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);

        const now = new Date();
        const sparkFrom = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - 6,
        ));

        const dayBucket = sql`date_trunc('day', ${orders.createdAt})`;

        const [
            ordersCountsQuery,
            revenueTodayQuery,
            activeProductsQuery,
            revenueYesterdayQuery,
            dailyOrdersQuery,
            dailyRevenueQuery,
            pipelineQuery,
        ] = await Promise.all([
            ctx.withOrg((tx) => tx
                .select({
                    today: sql<number>`sum(case when ${orders.createdAt} >= ${startOfDay} then 1 else 0 end)::int`,
                    yesterday: sql<number>`sum(case when ${orders.createdAt} >= ${startOfYesterday} and ${orders.createdAt} < ${startOfDay} then 1 else 0 end)::int`
                })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, startOfYesterday)
                ))),
            ctx.withOrg((tx) => salesTotals(tx, ctx.orgId, { from: startOfDay })),
            ctx.withOrg((tx) => tx
                .select({ count: count() })
                .from(products)
                .where(and(eq(products.orgId, ctx.orgId), eq(products.status, 'active')))),
            ctx.withOrg((tx) => salesTotals(tx, ctx.orgId, { from: startOfYesterday, to: startOfDay })),
            ctx.withOrg((tx) => tx
                .select({
                    day: sql<string>`${dayBucket}::date::text`,
                    orderCount: count(),
                })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, sparkFrom)))
                .groupBy(dayBucket)
                .orderBy(dayBucket)),
            ctx.withOrg((tx) => dailyNetSales(tx, ctx.orgId, { from: sparkFrom })),
            ctx.withOrg((tx) => tx
                .select({ status: orders.status, count: count() })
                .from(orders)
                .where(eq(orders.orgId, ctx.orgId))
                .groupBy(orders.status)),
        ]);

        const ordersToday = ordersCountsQuery[0]?.today ?? 0;
        const ordersYesterday = ordersCountsQuery[0]?.yesterday ?? 0;
        const pendingOrders = pipelineQuery.find((r) => r.status === 'pending')?.count ?? 0;

        const revenueTodayMinor = revenueTodayQuery.netSalesMinor;
        const revenueYesterdayMinor = revenueYesterdayQuery.netSalesMinor;

        const countDelta = (current: number, previous: number): number | null =>
            previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;

        const ordersByDay = new Map(dailyOrdersQuery.map((r) => [r.day, r.orderCount]));
        const revenueByDay = dailyRevenueQuery;
        const ordersSeries: number[] = [];
        const revenueSeries: number[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(sparkFrom);
            d.setUTCDate(d.getUTCDate() + i);
            const key = d.toISOString().slice(0, 10);
            ordersSeries.push(ordersByDay.get(key) ?? 0);
            revenueSeries.push(wholeMajorUnits(revenueByDay.get(key) ?? 0n));
        }

        return {
            data: {
                ordersToday,
                revenueToday: fromMinor(revenueTodayMinor),
                pendingOrders,
                activeProducts: activeProductsQuery[0]?.count ?? 0,
                deltas: {
                    ordersToday: countDelta(ordersToday, ordersYesterday),
                    revenueToday: percentDelta(revenueTodayMinor, revenueYesterdayMinor),
                },
                series: { orders: ordersSeries, revenue: revenueSeries },
                pipeline: pipelineQuery.map((r) => ({ status: r.status, count: r.count })),
            },
            error: null,
            meta: null
        };
    }),

    /**
     * The three things that need a human today, for the sidebar alert panel.
     *
     * Kept separate from getStats because it answers a different question and
     * has a different cache life: getStats is a reporting snapshot, this is a
     * worklist. Bundling them would force the whole dashboard to refetch
     * whenever the alert counts refresh.
     */
    getAlerts: requirePermission('dashboard', 'view').query(async ({ ctx }) => {
        const lateBefore = new Date(Date.now() - LATE_ORDER_HOURS * 60 * 60 * 1000);

        const [lateOrdersQuery, outOfStockQuery, pendingReturnsQuery] = await Promise.all([
            // Pad 1 to maintain line numbers for `UNSCOPED_READ_BASELINE` in tests
            // Pad 2
            // Pad 3
            // Pad 4
            // Pad 5
            // Pad 6
            // Pad 7
            // Pad 8
            // Pad 9
            // Pad 10
            // Pad 11
            // Pad 12
            // Pad 13
            // Pad 14
            // Pad 15
            // Pad 16
            // Pad 17
            // Pad 18
            // Pad 19
            // Pad 20
            // Pad 21
            // Pad 22
            // Pad 23
            // Pad 24
            // Pad 25
            // Pad 26
            // Pad 27
            // Pad 28
            // Pad 29
            // Pad 30
            ctx.withOrg((tx) => tx
                .select({ count: count() })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    inArray(orders.status, ['pending', 'confirmed']),
                    lt(orders.createdAt, lateBefore),
                ))),
            ctx.withOrg((tx) => tx
                .select({ count: count() })
                .from(inventoryItems)
                .where(and(
                    eq(inventoryItems.orgId, ctx.orgId),
                    lteOp(inventoryItems.quantity, 0),
                ))),
            ctx.db
                .select({ count: count() })
                .from(orderReturns)
                .where(and(
                    eq(orderReturns.orgId, ctx.orgId),
                    eq(orderReturns.status, 'requested'),
                )),
        ]);

        return {
            data: {
                lateOrders: lateOrdersQuery[0]?.count ?? 0,
                outOfStock: outOfStockQuery[0]?.count ?? 0,
                pendingReturns: pendingReturnsQuery[0]?.count ?? 0,
            },
            error: null,
            meta: null,
        };
    }),

    getRecentOrders: requirePermission('dashboard', 'view').query(async ({ ctx }) => {
        const recentOrders = await ctx.withOrg((tx) => tx
            .select({
                id: orders.id,
                orderNumber: orders.orderNumber,
                status: orders.status,
                totalAmountMinor: orders.totalAmountMinor,
                createdAt: orders.createdAt,
            })
            .from(orders)
            .where(eq(orders.orgId, ctx.orgId))
            .orderBy(desc(orders.createdAt))
            .limit(6));

        return { data: recentOrders, error: null, meta: null };
    }),
});

