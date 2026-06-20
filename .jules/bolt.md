## 2024-06-20 - Batching Independent Database Queries
**Learning:** In tRPC list routers, the list queries and total count queries were often executed sequentially, causing unnecessary roundtrips to the database and adding to the overall latency.
**Action:** Always batch independent database queries (e.g., fetching multiple dashboard stats, aggregate metrics, or list + total count queries in tRPC routers) using `Promise.all` to execute them concurrently and improve latency.
