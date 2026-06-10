## 2024-05-18 - Batch independent DB queries
**Learning:** Paginated queries and simple item lookups can easily block the thread if awaited sequentially (e.g., getting a list and its total count, or an order and its items).
**Action:** Always wrap independent queries in `Promise.all` in tRPC routers and API endpoints to execute them concurrently and improve latency.
