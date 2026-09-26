import { describe, expect, it } from 'vitest';
import { isPriceListActive, totalsOf, unitPrice, type PriceListRule } from '../salesPricing';

const variant = { id: 'v1', productId: 'p1', priceMinor: null, productPriceMinor: 10_000n };
const list = (over: Partial<PriceListRule> = {}): PriceListRule => ({
  id: 'l', currency: 'EGP', discountBp: null, startDate: null, endDate: null, items: [], ...over,
});

describe('unitPrice (PR-2b)', () => {
  it('no list: the variant price, or its product\'s', () => {
    expect(unitPrice(variant, null)).toEqual({ listPriceMinor: 10_000n, unitPriceMinor: 10_000n });
    expect(unitPrice({ ...variant, priceMinor: 12_345n }, null).unitPriceMinor).toBe(12_345n);
  });

  it('an exact variant item beats a product item beats the discount', () => {
    const items = [
      { productId: 'p1', variantId: null, priceMinor: 8_000n },
      { productId: 'p1', variantId: 'v1', priceMinor: 7_000n },
    ];
    expect(unitPrice(variant, list({ items, discountBp: 5000 })).unitPriceMinor).toBe(7_000n);
    expect(unitPrice(variant, list({ items: [items[0]], discountBp: 5000 })).unitPriceMinor).toBe(8_000n);
    expect(unitPrice(variant, list({ discountBp: 5000 })).unitPriceMinor).toBe(5_000n);
  });

  it('rounds the discount once per unit, half to even, in integer piastres', () => {
    // 3333 × 10% = 333.3 → 333 off; 3335 × 10% = 333.5 → 334 (even) off.
    expect(unitPrice({ ...variant, priceMinor: 3_333n }, list({ discountBp: 1000 })).unitPriceMinor).toBe(3_000n);
    expect(unitPrice({ ...variant, priceMinor: 3_335n }, list({ discountBp: 1000 })).unitPriceMinor).toBe(3_001n);
  });

  it('a list price above the base never produces a negative discount', () => {
    const r = unitPrice(variant, list({ items: [{ productId: 'p1', variantId: 'v1', priceMinor: 11_000n }] }));
    expect(r).toEqual({ listPriceMinor: 11_000n, unitPriceMinor: 11_000n });
  });
});

describe('totalsOf', () => {
  it('subtotal − discount = total, exactly, and the lines sum to the total', () => {
    const lines = [
      { variantId: 'a', quantity: 3, listPriceMinor: 3_333n, unitPriceMinor: 3_000n },
      { variantId: 'b', quantity: 7, listPriceMinor: 1_001n, unitPriceMinor: 901n },
    ];
    const t = totalsOf(lines);
    expect(t.subtotalMinor - t.discountMinor).toBe(t.totalMinor);
    expect(t.totalMinor).toBe(3n * 3_000n + 7n * 901n);
  });
});

describe('isPriceListActive', () => {
  it('respects start and end', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    expect(isPriceListActive({ startDate: null, endDate: null }, now)).toBe(true);
    expect(isPriceListActive({ startDate: new Date('2026-10-01'), endDate: null }, now)).toBe(false);
    expect(isPriceListActive({ startDate: null, endDate: new Date('2026-09-01') }, now)).toBe(false);
  });
});
