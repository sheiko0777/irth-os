# AGENTS.md — irth-os

Guidance for coding agents (Google Jules, Claude, etc.) working in this repo.
This project is built **in phases**; keep changes consistent with the existing
patterns below rather than introducing new ones.

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
- Install: `pnpm install`
- Lint + type-check (the CI gate): `pnpm turbo lint type-check`
- Tests: `pnpm turbo test`
- Dev (all apps): `pnpm dev` · single app: `pnpm --filter @irth/admin dev`
- Format: `pnpm format`

Env vars (see `apps/api/.env.example`): `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`, plus integration keys
(Bosta/Paymob/ETA/Resend/R2). Never commit real secrets.

## CI

`.github/workflows/ci.yml` runs on every PR: `pnpm install` →
`pnpm turbo lint type-check` → `pnpm turbo test`. A PR must keep these green.
Note: `apps/admin`'s gate is `next lint`; `apps/api` is built with `tsc`.

## Conventions (follow these)

- **Multi-tenancy:** every domain table carries `orgId`; **every** query must be
  scoped by `orgId`. Never return or mutate cross-org data.
- **Auth:** Better Auth (organization plugin). The admin tier verifies the
  session in `apps/admin/src/lib/auth.ts`; the API derives identity in
  `apps/api/src/middlewares/authContext.ts`. **Never trust client-supplied
  `org_id`/`user_id` headers** — read identity from the session/context.
- **RBAC:** the matrix lives in `packages/db/src/permissions.ts`
  (`can(role, resource, action)`; roles: `owner` > `admin` > `member`). On the
  server use the tRPC `protectedProcedure` / `adminProcedure` / `ownerProcedure`;
  on the client gate UI with `<PermissionGate>`. Client gating is UX only —
  always enforce on the server too.
- **tRPC routers** live in `apps/admin/src/server/routers/`, registered in
  `_app.ts`, and return the shape `{ data, error, meta }`.
- **Audit:** wrap state changes with `withAudit(db, op, { orgId, userId, action,
  tableName, changes })` from `@irth/db`.
- **DB:** Drizzle; schema in `packages/db/src/schema.ts` and `schema/*`. Add new
  tables/columns there and keep them org-scoped.
- **UI:** Arabic RTL (`dir="rtl"`, Cairo font); user-facing strings are Arabic.
- **Validation:** validate input with zod; bound free-text fields with `.max()`.

## Gotchas

- `apps/admin` has some pre-existing `tsc` errors in unrelated pages; the CI gate
  is `next lint`, not a full `tsc`. Keep your own changes `tsc`-clean.
- `apps/api` isn't covered by a `type-check` script in CI — run
  `cd apps/api && npx tsc --noEmit` locally before pushing API changes.
- Webhooks (`apps/api/src/routes/webhooks/*`) authenticate by signature and are
  intentionally outside session auth.

## Workflow

- Branch per change; open a PR to `main`; keep the CI checks green.
- Make focused commits; describe the phase/feature in the message.
