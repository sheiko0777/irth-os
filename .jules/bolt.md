## 2025-06-08 - Avoid N+1 queries in tRPC mapping logic
**Learning:** Mapping over an array of entities and awaiting a `ctx.db` query for each inside `Promise.all` executes N concurrent queries, leading to severe performance bottlenecks.
**Action:** Use Drizzle ORM's `inArray` to fetch aggregates or relations for all entities in a single batched query, `groupBy` the parent ID, and map the results to the parent entities via an O(1) in-memory hash map (`Map`). Always early return if the original list is empty.
