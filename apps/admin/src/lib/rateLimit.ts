// Simple sliding window — resets per Server instance.
// KNOWN LIMIT (interim): this is per-isolate, so the effective limit is
// `max` per window PER ISOLATE, not globally — requests scattered across
// isolates/colos each get their own budget. Replacing this with a
// KV/Durable-Object-backed limiter is tracked as follow-up work; until then
// this still bounds runaway loops within an isolate.
//
// Stale keys are evicted lazily: without eviction the Map grows without bound
// (one key per unique IP/token), which is itself a memory-pressure DoS vector.
// The sweep runs only when the cap is reached, so steady-state traffic pays
// nothing.
const MAX_TRACKED_KEYS = 10_000;

const hits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    if (hits.size >= MAX_TRACKED_KEYS) {
      // Evict everything already expired; then, if still full, drop the
      // soonest-to-expire key to make room.
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
    return { success: true };
  } else {
    entry.count++;
    if (entry.count > max) {
      return { success: false, resetAt: entry.resetAt };
    }
    return { success: true };
  }
}
