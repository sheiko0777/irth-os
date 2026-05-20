## 2024-05-20 - [Concurrent DB Queries]

**Learning:** Found several instances of independent database queries being awaited sequentially in TRPC routers (e.g., `dashboard.ts` doing 4 sequential counts/sums, and list endpoints doing data fetch followed by count fetch). This causes a waterfall effect, increasing API latency.
**Action:** Use `Promise.all()` to execute independent database queries concurrently to reduce overall latency.
