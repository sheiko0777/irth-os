## 2024-05-18 - Optimize list queries by batching DB calls
**Learning:** Found sequential db queries fetching data list and total count. This increases latency and violates memory guidelines on query batching.
**Action:** When creating list queries with a total count for pagination, always use `Promise.all` to batch the `.select()` data query and the `.select({ count: count() })` total query.
