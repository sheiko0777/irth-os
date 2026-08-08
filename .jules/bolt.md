## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.
## 2023-10-25 - Drizzle ORM Relational Mapping N+1
**Learning:** Mapping over Drizzle ORM query results and fetching aggregate counts for each row in a `Promise.all` loop causes an N+1 query problem, increasing maximum database latency drastically.
**Action:** Always refactor sequential queries in `Promise.all` arrays into single aggregate database queries using `leftJoin`, `groupBy`, and `count()` functions directly.
