import { describe, expect, it } from 'vitest';
import { type CandidateOrder, validateCandidate } from '..';

function buildCandidate(overrides: Partial<CandidateOrder> = {}): CandidateOrder {
  const candidate: CandidateOrder = {
    header: {
      source_order_id: 'gid://shopify/Order/1',
      source_order_number: '#1001',
      source_updated_at: '2026-09-17T10:00:00Z',
      currency_code: 'EGP',
      presentment_currency_code: 'EGP',
      subtotal_price_set: { shop_money_minor: '10000' },
      total_price_set: { shop_money_minor: '11400' },
      total_tax_set: { shop_money_minor: '1400' },
      total_discounts_set: { shop_money_minor: '0' },
      total_shipping_set: { shop_money_minor: '0' },
      total_refunded_set: { shop_money_minor: '0' },
      total_outstanding_set: { shop_money_minor: '0' },
    },
    lines: [{
      source_line_id: 'line-1',
      title: 'Serum',
      sku_snapshot: 'SERUM-30',
      source_variant_id: 'variant-1',
      source_product_id: 'product-1',
      quantity: 1,
      current_quantity: 1,
      unfulfilled_quantity: 1,
      refundable_quantity: 1,
      unit_price_minor: '10000',
      discount_minor: '0',
      tax_minor: '1400',
      total_minor: '10000',
      requires_shipping: true,
      taxable: true,
      custom_attributes: {},
      tax_lines: [{ title: 'VAT', rate_basis_points: 1400, price_minor: '1400' }],
      discount_allocations: [],
      mapping: { state: 'mapped', variant_id: 'local-variant-1' },
    }],
    buyer: { source_customer_id: 'customer-1', email: 'buyer@example.test', is_guest: false },
    addresses: { shipping: { city: 'Cairo', country_code: 'EG' } },
    price: {
      subtotal: '10000',
      discounts: '0',
      discount_codes: [],
      tax_lines: [{ title: 'VAT', rate_basis_points: 1400, price_minor: '1400' }],
      shipping: '0',
      additional_fees: '0',
      total: '11400',
      refunded: '0',
      outstanding: '0',
      taxes_included: false,
    },
    currency: { shop: 'EGP', presentment: 'EGP' },
    transactions: [],
    fulfillments: [],
    refunds: [],
    context: { tags: [], custom_attributes: {}, is_test: false },
    evidence: {
      inbound_delivery_id: 'delivery-1',
      api_version: '2026-07',
      connector_version: 'shopify@1',
      fetched_at: '2026-09-17T10:00:01Z',
    },
  };

  return { ...candidate, ...overrides };
}

const ctx = { connectionDimensionsResolved: true, supportedCurrencies: ['EGP', 'EUR', 'SAR', 'AED'] };

describe('validateCandidate', () => {
  it('returns zero blockers for a clean order', () => {
    const result = validateCandidate(buildCandidate(), {}, ctx);
    expect(result.blockers).toEqual([]);
  });

  it('returns exactly one line_unmapped blocker for one unmapped line', () => {
    const candidate = buildCandidate({
      lines: [{ ...buildCandidate().lines[0], mapping: { state: 'unmapped' } }],
    });
    const result = validateCandidate(candidate, {}, ctx);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(['line_unmapped']);
  });

  it('marks redacted buyer data as permission denied', () => {
    const candidate = buildCandidate({
      buyer: { is_guest: false },
      addresses: {},
    });
    const result = validateCandidate(candidate, { buyer: 'permission_denied', addresses: 'permission_denied' }, ctx);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'buyer_unavailable',
    ]);
    expect(result.sections.buyer.status).toBe('permission_denied');
    expect(result.sections.addresses.status).toBe('permission_denied');
  });

  it('reports both sides when totals are off by one minor unit', () => {
    const result = validateCandidate(buildCandidate({
      price: { ...buildCandidate().price, total: '11401' },
    }), {}, ctx);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toMatchObject({ code: 'totals_mismatch' });
    expect(result.blockers[0].detail).toContain('"calculatedTotal":"11400"');
    expect(result.blockers[0].detail).toContain('"reportedTotal":"11401"');
  });

  it('marks addresses not applicable when no lines require shipping', () => {
    const line = { ...buildCandidate().lines[0], requires_shipping: false };
    const result = validateCandidate(buildCandidate({ lines: [line], addresses: {} }), {}, ctx);
    expect(result.blockers).toEqual([]);
    expect(result.sections.addresses.status).toBe('not_applicable');
  });

  it('does not subtract a line-allocated discount twice', () => {
    // 2 × 100.00 with 20.00 off the line: subtotal 180.00, total 180.00 + 14% VAT.
    const line = {
      ...buildCandidate().lines[0],
      quantity: 2, current_quantity: 2, unfulfilled_quantity: 2, refundable_quantity: 2,
      discount_minor: '2000', tax_minor: '2520', total_minor: '18000',
    };
    const result = validateCandidate(buildCandidate({
      lines: [line],
      price: {
        ...buildCandidate().price,
        subtotal: '18000', discounts: '2000', total: '20520',
        tax_lines: [{ title: 'VAT', rate_basis_points: 1400, price_minor: '2520' }],
      },
    }), {}, ctx);
    expect(result.blockers).toEqual([]);
  });

  it('flags lines that do not add up to the subtotal', () => {
    const result = validateCandidate(buildCandidate({
      price: { ...buildCandidate().price, subtotal: '9999', total: '11399' },
    }), {}, ctx);
    expect(result.blockers.map((b) => b.code)).toEqual(['totals_mismatch']);
    expect(result.blockers[0].detail).toContain('"lineSubtotal":"10000"');
  });

  it('blocks a redacted buyer even when the provider still returns a customer id', () => {
    const result = validateCandidate(buildCandidate({
      buyer: { source_customer_id: 'customer-1', is_guest: false },
    }), { buyer: 'permission_denied' }, ctx);
    expect(result.blockers.map((b) => b.code)).toEqual(['buyer_unavailable']);
    expect(result.sections.buyer.status).toBe('permission_denied');
  });

  it('blocks unsupported currencies', () => {
    const result = validateCandidate(buildCandidate({
      currency: { shop: 'USD', presentment: 'USD' },
    }), {}, ctx);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(['unsupported_currency']);
  });
});
