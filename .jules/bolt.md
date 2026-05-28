## 2025-02-28 - Materializing Tables for Sequence Generation
**Learning:** Found a pattern where the entire `orders` table was materialized into memory (`await db.select().from(orders)`) just to check `.length` and generate a sequential order number (`IRT-2026-${seq}`). As the table grows, this causes severe memory spikes and database load.
**Action:** Always use Drizzle's `count()` aggregate function (`select({ count: count() })`) when you only need the number of rows, especially for sequence generation.
