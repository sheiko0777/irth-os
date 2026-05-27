
## 2024-05-27 - Drizzle ORM N+1 Queries and Inefficient Counts
**Learning:** Found critical N+1 query patterns and inefficient row counts during order creation. Querying relation dependencies in a loop creates an N+1 query bottleneck. Fetching the entirety of an existing relationship just to `.length` it transfers unnecessary data over the wire instead of offloading the calculation to the database engine using aggregate functions (`count(*)`).
**Action:** Always batch queries with `inArray()` prior to processing iterations and construct in-memory hash maps for O(1) lookups. When determining row counts, utilize `sql\`count(*)\`` aggregates instead of materializing the entire query results in memory.
