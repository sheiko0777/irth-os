import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { productsRouter } from '@/server/routers/products';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

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
      categoryId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      isActive: true,
    });
    expect(r.name).toBe('تمر مدينة');
  });

  it('update: requires id as uuid', () => {
    expect(() => updateProductSchema.parse({ id: 'bad', name: 'X' })).toThrow();
  });

  it('update: allows partial fields', () => {
    const r = updateProductSchema.parse({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', price: 99 });
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

const PRODUCT_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

function chainOf(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'returning', 'values', 'set', 'leftJoin']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

/** list fires two queries in Promise.all: rows, then the total count. */
function queueSelects(results: unknown[]) {
  let i = 0;
  mockDb.select = vi.fn(() => chainOf(results[i++] ?? []));
}

beforeEach(() => {
  mockDb._reset();
});

// requirePermission('products', 'view'|'write'|'delete') replaced
// protectedProcedure/adminProcedure/ownerProcedure on these five procedures.
// products.view is granted to every role, so list/getById have no wrong-role
// case to test — only write (owner, admin) and delete (owner only) narrow
// the set of roles that pass.
describe('products router — authorization', () => {
  it('list: member caller is allowed (products.view is open to every role)', async () => {
    queueSelects([[], [{ count: 0 }]]);
    const caller = productsRouter.createCaller(ctx('member'));
    const res = await caller.list({ page: 1, pageSize: 20 });
    expect(res.data).toEqual([]);
  });

  it('create: member caller rejects FORBIDDEN (requirePermission products.write)', async () => {
    const caller = productsRouter.createCaller(ctx('member'));
    await expectCode(
      caller.create({ name: 'Product', sku: 'P-001', price: 100, stock: 5 }),
      'FORBIDDEN',
    );
  });

  it('create: admin caller is allowed (requirePermission products.write)', async () => {
    mockDb.insert = vi.fn(() => chainOf([{ id: PRODUCT_UUID, name: 'Product', sku: 'P-001' }]));
    const caller = productsRouter.createCaller(ctx('admin'));
    const res = await caller.create({ name: 'Product', sku: 'P-001', price: 100, stock: 5 });
    expect(res.data).toEqual({ id: PRODUCT_UUID, name: 'Product', sku: 'P-001' });
  });

  it('deactivate: admin caller rejects FORBIDDEN (requirePermission products.delete)', async () => {
    const caller = productsRouter.createCaller(ctx('admin'));
    await expectCode(caller.deactivate({ id: PRODUCT_UUID }), 'FORBIDDEN');
  });

  it('deactivate: owner caller is allowed (requirePermission products.delete)', async () => {
    mockDb.update = vi.fn(() => chainOf([{ id: PRODUCT_UUID, status: 'archived' }]));
    const caller = productsRouter.createCaller(ctx('owner'));
    const res = await caller.deactivate({ id: PRODUCT_UUID });
    expect(res.data).toEqual({ id: PRODUCT_UUID, status: 'archived' });
  });
});
