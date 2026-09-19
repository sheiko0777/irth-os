import { describe, it, expect } from 'vitest';
import { encodeQrMatrix, getQrSvgPath, generateQrSvg, generateQrDataUrl } from '../lib/qr';

describe('QR code generator (qr.ts)', () => {
  it('generates a valid square matrix for standard SKU', () => {
    const matrix = encodeQrMatrix('IRTH-SKU-001');
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0].length).toBe(matrix.length);
  });

  it('has finder pattern blocks in 3 corners', () => {
    const matrix = encodeQrMatrix('TEST-SKU');
    const size = matrix.length;

    // Top-left corner center (row 3, col 3) must be true
    expect(matrix[3][3]).toBe(true);
    // Top-right corner center (row 3, col size - 4) must be true
    expect(matrix[3][size - 4]).toBe(true);
    // Bottom-left corner center (row size - 4, col 3) must be true
    expect(matrix[size - 4][3]).toBe(true);
  });

  it('generates valid SVG path and standalone SVG', () => {
    const matrix = encodeQrMatrix('PROD-12345');
    const { path, viewBox, size } = getQrSvgPath(matrix, 5, 2);

    expect(path.startsWith('M')).toBe(true);
    expect(viewBox).toBe(`0 0 ${size} ${size}`);

    const svg = generateQrSvg('PROD-12345');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox=');
    expect(svg).toContain('<path d=');
  });

  it('generates a data URL for images', () => {
    const dataUrl = generateQrDataUrl('SKU-999');
    expect(dataUrl.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(dataUrl).toContain('%3Csvg');
  });

  it('handles longer strings by stepping to higher QR versions', () => {
    const longString = 'irth:sku:IRTH-HOODIE-EXTRA-LONG-SKU-NAME-SPRING-COLLECTION-2026';
    const matrix = encodeQrMatrix(longString);
    expect(matrix.length).toBeGreaterThan(21); // Version 2+ is > 21
  });
});
