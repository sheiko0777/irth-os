import { effectiveAccess } from '@irth/db';
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { router, requirePermission, type Context } from '@/server/trpc';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

function ctxWithRole(role: 'owner' | 'admin' | 'member'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: {
      user: { id: 'user-1', email: 'user@test.com' },
      session: { activeOrganizationId: 'org-1' },
    },
    orgId: 'org-1',
    userId: 'user-1',
    role,
    access: effectiveAccess({ systemKey: role }),
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

// Middleware mechanism: requirePermission reads ctx.access (role + per-person
// grants − revokes), never ctx.role.
const gated = router({
  view: requirePermission('products', 'view').mutation(() => 'ok'),
  write: requirePermission('products', 'write').mutation(() => 'ok'),
  remove: requirePermission('products', 'delete').mutation(() => 'ok'),
});

function ctxWithAccess(access: ReturnType<typeof effectiveAccess>, role: 'owner' | 'admin' | 'member' = 'member'): Context {
  return { ...ctxWithRole(role), access } as unknown as Context;
}

describe('rbac — requirePermission on effective access', () => {
  it('member: view only', async () => {
    const caller = gated.createCaller(ctxWithRole('member'));
    await expect(caller.view()).resolves.toBe('ok');
    await expectForbidden(caller.write());
    await expectForbidden(caller.remove());
  });

  it('admin: view and write, not delete', async () => {
    const caller = gated.createCaller(ctxWithRole('admin'));
    await expect(caller.view()).resolves.toBe('ok');
    await expect(caller.write()).resolves.toBe('ok');
    await expectForbidden(caller.remove());
  });

  it('owner: everything', async () => {
    const caller = gated.createCaller(ctxWithRole('owner'));
    await expect(caller.view()).resolves.toBe('ok');
    await expect(caller.write()).resolves.toBe('ok');
    await expect(caller.remove()).resolves.toBe('ok');
  });

  it('a per-person grant lets a member write; a revoke takes view from an admin', async () => {
    const granted = gated.createCaller(ctxWithAccess(effectiveAccess({
      systemKey: 'member', overrides: { grant: { products: ['write'] } },
    })));
    await expect(granted.write()).resolves.toBe('ok');

    const revoked = gated.createCaller(ctxWithAccess(effectiveAccess({
      systemKey: 'admin', overrides: { revoke: { products: ['view'] } },
    }), 'admin'));
    await expectForbidden(revoked.view());
    await expect(revoked.write()).resolves.toBe('ok');
  });

  it('decides on access, not role: an "owner" role string with member access is a member', async () => {
    const caller = gated.createCaller(ctxWithAccess(effectiveAccess({ systemKey: 'member' }), 'owner'));
    await expectForbidden(caller.remove());
  });

  it('a custom role holds exactly its own list', async () => {
    const caller = gated.createCaller(ctxWithAccess(effectiveAccess({
      systemKey: null, rolePermissions: { products: ['delete'] },
    })));
    await expect(caller.remove()).resolves.toBe('ok');
    await expectForbidden(caller.view());
  });

  it('a suspended member is refused everything, whatever the role', async () => {
    const caller = gated.createCaller(ctxWithAccess(effectiveAccess({ systemKey: 'owner', status: 'suspended' }), 'owner'));
    await expectForbidden(caller.view());
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
      settingsRouter.createCaller(ctxWithRole('member')).set({ key: 'org.name', value: 'b' })
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
