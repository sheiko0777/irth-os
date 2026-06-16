import { MiddlewareHandler } from 'hono';

// Simple sliding window — resets per Worker instance
// For production: replace with Cloudflare KV-backed rate limiter
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(max: number, windowMs: number, trustedProxiesCount: number = 0): MiddlewareHandler {
  return async (c, next) => {
    // Prefer the platform-provided client IP (trusted on Cloudflare).
    let key = c.req.header('CF-Connecting-IP');
    if (!key) {
      // Only honor X-Forwarded-For when trusted proxies are explicitly configured.
      // With no trusted proxies the header is client-spoofable, so trusting it
      // would let an attacker rotate it to bypass the limit — fall back to a
      // shared 'unknown' bucket instead.
      if (trustedProxiesCount > 0) {
        const forwardedFor = c.req.header('X-Forwarded-For');
        if (forwardedFor) {
          const ips = forwardedFor.split(',').map(ip => ip.trim()).filter(Boolean);
          // Trust the rightmost `trustedProxiesCount` hops (added by our own
          // infrastructure); take the IP recorded by the outermost trusted hop.
          key = ips.length >= trustedProxiesCount ? ips[ips.length - trustedProxiesCount] : ips[0];
        }
      }
      if (!key) key = 'unknown';
    }
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
