# Monitoring and the browser smoke test

## Error reporting (Sentry)

Both apps report crashes to Sentry **only when a DSN is configured**. With no
DSN the SDK is not initialised at all, so local dev, tests and previews are
unchanged.

| App | Where to set it | Variables |
| --- | --- | --- |
| API (Cloudflare Worker) | `wrangler secret put SENTRY_DSN` | `SENTRY_DSN` |
| Admin (Vercel) | Project → Settings → Environment Variables (Production) | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (same value) |

Use two Sentry projects (one per app) so alerts say which side failed. The
free plan is enough: tracing is off (`tracesSampleRate: 0`); only errors are
sent.

**What gets reported**

- API: any uncaught throw in `fetch` or the cron (`scheduled`), every 500
  returned by the global error handler, and every outbox event that is
  dead-lettered (a customer message never sent, an ETA invoice never filed, a
  blocked order never re-imported), tagged with the event type.
- Admin: server errors from pages, tRPC and route handlers (`onRequestError`),
  and browser errors.

**What never leaves the app**: cookies, headers, request bodies and query
strings are stripped from every event (`scrubEvent` in
`apps/api/src/lib/sentry.ts` and `apps/admin/src/lib/sentryOptions.ts`); the
user is reduced to an id. Outbox reports carry ids only, never the payload.

**Suggested alerts**: a new issue in either project, and any event tagged
`outbox_event_type`, notify the owner by email immediately.

## Browser smoke test (Playwright)

`apps/admin/e2e/` runs in CI (`e2e` job in `.github/workflows/ci.yml`) against a
production build and a throwaway Postgres service container: sign in, the
dashboard, the orders list, a blocked Shopify order and its resolution.

Locally:

```bash
createdb irth_e2e                                   # disposable — the seed writes to it
export DATABASE_URL=postgres://…/irth_e2e
export BETTER_AUTH_SECRET=any-32-plus-character-string
export NEXT_PUBLIC_APP_URL=http://localhost:3100
pnpm --filter @irth/db db:migrate
pnpm --filter @irth/admin build
pnpm --filter @irth/admin test:e2e                  # PW_CHROMIUM_PATH=… to reuse a local Chromium
```
