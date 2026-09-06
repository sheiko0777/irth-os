# Implementation Status — IRTH OS Plan

See `BASELINE.md` for Phase 0 decisions and environment limits. Baseline/current commit: `6dcf2df40b44e6b9b71979775eac1c393afd9a37`.

Progress row format: `Task ID | status | branch/PR | commit | evidence/tests | migration | blocker | next action`.

| ID | Status | Branch/PR | Commit | Evidence/Tests | Migration | Blocker | Next action |
|---|---|---|---|---|---|---|---|
| Phase 0 | done | — | — | `BASELINE.md` | none | none | proceed to F01 |
| F01 | confirmed, fixed | `fix/f01-webhook-delivery-lifecycle` (PR pending) | (pending merge) | `apps/api/src/__tests__/shopifyWebhookDeliveryLifecycle.test.ts` (mocked — reproduces the exact defect: a redelivery of a `'received'`-status row is claimed as `'retry'`, not `'processed'`) | none (existing `status`/`error`/`processedAt` columns on `shopify_webhook_deliveries` were already in schema, just unwired) | Local `tsc`/`vitest` broken by pre-existing pnpm store corruption (see BASELINE.md) — relying on CI's clean install for real verification, same as PRs #221-#223 this session | Merge once CI green; then F02 |
| F02 | not started | — | — | — | — | — | Next after F01 merges |
| F03-F09 | not started | — | — | — | — | — | Dependency order per plan Section 7: F03/F04 → F05 → F06 → F08 → F07 → F09 |
| F10-F20 | not started | — | — | — | — | — | Phase 2+ |

## F01 — webhook receipt can suppress recovery after processing failure

**Confirmed live at baseline**, not already fixed. Read `apps/api/src/routes/webhooks/shopify.ts`'s `recordDelivery` (now `claimDelivery`) directly:

- The delivery-dedup row (`shopify_webhook_deliveries`, keyed on `(connection_id, webhook_id)`) was inserted **before** the business transaction ran.
- On Shopify's automatic redelivery (same webhook id), the old code hit the unique-constraint violation and returned `false` — the caller (`/orders-create` and all four other handlers sharing this function) treated that as `alreadyProcessed: true` and returned **immediately, before ever checking whether the actual order/customer/inventory effect had completed**.
- Any failure between the delivery insert and the transaction committing — a crash, a DB timeout, an unrelated exception, anything other than the orders-table's own `(org_id, shopify_order_id)` unique-constraint race (which *was* already handled) — left a permanently "already processed" delivery row next to a business effect that never happened. The order was lost silently; Shopify saw 200 and stopped retrying.
- The schema already had `status` (default `'received'`), `error`, and `processedAt` columns on this exact table — designed for a lifecycle that nothing ever read or wrote.

**Fix**: `claimDelivery` now looks up the *existing row's status* on a redelivery instead of assuming existence means success. Only `status === 'processed'` short-circuits as already-done; `'received'`/`'failed'` return `{ kind: 'retry' }`, which the caller must reprocess (reusing the same delivery row, not losing it). `markDeliveryProcessed` is called **inside the same database transaction** as the order-creation/stock-decrement effect for `/orders-create` (and the restock effect for `/orders-cancelled`) — both commit together or neither does. The three lower-risk handlers (`/orders-updated`, `/customers-upsert`, `/inventory-levels-update`) mark processed just after their own naturally-idempotent single-statement effect commits; a small window there is acceptable since retrying any of them is itself a safe no-op (unlike order creation, which is not naturally re-runnable without this fix).

**Acceptance (A01)** — "crash after webhook reception... retry the same delivery ID... exactly one order... eventually processed": proven at the decision-logic level by `shopifyWebhookDeliveryLifecycle.test.ts`'s `'THE F01 REGRESSION'` test, which reproduces the exact prior-crash state (a `'received'`-status row with no completed effect) and asserts the redelivery is claimed as `'retry'`, not `'processed'`. Full end-to-end proof (an actual crash mid-transaction against real Postgres) is not covered here — see BASELINE.md's testing-infrastructure limitation.

**Files changed**: `apps/api/src/routes/webhooks/shopify.ts` (all 5 webhook handlers), new test file. No schema migration — the lifecycle columns already existed.
