import { describe, it, expect, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb } from '../helpers/mockDb';

const { shippingRouter } = await import('@/server/routers/shipping');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
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

describe('shipping.zones', () => {
  it('list resolves with an array on an empty db', async () => {
    const res = await shippingRouter.createCaller(ctx()).zones.list();
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('create rejects an empty name', async () => {
    await expectCode(
      shippingRouter.createCaller(ctx()).zones.create({ name: '', countries: ['EG'] } as never),
      'BAD_REQUEST'
    );
  });

  it('setActive rejects a malformed id', async () => {
    await expectCode(
      shippingRouter.createCaller(ctx()).zones.setActive({ id: 'nope', isActive: true } as never),
      'BAD_REQUEST'
    );
  });

  it('a member cannot create a zone or toggle it', async () => {
    const member = shippingRouter.createCaller(ctx('member'));
    await expect(member.zones.create({ name: 'Cairo', countries: ['EG'] })).rejects.toSatisfy(forbidden);
    await expect(member.zones.setActive({ id: UUID, isActive: false })).rejects.toSatisfy(forbidden);
  });
});

describe('shipping.rates', () => {
  it('list resolves for a zone with no rates', async () => {
    const res = await shippingRouter.createCaller(ctx()).rates.list({ zoneId: UUID });
    expect(Array.isArray(res.data ?? res)).toBe(true);
  });

  it('list rejects a malformed zoneId', async () => {
    await expectCode(
      shippingRouter.createCaller(ctx()).rates.list({ zoneId: 'nope' } as never),
      'BAD_REQUEST'
    );
  });

  it('create rejects an invalid rateType', async () => {
    await expectCode(
      shippingRouter.createCaller(ctx()).rates.create({ zoneId: UUID, name: 'x', rateType: 'telepathy', price: 1 } as never),
      'BAD_REQUEST'
    );
  });

  it('a member cannot create a rate', async () => {
    await expect(
      shippingRouter.createCaller(ctx('member')).rates.create({ zoneId: UUID, name: 'x', rateType: 'flat', price: 10 })
    ).rejects.toSatisfy(forbidden);
  });

  it('an admin cannot delete a rate — delete is owner-only', async () => {
    await expect(
      shippingRouter.createCaller(ctx('admin')).rates.delete({ id: UUID })
    ).rejects.toSatisfy(forbidden);
  });
});
