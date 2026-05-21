import { MiddlewareHandler } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyHmac(secretEnvKey: string, headerName: string): MiddlewareHandler {
  return async (c, next) => {
    const secret = process.env[secretEnvKey];
    if (!secret) return c.json({ data: null, error: 'Webhook secret not configured', meta: null }, 500);

    const signature = c.req.header(headerName);
    if (!signature) return c.json({ data: null, error: 'Missing signature', meta: null }, 401);

    const body = await c.req.text();
    const expected = createHmac('sha512', secret).update(body).digest('hex');

    const sigBuf = Buffer.from(signature.replace('sha512=', ''), 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return c.json({ data: null, error: 'Invalid signature', meta: null }, 401);
    }

    // Re-attach body for downstream handlers
    c.set('rawBody', body);
    await next();
  };
}
