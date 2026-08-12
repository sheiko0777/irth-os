import { EGP, zero } from '@irth/domain';
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { couponsRouter } from '@/server/routers/coupons';
import { mockDb } from '../helpers/mockDb';

const UUID = '11111111-1111-4111-8111-111111111111';

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

// coupons.ts uses the module-level `db` import; setup.ts maps it to mockDb too.
describe('coupons router', () => {
  const caller = couponsRouter.createCaller(ctx('owner'));

  it('list: empty db yields empty items and zero total', async () => {
    const res = await caller.list({});
    expect(res).toEqual({ items: [], total: 0 });
  });

  it('get: missing coupon rejects NOT_FOUND', async () => {
    await expectCode(caller.get({ id: UUID }), 'NOT_FOUND');
  });

  it('get: malformed uuid rejects BAD_REQUEST', async () => {
    await expectCode(caller.get({ id: 'not-a-uuid' }), 'BAD_REQUEST');
  });

  it('update: missing coupon rejects NOT_FOUND (thrown inside withAudit)', async () => {
    await expectCode(caller.update({ id: UUID, value: 10 }), 'NOT_FOUND');
  });

  it('toggleActive: missing coupon rejects NOT_FOUND', async () => {
    await expectCode(caller.toggleActive({ id: UUID }), 'NOT_FOUND');
  });

  it('delete: missing coupon rejects NOT_FOUND', async () => {
    await expectCode(caller.delete({ id: UUID }), 'NOT_FOUND');
  });

  it('redeem: missing coupon rejects NOT_FOUND', async () => {
    await expectCode(caller.redeem({ couponId: UUID }), 'NOT_FOUND');
  });

  it('validate: unknown code returns invalid_code result instead of throwing', async () => {
    const res = await caller.validate({ code: 'nope', orderAmount: 100 });
    expect(res).toEqual({
      valid: false,
      error: 'invalid_code',
      discount: zero(EGP),
      discountType: null,
      couponId: null,
    });
  });

  it('validate: negative orderAmount rejects BAD_REQUEST', async () => {
    await expectCode(caller.validate({ code: 'X', orderAmount: -1 }), 'BAD_REQUEST');
  });

  it('create: empty code and bad enum reject BAD_REQUEST', async () => {
    await expectCode(caller.create({ code: '', type: 'percentage', value: 5 }), 'BAD_REQUEST');
    await expectCode(
      caller.create({ code: 'SAVE10', type: 'bogus', value: 5 } as never),
      'BAD_REQUEST'
    );
  });
});
