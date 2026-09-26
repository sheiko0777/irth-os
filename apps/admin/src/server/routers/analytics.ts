import { router, requirePermission } from '../trpc';
import { orders, products, inventoryItems, salesTotals, dailyNetSales } from '@irth/db';
import { eq, and, sql, count, gte } from 'drizzle-orm';
import { z } from 'zod';
import { wholeMajorUnits, percentDelta } from '../lib/moneyDisplay';

export function daysAgoIso(days: number): string {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}

export const analyticsRouter = router({
  /**
   * Daily net sales (from the ledger) and delivered-order counts for the last
   * N days. Revenue is the ledger's net sales (4010 less 4020, ex-VAT) dated
   * at recognition — not a sum over orders (CLAUDE.md rule 2). The order
   * count is a count of intent and stays on `orders`.
   */
  revenue: requirePermission('analytics', 'view')
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      // Bound as an ISO string, not a Date. The query builder converts Date
      // params for you; `db.execute` with a raw sql`` template does not, and
      // postgres-js rejects the object with "The string argument must be of
      // type string... Received an instance of Date". This threw on every
      // request, so the analytics page had never rendered — it 500'd for
      // everyone, always.
      const sinceIso = daysAgoIso(input.days);

      const [rows, netByDay] = await Promise.all([
        ctx.db.execute(sql`
          SELECT
            (date_trunc('day', created_at)::date)::text AS day,
            COUNT(*)::int                               AS orders
          FROM orders
          WHERE org_id = ${ctx.orgId}
            AND created_at >= ${sinceIso}
            AND status = 'delivered'
          GROUP BY 1
        `),
        ctx.withOrg((tx) => dailyNetSales(tx, ctx.orgId, { from: new Date(sinceIso) })),
      ]);

      type Row = { day: string; orders: number };
      const ordersByDay = new Map((rows as unknown as Row[]).map((r) => [r.day, Number(r.orders)]));
      const days = [...new Set([...ordersByDay.keys(), ...netByDay.keys()])].sort();
      const data = days.map((day) => ({
        day,
        orders: ordersByDay.get(day) ?? 0,
        revenue: wholeMajorUnits(netByDay.get(day) ?? 0n),
      }));

      return { data, error: null, meta: null };
    }),

  /**
   * Top 10 products by delivered revenue.
   */
  topProducts: requirePermission('analytics', 'view')
    .input(z.object({ limit: z.number().min(5).max(20).default(10) }))
    .query(async ({ ctx, input }) => {
      // Inside withOrg so a brand-scoped member (PR-1e) only ranks their brands.
      const rows = await ctx.withOrg((tx) => tx.execute(sql`
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
      `));

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
  inventoryTurnover: requirePermission('analytics', 'view')
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      // Same raw-execute Date binding trap as `revenue` above.
      const sinceIso = daysAgoIso(input.days);

      const rows = await ctx.withOrg((tx) => tx.execute(sql`
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
      `));

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
  kpiSummary: requirePermission('analytics', 'view').query(async ({ ctx }) => {
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
      // Net sales from the ledger (CLAUDE.md rule 2); see `revenue` above.
      ctx.withOrg((tx) => salesTotals(tx, ctx.orgId, { from: todayStart })),
      ctx.withOrg((tx) => salesTotals(tx, ctx.orgId, { from: thisMonthStart })),
      ctx.withOrg((tx) => salesTotals(tx, ctx.orgId, { from: lastMonthStart, to: thisMonthStart })),
      ctx.db
        .select({ count: count() })
        .from(orders)
        .where(eq(orders.orgId, ctx.orgId)),
      ctx.withOrg((tx) => tx
        .select({ count: count() })
        .from(inventoryItems)
        .where(and(
          eq(inventoryItems.orgId, ctx.orgId),
          sql`${inventoryItems.quantity} <= ${inventoryItems.reorderPoint}`
        ))),
    ]);

    const todayRevMinor = todayRevenue.netSalesMinor;
    const monthRevMinor = monthRevenue.netSalesMinor;
    const lastRevMinor = lastMonthRevenue.netSalesMinor;
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
  storefrontOverview: requirePermission('analytics', 'view')
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const sinceIso = daysAgoIso(input.days);

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
  storefrontSources: requirePermission('analytics', 'view')
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const sinceIso = daysAgoIso(input.days);

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

  storefrontTopPages: requirePermission('analytics', 'view')
    .input(z.object({ days: z.number().min(7).max(90).default(30), limit: z.number().min(5).max(30).default(10) }))
    .query(async ({ ctx, input }) => {
      const sinceIso = daysAgoIso(input.days);

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

  /**
   * Real-time & Abandoned Cart Monitor.
   * Analyzes cart_viewed, product_added_to_cart, checkout_started, and checkout_completed events.
   */
  cartMonitor: requirePermission('analytics', 'view')
    .input(z.object({
      days: z.number().min(1).max(90).default(7),
      status: z.enum(['all', 'abandoned', 'active', 'converted']).default('all'),
      limit: z.number().min(5).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const sinceIso = daysAgoIso(input.days);

      const rows = await ctx.withOrg(async (tx) => tx.execute(sql`
        SELECT
          e.id,
          e.event_name,
          e.occurred_at,
          e.metadata,
          s.id AS session_id,
          s.client_id_hash,
          s.landing_path,
          s.source,
          s.medium,
          c.name AS customer_name,
          c.email AS customer_email,
          c.phone AS customer_phone
        FROM storefront_events e
        JOIN storefront_sessions s ON s.id = e.session_id
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE e.org_id = ${ctx.orgId}
          AND e.occurred_at >= ${sinceIso}
          AND e.event_name IN ('cart_viewed', 'product_added_to_cart', 'checkout_started', 'checkout_completed')
        ORDER BY e.occurred_at DESC
        LIMIT 500
      `));

      type EventRow = {
        id: string;
        event_name: string;
        occurred_at: string;
        metadata: any;
        session_id: string;
        client_id_hash: string;
        landing_path: string | null;
        source: string | null;
        medium: string | null;
        customer_name: string | null;
        customer_email: string | null;
        customer_phone: string | null;
      };

      const eventRows = rows as unknown as EventRow[];

      type CartGroup = {
        cartToken: string;
        sessionId: string;
        lastEventName: string;
        lastOccurredAt: Date;
        customerName: string | null;
        customerEmail: string | null;
        customerPhone: string | null;
        totalPrice: number;
        currency: string;
        abandonedCheckoutUrl: string | null;
        lineItems: Array<{ title: string; quantity: number; price: number; sku?: string | null }>;
        isConverted: boolean;
      };

      const cartsMap = new Map<string, CartGroup>();

      for (const row of eventRows) {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
        const key = meta.checkoutToken || meta.cartToken || row.session_id;

        const existing = cartsMap.get(key);
        const occurred = new Date(row.occurred_at);

        if (!existing) {
          const items: Array<{ title: string; quantity: number; price: number; sku?: string | null }> = [];
          if (Array.isArray(meta.lineItems)) {
            for (const item of meta.lineItems) {
              items.push({
                title: item.title || item.variantTitle || 'منتج',
                quantity: Number(item.quantity) || 1,
                price: Number(item.price) || 0,
                sku: item.sku ?? null,
              });
            }
          } else if (Array.isArray(meta.lines)) {
            for (const item of meta.lines) {
              items.push({
                title: item.title || 'منتج',
                quantity: Number(item.quantity) || 1,
                price: Number(item.price) || 0,
                sku: item.sku ?? null,
              });
            }
          } else if (meta.title) {
            items.push({
              title: meta.title,
              quantity: 1,
              price: Number(meta.price) || 0,
              sku: meta.sku ?? null,
            });
          }

          const rawTotal = meta.totalPrice || (items.length > 0 ? items.reduce((sum, it) => sum + (it.price * it.quantity), 0) : 0);
          const numTotal = Number(rawTotal) || 0;

          cartsMap.set(key, {
            cartToken: key,
            sessionId: row.session_id,
            lastEventName: row.event_name,
            lastOccurredAt: occurred,
            customerName: row.customer_name || meta.customerName || null,
            customerEmail: row.customer_email || meta.email || null,
            customerPhone: row.customer_phone || meta.phone || null,
            totalPrice: numTotal,
            currency: meta.currency || 'EGP',
            abandonedCheckoutUrl: meta.abandonedCheckoutUrl || null,
            lineItems: items,
            isConverted: row.event_name === 'checkout_completed',
          });
        } else {
          if (row.event_name === 'checkout_completed') {
            existing.isConverted = true;
          }
          if (occurred > existing.lastOccurredAt) {
            existing.lastOccurredAt = occurred;
            existing.lastEventName = row.event_name;
          }
          if (!existing.customerEmail && (row.customer_email || meta.email)) {
            existing.customerEmail = row.customer_email || meta.email;
          }
          if (!existing.customerPhone && (row.customer_phone || meta.phone)) {
            existing.customerPhone = row.customer_phone || meta.phone;
          }
          if (!existing.customerName && (row.customer_name || meta.customerName)) {
            existing.customerName = row.customer_name || meta.customerName;
          }
          if (!existing.abandonedCheckoutUrl && meta.abandonedCheckoutUrl) {
            existing.abandonedCheckoutUrl = meta.abandonedCheckoutUrl;
          }
        }
      }

      const nowMs = Date.now();
      const ABANDONED_THRESHOLD_MS = 20 * 60 * 1000;

      const allCarts = Array.from(cartsMap.values()).map((c) => {
        let status: 'abandoned' | 'active' | 'converted';
        if (c.isConverted) {
          status = 'converted';
        } else if (nowMs - c.lastOccurredAt.getTime() > ABANDONED_THRESHOLD_MS) {
          status = 'abandoned';
        } else {
          status = 'active';
        }

        return {
          id: c.cartToken,
          status,
          customerName: c.customerName,
          customerEmail: c.customerEmail,
          customerPhone: c.customerPhone,
          totalPrice: c.totalPrice,
          currency: c.currency,
          lineItems: c.lineItems,
          itemsCount: c.lineItems.reduce((acc, item) => acc + item.quantity, 0),
          lastActiveAt: c.lastOccurredAt.toISOString(),
          abandonedCheckoutUrl: c.abandonedCheckoutUrl,
        };
      });

      const totalCarts = allCarts.length;
      const abandonedCarts = allCarts.filter((c) => c.status === 'abandoned');
      const activeCarts = allCarts.filter((c) => c.status === 'active');
      const convertedCarts = allCarts.filter((c) => c.status === 'converted');

      const abandonedValue = abandonedCarts.reduce((sum, c) => sum + c.totalPrice, 0);
      const convertedValue = convertedCarts.reduce((sum, c) => sum + c.totalPrice, 0);
      const abandonmentRate = totalCarts > 0 ? Math.round((abandonedCarts.length / totalCarts) * 100) : 0;

      let filteredCarts = allCarts;
      if (input.status !== 'all') {
        filteredCarts = allCarts.filter((c) => c.status === input.status);
      }
      filteredCarts.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());

      return {
        data: {
          kpis: {
            totalCarts,
            abandonedCount: abandonedCarts.length,
            activeCount: activeCarts.length,
            convertedCount: convertedCarts.length,
            abandonmentRate,
            abandonedValue,
            convertedValue,
          },
          carts: filteredCarts.slice(0, input.limit),
        },
        error: null,
        meta: null,
      };
    }),

  /**
   * 5-Stage Customer Conversion Funnel:
   * Sessions -> Product Viewed -> Cart Added -> Checkout Started -> Orders Completed
   */
  customerFunnel: requirePermission('analytics', 'view')
    .input(z.object({ days: z.number().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const sinceIso = daysAgoIso(input.days);

      const [sessionsRow, eventsRows, ordersRow] = await Promise.all([
        ctx.withOrg(async (tx) => tx.execute(sql`
          SELECT COUNT(DISTINCT id)::int AS count
          FROM storefront_sessions
          WHERE org_id = ${ctx.orgId} AND first_seen_at >= ${sinceIso}
        `)),
        ctx.withOrg(async (tx) => tx.execute(sql`
          SELECT
            event_name,
            COUNT(DISTINCT session_id)::int AS unique_sessions,
            COUNT(*)::int AS total_events
          FROM storefront_events
          WHERE org_id = ${ctx.orgId} AND occurred_at >= ${sinceIso}
            AND event_name IN ('product_viewed', 'product_added_to_cart', 'cart_viewed', 'checkout_started', 'checkout_completed')
          GROUP BY event_name
        `)),
        ctx.withOrg(async (tx) => tx.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM orders
          WHERE org_id = ${ctx.orgId} AND created_at >= ${sinceIso}
            AND status != 'cancelled'
        `)),
      ]);

      type CountRow = { count: number };
      type EventCountRow = { event_name: string; unique_sessions: number; total_events: number };

      const totalSessions = Number((sessionsRow as unknown as CountRow[])[0]?.count ?? 0);
      const bookedOrders = Number((ordersRow as unknown as CountRow[])[0]?.count ?? 0);

      const eventsMap = new Map<string, { uniqueSessions: number; totalEvents: number }>();
      for (const row of eventsRows as unknown as EventCountRow[]) {
        eventsMap.set(row.event_name, {
          uniqueSessions: Number(row.unique_sessions),
          totalEvents: Number(row.total_events),
        });
      }

      const productViews = eventsMap.get('product_viewed')?.uniqueSessions ?? 0;
      const cartAdds = Math.max(eventsMap.get('product_added_to_cart')?.uniqueSessions ?? 0, eventsMap.get('cart_viewed')?.uniqueSessions ?? 0);
      const checkoutStarts = eventsMap.get('checkout_started')?.uniqueSessions ?? 0;
      const pixelCompletions = eventsMap.get('checkout_completed')?.uniqueSessions ?? 0;
      const completedPurchases = Math.max(bookedOrders, pixelCompletions);

      const baseSessions = Math.max(totalSessions, productViews, cartAdds, checkoutStarts, completedPurchases);

      const funnel = [
        { stage: 'visitors', label: 'الزيارات', labelEn: 'Visitors', count: baseSessions, rate: 100 },
        { stage: 'product_viewed', label: 'تصفح المنتجات', labelEn: 'Product Views', count: productViews, rate: baseSessions > 0 ? Math.round((productViews / baseSessions) * 100) : 0 },
        { stage: 'added_to_cart', label: 'إضافة للسلة', labelEn: 'Added to Cart', count: cartAdds, rate: baseSessions > 0 ? Math.round((cartAdds / baseSessions) * 100) : 0 },
        { stage: 'checkout_started', label: 'بدء الدفع', labelEn: 'Checkout Started', count: checkoutStarts, rate: baseSessions > 0 ? Math.round((checkoutStarts / baseSessions) * 100) : 0 },
        { stage: 'purchased', label: 'إتمام الشراء', labelEn: 'Completed Orders', count: completedPurchases, rate: baseSessions > 0 ? Math.round((completedPurchases / baseSessions) * 100) : 0 },
      ];

      return {
        data: {
          funnel,
          conversionRate: baseSessions > 0 ? +(completedPurchases / baseSessions * 100).toFixed(2) : 0,
        },
        error: null,
        meta: null,
      };
    }),

  /**
   * Live customer activity stream (last N storefront events).
   */
  customerActivityStream: requirePermission('analytics', 'view')
    .input(z.object({ limit: z.number().min(10).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withOrg(async (tx) => tx.execute(sql`
        SELECT
          e.id,
          e.event_name,
          e.occurred_at,
          e.path,
          e.product_id,
          e.search_term,
          e.metadata,
          s.landing_path,
          s.source,
          s.medium,
          c.name AS customer_name,
          c.email AS customer_email
        FROM storefront_events e
        JOIN storefront_sessions s ON s.id = e.session_id
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE e.org_id = ${ctx.orgId}
        ORDER BY e.occurred_at DESC
        LIMIT ${input.limit}
      `));

      type StreamRow = {
        id: string;
        event_name: string;
        occurred_at: string;
        path: string | null;
        product_id: string | null;
        search_term: string | null;
        metadata: any;
        landing_path: string | null;
        source: string | null;
        medium: string | null;
        customer_name: string | null;
        customer_email: string | null;
      };

      const data = (rows as unknown as StreamRow[]).map((r) => {
        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
        return {
          id: r.id,
          eventName: r.event_name,
          occurredAt: r.occurred_at,
          path: r.path,
          productId: r.product_id,
          searchTerm: r.search_term,
          title: meta.title || null,
          price: meta.price ? Number(meta.price) : null,
          totalPrice: meta.totalPrice ? Number(meta.totalPrice) : null,
          source: r.source || 'direct',
          medium: r.medium || '(none)',
          customerName: r.customer_name || meta.customerName || null,
          customerEmail: r.customer_email || meta.email || null,
        };
      });

      return { data, error: null, meta: null };
    }),

  /**
   * Top products abandoned in carts without purchase.
   */
  abandonedProducts: requirePermission('analytics', 'view')
    .input(z.object({ days: z.number().min(1).max(90).default(30), limit: z.number().min(5).max(30).default(10) }))
    .query(async ({ ctx, input }) => {
      const sinceIso = daysAgoIso(input.days);

      const rows = await ctx.withOrg(async (tx) => tx.execute(sql`
        SELECT
          COALESCE(e.metadata->>'title', e.path, 'منتج غير محدد') AS title,
          COUNT(*)::int AS abandon_count,
          COALESCE(SUM(NULLIF(e.metadata->>'price', '')::numeric), 0)::numeric AS estimated_value
        FROM storefront_events e
        WHERE e.org_id = ${ctx.orgId}
          AND e.occurred_at >= ${sinceIso}
          AND e.event_name IN ('product_added_to_cart', 'cart_viewed')
          AND NOT EXISTS (
            SELECT 1 FROM storefront_events comp
            WHERE comp.session_id = e.session_id
              AND comp.event_name = 'checkout_completed'
              AND comp.occurred_at >= e.occurred_at
          )
        GROUP BY 1
        ORDER BY abandon_count DESC
        LIMIT ${input.limit}
      `));

      type ProdRow = { title: string; abandon_count: number; estimated_value: string };
      const data = (rows as unknown as ProdRow[]).map((r) => ({
        title: r.title,
        abandonCount: Number(r.abandon_count),
        estimatedValue: Number(r.estimated_value),
      }));

      return { data, error: null, meta: null };
    }),
});

