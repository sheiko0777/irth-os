## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.

## 2024-08-01 - N+1 Queries in tRPC Procedures
**Learning:** Found N+1 query patterns in tRPC procedures where a list is fetched, and then `Promise.all` is used to map over the results to fetch counts for each item individually (e.g., in `pricelists.ts`). This is highly inefficient and creates an O(N+1) database roundtrip scenario.
**Action:** Replace `Promise.all` count mappings on list queries with a single Drizzle query using `leftJoin`, `groupBy`, and `count()` to resolve relations and counts in O(1) database queries.
