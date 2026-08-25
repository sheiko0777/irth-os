# irth-os Production Deployment — Current State & Runbook

Supersedes the previous version of this file, which described infrastructure
(Supabase, `irth.eg`) that was never actually provisioned and referenced
issues (RBAC matrix, `orgId` type consistency) that were fixed by the P0–P5
foundation refactor. This version reflects what is actually built, checked
against the live code, not what was once planned.

Target: **`app.irth-house.com`** — the IRTH HOUSE beauty brand's ops/ERP
console. `irth-house.com` itself is a separate Shopify storefront; this app
is not it.

---

## What's already real

- **Database**: Neon Postgres, not Supabase. `DATABASE_URL` is a GitHub
  secret already referenced by every workflow below.
- **CI gate** (`.github/workflows/ci.yml`): unit tests (mocked `db`) plus a
  separate integration job against a real, disposable Postgres branch
  (`TEST_DATABASE_URL`) — the only way a constraint, trigger, or RLS policy
  actually gets exercised before merge. Both are non-bypassable: the
  integration job fails loudly if the secret is missing rather than silently
  skipping.
- **`apps/api` → Cloudflare Workers** (`deploy-api.yml` + `wrangler.toml`):
  gated on `ci.yml`, runs real Drizzle migrations against production before
  deploying, then curls the deployed `/health` endpoint and fails the deploy
  if it doesn't return 200 within 5 retries. `/health` itself now runs a real
  `select 1` against Postgres (fixed this session — it used to be a hardcoded
  `{status:'ok'}` that would report healthy even with the database
  unreachable, which made the smoke test worthless).
- **RBAC**: `packages/db/src/permissions.ts` already covers orders, coupons,
  campaigns, inventory, stocktaking, finance, and eta invoices, not just the
  three resources an earlier version of this plan flagged as missing.
- **`orgId` typing**: already consistently `uuid` across schema tables,
  contrary to what this plan used to claim.

## What changed today

- **CORS** (`apps/api/src/middlewares/cors.ts`): was hardcoded to
  `irth.com`/`admin.irth.com` — domains nobody owns. Now allows
  `https://app.irth-house.com` and `https://irth-house.com`.
- **`apps/admin` production build was broken**: `next build` failed with
  `Cannot find module 'picocolors'`. Root cause: `node_modules/.pnpm` had
  corrupted (empty) content for `picocolors` and `@babel/parser` — the exact
  "killed install corrupts node_modules" failure mode this repo has hit
  before. Repaired via a scoped, forced reinstall
  (`pnpm install --filter "@irth/admin..." --force`) rather than a full
  workspace reinstall, to keep it fast and avoid re-triggering the same
  class of corruption across the whole monorepo.
- **Admin hosting decided: Vercel**, not Cloudflare Pages. The previous
  `deploy-admin.yml` ran `wrangler pages deploy .next` — that does not work
  for a dynamic Next.js app with server-side tRPC without the
  `@opennextjs/cloudflare` (or `@cloudflare/next-on-pages`) build adapter,
  which was never installed. Vercel needs no adapter for this stack
  (Next.js 15, App Router) and is the standard target. `deploy-admin.yml`
  now builds and deploys through the Vercel CLI, gated on `ci.yml`, with the
  same "smoke test the real URL or fail the deploy" discipline as the API
  workflow.

## What still needs a human — I cannot do these myself

### 1. Vercel project

- Create a Vercel project linked to this repo, **Root Directory = `apps/admin`**.
- Vercel auto-detects the pnpm workspace and Next.js; no extra config file
  needed for that part.
- Generate a token (`vercel.com/account/tokens`) and find the org/project
  IDs (`vercel link` locally, or the project's Settings page).
- Add as GitHub repo secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID`.
- Add as a GitHub repo **variable** (not secret — it's a public URL):
  `ADMIN_HEALTH_URL` = `https://app.irth-house.com/ar/login` (or any route
  that returns 200 without auth).

### 2. DNS for `app.irth-house.com`

