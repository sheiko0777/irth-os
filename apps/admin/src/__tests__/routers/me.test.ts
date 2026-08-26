import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { meRouter } from '@/server/routers/me';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

function ctx(): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role: 'owner',
  } as unknown as Context;
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

describe('me router', () => {
  const caller = meRouter.createCaller(ctx());

  it('get: returns identity plus every org the caller belongs to', async () => {
    mockDb.select = vi.fn(() => chainOf([
      { orgId: 'org-1', orgName: 'IRTH Group', role: 'owner' },
      { orgId: 'org-2', orgName: 'Second Co', role: 'member' },
    ]));

    const res = await caller.get();

    expect(res.data).toEqual({
      userId: 'user-1',
      orgId: 'org-1',
      role: 'owner',
      orgs: [
        { orgId: 'org-1', orgName: 'IRTH Group', role: 'owner' },
        { orgId: 'org-2', orgName: 'Second Co', role: 'member' },
      ],
    });
  });

  it('switchOrg: rejects with FORBIDDEN when the caller is not a member of the target org', async () => {
    mockDb.select = vi.fn(() => chainOf([])); // no membership row

    await expect(caller.switchOrg({ orgId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'FORBIDDEN');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('switchOrg: verifies membership then persists the pin', async () => {
    const orgId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    mockDb.select = vi.fn(() => chainOf([{ orgId, role: 'member' }]));

    const res = await caller.switchOrg({ orgId });

    expect(res.data).toEqual({ orgId, role: 'member' });
    expect(mockDb.update).toHaveBeenCalled();
  });
});
