export type RateLimitEntry = { count: number; resetAt: number };

export type RateLimitDecision = {
  entry: RateLimitEntry;
  allowed: boolean;
  remaining: number;
};

export function applySlidingWindowRateLimit(
  currentEntry: RateLimitEntry | undefined,
  now: number,
  max: number,
  windowMs: number,
): RateLimitDecision {
  if (!currentEntry || now > currentEntry.resetAt) {
    return {
      entry: { count: 1, resetAt: now + windowMs },
      allowed: true,
      remaining: max - 1,
    };
  }

  const entry = { count: currentEntry.count + 1, resetAt: currentEntry.resetAt };
  return {
    entry,
    allowed: entry.count <= max,
    remaining: max - entry.count,
  };
}

export function chooseRateLimitEvictionKeys(
  entries: Iterable<[string, RateLimitEntry]>,
  now: number,
  maxTrackedKeys: number,
): string[] {
  const expiredKeys: string[] = [];
  let oldestKey: string | null = null;
  let oldestResetAt = Infinity;
  let total = 0;

  for (const [key, entry] of entries) {
    total++;
    if (now > entry.resetAt) {
      expiredKeys.push(key);
    } else if (entry.resetAt < oldestResetAt) {
      oldestResetAt = entry.resetAt;
      oldestKey = key;
    }
  }

  if (total - expiredKeys.length >= maxTrackedKeys && oldestKey) {
    return [...expiredKeys, oldestKey];
  }
  return expiredKeys;
}
