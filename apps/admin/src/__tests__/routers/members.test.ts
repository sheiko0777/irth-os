import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { membersRouter } from '@/server/routers/members';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

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
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy', 'returning', 'values', 'set', 'onConflictDoUpdate'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

beforeEach(() => {
  mockDb._reset();
});

describe('members router', () => {
  const caller = membersRouter.createCaller(ctx('owner'));
  const adminCaller = membersRouter.createCaller(ctx('admin'));
  const memberCaller = membersRouter.createCaller(ctx('member'));

  it('list: empty db yields empty array', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.list();
    expect(res).toEqual({ data: [], error: null, meta: { orgId: 'org-1' } });
  });

  it('list: member caller rejects FORBIDDEN (adminProcedure)', async () => {
    await expectCode(memberCaller.list(), 'FORBIDDEN');
  });

  it('changeRole: missing member rejects NOT_FOUND', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    await expectCode(caller.changeRole({ memberId: UUID, role: 'admin' }), 'NOT_FOUND');
  });

  it('changeRole: target is owner rejects FORBIDDEN', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: UUID, role: 'owner', userId: 'user-2' }]));
    await expectCode(caller.changeRole({ memberId: UUID, role: 'admin' }), 'FORBIDDEN');
  });

  it('changeRole: target is self rejects FORBIDDEN', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: UUID, role: 'admin', userId: 'user-1' }]));
    await expectCode(caller.changeRole({ memberId: UUID, role: 'member' }), 'FORBIDDEN');
  });

  it('changeRole: admin caller rejects FORBIDDEN (ownerProcedure)', async () => {
    await expectCode(adminCaller.changeRole({ memberId: UUID, role: 'admin' }), 'FORBIDDEN');
  });

  it('invite: member caller rejects FORBIDDEN (adminProcedure)', async () => {
    await expectCode(memberCaller.invite({ email: 'a@test.com', role: 'member' }), 'FORBIDDEN');
  });

  it('invite: admin caller inviting an owner rejects FORBIDDEN', async () => {
    await expectCode(adminCaller.invite({ email: 'a@test.com', role: 'owner' }), 'FORBIDDEN');
  });

  it('invite: owner caller creates an invite row', async () => {
    mockDb.insert = vi.fn(() => chainOf([{ id: UUID, orgId: 'org-1', email: 'a@test.com', role: 'member' }]));
    const res = await caller.invite({ email: 'a@test.com', role: 'member' });
    expect(res.data).toEqual({ id: UUID, orgId: 'org-1', email: 'a@test.com', role: 'member' });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('invite: admin caller can invite a member', async () => {
    mockDb.insert = vi.fn(() => chainOf([{ id: UUID, orgId: 'org-1', email: 'b@test.com', role: 'member' }]));
    const res = await adminCaller.invite({ email: 'b@test.com', role: 'member' });
    expect(res.data).toEqual({ id: UUID, orgId: 'org-1', email: 'b@test.com', role: 'member' });
  });
});
