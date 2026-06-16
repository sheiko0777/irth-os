## 2026-06-16 - [Batch Independent Queries in tRPC]
**Learning:** Sequential queries like fetching list data and total counts independently introduce unnecessary latency.
**Action:** Always batch independent queries like list and count in tRPC using `Promise.all` to reduce overall latency.
