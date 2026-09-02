# CLAUDE.md — irth-os

IRTH OS is an Arabic-first, multi-tenant ERP + CRM for the Egyptian market. It
moves **other people's money**. The rules below are not style preferences — each
one exists because violating it loses money silently, and silent loss is the
only kind that matters.

Read `AGENTS.md` for repo layout, commands, and conventions. This file is the
rules authority; where the two disagree, this file wins.

---

## The five rules

### 1. Money is an integer count of minor units

Amounts are `bigint` piastres (1 EGP = 100 piastres), never `float`, `number`,
`numeric`, or `decimal`.

```ts
// NO — 0.1 + 0.2 !== 0.3, and every read-modify-write compounds the drift
const total = Number(variant.price) * qty;
const vat = total * 0.14;

// YES
const total = Money.mul(Money.fromMinor(variant.priceMinor), qty);
const vat = Money.mulRate(total, VAT_RATE_BP);
```

- Do arithmetic through `packages/domain`'s `Money`, never on raw column values.
- Round **once**, at the point the number becomes a total a human will see or a
  tax authority will read — not at every intermediate step.
- Split a discount or tax across lines with `Money.allocate()`. Line amounts must
  sum to the header exactly; a largest-remainder split guarantees that,
  `Math.round` per line does not.
- Store a `currency` alongside every amount. Never add two amounts without
  asserting the currencies match.
- **Never** compute a percentage by multiplying by a float literal (`* 0.14`).
  Rates are basis points (integers).

A column named `amount` that is `numeric(12,2)` is a bug, not a schema choice.

### 2. The ledger is append-only

Financial history is a double-entry ledger: `accounts`, `journals`,
`journal_entries`, `journal_lines`.

- Every entry balances: `SUM(debit) = SUM(credit)`. Enforced by a deferred
  constraint trigger, not by hope.
- `journal_lines` has no `UPDATE` and no `DELETE` grant. Correct a mistake by
  posting a **reversing entry**, never by editing history.
- Reports read the ledger. They do not `SUM(orders.total_amount)` — an order
  table is a record of intent, not a record of value movement, and the two
  diverge the moment anything is refunded, discounted, or cancelled.
- Never hard-delete a financial row. Soft-delete or reverse.

### 3. Tenant isolation is structural, not remembered

- Every domain table carries `org_id`, indexed.
- Every table has RLS enabled with a policy — **and** every query is scoped by
  `ctx.orgId`. Two layers, because one forgotten `WHERE` should not be a breach.
- Set the tenant GUC **transaction-locally**:

```ts
// YES — third arg `true` scopes it to the transaction
await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);

// NO — `db` is a module-level singleton over a shared pool (packages/db/src/index.ts).
// A connection-level SET leaks this request's tenant into the next request
// that happens to get the same connection.
await db.execute(sql`set app.org_id = ${orgId}`);
```

- A `SELECT` that checks `orgId` followed by an `UPDATE` that does not is a
  TOCTOU bug even when the `SELECT` appears to protect it. Scope the write too.

### 4. Authorization is server-side

- The RBAC matrix is `packages/db/src/permissions.ts`. Enforce with the tRPC
  `protectedProcedure` / `adminProcedure` / `ownerProcedure`.
- `<PermissionGate>` and any client-side check are **UX only**. Assume the
  client is hostile and calls the procedure directly.
- Never trust a client-supplied `org_id` or `user_id`. Read identity from the
  session.

### 5. A financial write is atomic and idempotent

- One transaction. If a procedure writes to two tables, both land or neither
  does. A remittance marked reconciled while its shipments were not updated is
  money state that no report will ever flag.
- `withAudit` takes a transaction handle. The audit row commits with the write
  it describes, or the audit log is fiction.
- Every mutation that moves money or stock takes an idempotency key. Networks
  retry; users double-click. Applying a top-up twice is a real outcome, not a
  theoretical one.
- Put the guard in the `WHERE` clause, not in an `if` above the query:

```ts
// NO — the check is stale by the time the UPDATE runs, and two concurrent
// callers both pass it
if (coupon.usedCount < coupon.maxUses) { await db.update(...) }

// YES — the check and the increment cannot be split
await db.update(coupons)
  .set({ usedCount: sql`used_count + 1` })
  .where(and(eq(coupons.id, id), lt(coupons.usedCount, coupons.maxUses)))
```

---

## Enforcement

CI runs `pnpm turbo lint typecheck test` on every PR. All four workspaces are in
the gate — `packages/db` and `apps/api` included.

Integration tests run against a real Postgres branch, not a mock. A mocked `db`
cannot exercise a constraint, a trigger, or an RLS policy, so a green mock-only
suite proves nothing about the rules above.

**A gate that has never failed is not a gate.** When you add one, prove it fails:
plant the defect, watch CI go red, then revert the plant.

---

## Working here

- Read a file before editing it.
- No TypeScript `any` — use `unknown` plus a type guard.
- Never run `drizzle-kit push` against a shared database. Write a migration.
  Add new migration files; do not edit existing ones.
- `DATABASE_URL` is a GitHub secret. Never commit secrets, credentials, or
  `.env` files.
- Never touch `pnpm-lock.yaml` or `tsconfig.tsbuildinfo` by hand.
- Keep files under 500 lines.

- ---

## Branch & Merge Workflow (Claude Code as Senior AI)

Claude Code is the **senior AI** on this repo. Its PRs have elevated trust and can be auto-merged by the owner.

### Rules
- `main` is protected — never push directly to it
- - Always work on a feature branch: `claude/task-name`
  - - Open a Pull Request when work is ready
    - - The owner applies the `claude-code` label to auto-merge trusted PRs
      - - PRs without that label wait for manual review
       
        - ### How auto-merge works
        - A GitHub Action (`.github/workflows/claude-code-automerge.yml`) watches for the `claude-code` label and squash-merges the PR into `main` automatically. That label means: **"I trust this — ship it."**

        ### Other AI tools
        Other tools (Codex, Cursor, Windsurf, etc.) also open PRs. Do not touch their branches. Focus only on `claude/*` branches.
- Conventional commits. Do **not** add a `Co-Authored-By` trailer.
- Validate input at system boundaries with zod; bound free-text with `.max()`.
- User-facing strings are Arabic; currency renders as `ج.م`, not `EGP`.
