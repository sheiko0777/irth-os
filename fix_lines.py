with open("apps/admin/src/server/routers/dashboard.ts", "r") as f:
    lines = f.readlines()

old_1 = """        const [
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
            ctx.withOrg((tx) => tx
                .select({ count: count() })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, startOfDay)))),
            // Revenue reads the ledger (CLAUDE.md rule 2), never orders: net
            // sales ex-VAT, less returns, dated when the sale was recognised.
            ctx.withOrg((tx) => salesTotals(tx, ctx.orgId, { from: startOfDay })),
            ctx.withOrg((tx) => tx
                .select({ count: count() })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), eq(orders.status, 'pending')))),
            ctx.withOrg((tx) => tx
                .select({ count: count() })
                .from(products)
                .where(and(eq(products.orgId, ctx.orgId), eq(products.status, 'active')))),
            ctx.withOrg((tx) => tx
                .select({ count: count() })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, startOfYesterday),
                    lt(orders.createdAt, startOfDay),
                ))),
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
            // Same source as revenueToday so the headline and its trend line
            // measure the same thing.
            ctx.withOrg((tx) => dailyNetSales(tx, ctx.orgId, { from: sparkFrom })),
            ctx.withOrg((tx) => tx
                .select({ status: orders.status, count: count() })
                .from(orders)
                .where(eq(orders.orgId, ctx.orgId))
                .groupBy(orders.status)),
        ]);"""

new_1 = """        const [
            ordersTodayQuery,
            revenueTodayQuery,
            pendingOrdersQuery,
            activeProductsQuery,
            ordersYesterdayQuery,
            revenueYesterdayQuery,
            dailyOrdersQuery,
            dailyRevenueQuery,
            pipelineQuery,
        ] = await ctx.withOrg(async (tx) => [
            await tx
                .select({ count: count() })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, startOfDay))),
            // Revenue reads the ledger (CLAUDE.md rule 2), never orders: net
            // sales ex-VAT, less returns, dated when the sale was recognised.
            await salesTotals(tx, ctx.orgId, { from: startOfDay }),
            await tx
                .select({ count: count() })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), eq(orders.status, 'pending'))),
            await tx
                .select({ count: count() })
                .from(products)
                .where(and(eq(products.orgId, ctx.orgId), eq(products.status, 'active'))),
            await tx
                .select({ count: count() })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, startOfYesterday),
                    lt(orders.createdAt, startOfDay),
                )),
            await salesTotals(tx, ctx.orgId, { from: startOfYesterday, to: startOfDay }),
            await tx
                .select({
                    day: sql<string>`${dayBucket}::date::text`,
                    orderCount: count(),
                })
                .from(orders)
                .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, sparkFrom)))
                .groupBy(dayBucket)
                .orderBy(dayBucket),
            // Same source as revenueToday so the headline and its trend line
            // measure the same thing.
            await dailyNetSales(tx, ctx.orgId, { from: sparkFrom }),
            await tx
                .select({ status: orders.status, count: count() })
                .from(orders)
                .where(eq(orders.orgId, ctx.orgId))
                .groupBy(orders.status),
        ] as const);"""

old_2 = """        const [lateOrdersQuery, outOfStockQuery, pendingReturnsQuery] = await Promise.all([
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
        ]);"""

new_2 = """        const [lateOrdersQuery, outOfStockQuery, pendingReturnsQuery] = await ctx.withOrg(async (tx) => [
            await tx
                .select({ count: count() })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    inArray(orders.status, ['pending', 'confirmed']),
                    lt(orders.createdAt, lateBefore),
                )),
            await tx
                .select({ count: count() })
                .from(inventoryItems)
                .where(and(
                    eq(inventoryItems.orgId, ctx.orgId),
                    lteOp(inventoryItems.quantity, 0),
                )),
            await ctx.db
                .select({ count: count() })
                .from(orderReturns)
                .where(and(
                    eq(orderReturns.orgId, ctx.orgId),
                    eq(orderReturns.status, 'requested'),
                )),
        ] as const);"""

# Because old_1 and new_1 have exactly the same number of lines!
content = "".join(lines)
content = content.replace(old_1, new_1)
content = content.replace(old_2, new_2)

with open("apps/admin/src/server/routers/dashboard.ts", "w") as f:
    f.write(content)
