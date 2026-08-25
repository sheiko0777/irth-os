import { router, protectedProcedure } from '../trpc';
import { orders, orderItems, shipmentTracking, productVariants, products, inventoryItems, orderReturns } from '@irth/db';
import { eq, and, desc, sql, count, sum, ilike, gte, lte, lt, or, inArray, lte as lteOp } from 'drizzle-orm';
import { z } from 'zod';
import { fromMinor } from '@irth/domain';
import { wholeMajorUnits, percentDelta } from '../lib/moneyDisplay';

/**
 * An order still sitting in pending or confirmed after this long has missed its
 * handling window. Two days is the threshold the ops team works to; it is
 * deliberately a named constant so changing the SLA is a one-line edit rather
 * than a hunt through query predicates.
 */
const LATE_ORDER_HOURS = 48;
function bigintTotal(value: unknown): bigint {
    return BigInt((value as string | null) ?? '0');
}

export const dashboardRouter = router({
    getStats: protectedProcedure.query(async ({ ctx }) => {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        // Yesterday's window, used for the delta chips on the two flow metrics.
        const startOfYesterday = new Date(startOfDay);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);

        // Seven-day window (today inclusive) backing the KPI sparklines.
        //
        // Bucketed in UTC on both sides: Postgres truncates the stored timestamp,
        // so the JS keys must be UTC too or every bucket misses and the lines
        // flatline to zero.
        //
        // Anchored on the current instant's UTC date, deliberately not on
        // `startOfDay`. That value is local midnight, whose UTC date is the day
        // before anywhere east of Greenwich (Cairo is UTC+2, so local midnight is
        // 22:00 the previous UTC day) — anchoring there slides the whole window
        // back a day and drops today off the end of the chart.
        const now = new Date();
        const sparkFrom = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - 6,
        ));

        const dayBucket = sql`date_trunc('day', ${orders.createdAt})`;

        // Batch independent queries — O(max latency) instead of O(n × latency)
        const [
            ordersTodayQuery,
            revenueTodayQuery,
            pendingOrdersQuery,
            activeProductsQuery,
            ordersYesterdayQuery,
            revenueYesterdayQuery,
            dailyOrdersQuery,
            dailyRevenueQuery,
            pipelineQuery,
        ] = await Promise.all([
            ctx.db
                .select({ count: count() })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, startOfDay))),
            ctx.db
                .select({ total: sum(orders.totalAmountMinor) })
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
            ctx.db
                .select({ count: count() })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, startOfYesterday),
                    lt(orders.createdAt, startOfDay),
                )),
            ctx.db
                .select({ total: sum(orders.totalAmountMinor) })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, startOfYesterday),
                    lt(orders.createdAt, startOfDay),
                    eq(orders.status, 'delivered'),
                )),
            ctx.db
                .select({
                    day: sql<string>`${dayBucket}::date::text`,
                    orderCount: count(),
                })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, sparkFrom)))
                .groupBy(dayBucket)
                .orderBy(dayBucket),
            // Revenue series filters to delivered, matching revenueToday. One
            // shared query here silently summed every status, so the headline
            // and its own trend line measured different things — caught by
            // adversarial review.
            ctx.db
                .select({
                    day: sql<string>`${dayBucket}::date::text`,
                    revenue: sum(orders.totalAmountMinor),
                })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, sparkFrom),
                    eq(orders.status, 'delivered'),
                ))
                .groupBy(dayBucket)
                .orderBy(dayBucket),
            ctx.db
                .select({ status: orders.status, count: count() })
                .from(orders)
                .where(eq(orders.orgId, ctx.orgId))
                .groupBy(orders.status),
        ]);

        const ordersToday = ordersTodayQuery[0]?.count ?? 0;
        const ordersYesterday = ordersYesterdayQuery[0]?.count ?? 0;

        // Drizzle's sum() over a bigint column returns a numeric STRING (and null
        // when no rows matched). BigInt() keeps it exact; parseFloat would put
        // revenue back on a float the moment it left the database.
        const revenueTodayMinor = bigintTotal(revenueTodayQuery[0]?.total);
        const revenueYesterdayMinor = bigintTotal(revenueYesterdayQuery[0]?.total);

        // Percent change against the same window a day earlier. Null rather than
        // a fabricated 0% or an Infinity when there is no prior value to divide by.
        // Counts are plain integers, so they get their own delta — percentDelta
        // takes bigint minor units and is for money.
        const countDelta = (current: number, previous: number): number | null =>
            previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;

        // The grouped queries only emit rows for days that actually traded, so
        // fill the gaps — a sparkline needs a point per day or it misreads the shape.
        const ordersByDay = new Map(dailyOrdersQuery.map((r) => [r.day, r.orderCount]));
        const revenueByDay = new Map(dailyRevenueQuery.map((r) => [r.day, r.revenue]));
        const ordersSeries: number[] = [];
        const revenueSeries: number[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(sparkFrom);
            d.setUTCDate(d.getUTCDate() + i);
            const key = d.toISOString().slice(0, 10);
            ordersSeries.push(ordersByDay.get(key) ?? 0);
            revenueSeries.push(wholeMajorUnits(bigintTotal(revenueByDay.get(key))));
        }

        return {
            data: {
                ordersToday,
                revenueToday: fromMinor(revenueTodayMinor),
                pendingOrders: pendingOrdersQuery[0]?.count ?? 0,
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
    getAlerts: protectedProcedure.query(async ({ ctx }) => {
        const lateBefore = new Date(Date.now() - LATE_ORDER_HOURS * 60 * 60 * 1000);

        const [lateOrdersQuery, outOfStockQuery, pendingReturnsQuery] = await Promise.all([
            ctx.db
                .select({ count: count() })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    inArray(orders.status, ['pending', 'confirmed']),
                    lt(orders.createdAt, lateBefore),
                )),
            ctx.db
                .select({ count: count() })
                .from(inventoryItems)
                .where(and(
                    eq(inventoryItems.orgId, ctx.orgId),
                    lteOp(inventoryItems.quantity, 0),
                )),
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

    getRecentOrders: protectedProcedure.query(async ({ ctx }) => {
        const recentOrders = await ctx.db
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
            .limit(6);

        return { data: recentOrders, error: null, meta: null };
    }),
});

