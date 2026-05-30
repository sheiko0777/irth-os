## 2024-05-30 - Database Array Materialization & N+1 Operations
**Learning:** Found instances where count calculations were done by materializing the entire table into memory (`.length` instead of `count()`). Also found loops causing N+1 operations (inserts, selects). This increases latency and memory usage.
**Action:** Audit API routes that perform aggregates or bulk inserts/fetches. Use `count()` for aggregates. Use `inArray` to fetch required items in a single query, map them for `O(1)` lookup, and batch inserts using `db.insert(...).values(arrayOfValues)`.
