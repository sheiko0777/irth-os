import { router, protectedProcedure } from '../trpc';
import { orders, orderItems, products, productVariants } from '@irth/db';
import { eq, and, desc, sql, count, sum, gte, lte } from 'drizzle-orm';
import { z } from 'zod';

export const financeRouter = router({
    pnl: protectedProcedure
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
                    .select({ total: sum(orders.totalAmount) })
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

            const totalRevenue = parseFloat((deliveredQuery[0]?.total as unknown as string) ?? '0');
            const totalOrders = totalOrdersQuery[0]?.count ?? 0;
            const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
            const cancelledOrders = cancelledQuery[0]?.count ?? 0;
            const pendingOrders = pendingQuery[0]?.count ?? 0;

            return {
                data: {
                    totalRevenue,
                    totalOrders,
                    avgOrderValue,
                    cancelledOrders,
                    pendingOrders,
                    startDate: input.startDate,
                    endDate: input.endDate
                },
                error: null,
                meta: null
            };
        }),

    codReconciliation: protectedProcedure
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
                    amount: orders.totalAmount,
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

    vatReport: protectedProcedure
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
                    total: sum(orders.totalAmount),
                    count: count(),
                })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, start),
                    lte(orders.createdAt, end),
                    eq(orders.status, 'delivered')
                ));

            const grossRevenue = parseFloat((result[0]?.total as unknown as string) ?? '0');
            const orderCount = result[0]?.count ?? 0;
            const vatAmount = grossRevenue * 0.14;
            const netRevenue = grossRevenue * 0.86;

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

    askAi: protectedProcedure
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
                queryStr = "SELECT SUM(total_amount) FROM orders WHERE org_id = ? AND status = 'delivered' AND created_at >= NOW() - INTERVAL '30 days'";

                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                const revRes = await ctx.db
                    .select({ total: sum(orders.totalAmount) })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        eq(orders.status, 'delivered'),
                        gte(orders.createdAt, thirtyDaysAgo)
                    ));

                const rev = parseFloat((revRes[0]?.total as unknown as string) ?? '0');
                resultData = `إجمالي الإيرادات في آخر 30 يوماً: ${rev.toLocaleString('ar-EG')} ج.م`;
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
