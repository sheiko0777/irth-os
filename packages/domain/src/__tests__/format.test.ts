import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, formatNumber } from '../format';
import { fromMinor } from '../money';

const ARABIC_INDIC = /[٠-٩]/;

describe('format: one digit system everywhere', () => {
  it('uses Western digits by default in ar and en', () => {
    for (const locale of ['ar-EG', 'en-US']) {
      expect(formatNumber(7017, { locale })).toBe('7,017');
      expect(formatMoney(fromMinor(701760n), { locale })).toBe('7,017.60 ج.م');
      expect(formatDate(new Date(Date.UTC(2026, 8, 27, 12)), { locale })).not.toMatch(ARABIC_INDIC);
    }
  });

  it('keeps bigint minor precision past 2^53', () => {
    expect(formatMoney(fromMinor(9_007_199_254_740_993n))).toBe('90,071,992,547,409.93 ج.م');
    expect(formatNumber(9_007_199_254_740_993n)).toBe('9,007,199,254,740,993');
  });

  it('still offers native digits on request', () => {
    expect(formatNumber(12, { digits: 'default' })).toMatch(ARABIC_INDIC);
  });
});
