import { MiddlewareHandler } from 'hono';
import { getEnv } from '../db';
import {
  applySlidingWindowRateLimit,
  chooseRateLimitEvictionKeys,
  type RateLimitDecision,
  type RateLimitEntry,
} from './rateLimitLogic';

// Stale keys are evicted lazily: without eviction the Map grows without bound
// (one key per unique IP), which is itself a memory-pressure DoS vector. The
// sweep runs only when the cap is reached, so steady-state traffic pays
// nothing. This cap only applies to the local fallback; Durable Objects keep
// one persisted entry per key.
const hits = new Map<string, RateLimitEntry>();
export const MAX_TRACKED_KEYS = 10_000;

function recordLocalHit(key: string, now: number, max: number, windowMs: number): RateLimitDecision {
  const currentEntry = hits.get(key);
  const startsNewWindow = !currentEntry || now > currentEntry.resetAt;

  if (startsNewWindow && hits.size >= MAX_TRACKED_KEYS) {
    for (const keyToEvict of chooseRateLimitEvictionKeys(hits, now, MAX_TRACKED_KEYS)) {
      hits.delete(keyToEvict);
    }
  }

  const decision = applySlidingWindowRateLimit(currentEntry, now, max, windowMs);
  hits.set(key, decision.entry);
  return decision;
}

function isRateLimitDecision(value: unknown): value is RateLimitDecision {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const entry = record.entry;
  if (typeof entry !== 'object' || entry === null) return false;
  const entryRecord = entry as Record<string, unknown>;
  return (
    typeof entryRecord.count === 'number' &&
    typeof entryRecord.resetAt === 'number' &&
    typeof record.allowed === 'boolean' &&
    typeof record.remaining === 'number'
  );
}

async function recordDurableObjectHit(
  namespace: DurableObjectNamespace,
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const id = namespace.idFromName(key);
  const stub = namespace.get(id);
  const url = new URL('https://rate-limit.local/');
  url.searchParams.set('max', String(max));
  url.searchParams.set('windowMs', String(windowMs));

  const response = await stub.fetch(url);
  if (!response.ok) {
    throw new Error(`RateLimiterDO returned ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isRateLimitDecision(payload)) {
    throw new Error('RateLimiterDO returned an invalid payload');
  }
  return payload;
}

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
): MiddlewareHandler {
  return async (c, next) => {
    const trustedProxies =
      typeof trustedProxiesCount === 'function' ? trustedProxiesCount() : trustedProxiesCount;

    // Prefer the platform-provided client IP (trusted on Cloudflare).
    let key = c.req.header('CF-Connecting-IP');
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

    const namespace = getEnv()?.RATE_LIMITER as DurableObjectNamespace | undefined;
    const decision = namespace
      ? await recordDurableObjectHit(namespace, key, max, windowMs)
      : recordLocalHit(key, Date.now(), max, windowMs);

    if (!decision.allowed) {
      return c.json({ data: null, error: 'Too Many Requests', meta: null }, 429);
    }

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(decision.remaining));
    await next();
  };
}
