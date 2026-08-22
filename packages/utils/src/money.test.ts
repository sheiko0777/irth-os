import { describe, it, expect } from 'vitest';
import { decimalStringToMinor, minorToDecimalString, sumMinor, multiplyMinorByQuantity, egp } from './money';

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
