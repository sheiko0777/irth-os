import { describe, expect, it } from 'vitest';
import { formatDocumentNumber, type DocumentKind } from '../index';

describe('formatDocumentNumber (DM-04)', () => {
  it('keeps the default entity on the shapes it has always issued (0036 seed continuity)', () => {
    expect(formatDocumentNumber('order', 1, 2026)).toBe('IRT-2026-0001');
    expect(formatDocumentNumber('return', 1)).toBe('RMA-0001');
    expect(formatDocumentNumber('purchase_order', 1, 2026)).toBe('PO-2026-0001');
    expect(formatDocumentNumber('quote', 1, 2026)).toBe('QT-2026-0001');
  });

  it('gives each new kind its own code for the default entity', () => {
    const cases: Array<[DocumentKind, string]> = [
      ['shipment', 'SHP-2026-0007'],
      ['invoice', 'INV-2026-0007'],
      ['credit_note', 'CN-2026-0007'],
      ['production_order', 'MO-2026-0007'],
      ['stock_adjustment', 'ADJ-2026-0007'],
    ];
    for (const [kind, expected] of cases) {
      expect(formatDocumentNumber(kind, 7, 2026)).toBe(expected);
    }
  });

  it('uses the entity document_prefix for a non-default entity, every kind', () => {
    const cases: Array<[DocumentKind, string]> = [
      ['order', 'EU-2026-0042'],
      ['return', 'EU-RMA-0042'],
      ['purchase_order', 'EU-PO-2026-0042'],
      ['quote', 'EU-QT-2026-0042'],
      ['shipment', 'EU-SHP-2026-0042'],
      ['invoice', 'EU-INV-2026-0042'],
      ['credit_note', 'EU-CN-2026-0042'],
      ['production_order', 'EU-MO-2026-0042'],
      ['stock_adjustment', 'EU-ADJ-2026-0042'],
    ];
    for (const [kind, expected] of cases) {
      expect(formatDocumentNumber(kind, 42, 2026, 'EU')).toBe(expected);
    }
  });

  it('the default entity prefix IRT renders orders identically with or without it', () => {
    expect(formatDocumentNumber('order', 3, 2026, 'IRT')).toBe(formatDocumentNumber('order', 3, 2026));
  });

  it('always ends in the full trailing digit run the 0036 seed regex reads', () => {
    for (const s of [
      formatDocumentNumber('invoice', 10000, 2026, 'EU'),
      formatDocumentNumber('return', 10000),
    ]) {
      expect(/(\d+)$/.exec(s)?.[1]).toBe('10000');
    }
  });

  it('defaults the year to the current one', () => {
    expect(formatDocumentNumber('invoice', 1)).toBe(`INV-${new Date().getFullYear()}-0001`);
  });
});
