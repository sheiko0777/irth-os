## 2025-05-23 - [Batching reads and inserts with Drizzle ORM]
**Learning:** Drizzle ORM performance can be heavily degraded by N+1 queries during repetitive operations like order creation, where multiple variant records are fetched sequentially within a loop and then multiple order items are inserted one by one.
**Action:** Always avoid N+1 queries by batching reads with `inArray()` to construct in-memory hash maps for O(1) lookups. Additionally, always batch inserts using `.values([])` instead of iterating and inserting items one by one.
