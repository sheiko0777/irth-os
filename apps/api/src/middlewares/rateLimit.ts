import { MiddlewareHandler } from 'hono';

// Simple sliding window — resets per Worker instance
// For production: replace with Cloudflare KV-backed rate limiter
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(max: number, windowMs: number): MiddlewareHandler {
  return async (c, next) => {
    const key = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
      if (entry.count > max) {
        return c.json({ data: null, error: 'Too Many Requests', meta: null }, 429);
      }
    }

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(max - (hits.get(key)?.count ?? 1)));
    await next();
  };
}
