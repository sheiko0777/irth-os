## 2024-05-24 - N+1 query and sequential fetch optimization
**Learning:** In Drizzle ORM, running list queries and count queries sequentially increases latency.
**Action:** Always batch list data and total count queries using Promise.all.
