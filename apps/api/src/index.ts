import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { auth } from './auth'
import { ordersRoute } from './routes/orders'
import { shippingRoute } from './routes/shipping'
import { paymobRoute } from './routes/webhooks/paymob'
import { bostaRoute } from './routes/webhooks/bosta'
import { shopifyWebhookRoute } from './routes/webhooks/shopify'
import { webhooksRouter } from './routes/webhooks'
import { orgsRouter } from './routes/orgs'
import { activeOrganizationRoute } from './routes/activeOrganization'
import { notificationsRouter } from './routes/notifications'
import { productsRouter } from './routes/products'
import { categoriesRouter } from './routes/categories'
import { corsMiddleware } from './middlewares/cors'
import { securityHeaders } from './middlewares/securityHeaders'
import { rateLimit } from './middlewares/rateLimit'
import { authContext } from './middlewares/authContext'
import { handleError } from './utils/errors'
import { dbContext, getDb, captureEnv } from './db'
import { envVar } from './utils/env'
import { processOutbox, OUTBOX_BATCH_SIZE } from './workers/outboxWorker'

const app = new Hono()
app.use('*', dbContext())
app.use('*', corsMiddleware)
app.use('*', securityHeaders)
const trustedProxyCount = () => parseInt(envVar('TRUSTED_PROXY_COUNT') || '0', 10)
app.use('/api/*', rateLimit(100, 60_000, trustedProxyCount))
app.use('/api/auth/*', rateLimit(10, 60_000, trustedProxyCount))
app.use('/webhooks/*', rateLimit(600, 60_000, trustedProxyCount))
app.use('/health', rateLimit(60, 60_000, trustedProxyCount))
app.use('*', authContext())

app.get('/health', async (c) => {
  const environment = (c.env as { NODE_ENV?: string }).NODE_ENV || process.env.NODE_ENV || 'development'
  try {
    await getDb().execute(sql`select 1`)
    return c.json({ data: { status: 'ok', db: 'up', environment }, error: null, meta: null })
  } catch {
    return c.json({ data: { status: 'degraded', db: 'down', environment }, error: 'db_unreachable', meta: null }, 503)
  }
})

app.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))
app.onError((err, c) => c.json({ data: null, error: handleError(err), meta: null }, 500))
app.notFound((c) => c.json({ data: null, error: 'not_found', meta: null }, 404))

app.route('/api/orders', ordersRoute)
app.route('/api/shipping', shippingRoute)
app.route('/api/webhooks/paymob', paymobRoute)
app.route('/api/webhooks/bosta', bostaRoute)
app.route('/api/webhooks/shopify', shopifyWebhookRoute)
app.route('/webhooks', webhooksRouter)
app.route('/api/orgs', orgsRouter)
app.route('/api/orgs/active', activeOrganizationRoute)
app.route('/api/notifications', notificationsRouter)
app.route('/api/products', productsRouter)
app.route('/api/categories', categoriesRouter)

const OUTBOX_MAX_BATCHES_PER_TICK = 10
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: unknown, ctx: ExecutionContext): Promise<void> {
    captureEnv(env as Record<string, unknown>)
    const db = getDb()
    ctx.waitUntil((async () => {
      for (let i = 0; i < OUTBOX_MAX_BATCHES_PER_TICK; i++) {
        const handled = await processOutbox(db)
        if (handled < OUTBOX_BATCH_SIZE) break
      }
    })())
  },
}
