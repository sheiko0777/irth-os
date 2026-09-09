import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { safeEqual } from '../crypto';

describe('safeEqual', () => {
  // Both digests are always 32 bytes. Hashing/decoding still depends on input
  // length; wall-clock timing assertions would be flaky and prove no guarantee.
  for (const encoding of ['utf8', 'hex', 'base64'] as const) {
    const encode = (value: string) => Buffer.from(value).toString(encoding);

    it('matches equal bytes encoded as ' + encoding, () => {
      expect(safeEqual(encode('secret'), encode('secret'), encoding)).toBe(true);
    });

    it('rejects different bytes of equal length in ' + encoding, () => {
      expect(safeEqual(encode('secret'), encode('secreu'), encoding)).toBe(false);
    });

    it('rejects unequal lengths without throwing in ' + encoding, () => {
      expect(() => safeEqual(encode('short'), encode('longer'), encoding)).not.toThrow();
      expect(safeEqual(encode('short'), encode('longer'), encoding)).toBe(false);
      expect(safeEqual(encode('longer'), encode('short'), encoding)).toBe(false);
      expect(safeEqual('', encode('secret'), encoding)).toBe(false);
    });

    it('matches empty buffers in ' + encoding, () => {
      expect(safeEqual('', '', encoding)).toBe(true);
    });
  }

  it('defaults to UTF-8, retaining case-sensitive text-token comparison', () => {
    expect(safeEqual('رمز', 'رمز')).toBe(true);
    expect(safeEqual('abcdef', 'ABCDEF')).toBe(false);
    expect(safeEqual('abcdef', 'ABCDEF', 'hex')).toBe(true);
  });

  it('compares decoded base64 bytes rather than their text representation', () => {
    expect(safeEqual('YQ==', 'YQ', 'base64')).toBe(true);
    expect(safeEqual('YQ==', 'YQ')).toBe(false);
  });
});
