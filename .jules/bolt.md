## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.

## 2024-05-18 - Sequential Entity Fetching Anti-Pattern
**Learning:** In tRPC endpoints retrieving a primary entity by ID and its related data (like `orders.getById` or `products.getById`), there's a recurring pattern of fetching the primary entity first, then using its returned `id` to query relations. This creates a sequential dependency that doubles database roundtrips.
**Action:** Always refactor these to use the original `input.id` for all queries and execute them concurrently using `Promise.all`. This safely halves the latency while preserving identical functionality (as the first query will still throw `NOT_FOUND` if the entity doesn't exist).
