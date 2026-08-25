import { describe, it, expect } from 'vitest';
import { decimalStringToMinor, minorToDecimalString, sumMinor, multiplyMinorByQuantity, egp, splitTax } from './money';

describe('decimalStringToMinor', () => {
  it('parses whole and fractional amounts exactly', () => {
    expect(decimalStringToMinor('123.45')).toBe(12345);
    expect(decimalStringToMinor('0.1')).toBe(10);
    expect(decimalStringToMinor('10')).toBe(1000);
    expect(decimalStringToMinor('0')).toBe(0);
  });

  it('pads short fractions and truncates long ones instead of rounding', () => {
    expect(decimalStringToMinor('5.5')).toBe(550);
    expect(decimalStringToMinor('5.559')).toBe(555); // truncated, not rounded to 556
  });

  it('handles negative amounts, nullish input, and numeric input', () => {
    expect(decimalStringToMinor('-42.50')).toBe(-4250);
    expect(decimalStringToMinor(null)).toBe(0);
    expect(decimalStringToMinor(undefined)).toBe(0);
    expect(decimalStringToMinor('')).toBe(0);
    expect(decimalStringToMinor(19.99)).toBe(1999);
  });

  it('rejects malformed input rather than silently coercing it', () => {
    expect(() => decimalStringToMinor('abc')).toThrow();
    expect(() => decimalStringToMinor('1.2.3')).toThrow();
  });
});

describe('minorToDecimalString', () => {
  it('is the exact inverse of decimalStringToMinor for representable amounts', () => {
    for (const s of ['123.45', '0.10', '1000.00', '0.00', '99.99']) {
      expect(minorToDecimalString(decimalStringToMinor(s))).toBe(s.includes('.') ? s : `${s}.00`);
    }
  });

  it('formats negatives correctly', () => {
    expect(minorToDecimalString(-4250)).toBe('-42.50');
  });
});

describe('sumMinor', () => {
  it('sums exactly with no float drift, including the classic 0.1 + 0.2 case', () => {
    // 0.1 + 0.2 !== 0.3 in float; in minor units it's exact integer addition.
    expect(sumMinor([10, 20])).toBe(30);
    expect(sumMinor([1099, 250, 5997])).toBe(7346);
    expect(sumMinor([])).toBe(0);
  });
});

describe('multiplyMinorByQuantity', () => {
  it('multiplies a unit price by an integer quantity exactly', () => {
    expect(multiplyMinorByQuantity(1999, 3)).toBe(5997);
    expect(multiplyMinorByQuantity(0, 5)).toBe(0);
  });

  it('rejects non-integer or negative quantities', () => {
    expect(() => multiplyMinorByQuantity(100, 1.5)).toThrow();
    expect(() => multiplyMinorByQuantity(100, -1)).toThrow();
  });
});

describe('egp', () => {
  it('rejects non-integer minor amounts', () => {
    expect(() => egp(10.5)).toThrow();
  });
});

describe('splitTax', () => {
  const EGYPT_VAT = 1400; // 14.00% in basis points

  it('extracts tax from a tax-inclusive price (the vatReport bug)', () => {
    // 114,000.00 EGP gross at 14% contains 14,000.00 tax over 100,000.00 net.
    // The old finance.vatReport did gross * 0.14 = 15,960 — a 14% overstatement
    // on a tax filing.
    const r = splitTax(11_400_000, EGYPT_VAT, true);
    expect(r.subtotalMinor).toBe(10_000_000);
    expect(r.taxAmountMinor).toBe(1_400_000);
    expect(r.totalAmountMinor).toBe(11_400_000);
  });

  it('adds tax on top of a tax-exclusive price', () => {
    const r = splitTax(10_000_000, EGYPT_VAT, false);
    expect(r.subtotalMinor).toBe(10_000_000);
    expect(r.taxAmountMinor).toBe(1_400_000);
    expect(r.totalAmountMinor).toBe(11_400_000);
  });

  it('holds subtotal + tax === total for every amount, rate and convention', () => {
    for (const rate of [0, 500, 1400, 2000]) {
      for (const inclusive of [true, false]) {
        for (const amount of [0, 1, 7, 99, 12_345, 999_999, 100_000_001]) {
          const r = splitTax(amount, rate, inclusive);
          expect(r.subtotalMinor + r.taxAmountMinor).toBe(r.totalAmountMinor);
        }
      }
    }
  });

  it('is a no-op at a zero rate (exports, exempt goods)', () => {
    const r = splitTax(50_000, 0, true);
    expect(r).toEqual({ subtotalMinor: 50_000, taxAmountMinor: 0, totalAmountMinor: 50_000 });
  });

  it('supports the 5% reduced rate', () => {
    const r = splitTax(10_000, 500, false);
    expect(r.taxAmountMinor).toBe(500);
  });

  it('rounds to whole piastres rather than leaving fractions', () => {
    // 100.01 EGP inclusive of 14%: tax = 10001 * 1400 / 11400 = 1228.19... -> 1228
    const r = splitTax(10_001, EGYPT_VAT, true);
    expect(Number.isInteger(r.taxAmountMinor)).toBe(true);
    expect(r.taxAmountMinor).toBe(1_228);
    expect(r.subtotalMinor + r.taxAmountMinor).toBe(10_001);
  });

  it('rejects non-integer amounts and negative rates', () => {
    expect(() => splitTax(10.5, EGYPT_VAT, true)).toThrow();
    expect(() => splitTax(1000, -1, true)).toThrow();
  });
});
