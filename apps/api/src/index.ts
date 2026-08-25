import { Hono } from 'hono'
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
import { dbContext } from './db'

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

app.get('/health', (c) => {
  return c.json({ data: { status: 'ok', environment: 'development' }, error: null, meta: null })
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
