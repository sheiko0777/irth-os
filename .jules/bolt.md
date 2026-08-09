## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.

## 2023-10-25 - Break Sequential Query Dependencies When Fetching By ID
**Learning:** Found sequential relation queries waiting on the primary fetch (e.g. `items` waiting for `po.order.id`) despite already having the primary key in `input.id`, needlessly doubling latency.
**Action:** When a procedure retrieves a specific entity by its ID alongside related records, break sequential query dependency by using `input.id` instead of the fetched entity's ID for the relational queries. Always execute them concurrently using `Promise.all` and remove any dead redundant queries.
