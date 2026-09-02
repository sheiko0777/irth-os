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

  it('list: member caller rejects FORBIDDEN (requirePermission members.view)', async () => {
    await expectCode(memberCaller.list(), 'FORBIDDEN');
  });

  it('list: admin caller is allowed (requirePermission members.view)', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await adminCaller.list();
    expect(res).toEqual({ data: [], error: null, meta: { orgId: 'org-1' } });
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

  it('changeRole: admin caller rejects FORBIDDEN (requirePermission members.changeRole)', async () => {
    await expectCode(adminCaller.changeRole({ memberId: UUID, role: 'admin' }), 'FORBIDDEN');
  });

  it('changeRole: owner caller is allowed (requirePermission members.changeRole)', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: UUID, role: 'member', userId: 'user-2' }]));
    mockDb.update = vi.fn(() => chainOf([{ id: UUID, role: 'admin' }]));
    const res = await caller.changeRole({ memberId: UUID, role: 'admin' });
    expect(res.data).toEqual({ id: UUID, role: 'admin' });
  });

  it('invite: member caller rejects FORBIDDEN (requirePermission members.invite)', async () => {
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

  it('listInvites: member caller rejects FORBIDDEN (requirePermission members.view)', async () => {
    await expectCode(memberCaller.listInvites(), 'FORBIDDEN');
  });

  it('listInvites: admin caller is allowed and returns pending invites', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: UUID, email: 'a@test.com', role: 'member' }]));
    const res = await adminCaller.listInvites();
    expect(res.data).toEqual([{ id: UUID, email: 'a@test.com', role: 'member' }]);
  });

  it('resendInvite: member caller rejects FORBIDDEN (requirePermission members.invite)', async () => {
    await expectCode(memberCaller.resendInvite({ inviteId: UUID }), 'FORBIDDEN');
  });

  it('resendInvite: missing invite rejects NOT_FOUND', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    await expectCode(caller.resendInvite({ inviteId: UUID }), 'NOT_FOUND');
  });

  it('resendInvite: owner caller reissues the invite (new token/OTP), invite id unchanged', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: UUID, orgId: 'org-1', email: 'a@test.com', role: 'member' }]));
    mockDb.update = vi.fn(() => chainOf([{ id: UUID, orgId: 'org-1', email: 'a@test.com', role: 'member' }]));
    const res = await caller.resendInvite({ inviteId: UUID });
    expect(res.data).toEqual({ id: UUID, orgId: 'org-1', email: 'a@test.com', role: 'member' });
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('revokeInvite: member caller rejects FORBIDDEN (requirePermission members.invite)', async () => {
    await expectCode(memberCaller.revokeInvite({ inviteId: UUID }), 'FORBIDDEN');
  });

  it('revokeInvite: missing/cross-org invite rejects NOT_FOUND', async () => {
    mockDb.delete = vi.fn(() => chainOf([]));
    await expectCode(caller.revokeInvite({ inviteId: UUID }), 'NOT_FOUND');
  });

  it('revokeInvite: owner caller deletes the invite', async () => {
    mockDb.delete = vi.fn(() => chainOf([{ id: UUID }]));
    const res = await caller.revokeInvite({ inviteId: UUID });
    expect(res.data).toEqual({ revoked: true });
  });

  it('bulkInvite: member caller rejects FORBIDDEN (requirePermission members.invite)', async () => {
    await expectCode(memberCaller.bulkInvite({ emails: ['a@test.com'], role: 'member' }), 'FORBIDDEN');
  });

  it('bulkInvite: admin caller inviting an owner rejects the whole batch before any insert', async () => {
    await expectCode(adminCaller.bulkInvite({ emails: ['a@test.com', 'b@test.com'], role: 'owner' }), 'FORBIDDEN');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('bulkInvite: all succeed', async () => {
    mockDb.insert = vi.fn(() => chainOf([{ id: UUID, email: 'a@test.com' }]));
    const res = await caller.bulkInvite({ emails: ['a@test.com', 'b@test.com', 'c@test.com'], role: 'member' });
    expect(res.data.invited).toBe(3);
    expect(res.data.results.every((r) => r.ok)).toBe(true);
  });

  it('bulkInvite: one row failing does not roll back the others', async () => {
    let call = 0;
    mockDb.insert = vi.fn(() => {
      call++;
      if (call === 2) throw new Error('duplicate email');
      return chainOf([{ id: UUID, email: 'x@test.com' }]);
    });
    const res = await caller.bulkInvite({ emails: ['a@test.com', 'b@test.com', 'c@test.com'], role: 'member' });
    expect(res.data.invited).toBe(2);
    expect(res.data.results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it('remove: member caller rejects FORBIDDEN (requirePermission members.remove)', async () => {
    await expectCode(memberCaller.remove({ memberId: UUID }), 'FORBIDDEN');
  });

  it('remove: admin caller rejects FORBIDDEN (requirePermission members.remove)', async () => {
    await expectCode(adminCaller.remove({ memberId: UUID }), 'FORBIDDEN');
  });

  it('remove: missing member rejects NOT_FOUND', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    await expectCode(caller.remove({ memberId: UUID }), 'NOT_FOUND');
  });

  it('remove: target is owner rejects FORBIDDEN', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: UUID, role: 'owner', userId: 'user-2' }]));
    await expectCode(caller.remove({ memberId: UUID }), 'FORBIDDEN');
  });

  it('remove: target is self rejects FORBIDDEN', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: UUID, role: 'admin', userId: 'user-1' }]));
    await expectCode(caller.remove({ memberId: UUID }), 'FORBIDDEN');
  });

  it('remove: owner caller deletes the target member', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: UUID, role: 'member', userId: 'user-2' }]));
    mockDb.delete = vi.fn(() => chainOf([{ id: UUID, role: 'member', userId: 'user-2' }]));
    const res = await caller.remove({ memberId: UUID });
    expect(res.data).toEqual({ id: UUID, role: 'member', userId: 'user-2' });
  });
});
