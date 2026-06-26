## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.
## 2024-06-25 - Promise.all for Concurrent Entity and Relations Fetching
**Learning:** Sequential database queries fetching an entity (e.g., `findFirst`) and its related records (e.g., `items`, `history`, `transactions`) based on a common ID (usually the input ID) introduce unnecessary O(N) latency.
**Action:** When a procedure retrieves a specific entity by its ID alongside related records that only require that same input ID, always use `Promise.all` to batch the independent queries, executing them concurrently to reduce database roundtrips and improve latency. Avoid using the fetched entity's ID (e.g., `order.id`) in the subsequent queries if `input.id` can be used instead to break the sequential dependency.
