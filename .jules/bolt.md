## 2025-05-25 - Avoid N+1 DB Queries and Inserts in Iterations
**Learning:** Performing database queries or inserts inside loops creates N+1 problems and severely hurts performance by multiplying database roundtrips.
**Action:** When using Drizzle ORM, batch database reads using `inArray()` to construct in-memory hash maps for O(1) lookups, and batch inserts using `db.insert(table).values(array_of_objects)` instead of inserting items one by one.
