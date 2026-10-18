const fs = require('fs');
const path = 'apps/admin/src/server/routers/dashboard.ts';
let code = fs.readFileSync(path, 'utf8');

// Replace getStats
code = code.replace(
    /\/\/ Batch independent queries — O\(max latency\) instead of O\(n × latency\)\s+const \[\s+ordersTodayQuery,[\s\S]*?\] = await Promise\.all\(\[\s+ctx\.withOrg\(\(tx\) => tx\s+\.select\(\{ count: count\(\) \}\)\s+\.from\(orders\)\s+\.where\(and\(eq\(orders\.orgId, ctx\.orgId\), gte\(orders\.createdAt, startOfDay\)\)\)\),\s+\/\/ Revenue reads the ledger \(CLAUDE\.md rule 2\), never orders: net\s+\/\/ sales ex-VAT, less returns, dated when the sale was recognised\.\s+ctx\.withOrg\(\(tx\) => salesTotals\(tx, ctx\.orgId, \{ from: startOfDay \}\)\),\s+ctx\.withOrg\(\(tx\) => tx\s+\.select\(\{ count: count\(\) \}\)\s+\.from\(orders\)\s+\.where\(and\(eq\(orders\.orgId, ctx\.orgId\), eq\(orders\.status, 'pending'\)\)\)\),\s+ctx\.withOrg\(\(tx\) => tx\s+\.select\(\{ count: count\(\) \}\)\s+\.from\(products\)\s+\.where\(and\(eq\(products\.orgId, ctx\.orgId\), eq\(products\.status, 'active'\)\)\)\),\s+ctx\.withOrg\(\(tx\) => tx\s+\.select\(\{ count: count\(\) \}\)\s+\.from\(orders\)\s+\.where\(and\(\s+eq\(orders\.orgId, ctx\.orgId\),\s+gte\(orders\.createdAt, startOfYesterday\),\s+lt\(orders\.createdAt, startOfDay\),\s+\)\)\),\s+ctx\.withOrg\(\(tx\) => salesTotals\(tx, ctx\.orgId, \{ from: startOfYesterday, to: startOfDay \}\)\),\s+ctx\.withOrg\(\(tx\) => tx\s+\.select\(\{\s+day: sql<string>`\$\{dayBucket\}::date::text`,\s+orderCount: count\(\),\s+\}\)\s+\.from\(orders\)\s+\.where\(and\(eq\(orders\.orgId, ctx\.orgId\), gte\(orders\.createdAt, sparkFrom\)\)\)\s+\.groupBy\(dayBucket\)\s+\.orderBy\(dayBucket\)\),\s+\/\/ Same source as revenueToday so the headline and its trend line\s+\/\/ measure the same thing\.\s+ctx\.withOrg\(\(tx\) => dailyNetSales\(tx, ctx\.orgId, \{ from: sparkFrom \}\)\),\s+ctx\.withOrg\(\(tx\) => tx\s+\.select\(\{ status: orders\.status, count: count\(\) \}\)\s+\.from\(orders\)\s+\.where\(eq\(orders\.orgId, ctx\.orgId\)\)\s+\.groupBy\(orders\.status\)\),\s+\]\);/,
    `// Batch independent queries — O(max latency) instead of O(n × latency)
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
        ] = await ctx.withOrg(async (tx) => {
            return [
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
                        day: sql<string>\`\${dayBucket}::date::text\`,
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
            ] as const;
        });`
);

// Replace getAlerts
code = code.replace(
    /const \[lateOrdersQuery, outOfStockQuery, pendingReturnsQuery\] = await Promise\.all\(\[\s+ctx\.withOrg\(\(tx\) => tx\s+\.select\(\{ count: count\(\) \}\)\s+\.from\(orders\)\s+\.where\(and\(\s+eq\(orders\.orgId, ctx\.orgId\),\s+inArray\(orders\.status, \['pending', 'confirmed'\]\),\s+lt\(orders\.createdAt, lateBefore\),\s+\)\)\),\s+ctx\.withOrg\(\(tx\) => tx\s+\.select\(\{ count: count\(\) \}\)\s+\.from\(inventoryItems\)\s+\.where\(and\(\s+eq\(inventoryItems\.orgId, ctx\.orgId\),\s+lteOp\(inventoryItems\.quantity, 0\),\s+\)\)\),\s+ctx\.db\s+\.select\(\{ count: count\(\) \}\)\s+\.from\(orderReturns\)\s+\.where\(and\(\s+eq\(orderReturns\.orgId, ctx\.orgId\),\s+eq\(orderReturns\.status, 'requested'\),\s+\)\),\s+\]\);/,
    `const [lateOrdersQuery, outOfStockQuery, pendingReturnsQuery] = await ctx.withOrg(async (tx) => {
            return [
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
                await tx
                    .select({ count: count() })
                    .from(orderReturns)
                    .where(and(
                        eq(orderReturns.orgId, ctx.orgId),
                        eq(orderReturns.status, 'requested'),
                    )),
            ] as const;
        });`
);

fs.writeFileSync(path, code);
