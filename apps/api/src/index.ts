import { Hono } from 'hono'
import { auth } from './auth'

const app = new Hono()

app.get('/health', (c) => {
  return c.json({ data: { status: 'ok', environment: 'development' }, error: null, meta: null })
})

app.on(['POST', 'GET'], '/api/auth/**', (c) => {
  return auth.handler(c.req.raw)
})

export default app
