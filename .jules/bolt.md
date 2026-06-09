## 2024-05-24 - Batching Pagination Queries
**Learning:** Sequential execution of list data fetching and total count aggregation queries in tRPC routers adds unnecessary latency and roundtrips to the database.
**Action:** Always use `Promise.all` to batch independent queries like paginated lists and their corresponding total counts, executing them concurrently to improve response time.
