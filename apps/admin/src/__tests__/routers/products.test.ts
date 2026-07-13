import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().min(1).max(100),
  price: z.number().min(0),
  compareAtPrice: z.number().min(0).optional(),
  categoryId: z.string().uuid().optional(),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

const updateProductSchema = createProductSchema.partial().extend({
  id: z.string().uuid(),
});

const listInputSchema = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});

describe('products router — input validation', () => {
  it('create: requires name and sku', () => {
    expect(() => createProductSchema.parse({ price: 100 })).toThrow();
  });

  it('create: rejects negative price', () => {
    expect(() => createProductSchema.parse({ name: 'X', sku: 'X-1', price: -1 })).toThrow();
  });

  it('create: isActive defaults to true', () => {
    const r = createProductSchema.parse({ name: 'Product', sku: 'P-001', price: 50 });
    expect(r.isActive).toBe(true);
  });

  it('create: accepts full valid input', () => {
    const r = createProductSchema.parse({
      name: 'تمر مدينة',
      sku: 'DATE-001',
      price: 120,
      compareAtPrice: 150,
      categoryId: '00000000-0000-0000-0000-000000000001',
      isActive: true,
    });
    expect(r.name).toBe('تمر مدينة');
  });

  it('update: requires id as uuid', () => {
    expect(() => updateProductSchema.parse({ id: 'bad', name: 'X' })).toThrow();
  });

  it('update: allows partial fields', () => {
    const r = updateProductSchema.parse({ id: '00000000-0000-0000-0000-000000000001', price: 99 });
    expect(r.price).toBe(99);
  });

  it('list: defaults page and pageSize', () => {
    const r = listInputSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });

  it('list: rejects invalid categoryId format', () => {
    expect(() => listInputSchema.parse({ categoryId: 'not-uuid' })).toThrow();
  });
});
