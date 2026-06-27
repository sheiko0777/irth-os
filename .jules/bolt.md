## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.
## 2025-02-14 - Break Sequential Query Dependencies in tRPC Relational Queries
**Learning:** Found sequential queries where a primary record was fetched first just to use its ID (`entity.id`) for subsequent related record queries, creating unnecessary execution waterfalls (O(N) latency).
**Action:** When procedures retrieve a specific entity by its ID alongside related records, break the sequential query dependency by using the procedure's input ID (`input.id`) instead of the fetched entity's ID for the relational queries. Batch them concurrently using `Promise.all` to reduce overall latency.
