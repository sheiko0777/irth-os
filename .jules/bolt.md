
## 2024-05-18 - Optimize Order Creation Endpoint
**Learning:** Found an N+1 query issue, inefficient sequence generation loading all rows into memory to check `.length`, and unbatched row inserts in `apps/api/src/routes/orders.ts` inside a route handler looping over items. This scales poorly as items size grows or records accumulate.
**Action:** Always batch queries with `inArray()` mapping by ID for fast lookup. Replace fetching entire sets into memory just for length count with an aggregate `.select({ count: count() })` call. Insert multiple items using a batched `await db.insert(...).values([...])` instead of looping `.values({...})`.
