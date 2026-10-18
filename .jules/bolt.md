## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.
## 2026-09-07 - Batch Purchasing PO List Query
**Learning:** The po.list query was fetching data without a corresponding total count, missing essential pagination data, and implementing this sequentially would double latency.
**Action:** Execute list and count queries concurrently in API routes/tRPC procedures using `Promise.all` to return complete pagination metadata while reducing max latency.
## 2025-02-14 - Refactoring N+1 mapping to GROUP BY count()
**Learning:** Found sequential independent count queries using Promise.all inside a mapping loop which executes n queries against the database for every fetched item.
**Action:** Refactor N+1 mapping loop queries by pushing the logic down to the database level through a single grouped query utilizing left joins, GROUP BY, and aggregate functions (like count()) to eliminate database roundtrips.
## 2026-09-12 - Prevent concurrent queries on single transaction\n**Learning:** In Postgres, executing concurrent queries using `Promise.all` on a single Drizzle transaction object (e.g., `tx`) causes race conditions or crashes since a single connection cannot multiplex queries.\n**Action:** Never use `Promise.all` with `tx.select()` or mutations inside a transaction. Keep queries sequential, or pull independent reads outside the transaction if they don't need its consistency guarantee.
## 2026-10-09 - Combine count queries with FILTER clause
**Learning:** Found sequential and concurrent aggregate queries executing multiple database roundtrips and causing multiplexing risks on single transaction connections.
**Action:** Use PostgreSQL's `FILTER (WHERE ...)` clause with `drizzle-orm` to combine multiple aggregate queries into a single query to reduce database roundtrips.
## 2025-02-28 - Optimize AI tool sales summary queries in `apps/api/src/ai/tools.ts`
**Learning:** Combining multiple aggregate queries using PostgreSQL's `FILTER (WHERE ...)` clause with `drizzle-orm`'s `sql` utility prevents executing multiple queries concurrently inside transaction contexts and reduces network roundtrips.
**Action:** When making multiple conditional aggregates on the same table, use PostgreSQL's `FILTER` clause.
## 2023-11-20 - Combine Queries using PostgreSQL FILTER
**Learning:** Three separate database queries executing in Promise.all were making three separate database round trips to fetch counts with different where conditions for the same table.
**Action:** When making multiple conditional aggregates on the same table, use PostgreSQL's `FILTER (WHERE ...)` clause with `drizzle-orm`'s `sql` utility to combine them into a single query to reduce latency and database roundtrips.
## 2023-11-20 - Combine Courier Shipments Aggregates using PostgreSQL FILTER
**Learning:** Three separate aggregate queries running concurrently were making three separate database round trips to fetch counts with different where conditions for the same table, opening multiple connections against the database.
**Action:** Used PostgreSQL's `FILTER (WHERE ...)` clause with `drizzle-orm`'s `sql` utility to combine them into a single query to reduce database round trips and connections footprint. Added an `or` restrictive `WHERE` clause to narrow scanned rows and leverage indexes.
