# Migration rules

Every agent that touches `packages/db/drizzle/` or `packages/db/src/schema*` follows these. Several agents write schema in parallel, so these rules keep the history linear and every gate green. Only `exec:claude` tasks write migrations; any other lane that needs one labels its issue `needs:schema`.

## How migrations run

`packages/db/scripts/migrate.mjs` applies every `drizzle/*.sql` file in filename order, once, one transaction per file, and records it in `public._migrations`. It does not use drizzle's migrator or `_journal.json` (which stops at 0004). `drizzle-kit push` is **never** used against a shared database. Both deploy workflows run `db:migrate` after a Neon snapshot (`docs/db/RESTORE.md`).

`node packages/db/scripts/migrate.mjs --dry-run` lists pending files without applying anything.

## Rules

1. **Number.** Next free 4-digit number above main's highest file, claimed in the PR title (e.g. `feat(db): dimension tables (0069)`). `migration-check` in CI rejects a number that isn't above main's max, a duplicate prefix, or any edit/delete/rename of an existing file. If two open PRs claim numbers, the lower one merges first.
2. **One concern per file.** Header comment says why the file exists, not just what it does.
3. **Additive only.** Never edit an applied file. To fix one, write a follow-up (see 0065).
4. **Must run on the existing DB.** There is no live customer data, so DROP/recreate is allowed. But every file must still succeed on the current single-org database: add a column nullable → backfill → `SET NOT NULL`. A migration that only works on an empty database breaks CI and deploy.
5. **RLS on every `org_id` table,** in the same file that creates it: `ENABLE` + `FORCE` + the NULLIF policy + explicit `GRANT`. Copy `drizzle/_TEMPLATE.sql.txt`. `rlsCoverage.test.ts` fails the build otherwise.
6. **Append-only tables** (ledgers, audit, stock moves): `REVOKE UPDATE, DELETE ... FROM "irth_app"`. Default privileges grant them, so omitting the grant is not enough.
7. **Entity-scoped children** (money, stock, documents): carry `legal_entity_id` with a composite FK `(parent_id, legal_entity_id) → parent(id, legal_entity_id)`, so a line whose entity disagrees with its parent is unrepresentable.
8. **Drizzle schema in the same PR.** Every table/column/CHECK in SQL is mirrored in `packages/db/src/schema*`, and new schema files are exported from `src/schema/index.ts` (drizzle-kit reads that barrel). `schemaDrift.test.ts` catches missing NOT NULL columns.
9. **Money is bigint minor units**, rates as integer basis points or num/den bigint pairs. No `numeric`/`float` for amounts.
10. **Gates must be green:** `test`, `integration` (rlsCoverage, schemaDrift, tenantIsolation, the rest of the real-Postgres suite), `migration-check`, and the `tenancyGate` unit test.

## PR checklist

- [ ] Migration number claimed in the PR title and above main's max
- [ ] One concern, header comment explains why
- [ ] Runs on the existing dev/test DB (nullable → backfill → NOT NULL)
- [ ] Every new `org_id` table: ENABLE + FORCE + NULLIF policy + GRANT
- [ ] Append-only tables REVOKE UPDATE, DELETE
- [ ] Entity-scoped children use the composite `(parent_id, legal_entity_id)` FK
- [ ] Drizzle schema updated and exported from `src/schema/index.ts`
- [ ] Money columns are bigint minor units
- [ ] CI `integration` and `migration-check` green
