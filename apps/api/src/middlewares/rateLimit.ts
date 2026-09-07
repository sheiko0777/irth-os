import { type Context, MiddlewareHandler } from 'hono';

// Simple sliding window — resets per Worker instance.
// KNOWN LIMIT (interim): this is per-isolate, so the effective limit is
// `max` per window PER ISOLATE, not globally — requests scattered across
// isolates/colos each get their own budget. Replacing this with a
// KV/Durable-Object-backed limiter is tracked as follow-up work; until then
// this still bounds runaway loops within an isolate and keeps the 429 shape
// clients must handle.
//
// Stale keys are evicted lazily: without eviction the Map grows without bound
// (one key per unique IP), which is itself a memory-pressure DoS vector. The
// sweep runs only when the cap is reached, so steady-state traffic pays
// nothing.
const MAX_TRACKED_KEYS = 10_000;

/**
 * `trustedProxiesCount` may be given directly (Node/tests) or as a getter —
 * the Worker path passes a getter because `process.env.TRUSTED_PROXY_COUNT`
 * is empty at module scope there (see apps/api/src/db.ts); reading it lazily
 * inside the middleware means it resolves from the captured request env.
 */
export function rateLimit(
  max: number,
  windowMs: number,
  trustedProxiesCount: number | (() => number) = 0,
  keyResolver?: (c: Context) => string | undefined,
): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const trustedProxies =
      typeof trustedProxiesCount === 'function' ? trustedProxiesCount() : trustedProxiesCount;

    // A route may provide a server-derived key (for example, an authenticated
    // organization). All existing callers omit this and remain IP-keyed.
    let key = keyResolver?.(c);
    // Prefer the platform-provided client IP (trusted on Cloudflare).
    if (!key) key = c.req.header('CF-Connecting-IP');
    if (!key) {
      // Only honor X-Forwarded-For when trusted proxies are explicitly configured.
      // With no trusted proxies the header is client-spoofable, so trusting it
      // would let an attacker rotate it to bypass the limit — fall back to a
      // shared 'unknown' bucket instead.
      if (trustedProxies > 0) {
        const forwardedFor = c.req.header('X-Forwarded-For');
        if (forwardedFor) {
          const ips = forwardedFor.split(',').map(ip => ip.trim()).filter(Boolean);
          // Trust the rightmost `trustedProxies` hops (added by our own
          // infrastructure); take the IP recorded by the outermost trusted hop.
          key = ips.length >= trustedProxies ? ips[ips.length - trustedProxies] : ips[0];
        }
      }
      if (!key) key = 'unknown';
    }
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      if (hits.size >= MAX_TRACKED_KEYS) {
        // Evict everything already expired; then, if still full, drop the
        // soonest-to-expire key to make room. Worst case is one O(n) sweep
        // per new key while saturated — acceptable for an interim limiter.
        let oldestKey: string | null = null;
        let oldestResetAt = Infinity;
        for (const [k, v] of hits) {
          if (now > v.resetAt) hits.delete(k);
          else if (v.resetAt < oldestResetAt) {
            oldestResetAt = v.resetAt;
            oldestKey = k;
          }
        }
        if (hits.size >= MAX_TRACKED_KEYS && oldestKey) hits.delete(oldestKey);
      }
      hits.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
      if (entry.count > max) {
        c.header('X-RateLimit-Limit', String(max));
        c.header('X-RateLimit-Remaining', '0');
        c.header('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
        return c.json({ data: null, error: 'Too Many Requests', meta: null }, 429);
      }
    }

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(max - (hits.get(key)?.count ?? 1)));
    await next();
  };
}
