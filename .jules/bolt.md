## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.

## 2024-05-18 - Batch Relational Queries using Input ID
**Learning:** Found sequential fetch of primary entity followed by relational queries using the fetched entity's ID, which adds unnecessary database roundtrip delay.
**Action:** Always batch the primary entity and relational queries concurrently using `Promise.all` and base the relational where-clause on `input.id` rather than the fetched entity's ID to break the sequence dependency.
