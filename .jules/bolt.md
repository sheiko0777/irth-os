## 2023-10-25 - Batch Pagination Queries
**Learning:** Found sequential list and count queries fetching same data source resulting in O(2 × latency) when it can be fetched in parallel.
**Action:** Always batch independent list and total count database queries in API routes/tRPC procedures using `Promise.all` to reduce max latency.

## 2023-10-25 - Avoid Dynamic Imports in Webhooks
**Learning:** Found dynamic imports (`await import(...)`) used directly inside a frequent webhook route handler, incurring unnecessary Promise overhead on every request despite being pure module imports.
**Action:** Always prefer top-level static imports for module dependencies instead of dynamic imports in request handlers and webhooks, unless there is a specific cold-start/bundle-size constraint requiring it.
