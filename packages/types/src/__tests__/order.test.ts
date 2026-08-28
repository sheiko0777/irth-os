import { describe, expect, it } from 'vitest';
import { OrderSchema, ProductSchema } from '../order';

// A realistic payload as it actually arrives from apps/api's plain REST
// responses: jsonSafe() (packages/db/src/json.ts) has already turned every
// bigint minor-units column into an INTEGER string, e.g. "12550" for 125.50
// EGP — not a decimal-formatted string like MoneySchema expects.
const jsonSafeOrder = {
  id: '11111111-1111-1111-1111-111111111111',
  orderNumber: 'IRT-2026-0001',
  status: 'pending',
  totalAmountMinor: '12550',
  currency: 'EGP',
  customerId: null,
  createdAt: '2026-08-27T00:00:00.000Z',
};

const jsonSafeProduct = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Rose Oud Serum',
  priceMinor: '9900',
  stock: 42,
};

describe('OrderSchema', () => {
  it('accepts a realistic jsonSafe()-shaped payload (integer minor-units string)', () => {
    expect(() => OrderSchema.parse(jsonSafeOrder)).not.toThrow();
  });

  it('accepts a non-null customerId when the order is linked to a customer', () => {
    expect(() =>
      OrderSchema.parse({ ...jsonSafeOrder, customerId: '33333333-3333-3333-3333-333333333333' }),
    ).not.toThrow();
  });

  it('rejects a decimal-formatted string ("125.50") in a minor-units field', () => {
    expect(() => OrderSchema.parse({ ...jsonSafeOrder, totalAmountMinor: '125.50' })).toThrow();
  });

  it("rejects an invalid status value like 'processing'", () => {
    expect(() => OrderSchema.parse({ ...jsonSafeOrder, status: 'processing' })).toThrow();
  });
});

describe('ProductSchema', () => {
  it('accepts a realistic jsonSafe()-shaped payload (integer minor-units string)', () => {
    expect(() => ProductSchema.parse(jsonSafeProduct)).not.toThrow();
  });

  it('rejects a decimal-formatted string ("125.50") in a minor-units field', () => {
    expect(() => ProductSchema.parse({ ...jsonSafeProduct, priceMinor: '125.50' })).toThrow();
  });
});
