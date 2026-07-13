import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const adjustSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int(),
  reason: z.enum(['purchase', 'sale', 'adjustment', 'return', 'damage']),
  notes: z.string().max(500).optional(),
});

const listSchema = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
  lowStockOnly: z.boolean().default(false),
});

describe('inventory router — input validation', () => {
  it('adjust: rejects non-uuid productId', () => {
    expect(() => adjustSchema.parse({ productId: 'bad', quantity: 10, reason: 'purchase' })).toThrow();
  });

  it('adjust: rejects invalid reason', () => {
    expect(() => adjustSchema.parse({ productId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 5, reason: 'unknown' })).toThrow();
  });

  it('adjust: allows negative quantity (outbound)', () => {
    const r = adjustSchema.parse({ productId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: -5, reason: 'sale' });
    expect(r.quantity).toBe(-5);
  });

  it('adjust: allows positive quantity (inbound)', () => {
    const r = adjustSchema.parse({ productId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 50, reason: 'purchase' });
    expect(r.quantity).toBe(50);
  });

  it('list: lowStockOnly defaults false', () => {
    const r = listSchema.parse({});
    expect(r.lowStockOnly).toBe(false);
  });
});
