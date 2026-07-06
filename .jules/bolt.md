## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.
## 2024-07-24 - Break Sequential Query Dependencies in tRPC Routers
**Learning:** In tRPC procedure implementations, fetching a primary entity and then sequentially using its ID to fetch relational records (e.g., `const order = await findFirst(); const items = await select().where(eq(id, order.id))`) causes an unnecessary waterfall effect, turning O(max latency) into O(n x latency). Since `order.id` is guaranteed to be the same as `input.id`, they do not have a hard data dependency.
**Action:** When an endpoint fetches a specific entity by its ID alongside related records, break sequential query dependency by using the `input.id` instead of the fetched entity's ID for the relational queries. This allows them to be batched concurrently using `Promise.all`.
