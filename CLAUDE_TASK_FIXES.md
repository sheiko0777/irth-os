# CLAUDE_TASK_FIXES.md — Architecture Remediation & Enhancement Plan

Target: Claude Code Senior AI  
Repository: `irth-os`  
Authority: Subordinate to `CLAUDE.md` rules.

---

## Operating Guidelines for Claude Code

- **Branch format**: `claude/fix-<phase-name>` (e.g., `claude/fix-ledger-vat-alignment`).
- **Safety**: Never touch `pnpm-lock.yaml` manually. Run `pnpm turbo lint typecheck test` before submitting PRs.
- **Rules**: Follow the 5 core rules in `CLAUDE.md` (BigInt minor units, append-only ledger, transactional RLS, server authorization, atomic idempotency).

---

## Phase 1: Ledger & ETA VAT Calculation Alignment

### Defect
- [`packages/db/src/orderLedger.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/packages/db/src/orderLedger.ts#L118-L132) calculates VAT on order gross total aggregate.
- [`packages/domain/src/eta.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/packages/domain/src/eta.ts#L327-L344) calculates VAT per line.
- Banker's rounding causes multi-piastre drift between the official ETA e-invoice and GL Account `2030 (VAT Payable)`.

### Remediation
1. Update `postOrderDeliveredEntry` in [`orderLedger.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/packages/db/src/orderLedger.ts) to read `order_items` prices and calculate VAT line-by-line using `taxIncludedIn` / `netOfTax`.
2. Sum the line-level VATs and line-level Nets to build the header ledger entry.
3. If order-level discounts exist, distribute them using `Money.allocate()` across lines before computing VAT.

### Verification
- Add integration test proving: `SUM(line_vat) == header_vat_posted_to_account_2030` across multi-item orders with uneven piastre values.

---

## Phase 2: Complete COD Courier Remittance Accounting

### Defect
- [`courier.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/admin/src/server/routers/courier.ts#L223-L237) reconciles remittances by debiting `1020 (Bank)` and crediting `1030 (AR - COD)` with net remittance amount.
- Courier deductions (shipping fees, return fees, COD fees, logistics VAT) are ignored, leaving permanent phantom balances in `1030`.

### Remediation
1. Modify `courierRemittances` in [`packages/db/src/schema/couriers.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/packages/db/src/schema/couriers.ts) to track:
   - `collectedGrossAmountMinor: bigint`
   - `shippingFeesMinor: bigint`
   - `serviceVatMinor: bigint`
   - `netAmountMinor: bigint`
2. Update `reconcile` in [`apps/admin/src/server/routers/courier.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/admin/src/server/routers/courier.ts):
   - Assert linked shipments total matches `collectedGrossAmountMinor`.
   - Post compound journal entry:
     - Debit `1020 (Bank)`: net remittance received
     - Debit `5030` or shipping expense account: courier shipping & handling fees
     - Debit `2030` (or input VAT account): courier invoice VAT
     - Credit `1030 (AR - COD)`: gross cash collected
3. Mark all reconciled shipments `codRemitted = true`.

### Verification
- Test reconciling a 10,000 EGP collected batch with 1,200 EGP courier deductions; verify `1030 (AR - COD)` clears to 0n.

---

## Phase 3: Deadlock Prevention in Multi-Item Inventory Locks

### Defect
- [`apps/api/src/routes/orders.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/api/src/routes/orders.ts#L139-L155) decrements inventory in payload order.
- Concurrent orders with shuffled variant arrays cause PostgreSQL `40P01` deadlock.

### Remediation
1. In `orders.ts`, sort `itemsToInsert` deterministically by `variantId` before starting the transaction loop:
   ```ts
   const sortedItems = [...itemsToInsert].sort((a, b) => a.variantId.localeCompare(b.variantId));
   ```
2. Execute the stock decrement and movement inserts in `sortedItems` order.

### Verification
- Run concurrent test with two requests containing reverse-ordered variant arrays (`[A, B]` and `[B, A]`); verify 0 deadlocks.

---

## Phase 4: Outbox Partitioning & Priority Queues

### Defect
- [`packages/db/src/campaignDispatch.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/packages/db/src/campaignDispatch.ts#L70-L78) dumps thousands of marketing events into `outbox_events`.
- Single queue with 100/min throughput starves transactional events (`order.confirmed`, `eta.invoice.issue`).

### Remediation
1. Add `priority` column (`'high' | 'normal' | 'low'`, default `'normal'`) to `outbox_events` in [`packages/db/src/schema/outbox.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/packages/db/src/schema/outbox.ts).
2. Assign `'high'` to `order.confirmed`, `order.shipped`, `eta.invoice.issue`, `org.invite.sent`.
3. Assign `'low'` to `campaign.recipient.send`.
4. Update `processOutbox` claim query in [`apps/api/src/workers/outboxWorker.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/api/src/workers/outboxWorker.ts#L447-L465) to order by `priority ASC, created_at ASC` (or drain high-priority before low-priority).

### Verification
- Enqueue 500 low-priority campaign items, then 1 high-priority order event. Verify the order event is claimed on the immediate next batch.

---

## Phase 5: Idempotency Lease Expiration & Stuck Key Recovery

### Defect
- [`packages/db/src/idempotency.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/packages/db/src/idempotency.ts#L240-L260) sweep retains incomplete `in_progress` rows for 24 hours.
- A killed Worker leaves the user blocked on `409 CONFLICT` for a full day.

### Remediation
1. Add `leaseExpiresAt: timestamp` (or check `created_at < now() - INTERVAL '5 minutes'`) to `idempotency_keys`.
2. When a retry hits an `in_progress` key in `withIdempotency`:
   - If `createdAt < now() - 5 minutes` and `effectCommittedAt IS NULL`, consider lease expired, delete stale claim, and allow the request to re-execute.
   - If `effectCommittedAt IS NOT NULL`, reject deletion (effect landed, response just failed to record).
3. Adjust `sweepIdempotencyKeys` to reclaim uncommitted `in_progress` claims after 15 minutes instead of 24 hours.

### Verification
- Simulate an aborted process with an `in_progress` key; test that retry succeeds after lease expiry without manual intervention.

---

## Phase 6: Structural RLS Enforcement on Read Routes

### Defect
- Route handlers in [`returns.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/admin/src/server/routers/returns.ts#L30-L41) and [`orders.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/api/src/routes/orders.ts#L49-L59) query the bare `db` singleton directly.
- The connecting role has `BYPASSRLS`, violating Rule 3's two-layer defense.

### Remediation
1. Wrap all read queries in `ctx.withOrg(async (tx) => ...)` or a read-only scoped helper `ctx.withOrgRead`.
2. Remove direct `db` exports from router-accessible contexts, forcing all database access through tenant-scoped transaction wrappers.

### Verification
- Execute query on `returns.list` omitting `eq(orderReturns.orgId, ctx.orgId)`; verify RLS filters out other tenant rows.

---

## Phase 7: Bosta Webhook Unification

### Defect
- Two competing Bosta webhook endpoints exist: [`/api/webhooks/bosta`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/api/src/routes/webhooks/bosta.ts) and [`/webhooks/bosta`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/api/src/routes/webhooks/bosta-webhook.ts).
- Bosta dashboards only configure a single webhook destination.

### Remediation
1. Merge the handling logic of both files into [`apps/api/src/routes/webhooks/bosta-webhook.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/api/src/routes/webhooks/bosta-webhook.ts).
2. Within one transaction per webhook event:
   - Update `courier_shipments` status, tracking events, and COD flags.
   - Update `orders` status (e.g. transition to `delivered`).
   - Emit outbox notification and trigger `postOrderDeliveredEntry`.
3. In [`apps/api/src/index.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/api/src/index.ts), redirect or point `/api/webhooks/bosta` to the unified handler.

### Verification
- Send a mock Bosta `delivered` webhook payload; verify both `courier_shipments` and `orders` + ledger update in unison.

---

## Phase 8: Customer Resolution on Order Creation

### Defect
- [`apps/api/src/routes/orders.ts`](file:///C:/Users/sheri/.gemini/antigravity/scratch/irth-os/apps/api/src/routes/orders.ts#L187-L194) hardcodes `customerId: null`.
- Notifications fail because `buildOrderNotification` cannot resolve customer contact information.

### Remediation
1. Extend `createOrderSchema` to accept `customerPhone`, `customerName`, `customerEmail`.
2. In the transaction before order insert:
   - Look up customer by `(orgId, phone)`.
   - If missing, upsert customer record into `customers`.
   - Pass resolved `customers.id` into `orders.customerId`.
3. Ensure `buildOrderNotification` emits complete payload to `outbox_events`.

### Verification
- Place order with phone number; verify customer row is linked and WhatsApp notification outbox event is created with valid recipient phone.
