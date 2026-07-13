import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  parentId: z.string().uuid().optional(),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().uuid(),
});

describe('categories router — input validation', () => {
  it('create: requires name and slug', () => {
    expect(() => createSchema.parse({})).toThrow();
  });

  it('create: rejects slug with spaces', () => {
    expect(() => createSchema.parse({ name: 'Dates', slug: 'fresh dates' })).toThrow();
  });

  it('create: accepts valid slug', () => {
    const r = createSchema.parse({ name: 'Premium Dates', slug: 'premium-dates' });
    expect(r.isActive).toBe(true);
  });

  it('create: accepts optional parentId as uuid', () => {
    const r = createSchema.parse({ name: 'Sub', slug: 'sub', parentId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });
    expect(r.parentId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });

  it('create: rejects invalid parentId', () => {
    expect(() => createSchema.parse({ name: 'Sub', slug: 'sub', parentId: 'not-uuid' })).toThrow();
  });

  it('update: requires id', () => {
    expect(() => updateSchema.parse({ name: 'New Name' })).toThrow();
  });

  it('update: id must be uuid', () => {
    expect(() => updateSchema.parse({ id: 'bad', name: 'X' })).toThrow();
  });
});
