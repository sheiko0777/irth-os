import { router, protectedProcedure, adminProcedure } from '../trpc';
import { orders, orderItems, products, productVariants } from '@irth/db';
import { eq, and, desc, count, sum, gte, lte } from 'drizzle-orm';
import { EGYPT_VAT_BP, divideRoundHalfEven, formatMoney, fromMinor, netOfTax, taxIncludedIn } from '@irth/domain';
import { z } from 'zod';

export const financeRouter = router({
    pnl: adminProcedure
        .input(z.object({
            startDate: z.string(),
            endDate: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            const start = new Date(input.startDate);
            const end = new Date(input.endDate);
            end.setHours(23, 59, 59, 999);

            const [
                deliveredQuery,
                totalOrdersQuery,
                cancelledQuery,
                pendingQuery
            ] = await Promise.all([
                ctx.db
                    .select({ total: sum(orders.totalAmountMinor) })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        gte(orders.createdAt, start),
                        lte(orders.createdAt, end),
                        eq(orders.status, 'delivered')
                    )),
                ctx.db
                    .select({ count: count() })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        gte(orders.createdAt, start),
                        lte(orders.createdAt, end)
                    )),
                ctx.db
                    .select({ count: count() })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        gte(orders.createdAt, start),
                        lte(orders.createdAt, end),
                        eq(orders.status, 'cancelled')
                    )),
                ctx.db
                    .select({ count: count() })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        gte(orders.createdAt, start),
                        lte(orders.createdAt, end),
                        eq(orders.status, 'pending')
                    )),
            ]);

            const totalRevenueMinor = BigInt((deliveredQuery[0]?.total as string | null) ?? '0');
            const totalOrders = totalOrdersQuery[0]?.count ?? 0;
            const avgOrderValueMinor = totalOrders > 0
                ? divideRoundHalfEven(totalRevenueMinor, BigInt(totalOrders))
                : BigInt(0);
            const cancelledOrders = cancelledQuery[0]?.count ?? 0;
            const pendingOrders = pendingQuery[0]?.count ?? 0;

            return {
                data: {
                    totalRevenue: fromMinor(totalRevenueMinor),
                    totalOrders,
                    avgOrderValue: fromMinor(avgOrderValueMinor),
                    cancelledOrders,
                    pendingOrders,
                    startDate: input.startDate,
                    endDate: input.endDate
                },
                error: null,
                meta: null
            };
        }),

    codReconciliation: adminProcedure
        .input(z.object({
            startDate: z.string(),
            endDate: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            const start = new Date(input.startDate);
            const end = new Date(input.endDate);
            end.setHours(23, 59, 59, 999);

            // Since there is no paymentMethod column, querying all delivered orders
            const rows = await ctx.db
                .select({
                    orderId: orders.id,
                    orderNumber: orders.orderNumber,
                    amount: orders.totalAmountMinor,
                    status: orders.status,
                    createdAt: orders.createdAt,
                })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, start),
                    lte(orders.createdAt, end),
                    eq(orders.status, 'delivered')
                ))
                .orderBy(desc(orders.createdAt));

            return {
                data: rows,
                error: null,
                meta: null
            };
        }),

    vatReport: adminProcedure
        .input(z.object({
            startDate: z.string(),
            endDate: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            const start = new Date(input.startDate);
            const end = new Date(input.endDate);
            end.setHours(23, 59, 59, 999);

            const result = await ctx.db
                .select({
                    total: sum(orders.totalAmountMinor),
                    count: count(),
                })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, start),
                    lte(orders.createdAt, end),
                    eq(orders.status, 'delivered')
                ));

            const grossRevenue = fromMinor(BigInt((result[0]?.total as string | null) ?? '0'));
            const orderCount = result[0]?.count ?? 0;
            const vatAmount = taxIncludedIn(grossRevenue, EGYPT_VAT_BP);
            const netRevenue = netOfTax(grossRevenue, EGYPT_VAT_BP);

            return {
                data: {
                    grossRevenue,
                    vatAmount,
                    netRevenue,
                    orderCount,
                    startDate: input.startDate,
                    endDate: input.endDate
                },
                error: null,
                meta: null
            };
        }),

    askAi: adminProcedure
        .input(z.object({
            question: z.string().max(500),
        }))
        .mutation(async ({ ctx, input }) => {
            const q = input.question.toLowerCase();
            let resultData: string;
            let queryStr: string;

            if (q.includes('اكثر') || q.includes('top') || q.includes('best')) {
                queryStr = "SELECT p.name, COUNT(oi.id) as order_count FROM order_items oi JOIN product_variants pv ON oi.variant_id = pv.id JOIN products p ON pv.product_id = p.id JOIN orders o ON oi.order_id = o.id WHERE o.org_id = ? GROUP BY p.name ORDER BY order_count DESC LIMIT 5";

                const topProducts = await ctx.db
                    .select({
                        name: products.name,
                        orderCount: count(orderItems.id)
                    })
                    .from(orderItems)
                    .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
                    .innerJoin(products, eq(productVariants.productId, products.id))
                    .innerJoin(orders, eq(orderItems.orderId, orders.id))
                    .where(eq(orders.orgId, ctx.orgId))
                    .groupBy(products.name)
                    .orderBy(desc(count(orderItems.id)))
                    .limit(5);

                if (topProducts.length === 0) {
                    resultData = "لا توجد منتجات مباعة.";
                } else {
                    resultData = "أكثر 5 منتجات مبيعاً:\n" + topProducts.map((p: {name: string | null; orderCount: number}, i: number) => `${i + 1}. ${p.name} (${p.orderCount} طلب)`).join('\n');
                }
            } else if (q.includes('revenue') || q.includes('ايراد')) {
                queryStr = "SELECT SUM(total_amount_minor) FROM orders WHERE org_id = ? AND status = 'delivered' AND created_at >= NOW() - INTERVAL '30 days'";

                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                const revRes = await ctx.db
                    .select({ total: sum(orders.totalAmountMinor) })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        eq(orders.status, 'delivered'),
                        gte(orders.createdAt, thirtyDaysAgo)
                    ));

                const rev = fromMinor(BigInt((revRes[0]?.total as string | null) ?? '0'));
                resultData = `إجمالي الإيرادات في آخر 30 يوماً: ${formatMoney(rev)}`;
            } else if (q.includes('pending') || q.includes('معلق')) {
                queryStr = "SELECT COUNT(*) FROM orders WHERE org_id = ? AND status = 'pending'";

                const pendRes = await ctx.db
                    .select({ count: count() })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        eq(orders.status, 'pending')
                    ));

                resultData = `عدد الطلبات المعلقة: ${pendRes[0]?.count ?? 0}`;
            } else {
                queryStr = "SELECT COUNT(*) FROM orders WHERE org_id = ? AND created_at >= CURRENT_DATE";

                const startOfDay = new Date();
                startOfDay.setHours(0, 0, 0, 0);

                const todayRes = await ctx.db
                    .select({ count: count() })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        gte(orders.createdAt, startOfDay)
                    ));

                resultData = `إجمالي طلبات اليوم: ${todayRes[0]?.count ?? 0}`;
            }

            return {
                data: {
                    question: input.question,
                    result: resultData,
                    query: queryStr
                },
                error: null,
                meta: null
            };
        })
});


