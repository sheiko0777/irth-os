import { describe, expect, it } from 'vitest';
import { jsonSafe } from '../json';

describe('jsonSafe', () => {
  it('is needed at all — JSON.stringify throws on bigint', () => {
    // The premise. If this ever stops throwing, this whole module is dead code
    // and should be deleted rather than left as cargo.
    expect(() => JSON.stringify({ amount: 1n })).toThrow(/BigInt/);
    expect(() => JSON.stringify(jsonSafe({ amount: 1n }))).not.toThrow();
  });

  it('renders bigint as a decimal string, not a number', () => {
    // A number would defeat the point of minor units: Number(bigint) is lossy
    // past 2^53, and money is exactly what must not round.
    const out = jsonSafe({ totalAmountMinor: 19999n });
    expect(out.totalAmountMinor).toBe('19999');
    expect(typeof out.totalAmountMinor).toBe('string');
  });

  it('survives amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 9007199254740993n; // 2^53 + 1, not representable as a double
    const out = jsonSafe({ minor: huge });

    expect(out.minor).toBe('9007199254740993');
    // The string round-trips to the exact same integer.
    expect(BigInt(out.minor)).toBe(huge);
    // Whereas going through Number silently loses the last digit — which is
    // what serializing money as a JSON number would do.
    expect(String(Number(out.minor))).toBe('9007199254740992');
  });

  it('passes Date through instead of flattening it to {}', () => {
    // Object.entries(new Date()) is [], so a generic object walk turns every
    // timestamp into an empty object. This is the regression that a hand-rolled
    // copy of this helper shipped with.
    const createdAt = new Date('2026-08-18T10:00:00Z');
    const out = jsonSafe({ createdAt, totalAmountMinor: 5n });

    expect(out.createdAt).toBeInstanceOf(Date);
    expect((out.createdAt as Date).toISOString()).toBe('2026-08-18T10:00:00.000Z');
    expect(JSON.parse(JSON.stringify(out)).createdAt).toBe('2026-08-18T10:00:00.000Z');
  });

  it('walks arrays and nesting, which is where real rows carry money', () => {
    const row = {
      id: 'order-1',
      totalAmountMinor: 12345n,
      items: [
        { variantId: 'v1', quantity: 2, priceMinor: 500n },
        { variantId: 'v2', quantity: 1, priceMinor: 11345n },
      ],
      meta: { nested: { deep: 7n } },
    };

    const out = jsonSafe(row);
    expect(out.totalAmountMinor).toBe('12345');
    expect(out.items[0].priceMinor).toBe('500');
    expect(out.items[1].priceMinor).toBe('11345');
    expect(out.meta.nested.deep).toBe('7');
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('leaves null, undefined and primitives alone', () => {
    // typeof null === 'object', so null must be handled before the object walk
    // or it throws on Object.entries(null).
    expect(jsonSafe(null)).toBeNull();
    expect(jsonSafe(undefined)).toBeUndefined();
    expect(jsonSafe(0)).toBe(0);
    expect(jsonSafe('')).toBe('');
    expect(jsonSafe(false)).toBe(false);
    expect(jsonSafe({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
  });

  it('does not mutate its input', () => {
    // Callers pass rows they may still use; converting in place would turn a
    // bigint column into a string underneath them.
    const row = { totalAmountMinor: 42n, items: [{ priceMinor: 7n }] };
    const out = jsonSafe(row);

    expect(row.totalAmountMinor).toBe(42n);
    expect(row.items[0].priceMinor).toBe(7n);
    expect(out).not.toBe(row);
  });
});
