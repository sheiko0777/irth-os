# Task packet — the one body every executor reads

A task packet is a GitHub issue whose body has these sections, in this order.
Jules reads it as-is when the `jules` label is applied; Codex gets it wrapped by
`scripts/delivery/packet-to-brief.mjs`; Hermes gets the issue URL; Claude runs it
with `superpowers:subagent-driven-development`. Labels mirror the header fields.

## Sections

1. **Title** — `[<PREFIX>-<nn>] <imperative summary>`
2. **Goal** — one paragraph, the user-visible outcome
3. **Slice / Domain / Executor / Size** — `S0`–`S5` · `DM|OR|IN|CX|AN|DL|UI` · `claude|codex|jules|hermes|owner|accountant|ui` · `S|M|L`
4. **Context pointers** — `docs/agents/domain.md`, the slice epic, plan sections that lock decisions, owner facts A1–A4 when relevant
5. **Files** — exact paths; `new:` prefix for files that do not exist yet
6. **Reuse** — existing functions/patterns to build on, with paths (e.g. `packages/db/src/ledger.ts postJournalEntry`, `packages/db/src/index.ts withOrgContext`, `apps/api/src/routes/webhooks/shopify.ts claimDelivery`)
7. **Do-not-touch** — paths that stay untouched; plus, unless `exec:claude`: no migrations, no `pnpm-lock.yaml`, no `.env*`, no auth config
8. **Acceptance** — checkable bullets (a reviewer can answer yes/no to each)
9. **Tests** — unit / integration on the disposable Postgres branch / RLS coverage / Playwright, with file paths
10. **Depends_on** — issue references; published as native `blocked_by` dependencies
11. **Report contract** — what the PR body must contain: the evidence row (`ID | status | PR | commit | evidence/tests | migration | blocker | next`), gate output counts (`node pnpm.cjs turbo lint typecheck test`), deviations from the packet

## Example (DL-05)

```
[DL-05] Migration numbering lock (CI check `migration-check`)

Goal
Fail any PR whose migration files collide, are numbered at or below origin/main's highest,
are malformed, or edit/delete an existing migration — the collision class that already
forced the 0057→0058 renumber.

Slice S0 · Domain DL · Executor jules · Size S

Context pointers
docs/agents/domain.md · epic: S0 · plan §7.0 (migration sequence) · STATUS.md F11 note

Files
new: packages/db/scripts/check-migrations.mjs
packages/db/package.json (script check:migrations)
.github/workflows/ci.yml (new job migration-check)
new: packages/db/src/__tests__/checkMigrations.test.ts

Reuse
packages/db/scripts/migrate.mjs — filename-keyed ledger; the ordering this check protects
git ls-tree origin/main — list of migrations on main; git diff --name-status origin/main...HEAD

Do-not-touch
packages/db/scripts/migrate.mjs · packages/db/drizzle/** · pnpm-lock.yaml · .env*

Acceptance
- On current main the check passes.
- Planted 0066_dup.sql next to 0066_two_factor_lockout_columns.sql → red, naming both files.
- Planted one-line edit to 0010 → red. Planted 0060_x.sql (≤ main max) → red. Plants reverted.
- Job appears as `migration-check` on the PR.

Tests
packages/db/src/__tests__/checkMigrations.test.ts: unique / dup / edited / deleted / low-number / malformed

Depends_on
— (none)

Report contract
Evidence row for DL-05 in docs/delivery/S0.md; gate counts; the three planted-red screenshots or log links.
```
