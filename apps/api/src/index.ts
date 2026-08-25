import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { auth } from './auth'
import { ordersRoute } from './routes/orders'
import { shippingRoute } from './routes/shipping'
import { paymobRoute } from './routes/webhooks/paymob'
import { bostaRoute } from './routes/webhooks/bosta'
import { webhooksRouter } from './routes/webhooks'
import { orgsRouter } from './routes/orgs'
import { notificationsRouter } from './routes/notifications'
import { productsRouter } from './routes/products'
import { categoriesRouter } from './routes/categories'
import { corsMiddleware } from './middlewares/cors'
import { securityHeaders } from './middlewares/securityHeaders'
import { rateLimit } from './middlewares/rateLimit'
import { authContext } from './middlewares/authContext'
import { dbContext, getDb, captureEnv } from './db'
import { processOutbox, OUTBOX_BATCH_SIZE } from './workers/outboxWorker'

const app = new Hono()

// First in the chain on purpose: Workers expose configuration only through the
// request `env`, so the database handle cannot exist until a request arrives.
// Anything registered above this that touches the db would throw.
app.use('*', dbContext())
app.use('*', corsMiddleware)
app.use('*', securityHeaders)
const trustedProxyCount = parseInt(process.env.TRUSTED_PROXY_COUNT || '0', 10);
app.use('/api/*', rateLimit(100, 60_000, trustedProxyCount))
app.use('/api/auth/*', rateLimit(10, 60_000, trustedProxyCount))
// Establish trusted identity (userId/orgId/role) from the session before
// route handlers run. Skips /api/auth, webhooks, and /health internally.
app.use('*', authContext())

// Real DB-connectivity check, not a hardcoded 'ok' — a load balancer that
// trusts this without one keeps routing traffic to a Worker that can't reach
// Postgres. environment now reads NODE_ENV instead of a literal
// 'development' string that lied in every other environment. Ported from a
// 2-month-stale claude/phase-a-production-boot branch found in the
// archaeology sweep, adapted to getDb() (the request-scoped handle this file
// didn't have then).
//
// NODE_ENV comes from `c.env`, not `process.env` — same reason getDb() reads
// `envRef` instead of `process.env.DATABASE_URL` (see db.ts): `[vars]` in
// wrangler.toml is only reachable through the request's env on Workers.
// `process.env.NODE_ENV` stays as the fallback for local/test/node contexts,
// where c.env carries no such binding.
app.get('/health', async (c) => {
  const environment = (c.env as { NODE_ENV?: string }).NODE_ENV || process.env.NODE_ENV || 'development'
  try {
    await getDb().execute(sql`select 1`)
    return c.json({ data: { status: 'ok', db: 'up', environment }, error: null, meta: null })
  } catch {
    return c.json(
      { data: { status: 'degraded', db: 'down', environment }, error: 'db_unreachable', meta: null },
      503,
    )
  }
})

app.on(['POST', 'GET'], '/api/auth/**', (c) => {
  return auth.handler(c.req.raw)
})


app.route('/api/orders', ordersRoute)
app.route('/api/shipping', shippingRoute)
app.route('/api/webhooks/paymob', paymobRoute)
app.route('/api/webhooks/bosta', bostaRoute)
app.route('/webhooks', webhooksRouter)
app.route('/api/orgs', orgsRouter)
app.route('/api/notifications', notificationsRouter)
app.route('/api/products', productsRouter)
app.route('/api/categories', categoriesRouter)

/**
 * How many batches one cron tick will drain before yielding.
 *
 * Bounded rather than "loop until empty" so a backlog cannot run the invocation
 * into the Workers CPU limit and get killed mid-send — a killed run leaves
 * events it already delivered still marked unprocessed, and the next tick sends
 * them again. With the default every-minute trigger this ceiling is 100
 * events/minute; a standing backlog above that rate is a signal to raise the
 * cron frequency, not this number.
 */
const OUTBOX_MAX_BATCHES_PER_TICK = 10

export default {
  fetch: app.fetch,

  /**
   * Drains the outbox on a cron trigger (see [triggers] in wrangler.toml).
   *
   * The producers were wired up before any consumer existed, so events
   * accumulated in the table and no notification was ever sent. `scheduled` is
   * the only thing on Workers that runs without an inbound request; the old
   * setInterval-based starter could not work, because an isolate does not
   * outlive the request that created it.
   *
   * `captureEnv` is required: middleware only runs for `fetch`, so without it
   * getDb() falls through to `process.env`, which is empty on Workers, and
   * every tick would fail on a missing DATABASE_URL.
   *
   * The work is wrapped in waitUntil so the runtime keeps the invocation alive
   * until the drain settles instead of tearing it down when `scheduled`
   * returns.
   */
  async scheduled(_event: ScheduledEvent, env: unknown, ctx: ExecutionContext): Promise<void> {
    captureEnv(env as Record<string, unknown>)
    const db = getDb()

    ctx.waitUntil((async () => {
      for (let i = 0; i < OUTBOX_MAX_BATCHES_PER_TICK; i++) {
        const handled = await processOutbox(db)
        // A short batch means the queue is drained; only a full one implies
        // there may be more waiting.
        if (handled < OUTBOX_BATCH_SIZE) break
      }
    })())
  },
}
