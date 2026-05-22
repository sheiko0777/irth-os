import { MiddlewareHandler } from 'hono';

// Simple sliding window — resets per Worker instance
// For production: replace with Cloudflare KV-backed rate limiter
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(max: number, windowMs: number, trustedProxiesCount: number = 0): MiddlewareHandler {
  return async (c, next) => {
    let key = c.req.header('CF-Connecting-IP');
    if (!key) {
      const forwardedFor = c.req.header('X-Forwarded-For');
      if (forwardedFor) {
        const ips = forwardedFor.split(',').map(ip => ip.trim());
        // E.g. client, proxy1, proxy2
        // If trustedProxiesCount is 1, we trust the rightmost proxy (proxy2),
        // so we take the IP just before it (proxy1).
        // Since we are looking for the client IP securely, we just fall back
        // to the rightmost IP that we don't consider a trusted proxy.
        // Actually, the simplest is to take the (length - trustedProxiesCount - 1) index,
        // or just the first trusted proxy IP if that's what was requested.
        // The user asked to "fall back to first trusted proxy IP only".
        // If trustedProxiesCount > 0, we can take ips[ips.length - trustedProxiesCount] or similar.
        // Let's implement standard parsing.
        if (trustedProxiesCount > 0 && ips.length >= trustedProxiesCount) {
             key = ips[ips.length - trustedProxiesCount];
        } else {
             // Fallback to the rightmost IP (the closest proxy) if no trusted proxies configured
             key = ips[ips.length - 1] || 'unknown';
        }
      } else {
        key = 'unknown';
      }
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
