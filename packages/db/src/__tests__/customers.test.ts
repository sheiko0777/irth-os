import { describe, expect, it } from 'vitest';
import { normalizeIdentityExternalId, rankMergeCandidates } from '../customers';

describe('rankMergeCandidates', () => {
  it('orders by identity strength: verified shopify/woocommerce > phone > email', () => {
    const ranked = rankMergeCandidates(
      [
        { customerId: 'c-email', kind: 'email' },
        { customerId: 'c-phone', kind: 'phone' },
        { customerId: 'c-shop', kind: 'email' },
        { customerId: 'c-woo', kind: 'email' },
      ],
      [
        { customerId: 'c-email', kind: 'email', verified: false },
        { customerId: 'c-phone', kind: 'phone', verified: false },
        { customerId: 'c-shop', kind: 'shopify', verified: true },
        { customerId: 'c-shop', kind: 'email', verified: false },
        { customerId: 'c-woo', kind: 'woocommerce', verified: true },
      ],
    );
    expect(ranked.map((c) => [c.customerId, c.strength])).toEqual([
      ['c-shop', 3], ['c-woo', 3], ['c-phone', 2], ['c-email', 1],
    ]);
  });

  it('an unverified provider id does not count as strong', () => {
    const ranked = rankMergeCandidates(
      [{ customerId: 'a', kind: 'email' }, { customerId: 'b', kind: 'email' }],
      [
        { customerId: 'a', kind: 'shopify', verified: false },
        { customerId: 'a', kind: 'email', verified: false },
        { customerId: 'b', kind: 'phone', verified: false },
      ],
    );
    expect(ranked.map((c) => c.customerId)).toEqual(['b', 'a']);
    expect(ranked[1].strength).toBe(1);
  });

  it('breaks ties toward a phone match, collapses duplicate matches, ignores non-candidates', () => {
    const ranked = rankMergeCandidates(
      [
        { customerId: 'x', kind: 'email' },
        { customerId: 'y', kind: 'phone' },
        { customerId: 'y', kind: 'email' },
        { customerId: 'y', kind: 'email' },
      ],
      [
        { customerId: 'x', kind: 'email', verified: false },
        { customerId: 'y', kind: 'email', verified: false },
        { customerId: 'not-a-candidate', kind: 'shopify', verified: true },
      ],
    );
    expect(ranked).toEqual([
      { customerId: 'y', strength: 1, matchedOn: ['email', 'phone'] },
      { customerId: 'x', strength: 1, matchedOn: ['email'] },
    ]);
  });

  it('returns nothing for no matches', () => {
    expect(rankMergeCandidates([], [{ customerId: 'a', kind: 'phone', verified: true }])).toEqual([]);
  });
});

describe('normalizeIdentityExternalId', () => {
  it('lower-cases and trims emails only', () => {
    expect(normalizeIdentityExternalId('email', '  Ana@Example.COM ')).toBe('ana@example.com');
    expect(normalizeIdentityExternalId('shopify', ' gid://shopify/Customer/1 ')).toBe('gid://shopify/Customer/1');
  });
});
