import { router, protectedProcedure } from '../trpc';
import { orders, orderItems, productVariants, products, inventoryItems, inventoryMovements } from '@irth/db';
import { eq, and, desc, sql, count, sum, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { wholeMajorUnits, percentDelta } from '../lib/moneyDisplay';

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

      // Bound as an ISO string, not a Date. The query builder converts Date
      // params for you; `db.execute` with a raw sql`` template does not, and
      // postgres-js rejects the object with "The string argument must be of
      // type string... Received an instance of Date". This threw on every
      // request, so the analytics page had never rendered — it 500'd for
      // everyone, always.
      const sinceIso = since.toISOString();

      const rows = await ctx.db.execute(sql`
        SELECT
          date_trunc('day', created_at)::date AS day,
          COUNT(*)::int                        AS orders,
          COALESCE(SUM(total_amount_minor), 0)::numeric AS revenue
        FROM orders
        WHERE org_id = ${ctx.orgId}
          AND created_at >= ${sinceIso}
          AND status = 'delivered'
        GROUP BY 1
        ORDER BY 1 ASC
      `);

      type Row = { day: string; orders: number; revenue: string };
      const data = (rows as unknown as Row[]).map((r) => ({
        day: r.day,
        orders: Number(r.orders),
        revenue: wholeMajorUnits(r.revenue),
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
          COALESCE(SUM(oi.quantity * oi.price_minor), 0)::numeric AS revenue
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
        revenue: wholeMajorUnits(r.revenue),
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
      // Same raw-execute Date binding trap as `revenue` above.
      const sinceIso = since.toISOString();

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
               ON im.item_id = ii.id AND im.created_at >= ${sinceIso}
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
        .select({ total: sum(orders.totalAmountMinor) })
        .from(orders)
        .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, todayStart), eq(orders.status, 'delivered'))),
      ctx.db
        .select({ total: sum(orders.totalAmountMinor) })
        .from(orders)
        .where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, thisMonthStart), eq(orders.status, 'delivered'))),
      ctx.db
        .select({ total: sum(orders.totalAmountMinor) })
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

    const todayRevMinor = BigInt((todayRevenue[0]?.total as string | null) ?? '0');
    const monthRevMinor = BigInt((monthRevenue[0]?.total as string | null) ?? '0');
    const lastRevMinor = BigInt((lastMonthRevenue[0]?.total as string | null) ?? '0');
    const revenueGrowth = percentDelta(monthRevMinor, lastRevMinor);

    return {
      data: {
        ordersToday: todayOrders[0]?.count ?? 0,
        revenueToday: wholeMajorUnits(todayRevMinor.toString()),
        revenueThisMonth: wholeMajorUnits(monthRevMinor.toString()),
        revenueGrowth,
        totalOrders: totalOrders[0]?.count ?? 0,
        lowStockCount: lowStockCount[0]?.count ?? 0,
      },
      error: null,
      meta: null,
    };
  }),

  /**
   * Storefront visitor analytics — the first reader of the
   * storefront_sessions/storefront_events/storefront_daily_metrics tables
   * (packages/db/src/schema/shopify.ts, migration 0047), which existed since
   * that migration but had nothing querying them until now. Distinct from
   * `revenue`/`kpiSummary` above: this is visitor BEHAVIOR (sessions, page/
   * product views, funnel), not booked orders — deliberately kept in its own
   * procedures rather than merged into kpiSummary, matching PLAN.md's own
   * "clear separation between documented order numbers and visitor
   * behaviour" requirement. Returns empty series (not an error) for an org
   * with no Shopify connection or no traffic yet — this is a normal,
   * expected state for most orgs today, not a failure.
   */
  storefrontOverview: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - input.days);
      since.setUTCHours(0, 0, 0, 0);
      const sinceIso = since.toISOString();

      // Daily rollup, not the raw event table — this is meant to be cheap
      // enough for a dashboard card even on an org with millions of raw
      // events, matching PLAN.md's "13 months detail, daily aggregates after
      // that" retention shape.
      const rows = await ctx.db.execute(sql`
        SELECT metric_date::date AS day, metric, value
        FROM storefront_daily_metrics
        WHERE org_id = ${ctx.orgId} AND metric_date >= ${sinceIso}
        ORDER BY metric_date ASC
      `);

      type Row = { day: string; metric: string; value: number };
      const byDay = new Map<string, { day: string; sessions: number; events: number }>();
      for (const r of rows as unknown as Row[]) {
        const entry = byDay.get(r.day) ?? { day: r.day, sessions: 0, events: 0 };
        if (r.metric === 'sessions') entry.sessions = Number(r.value);
        else if (r.metric.startsWith('events:')) entry.events += Number(r.value);
        byDay.set(r.day, entry);
      }

      return { data: [...byDay.values()], error: null, meta: null };
    }),

  /**
   * Landing pages and traffic sources for the period — read from the raw
   * event/session tables (not the daily rollup, which doesn't break these
   * dimensions out) so it stays useful even on the rollup's very first day.
   */
  storefrontSources: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - input.days);
      const sinceIso = since.toISOString();

      const rows = await ctx.db.execute(sql`
        SELECT
          COALESCE(source, 'direct')  AS source,
          COALESCE(medium, '(none)')  AS medium,
          COUNT(*)::int               AS sessions
        FROM storefront_sessions
        WHERE org_id = ${ctx.orgId} AND first_seen_at >= ${sinceIso}
        GROUP BY 1, 2
        ORDER BY sessions DESC
        LIMIT 15
      `);

      type Row = { source: string; medium: string; sessions: number };
      const data = (rows as unknown as Row[]).map((r) => ({ ...r, sessions: Number(r.sessions) }));
      return { data, error: null, meta: null };
    }),

  storefrontTopPages: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30), limit: z.number().min(5).max(30).default(10) }))
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - input.days);
      const sinceIso = since.toISOString();

      const rows = await ctx.db.execute(sql`
        SELECT path, COUNT(*)::int AS views
        FROM storefront_events
        WHERE org_id = ${ctx.orgId} AND occurred_at >= ${sinceIso}
          AND event_name = 'page_viewed' AND path IS NOT NULL
        GROUP BY path
        ORDER BY views DESC
        LIMIT ${input.limit}
      `);

      type Row = { path: string; views: number };
      const data = (rows as unknown as Row[]).map((r) => ({ path: r.path, views: Number(r.views) }));
      return { data, error: null, meta: null };
    }),
});

