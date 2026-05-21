## 2024-05-20 - Promise.all for independent DB queries
**Learning:** Sequential database queries that don't depend on each other are a common performance bottleneck in backend code. In this codebase, several trpc routers executed aggregation or list queries sequentially.
**Action:** Use `Promise.all()` to execute independent database queries concurrently to reduce overall request latency.
