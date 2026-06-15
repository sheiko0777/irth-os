## 2025-06-15 - Optimize Order Creation Performance

**Learning:** When creating an order with multiple items, iterating and fetching product variants one by one creates a classic N+1 query problem. Furthermore, reading all existing orders into memory just to determine the array length for an order sequence prefix is extremely memory-intensive as the dataset grows. Finally, inserting order items one by one inside a loop increases database latency unnecessarily.

**Action:**
1. Always batch variant fetching by passing an array of `variantIds` using Drizzle ORM's `inArray()`, and convert the result into a JavaScript `Map` for fast O(1) lookups during processing.
2. Never materialize a full table into memory just to calculate its length; use Drizzle's aggregate SQL `count(*)` function to push the counting workload directly to the database.
3. Instead of looping to `db.insert(...)` multiple times, construct an array of objects and perform a bulk insert via `db.insert(table).values([...array])`.