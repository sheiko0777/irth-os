import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from './db'
import { auth } from './auth'
import { ordersRoute } from './routes/orders'
import { shippingRoute } from './routes/shipping'
import { paymobRoute } from './routes/webhooks/paymob'
import { bostaRoute } from './routes/webhooks/bosta'
import { webhooksRouter } from './routes/webhooks'
import { auditMiddleware } from './middlewares/audit'
import { orgsRouter } from './routes/orgs'
import { notificationsRouter } from './routes/notifications'
import { productsRouter } from './routes/products'
import { categoriesRouter } from './routes/categories'
import { corsMiddleware } from './middlewares/cors'
import { securityHeaders } from './middlewares/securityHeaders'
import { rateLimit } from './middlewares/rateLimit'
import { authContext } from './middlewares/authContext'

const app = new Hono()

app.use('*', corsMiddleware)
app.use('*', securityHeaders)
const trustedProxyCount = parseInt(process.env.TRUSTED_PROXY_COUNT || '0', 10);
app.use('/api/*', rateLimit(100, 60_000, trustedProxyCount))
app.use('/api/auth/*', rateLimit(10, 60_000, trustedProxyCount))
// Establish trusted identity (userId/orgId/role) from the session before audit
// and route handlers run. Skips /api/auth, webhooks, and /health internally.
app.use('*', authContext())
app.use('*', auditMiddleware())

app.get('/health', async (c) => {
  const environment = process.env.NODE_ENV || 'development'
  try {
    await db.execute(sql`select 1`)
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

export default app
