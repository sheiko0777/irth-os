# `Promise.all` Connection Pool Hotspots Audit

| File:Line | Procedure | Concurrent Leases | Branch Writes? | Risk Rating |
| :--- | :--- | :--- | :--- | :--- |
| `apps/admin/src/server/routers/analytics.ts:32` | `salesByDay` | 2 (`ctx.withOrg`) | No | High (analytics) |
| `apps/admin/src/server/routers/analytics.ts:161` | `summary` | 6 (`ctx.withOrg`) | No | High (analytics) |
| `apps/admin/src/server/routers/analytics.ts:507` | `customerFunnel` | 3 (`ctx.withOrg`) | No | High (analytics) |
| `apps/admin/src/server/routers/coupons.ts:49` | `list` | 2 (`db.select`) | No | Low (admin list, outside tx) |
| `apps/admin/src/server/routers/giftCards.ts:28` | `list` | 2 (`ctx.db.select`) | No | Low (admin list, outside tx) |
| `apps/admin/src/server/routers/finance.ts:109` | `pnl` | 2 (`ctx.db`, `ctx.withOrg`) | No | Low (rare admin report) |
| `apps/admin/src/server/routers/finance.ts:238` | `vatReport` | 2 (`ctx.withOrg`) | No | Low (rare admin report) |
| `apps/admin/src/server/routers/returns.ts:135` | `list` | 2 (`db.query`, `db.select`) | No | Low (admin list, outside tx) |
| `apps/admin/src/server/routers/customers.ts:37` | `list` | 2 (`ctx.withOrg`) | No | High (hot admin list path) |
| `apps/admin/src/server/routers/notifications.ts:14` | `list` | 2 (`ctx.db.select`) | No | Medium (admin list, outside tx) |
| `apps/admin/src/server/routers/campaigns.ts:13` | `list` | 2 (`ctx.db.select`) | No | Low (admin list, outside tx) |
| `apps/admin/src/server/routers/courier.ts:27` | `listShipments` | 2 (`ctx.withOrg`) | No | Medium (courier list path) |
| `apps/admin/src/server/routers/courier.ts:94` | `listRemittances` | 2 (`ctx.withOrg`) | No | Medium (courier list path) |
| `apps/admin/src/server/routers/courier.ts:257` | `summary` | 2 (`ctx.withOrg`) | No | Medium (summary dashboard) |
| `apps/api/src/routes/products.ts:35` | `GET /` | 2 (`db.select`) | No | High (API read, outside tx) |
| `apps/api/src/routes/orders.ts:156` | `GET /` | 2 (`db.select`) | No | High (API read, outside tx) |
| `apps/api/src/ai/tools.ts:240` | `dashboard` | 2 (`ctx.db`) | No | Low (AI tool) |

## Recommendations for 3 Highest-Risk Entries

### 1. `apps/admin/src/server/routers/analytics.ts:161` (`summary`)
**Recommendation:** Refactor the queries hitting the `orders` table into a single SQL aggregate query using PostgreSQL `FILTER (WHERE ...)` to compute counts for today and total orders in one roundtrip. For the `salesTotals`, execute them sequentially or combine logic where possible, reducing the 6 leases.
**Correctness Hazard:** Converting to sequential execution on analytical endpoints avoids pool exhaustion but introduces severe latency regressions. Sequential queries could also lead to slight read skew (e.g. an order is placed between two counts), but single-query `FILTER` aggregates natively provide snapshot consistency.

### 2. `apps/admin/src/server/routers/customers.ts:37` (`list`)
**Recommendation:** Execute the list and total count queries sequentially inside a single `ctx.withOrg` transaction block instead of using `Promise.all`.
**Correctness Hazard:** Sequential execution resolves connection exhaustion by using a single lease, but slightly increases request latency and trades away strict transactional isolation (the count might drift slightly from the list if a row is added between the two queries, unless explicitly wrapped in a single REPEATABLE READ snapshot).

### 3. `apps/admin/src/server/routers/courier.ts:27` (`listShipments`)
**Recommendation:** Similar to the customers list, execute the data retrieval and the count sequentially within a single `ctx.withOrg` wrapper rather than grabbing two pool connections simultaneously.
**Correctness Hazard:** Executing sequentially introduces a minor data drift risk where the total row count may disagree with the result set if a shipment is inserted exactly between the execution of the two queries. Latency is also minimally increased compared to concurrent execution.
