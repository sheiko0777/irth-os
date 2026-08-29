import { sql } from 'drizzle-orm';
import { storefrontDailyMetrics } from '@irth/db';
import type { db as DbType } from '@irth/db';

/**
 * Once-a-day aggregate of `storefront_sessions`/`storefront_events` into
 * `storefront_daily_metrics` — the rollup `PLAN.md` describes (13 months of
 * event-level detail, daily aggregates kept after that). Detail-table
 * pruning itself is a separate, later concern; this only keeps the rollup
 * populated so the analytics readers have something correct to show
 * regardless of how long detail rows stick around.
 *
 * `storefront_daily_metrics`'s own unique index is `(org_id, metric_date,
 * metric)` — no `dimensions` column in that key — so a distinct metric per
 * event name has to be a distinct METRIC STRING (`events:<eventName>`), not
 * a shared metric with a `dimensions` discriminator; the latter would
 * collide and silently drop every event name but the last one written.
 * `dimensions` is stored alongside purely for readability, not uniqueness.
 */
export async function rollupStorefrontMetrics(database: typeof DbType, dayStart: Date): Promise<void> {
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const sessionRows = await database.execute<{ org_id: string; value: number }>(sql`
    SELECT org_id, count(*)::int AS value
    FROM storefront_sessions
    WHERE last_seen_at >= ${dayStart} AND last_seen_at < ${dayEnd}
    GROUP BY org_id
  `);

  const eventRows = await database.execute<{ org_id: string; event_name: string; value: number }>(sql`
    SELECT org_id, event_name, count(*)::int AS value
    FROM storefront_events
    WHERE occurred_at >= ${dayStart} AND occurred_at < ${dayEnd}
    GROUP BY org_id, event_name
  `);

  for (const row of sessionRows) {
    await database.insert(storefrontDailyMetrics).values({
      orgId: row.org_id, metricDate: dayStart, metric: 'sessions', dimensions: {}, value: row.value, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [storefrontDailyMetrics.orgId, storefrontDailyMetrics.metricDate, storefrontDailyMetrics.metric],
      set: { value: row.value, updatedAt: new Date() },
    });
  }

  for (const row of eventRows) {
    await database.insert(storefrontDailyMetrics).values({
      orgId: row.org_id, metricDate: dayStart, metric: `events:${row.event_name}`,
      dimensions: { eventName: row.event_name }, value: row.value, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [storefrontDailyMetrics.orgId, storefrontDailyMetrics.metricDate, storefrontDailyMetrics.metric],
      set: { value: row.value, updatedAt: new Date() },
    });
  }
}
