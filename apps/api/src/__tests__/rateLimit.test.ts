import { describe, expect, it } from 'vitest';
import {
  applySlidingWindowRateLimit,
  chooseRateLimitEvictionKeys,
  type RateLimitEntry,
} from '../middlewares/rateLimitLogic';

describe('applySlidingWindowRateLimit', () => {
  it('creates an entry for the first hit', () => {
    const result = applySlidingWindowRateLimit(undefined, 1_000, 3, 60_000);

    expect(result).toEqual({
      entry: { count: 1, resetAt: 61_000 },
      allowed: true,
      remaining: 2,
    });
  });

  it('increments hits inside the active window and rejects past max', () => {
    const first = applySlidingWindowRateLimit(undefined, 1_000, 2, 60_000);
    const second = applySlidingWindowRateLimit(first.entry, 2_000, 2, 60_000);
    const third = applySlidingWindowRateLimit(second.entry, 3_000, 2, 60_000);

    expect(second).toEqual({
      entry: { count: 2, resetAt: 61_000 },
      allowed: true,
      remaining: 0,
    });
    expect(third).toEqual({
      entry: { count: 3, resetAt: 61_000 },
      allowed: false,
      remaining: -1,
    });
  });

  it('starts a fresh window after resetAt has passed', () => {
    const current: RateLimitEntry = { count: 10, resetAt: 5_000 };

    const result = applySlidingWindowRateLimit(current, 5_001, 10, 60_000);

    expect(result).toEqual({
      entry: { count: 1, resetAt: 65_001 },
      allowed: true,
      remaining: 9,
    });
  });
});

describe('chooseRateLimitEvictionKeys', () => {
  it('evicts expired keys first and then the oldest live key when still at capacity', () => {
    const entries = new Map<string, RateLimitEntry>([
      ['expired', { count: 1, resetAt: 999 }],
      ['oldest-live', { count: 1, resetAt: 2_000 }],
      ['newer-live', { count: 1, resetAt: 3_000 }],
    ]);

    expect(chooseRateLimitEvictionKeys(entries, 1_000, 2)).toEqual(['expired', 'oldest-live']);
  });

  it('does not evict a live key when expired keys bring the store below capacity', () => {
    const entries = new Map<string, RateLimitEntry>([
      ['expired', { count: 1, resetAt: 999 }],
      ['live', { count: 1, resetAt: 2_000 }],
    ]);

    expect(chooseRateLimitEvictionKeys(entries, 1_000, 2)).toEqual(['expired']);
  });
});
