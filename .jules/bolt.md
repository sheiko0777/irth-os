## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.
## 2026-09-07 - Batch Purchasing PO List Query
**Learning:** The po.list query was fetching data without a corresponding total count, missing essential pagination data, and implementing this sequentially would double latency.
**Action:** Execute list and count queries concurrently in API routes/tRPC procedures using `Promise.all` to return complete pagination metadata while reducing max latency.
