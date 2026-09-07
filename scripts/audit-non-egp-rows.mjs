/**
 * Read-only production diagnostic for legacy non-EGP monetary records.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/audit-non-egp-rows.mjs
 *
 * The connection string is read from DATABASE_URL, matching the normal
 * @irth/db client convention. The script issues SELECT statements only.
 */
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL must be set.");
  process.exitCode = 2;
} else {
  const sql = postgres(connectionString, {
    max: 1,
    // This script has no writes. Keep the session read-only as an additional
    // production-safety guard should this file ever be changed accidentally.
    connection: { options: "-c default_transaction_read_only=on" },
  });

  try {
    const [[{ count: orderCount }], orders, [{ count: journalLineCount }], journalLines] =
      await Promise.all([
        sql`
          SELECT count(*)::int AS count
          FROM orders
          WHERE currency <> 'EGP'
        `,
      sql`
        SELECT
          id,
          org_id,
          currency,
          created_at,
          id AS order_id
        FROM orders
        WHERE currency <> 'EGP'
        ORDER BY created_at DESC, id DESC
        LIMIT 20
      `,
        sql`
          SELECT count(*)::int AS count
          FROM journal_lines
          WHERE currency <> 'EGP'
        `,
      sql`
        SELECT
          id,
          org_id,
          currency,
          created_at,
          entry_id
        FROM journal_lines
        WHERE currency <> 'EGP'
        ORDER BY created_at DESC, id DESC
        LIMIT 20
      `,
      ]);

    const total = orderCount + journalLineCount;

    console.log("Non-EGP currency audit");
    console.log("======================");
    console.log(`orders: ${orderCount}`);
    console.table(orders);
    if (orderCount > orders.length) {
      console.log(`... ${orderCount - orders.length} more orders not shown`);
    }
    console.log(`journal_lines: ${journalLineCount}`);
    console.table(journalLines);
    if (journalLineCount > journalLines.length) {
      console.log(
        `... ${journalLineCount - journalLines.length} more journal lines not shown`,
      );
    }
    console.log(`total non-EGP rows: ${total}`);

    if (total > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Non-EGP currency audit failed:", error);
    process.exitCode = 2;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
