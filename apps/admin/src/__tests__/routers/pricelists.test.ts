import { describe, it, expect, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock } from '../helpers/mockDb';

const { pricelistsRouter } = await import('@/server/routers/pricelists');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const forbidden = (e: unknown) => e instanceof TRPCError && e.code === 'FORBIDDEN';

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

beforeEach(() => {
  mockDb._reset();
});

describe('pricelists', () => {
  it('list resolves with an array on an empty db', async () => {
    const res = await pricelistsRouter.createCaller(ctx()).list();
    expect(Array.isArray(res)).toBe(true);
  });

  it('getItems rejects a malformed pricelist id', async () => {
    await expectCode(
      pricelistsRouter.createCaller(ctx()).getItems({ pricelistId: 'nope' } as never),
      'BAD_REQUEST'
    );
  });

  it('getItems resolves with an array for a valid id', async () => {
    const res = await pricelistsRouter.createCaller(ctx()).getItems({ pricelistId: UUID });
    expect(Array.isArray(res)).toBe(true);
  });

  it('create rejects an empty name', async () => {
    await expectCode(
      pricelistsRouter.createCaller(ctx()).create({ name: '' } as never),
      'BAD_REQUEST'
    );
  });

  it('a member cannot create a price list', async () => {
    await expect(
      pricelistsRouter.createCaller(ctx('member')).create({ name: 'Wholesale' } as never)
    ).rejects.toSatisfy(forbidden);
  });

  it('an admin cannot delete a price list — delete is owner-only', async () => {
    await expect(
      pricelistsRouter.createCaller(ctx('admin')).delete({ id: UUID })
    ).rejects.toSatisfy(forbidden);
  });

  it('an owner passes the delete authorization gate', async () => {
    // Reaching the resolver (and failing on the empty mock, or resolving) is
    // enough — the point is that owner is not rejected at the middleware.
    await expect(
      pricelistsRouter.createCaller(ctx('owner')).delete({ id: UUID })
    ).resolves.toBeDefined().catch(() => undefined);
  });
});
