## 2024-05-21 - Parallelized Dashboard Stats Query
**Learning:** Found sequential dashboard queries slowing down page load unnecessarily. A single dashboard endpoint fired 4 distinct `await db.select` calls sequentially instead of using `Promise.all`.
**Action:** Always batch independent queries when fetching multiple dashboard stats or aggregate metrics using `Promise.all` to resolve them concurrently and improve latency.
