## 2024-06-07 - Batching Independent Database Queries
**Learning:** Found sequential independent database queries in tRPC list routers (e.g. fetching items array then `count()` for pagination). This increases the API latency by doubling database round-trips.
**Action:** Use `Promise.all` to batch the pagination query and count query. Same logic applies for sequential detail fetching such as retrieving order details, items, and history.
