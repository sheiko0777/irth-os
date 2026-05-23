import { router, protectedProcedure } from '../trpc';
import { orders, orderItems, productVariants, products, inventoryItems, inventoryMovements } from '@irth/db';
import { eq, and, desc, sql, count, sum, gte, lte } from 'drizzle-orm';
import { z } from 'zod';

export const analyticsRouter = router({
  /**
   * Daily revenue (delivered orders) for last N days.
   */
  revenue: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.days);
      since.setHours(0, 0, 0, 0);

      const rows = await ctx.db.execute(sql`
        SELECT
          date_trunc('day', created_at)::date AS day,
          COUNT(*)::int                        AS orders,
          COALESCE(SUM(total_amount), 0)::numeric AS revenue
        FROM orders
        WHERE org_id = ${ctx.orgId}
          AND created_at >= ${since}
          AND status = 'delivered'
        GROUP BY 1
        ORDER BY 1 ASC
      `);

      type Row = { day: string; orders: number; revenue: string };
      const data = (rows as unknown as Row[]).map((r) => ({
        day: r.day,
        orders: Number(r.orders),
        revenue: parseFloat(r.revenue),
      }));

      return { data, error: null, meta: null };
    }),

  /**
   * Top 10 products by delivered revenue.
   */
  topProducts: protectedProcedure
    .input(z.object({ limit: z.number().min(5).max(20).default(10) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.execute(sql`
        SELECT
          p.name                               AS product,
          SUM(oi.quantity)::int                AS units,
          COALESCE(SUM(oi.quantity * oi.price), 0)::numeric AS revenue
        FROM order_items oi
        JOIN orders      o  ON o.id  = oi.order_id
        JOIN product_variants pv ON pv.id = oi.variant_id
        JOIN products    p  ON p.id  = pv.product_id
        WHERE o.org_id = ${ctx.orgId}
          AND o.status = 'delivered'
        GROUP BY p.id, p.name
        ORDER BY revenue DESC
        LIMIT ${input.limit}
      `);

      type Row = { product: string; units: number; revenue: string };
      const data = (rows as unknown as Row[]).map((r) => ({
        product: r.product,
        units: Number(r.units),
        revenue: parseFloat(r.revenue),
      }));

      return { data, error: null, meta: null };
    }),

  /**
   * Inventory turnover: for each variant, outbound movements / current stock.
   * Returns low-stock items and overall turnover ratio.
   */
  inventoryTurnover: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const rows = await ctx.db.execute(sql`
        SELECT
          pv.name                                         AS variant,
          p.name                                          AS product,
          ii.quantity                                     AS stock,
          ii.reorder_point                                AS reorder_point,
          COALESCE(SUM(CASE WHEN im.type = 'out' THEN im.quantity ELSE 0 END), 0)::int AS outbound
        FROM inventory_items ii
        JOIN product_variants pv ON pv.id = ii.variant_id
        JOIN products         p  ON p.id  = pv.product_id
        LEFT JOIN inventory_movements im
               ON im.item_id = ii.id AND im.created_at >= ${since}
        WHERE ii.org_id = ${ctx.orgId}
        GROUP BY pv.name, p.name, ii.quantity, ii.reorder_point
        ORDER BY ii.quantity ASC
        LIMIT 20
      `);

      type Row = {
        variant: string;
        product: string;
        stock: number;
        reorder_point: number;
        outbound: number;
      };
      const data = (rows as unknown as Row[]).map((r) => ({
        variant: r.variant,
        product: r.product,
        stock: Number(r.stock),
        reorderPoint: Number(r.reorder_point),
        outbound: Number(r.outbound),
        turnover: r.stock > 0 ? +(Number(r.outbound) / Number(r.stock)).toFixed(2) : null,
        isLow: Number(r.stock) <= Number(r.reorder_point),
      }));

      const lowStockCount = data.filter((d) => d.isLow).length;
      return { data, lowStockCount, error: null, meta: null };
    }),

  /**
   * KPI summary cards — fast parallel queries.
   */
  kpiSummary: protectedProcedure.query(async ({ ctx }) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const thisMonthStart = new Date();
    thisMonthStart.setDate(1);
    thisMonthStart.setHours(0, 0, 0, 0);

    const lastMonthStart = new Date(thisMonthStart);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);

    const [
      todayOrders,
      todayRevenue,
      monthRevenue,
      lastMonthRevenue,
      totalOrders,
      lowStockCount,
    ] = await Promise.all([
      ctx.db
        .select({ count: count() })
        .from(orders)
        .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, todayStart))),
      ctx.db
        .select({ total: sum(orders.totalAmount) })
        .from(orders)
        .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, todayStart), eq(orders.status, 'delivered'))),
      ctx.db
        .select({ total: sum(orders.totalAmount) })
        .from(orders)
        .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, thisMonthStart), eq(orders.status, 'delivered'))),
      ctx.db
        .select({ total: sum(orders.totalAmount) })
        .from(orders)
        .where(and(
          eq(orders.orgId, ctx.orgId),
          gte(orders.createdAt, lastMonthStart),
          lte(orders.createdAt, thisMonthStart),
          eq(orders.status, 'delivered')
        )),
      ctx.db
        .select({ count: count() })
        .from(orders)
        .where(eq(orders.orgId, ctx.orgId)),
      ctx.db
        .select({ count: count() })
        .from(inventoryItems)
        .where(and(
          eq(inventoryItems.orgId, ctx.orgId),
          sql`${inventoryItems.quantity} <= ${inventoryItems.reorderPoint}`
        )),
    ]);

    const monthRev = parseFloat((monthRevenue[0]?.total as unknown as string) ?? '0');
    const lastRev = parseFloat((lastMonthRevenue[0]?.total as unknown as string) ?? '0');
    const revenueGrowth = lastRev > 0 ? +((monthRev - lastRev) / lastRev * 100).toFixed(1) : null;

    return {
      data: {
        ordersToday: todayOrders[0]?.count ?? 0,
        revenueToday: parseFloat((todayRevenue[0]?.total as unknown as string) ?? '0'),
        revenueThisMonth: monthRev,
        revenueGrowth,
        totalOrders: totalOrders[0]?.count ?? 0,
        lowStockCount: lowStockCount[0]?.count ?? 0,
      },
      error: null,
      meta: null,
    };
  }),
});
