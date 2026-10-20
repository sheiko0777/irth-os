import { describe, expect, it } from 'vitest';
import { CandidateOrderSchema, SectionsSchema, decimalStringToMinor } from '..';

const sections = {
  identity: { status: 'loaded' },
  items: { status: 'loaded' },
  buyer: { status: 'loaded' },
  addresses: { status: 'loaded' },
  price: { status: 'loaded' },
  currency: { status: 'loaded' },
  payment: { status: 'loaded' },
  fulfillment: { status: 'loaded' },
  returns: { status: 'loaded' },
  context: { status: 'loaded' },
  evidence: { status: 'loaded' },
} as const;

const candidate = {
  header: {
    source_order_id: 'gid://shopify/Order/1',
    source_order_number: '#1001',
    source_updated_at: '2026-09-17T10:00:00Z',
    currency_code: 'EGP',
    presentment_currency_code: 'EGP',
    subtotal_price_set: { shop_money_minor: '10000', presentment_money_minor: '10000' },
    total_price_set: { shop_money_minor: '11400', presentment_money_minor: '11400' },
    total_tax_set: { shop_money_minor: '1400' },
    total_discounts_set: { shop_money_minor: '0' },
    total_shipping_set: { shop_money_minor: '0' },
    total_refunded_set: { shop_money_minor: '0' },
    total_outstanding_set: { shop_money_minor: '0' },
  },
  lines: [{
    source_line_id: 'line-1',
    title: 'Serum',
    variant_title: '30ml',
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
    mapping: { state: 'mapped', variant_id: 'variant-local-1' },
  }],
  buyer: { source_customer_id: 'customer-1', name: 'Test Buyer', email: 'buyer@example.test', is_guest: false },
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

describe('CandidateOrderSchema', () => {
  it('round-trips a candidate order', () => {
    expect(CandidateOrderSchema.parse(candidate)).toEqual(candidate);
  });

  it('rejects a section missing its status', () => {
    expect(() => SectionsSchema.parse({ ...sections, buyer: {} })).toThrow();
  });
});

describe('decimalStringToMinor', () => {
  it.each([
    ['1234.56', 'EGP', 123456n],
    ['-10.00', 'EGP', -1000n],
    ['1.234', 'KWD', 1234n],
    ['1', 'EGP', 100n],
  ])('parses %s %s', (value, currency, expected) => {
    expect(decimalStringToMinor(value, currency)).toBe(expected);
  });

  it.each(['1,234.56', '', 'abc', '1e3', '1.001'])('rejects %s', (value) => {
    expect(() => decimalStringToMinor(value, 'EGP')).toThrow();
  });
});
