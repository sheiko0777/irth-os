import { describe, expect, it } from 'vitest';
import { minorToDecimalString, statusFromLocal } from '../services/shopify';

describe('minorToDecimalString', () => {
  // Shopify's productSet takes price as a decimal STRING. Money in this
  // schema is bigint minor units (piastres/cents) — see CLAUDE.md rule 1 and
  // orders.ts's own float-avoidance notes. This conversion is the one place
  // that boundary gets crossed, so it is the one place a float slipping back
  // in would be invisible until a price came out wrong by a cent.
  it('renders whole units with two decimal places', () => {
    expect(minorToDecimalString(10000n)).toBe('100.00');
  });

  it('pads a single-digit cents value', () => {
    expect(minorToDecimalString(100n)).toBe('1.00');
    expect(minorToDecimalString(105n)).toBe('1.05');
  });

  it('handles zero', () => {
    expect(minorToDecimalString(0n)).toBe('0.00');
  });

  it('handles amounts under one unit', () => {
    expect(minorToDecimalString(50n)).toBe('0.50');
    expect(minorToDecimalString(5n)).toBe('0.05');
  });

  it('handles negative amounts (refund lines) without misplacing the sign', () => {
    expect(minorToDecimalString(-10050n)).toBe('-100.50');
  });

  // The exact case a naive `(Number(minor) / 100).toString()` gets wrong:
  // floating point cannot represent every cent value exactly, and large
  // bigints do not fit in a JS number at all.
  it('stays exact for a value a float would round', () => {
    expect(minorToDecimalString(999999999999n)).toBe('9999999999.99');
  });
});

describe('statusFromLocal', () => {
  it('maps the three local product statuses to Shopify enum values', () => {
    expect(statusFromLocal('active')).toBe('ACTIVE');
    expect(statusFromLocal('archived')).toBe('ARCHIVED');
    expect(statusFromLocal('draft')).toBe('DRAFT');
  });

  it('falls back to DRAFT for anything unrecognised, never ACTIVE', () => {
    // A typo'd or future local status must not accidentally publish a
    // product to the live storefront.
    expect(statusFromLocal('something_new')).toBe('DRAFT');
  });
});
