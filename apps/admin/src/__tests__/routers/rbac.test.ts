import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure, ownerProcedure, type Context } from '@/server/trpc';
import { mockDb, withOrgMock } from '../helpers/mockDb';

function ctxWithRole(role: 'owner' | 'admin' | 'member'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    session: {
      user: { id: 'user-1', email: 'user@test.com' },
      session: { activeOrganizationId: 'org-1' },
    },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

async function expectForbidden(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof TRPCError && e.code === 'FORBIDDEN'
  );
}

async function expectNotForbidden(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof TRPCError && e.code === 'FORBIDDEN') {
      throw new Error('Expected procedure to pass authorization, got FORBIDDEN');
    }
    // Other errors (mock DB shape, validation) are fine — authz passed.
  }
}

// Middleware mechanism — the tiers themselves.
const tiers = router({
  memberOp: protectedProcedure.mutation(() => 'ok'),
  adminOp: adminProcedure.mutation(() => 'ok'),
  ownerOp: ownerProcedure.mutation(() => 'ok'),
});

describe('rbac — procedure tier middleware', () => {
  it('member: allowed on protected, forbidden on admin and owner ops', async () => {
    const caller = tiers.createCaller(ctxWithRole('member'));
    await expect(caller.memberOp()).resolves.toBe('ok');
    await expectForbidden(caller.adminOp());
    await expectForbidden(caller.ownerOp());
  });

  it('admin: allowed on protected and admin, forbidden on owner ops', async () => {
    const caller = tiers.createCaller(ctxWithRole('admin'));
    await expect(caller.memberOp()).resolves.toBe('ok');
    await expect(caller.adminOp()).resolves.toBe('ok');
    await expectForbidden(caller.ownerOp());
  });

  it('owner: allowed on everything', async () => {
    const caller = tiers.createCaller(ctxWithRole('owner'));
    await expect(caller.memberOp()).resolves.toBe('ok');
    await expect(caller.adminOp()).resolves.toBe('ok');
    await expect(caller.ownerOp()).resolves.toBe('ok');
  });
});

// Wiring spot-checks — real routers reject the wrong role at the
// middleware, before any input parsing or DB access.
describe('rbac — router wiring', () => {
  it('products: member cannot create, admin cannot deactivate (owner-only)', async () => {
    const { productsRouter } = await import('@/server/routers/products');
    await expectForbidden(
      productsRouter.createCaller(ctxWithRole('member')).create({} as never)
    );
    await expectForbidden(
      productsRouter.createCaller(ctxWithRole('admin')).deactivate({} as never)
    );
    await expectNotForbidden(
      productsRouter.createCaller(ctxWithRole('owner')).deactivate({} as never)
    );
  });

  it('finance: member cannot even view (owner+admin only)', async () => {
    const { financeRouter } = await import('@/server/routers/finance');
    await expectForbidden(
      financeRouter.createCaller(ctxWithRole('member')).pnl({} as never)
    );
    await expectNotForbidden(
      financeRouter.createCaller(ctxWithRole('admin')).pnl({} as never)
    );
  });

  it('settings: member cannot write settings', async () => {
    const { settingsRouter } = await import('@/server/routers/settings');
    await expectForbidden(
      settingsRouter.createCaller(ctxWithRole('member')).set({ key: 'a', value: 'b' })
    );
  });

  it('coupons: admin cannot delete (owner-only)', async () => {
    const { couponsRouter } = await import('@/server/routers/coupons');
    await expectForbidden(
      couponsRouter.createCaller(ctxWithRole('admin')).delete({} as never)
    );
  });

  it('purchasing: member cannot create supplier, admin cannot delete supplier', async () => {
    const { purchasingRouter } = await import('@/server/routers/purchasing');
    const memberCaller = purchasingRouter.createCaller(ctxWithRole('member'));
    const adminCaller = purchasingRouter.createCaller(ctxWithRole('admin'));
    await expectForbidden(memberCaller.suppliers.create({} as never));
    await expectForbidden(adminCaller.suppliers.delete({} as never));
  });

  it('courier: member cannot reconcile remittances', async () => {
    const { courierRouter } = await import('@/server/routers/courier');
    await expectForbidden(
      courierRouter.createCaller(ctxWithRole('member')).remittances.reconcile({} as never)
    );
  });

  it('members: member cannot list members (admin view), admin cannot change roles (owner-only)', async () => {
    const { membersRouter } = await import('@/server/routers/members');
    await expectForbidden(
      membersRouter.createCaller(ctxWithRole('member')).list()
    );
    await expectForbidden(
      membersRouter.createCaller(ctxWithRole('admin')).changeRole({} as never)
    );
  });

  it('notifications: member CAN mark own notifications read (stays protected)', async () => {
    const { notificationsRouter } = await import('@/server/routers/notifications');
    await expectNotForbidden(
      notificationsRouter.createCaller(ctxWithRole('member')).markAllRead()
    );
  });
});
