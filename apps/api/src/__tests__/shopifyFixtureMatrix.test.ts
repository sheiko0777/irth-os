import { describe, it, expect } from 'vitest';
import { listFixtures, loadFixture } from './helpers/fixtures';
import { CandidateOrderSchema, validateCandidate } from '@irth/domain';

describe('Shopify Fixture Matrix [OR-14]', () => {
  const fixtures = listFixtures();

  it('has exactly the expected 20 fixtures', () => {
    const expectedNames = [
      'guest-checkout', 'registered-customer', 'deleted-variant', 'unknown-mapping',
      'order-discount-code+line-allocations', 'shipping+tax-included', 'shipping+tax-excluded',
      'partial-refund', 'partial-fulfillment', 'presentment-eur-shop-egp', 'multipage-lineitems',
      'cod-gateway', 'test-order', 'cancelled', 'edited', 'protected-data-redacted',
      'partial-errors-optional-path', 'throttled-then-ok', 'http-502', 'invalid-utf8-body'
    ];
    expect(fixtures.sort()).toEqual(expectedNames.sort());
  });

  describe.each(fixtures)('Fixture: %s', (fixtureName: string) => {
    it('parses the expected candidate with CandidateOrderSchema', () => {
      const fixture = loadFixture(fixtureName);
      const parseResult = CandidateOrderSchema.safeParse(fixture.expectedCandidate);
      
      if (!parseResult.success) {
        console.error(`Validation error for ${fixtureName}:`, parseResult.error.format());
      }
      
      expect(parseResult.success).toBe(true);
    });

    it('produces the expected blockers and section statuses from validateCandidate', () => {
      const fixture = loadFixture(fixtureName);
      const candidate = CandidateOrderSchema.parse(fixture.expectedCandidate);

      // Each fixture declares its own fetch outcome; omitted keys default to loaded/complete.
      const result = validateCandidate(candidate, fixture.expectedValidation.fetchStatus ?? {}, {
        connectionDimensionsResolved: true,
        supportedCurrencies: ['EGP', 'EUR'],
      });

      const key = (b: { code: string; section: string }) => `${b.code}@${b.section}`;
      expect(result.blockers.map(key).sort()).toEqual(fixture.expectedValidation.blockers.map(key).sort());

      const actualSections = Object.fromEntries(
        Object.entries(result.sections).map(([name, state]) => [name, { status: state.status }]),
      );
      expect(actualSections).toEqual(fixture.expectedValidation.sections);
    });
  });
});
