# AGENTS.md — irth-os

Guidance for coding agents (Google Jules, Claude, etc.) working in this repo.
This project is built **in phases**; keep changes consistent with the existing
patterns below rather than introducing new ones.

> **Read `CLAUDE.md` first.** It holds the five non-negotiable rules (money as
> integer minor units, append-only ledger, structural tenant isolation,
> server-side authz, no hard deletes of financial rows). This file covers layout
> and conventions; `CLAUDE.md` covers the rules. Where they disagree, `CLAUDE.md`
> wins.

## What this is

IRTH OS — an Arabic-first (RTL), multi-tenant e-commerce / ERP platform for the
Egyptian market. pnpm + Turborepo monorepo.

```
apps/
  admin/    Next.js 15 admin dashboard (App Router, tRPC client, next-intl, Tailwind)
  api/      Hono API on Cloudflare Workers (Better Auth, Drizzle, webhooks)
  mobile/   mobile app
packages/
  db/       Drizzle ORM schema + client + RBAC permissions (@irth/db)
  emails/   email templates
  types/    shared types (@irth/types)
  utils/    shared utils (@irth/utils)
```

## Setup & commands

- Node >= 20, pnpm (the repo pins `pnpm@10.30.3`; CI uses pnpm 9 — either works).
- Install: `pnpm install` (install **all** workspaces — a partial install makes
  `turbo` fail locally in ways that do not reflect CI)
- The CI gate, in one command: `pnpm turbo lint typecheck test`
- Tests only: `pnpm turbo test`
- Dev (all apps): `pnpm dev` · single app: `pnpm --filter @irth/admin dev`
- Format: `pnpm format`

Env vars (see `apps/api/.env.example`): `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`, plus integration keys
(Bosta/Paymob/ETA/Resend/R2). Never commit real secrets.

## CI

`.github/workflows/ci.yml` runs on every PR: `pnpm install --frozen-lockfile` →
`pnpm turbo lint typecheck test`. A PR must keep these green.

`deploy-api.yml` runs `pnpm --filter @irth/db db:migrate` (the custom runner in
`packages/db/scripts/migrate.mjs`, **not** drizzle's own migrator — see below)
and then `wrangler deploy`.

## Conventions (follow these)

- **Multi-tenancy:** every domain table carries `orgId`; **every** query must be
  scoped by `orgId`. Never return or mutate cross-org data.
- **Auth:** Better Auth. The admin instance is
  `apps/admin/src/lib/auth-server.ts` (drizzle adapter; the organization plugin
  is deliberately **off** — it would create its own `organization`/`member`
  tables duplicating the `organizations`/`org_members` this app already scopes
  by). `apps/admin/src/lib/auth.ts` only *verifies* a session. The API derives
  identity in `apps/api/src/middlewares/authContext.ts`. **Never trust
  client-supplied `org_id`/`user_id` headers** — read identity from the
  session/context.
- **RBAC:** the matrix lives in `packages/db/src/permissions.ts`
  (`can(role, resource, action)`; roles: `owner` > `admin` > `member`). On the
  server use the tRPC `protectedProcedure` / `adminProcedure` / `ownerProcedure`;
  on the client gate UI with `<PermissionGate>`. Client gating is UX only —
  always enforce on the server too.
- **tRPC routers** live in `apps/admin/src/server/routers/`, registered in
  `_app.ts`, and return the shape `{ data, error, meta }`.
- **Audit:** wrap state changes with `withAudit(tx, op, { orgId, userId, action,
  tableName, changes })` from `@irth/db`. Pass the **transaction handle**, not
  `db` — passing `db` commits the business write and the audit row as two
  separate autocommits, so a crash between them leaves an unaudited change.
- **DB:** Drizzle; schema in `packages/db/src/schema.ts` and `schema/*`. Add new
  tables/columns there and keep them org-scoped. Money columns are `bigint`
  minor units — see `CLAUDE.md` rule 1.
- **UI:** Arabic RTL (`dir="rtl"`, Cairo font); user-facing strings are Arabic.
- **Validation:** validate input with zod; bound free-text fields with `.max()`.

## Gotchas

- **`pnpm install` locally needs `CI=true`** when `.npmrc` changes, or pnpm
  refuses to rebuild `node_modules` ("Aborted removal of modules directory due
  to no TTY").
- **Do not remove the `hoist-pattern` lines from `.npmrc`.** `apps/mobile` pins
  `@types/react` 18 and `apps/admin` uses 19; with default hoisting pnpm links
  one of them into `node_modules/.pnpm/node_modules/`, Next's bundled styled-jsx
  type definitions bind to *that* copy, and admin's `tsc` sees two unrelated
  `ReactNode` types — 613 errors, almost all `TS2786`. That state was CI-red for
  44 commits before anyone noticed, because the earlier gate ran a `type-check`
  script no package defined.
- **Migrations do not run through drizzle's migrator.** `drizzle/meta/_journal.json`
  has 5 entries against 24 SQL files (0006+ were hand-written), so drizzle's own
  migrator would silently skip 19 of them. `packages/db/scripts/migrate.mjs` keeps
  its own `_migrations` ledger keyed by filename, one transaction per file, and
  halts on the first failure. Use `pnpm --filter @irth/db db:migrate`.
- **Never run `drizzle-kit push`** against a shared database. Write a migration
  file; never edit an existing one.
- A partial `pnpm install` (only some workspaces populated) makes
  `pnpm turbo …` fail locally on missing modules — that is a local install gap,
  not a CI failure. Install everything.
- `apps/mobile`'s `tsconfig.json` extends `expo/tsconfig.base`, so its
  `typecheck` needs mobile's dependencies actually installed.
- Webhooks (`apps/api/src/routes/webhooks/*`) authenticate by signature and are
  intentionally outside session auth.

## Workflow

- Branch per change; open a PR to `main`; keep the CI checks green.
- Make focused commits; describe the phase/feature in the message.
