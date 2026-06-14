## 2025-02-23 - Batch Independent Database Queries
**Learning:** Sequential database queries for list data and total count add unnecessary network latency. The queries are independent and block each other.
**Action:** Always batch independent database queries (e.g., fetching multiple dashboard stats, aggregate metrics, or list + total count queries in tRPC routers) using `Promise.all` to execute them concurrently and improve latency.
