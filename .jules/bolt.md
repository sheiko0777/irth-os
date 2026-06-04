## 2024-06-04 - Batch Independent Database Queries with Promise.all
**Learning:** In trpc routers like `orders.ts` or `products.ts`, list data queries and total count queries are executed sequentially, causing unnecessary cumulative latency.
**Action:** Always batch independent database queries using `Promise.all` to execute them concurrently, reducing latency to the longest single query. This applies to list + count queries, or multiple aggregate queries.
