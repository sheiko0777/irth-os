## 2025-06-12 - Prevent Memory Bloat with DB Aggregations
**Learning:** Materializing entire database tables into memory (e.g. `const rows = await db.select().from(table)`) just to perform array operations like `.length`, `.filter().length`, or `.reduce()` is a severe performance bottleneck. It leads to massive memory overhead, OOM errors, and slow API endpoints as tables grow.
**Action:** Always compute aggregates directly in the database using SQL functions like `count()`, `sum()`, and conditional counts with `sql<number>\`COALESCE(SUM(CASE WHEN condition THEN 1 ELSE 0 END), 0)\``.
