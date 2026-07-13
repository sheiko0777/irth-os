import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const listSchema = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
  search: z.string().optional(),
  tag: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

const addTagSchema = z.object({
  customerId: z.string().uuid(),
  tag: z.string().min(1).max(50),
});

describe('customers router — input validation', () => {
  it('list: defaults applied', () => {
    const r = listSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });

  it('create: name required', () => {
    expect(() => createSchema.parse({})).toThrow();
  });

  it('create: rejects invalid email', () => {
    expect(() => createSchema.parse({ name: 'Ahmed', email: 'not-email' })).toThrow();
  });

  it('create: email optional', () => {
    const r = createSchema.parse({ name: 'Ahmed' });
    expect(r.name).toBe('Ahmed');
    expect(r.email).toBeUndefined();
  });

  it('addTag: rejects non-uuid customerId', () => {
    expect(() => addTagSchema.parse({ customerId: 'bad', tag: 'vip' })).toThrow();
  });

  it('addTag: rejects empty tag', () => {
    expect(() => addTagSchema.parse({ customerId: '00000000-0000-0000-0000-000000000001', tag: '' })).toThrow();
  });
});
