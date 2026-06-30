## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.
## 2023-10-25 - Push Aggregations to the Database
**Learning:** Found multiple tRPC procedures (`returns.summary`, `stocktaking.summary`) materializing entire tables into Node.js memory just to compute counts and totals using array loops and `.length`. This severely impacts latency and memory scaling.
**Action:** Always replace in-memory iterations (e.g., `returns.length`, `returns.reduce()`) with Drizzle ORM SQL aggregate functions (`count()`, `sql<number>COALESCE(SUM(...), 0)`, `MAX()`) to push compute to the database engine.