Whoever controls the `irth-house.com` zone (check whether that's Shopify's
own DNS or delegated elsewhere — Shopify-hosted storefronts sometimes keep
DNS in Shopify, sometimes it's delegated to a registrar/Cloudflare) needs to
add the CNAME record Vercel's dashboard specifies after the project is
created (Vercel shows the exact record once you add the custom domain in
Project Settings → Domains).

### 3. Environment variables — set per target, not shared blindly

**Vercel project settings** (`apps/admin`):
| Variable | Notes |
|---|---|
| `DATABASE_URL` | Same Neon database `apps/api` uses — this app queries it directly via its own tRPC routers. |
| `BETTER_AUTH_SECRET` | **Must be identical to `apps/api`'s value** — both read/write the same `session`/`account`/`user` tables (see `apps/admin/src/lib/auth-server.ts` and `apps/api/src/auth.ts`, which are already documented to require parity). |
| `NEXT_PUBLIC_APP_URL` | `https://app.irth-house.com` — Better Auth's `baseURL` reads this; without it, cookies/redirects target `localhost:3000` in production. |

**Cloudflare Workers secrets** (`apps/api`, via `wrangler secret put <KEY>` —
already documented in `wrangler.toml`'s own comment, listed here for the
one-shot checklist):
`DATABASE_URL`, `BETTER_AUTH_SECRET` (same value as above),
`PAYMOB_API_KEY`, `PAYMOB_HMAC_SECRET`, `BOSTA_API_KEY`, `BOSTA_ACCOUNT_ID`,
`ETA_CLIENT_ID`, `ETA_CLIENT_SECRET`, `ETA_ISSUER_EIN`, `RESEND_API_KEY`,
`ARCJET_KEY`.

**GitHub repo secrets** (Settings → Secrets and variables → Actions), for
the deploy workflows themselves to run at all:
`DATABASE_URL`, `TEST_DATABASE_URL` (a **disposable** branch — the
integration suite truncates every table it touches, never point this at
production), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`API_HEALTH_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

### 4. Production database confirmation

Whether the Neon `DATABASE_URL` already in use for this repo's other work is
meant to become the production database, or a separate production branch
should be provisioned, is a decision only you can make — I don't know which
Neon project/branch is meant to hold real customer data versus dev/test
data. Once decided: `pnpm --filter @irth/db db:migrate` against it (this is
exactly what `deploy-api.yml` already automates on every deploy — it does
not need to be run by hand once the secret points at the right database).

### 5. Webhook registration

Once `apps/api` has a stable public URL (Workers' own `*.workers.dev`
subdomain works for this even without a custom domain — a custom domain for
the API was not part of what you asked for and isn't required for it to
function), register that URL as the webhook endpoint inside the Paymob,
Bosta, and ETA portals, then trigger each provider's test webhook to confirm
`verifyHmac`/`verifyWebhook` accepts real signed payloads.

---

## Verified, not assumed

Before calling this "ready," confirmed directly against this session's own
work, not carried over from the old plan:

- `pnpm --filter @irth/api typecheck` / `test` — clean.
- `pnpm --filter @irth/admin typecheck` / `test` (251 tests) / `lint` — clean.
- `pnpm --filter @irth/admin build` — was failing on a corrupted dependency;
  fixed and reverified (see "What changed today").
- CORS now names the real domain instead of a placeholder nobody owns.
- The API health check the deploy pipeline's own smoke test depends on now
  actually checks something.

## Not verified — flagged, not guessed

- Whether `NEXT_PUBLIC_APP_URL` / Better Auth's `trustedOrigins` need an
  explicit entry beyond `baseURL` for cross-subdomain cookie behavior between
  `app.irth-house.com` (admin) and wherever `apps/api`'s Workers domain ends
  up — Better Auth's default same-origin assumptions should hold since
  admin's own tRPC talks to the same DB directly rather than to `apps/api`
  over HTTP, but this was not tested against a real deployed pair of URLs.
- Whether the Neon database plan/region is adequate for production load —
  no load testing has been done at any point in this project.
- Mobile app (`apps/mobile`) deployment is entirely out of scope here; it
  was scaffolded (`feat-mobile-app-scaffold-...` — one of the stale branches
  from the archaeology sweep) but nothing in the current `apps/mobile`
  directory or this plan addresses shipping it.
