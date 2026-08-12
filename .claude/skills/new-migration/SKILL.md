---
name: new-migration
description: Scaffold the next numbered SQL migration for packages/db, with the conventions this repo's custom migrator requires.
disable-model-invocation: true
---

# New migration

Creates the next migration in `packages/db/drizzle/`.

## Why this exists

This repo does **not** use drizzle's migrator, and getting that wrong is silent
rather than loud.

`drizzle/meta/_journal.json` has 5 entries against 26+ SQL files — everything
from `0006` on was hand-written and never got a journal entry. Drizzle's own
migrator reads that journal, so it would apply the first five, report success,
and **skip the rest**. Worse than having no migrator at all.

`packages/db/scripts/migrate.mjs` keeps its own `_migrations` ledger keyed by
**filename**, so it does not care how a migration was authored.

## Steps

1. Find the highest existing number:

```bash
ls packages/db/drizzle/*.sql | tail -3
```

2. Create `packages/db/drizzle/<NNNN>_<snake_case_name>.sql`, zero-padded to 4.

3. Separate every statement with the breakpoint marker — the runner splits on it
   and executes each piece in order:

```sql
ALTER TABLE "orders" ADD COLUMN "foo" bigint;--> statement-breakpoint
UPDATE "orders" SET "foo" = 0;
```

4. Update the matching Drizzle table in `packages/db/src/schema.ts` or
   `packages/db/src/schema/*.ts`. **The migration and the schema must agree** —
   a column that exists in the database but not in Drizzle is omitted from every
   insert, and a `NOT NULL` one then fails with `23502` at runtime, invisible to
   the mocked unit tests.

5. Apply to a disposable branch and verify:

```bash
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" --filter @irth/db db:migrate
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" --filter @irth/db test
```

## Rules

- **Never edit an applied migration.** The ledger is keyed on filename, so an
  edit never re-runs: the database keeps the old shape while the file claims the
  new one, forever, with no error. Write a new migration instead. (A PreToolUse
  hook blocks this.)
- **Never `CREATE INDEX CONCURRENTLY`.** The runner wraps each file in a single
  transaction and `CONCURRENTLY` cannot run inside one.
- **Never `drizzle-kit push`** against a shared database.
- Money columns are `bigint` minor units with a `currency` alongside — never
  `numeric`/`decimal`. Rates are `integer` basis points.
- Every domain table gets `org_id uuid NOT NULL`, indexed.
- Prefer additive steps. `public` on production is currently empty, so a plain
  `ALTER` is safe today; that stops being true the moment real orders exist.
