import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Input schemas mirrored from orders router — validate without DB
const listInputSchema = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
  status: z.string().optional(),
  search: z.string().optional(),
});

const updateStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']),
});

describe('orders router — input validation', () => {
  it('list: defaults page=1 pageSize=20', () => {
    const r = listInputSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });

  it('list: rejects pageSize > 100', () => {
    expect(() => listInputSchema.parse({ pageSize: 101 })).toThrow();
  });

  it('list: accepts valid status filter', () => {
    const r = listInputSchema.parse({ status: 'pending' });
    expect(r.status).toBe('pending');
  });

  it('updateStatus: rejects invalid uuid', () => {
    expect(() => updateStatusSchema.parse({ id: 'not-uuid', status: 'confirmed' })).toThrow();
  });

  it('updateStatus: rejects invalid status', () => {
    expect(() => updateStatusSchema.parse({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'unknown' })).toThrow();
  });

  it('updateStatus: accepts valid input', () => {
    const r = updateStatusSchema.parse({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'delivered' });
    expect(r.status).toBe('delivered');
  });
});
