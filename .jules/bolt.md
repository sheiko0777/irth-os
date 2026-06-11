## 2024-06-11 - Batch Independent Queries in tRPC List Endpoints
**Learning:** tRPC paginated list endpoints frequently perform sequential database queries: one to fetch the actual paginated data and a second to calculate the total record count. Since these queries are independent, executing them sequentially adds unnecessary round-trip latency.
**Action:** Always batch independent list and total count queries using `Promise.all` in tRPC list endpoints. This executes them concurrently, cutting the total query latency roughly in half.
