import { MiddlewareHandler } from 'hono';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { envVar } from '../utils/env';

export function verifyHmac(secretEnvKey: string, headerName: string): MiddlewareHandler {
  return async (c, next) => {
    // Request-time read through the captured Worker env — process.env is
    // empty on Workers (see db.ts), so a direct read here 500s every call.
    const secret = envVar(secretEnvKey);
    if (!secret) return c.json({ data: null, error: 'Webhook secret not configured', meta: null }, 500);

    const signature = c.req.header(headerName);
    if (!signature) return c.json({ data: null, error: 'Missing signature', meta: null }, 401);

    const body = await c.req.text();
    const expected = createHmac('sha512', secret).update(body).digest('hex');

    const sigBuf = Buffer.from(signature.replace('sha512=', ''), 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    const hashedSig = createHash('sha256').update(sigBuf).digest();
    const hashedExp = createHash('sha256').update(expBuf).digest();

    if (!timingSafeEqual(hashedSig, hashedExp)) {
      return c.json({ data: null, error: 'Invalid signature', meta: null }, 401);
    }

    // Re-attach body for downstream handlers
    c.set('rawBody', body);
    await next();
  };
}
