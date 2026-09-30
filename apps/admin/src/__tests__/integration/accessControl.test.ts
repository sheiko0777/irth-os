/**
 * 0074 (owner decision A5): roles the org defines, per-person overrides and
 * data scopes — against real Postgres, because every guarantee here is the
 * database's: the triggers that seed and link system roles, the CHECKs, the
 * same-org composite FKs, and RLS on the new tables.
 *
 * The parity block is the one that matters for the next step: it proves that
 * reading a member's authority from the new tables gives, for every declared
 * resource.action, exactly what can(role, …) gives today. Switching
 * requirePermission onto resolveEffectiveAccess is therefore a no-op for every
 * existing member.
 *
 * The last block goes end to end: a real createContext for a signed-in user,
 * then a procedure called directly — the hostile-client path CLAUDE.md rule 4
 * assumes — decided by the member's custom role and per-person overrides.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  accessRoles, can, canAccess, memberScopes, orgMembers, orders, organizations, PERMISSIONS,
  resolveEffectiveAccess, warehouses, withOrgContext, type Resource,
} from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { verifySession } = await import('@/lib/auth');
const { createContext } = await import('@/server/trpc');
const { appRouter } = await import('@/server/routers/_app');

let orgA: string;
let orgB: string;
let seq = 0;

async function newOrg(name: string) {
  const [org] = await testDb.insert(organizations).values({ name, slug: `${name}-${Date.now()}-${++seq}` }).returning();
  return org.id;
}

async function addMember(orgId: string, role: string) {
  const userId = `user-${++seq}`;
  const [row] = await testDb.insert(orgMembers).values({ orgId, userId, role }).returning();
  return { userId, memberId: row.id, accessRoleId: row.accessRoleId };
}

async function systemRoleId(orgId: string, systemKey: string) {
  const [row] = await testDb.select({ id: accessRoles.id }).from(accessRoles)
    .where(and(eq(accessRoles.orgId, orgId), eq(accessRoles.systemKey, systemKey as 'owner')));
  return row?.id;
}

function everyPair(): Array<[Resource, string]> {
  return (Object.keys(PERMISSIONS) as Resource[]).flatMap((resource) =>
    Object.keys(PERMISSIONS[resource]).map((action) => [resource, action] as [Resource, string]));
}

beforeAll(async () => {
  await truncateAll();
  orgA = await newOrg('access-a');
  orgB = await newOrg('access-b');
});
afterAll(async () => { await closeTestDb(); });

describe('system roles', () => {
  it('every new org gets owner, admin and member roles with no stored list', async () => {
    const rows = await testDb.select().from(accessRoles).where(eq(accessRoles.orgId, orgA));
    expect(rows.map((r) => r.systemKey).sort()).toEqual(['admin', 'member', 'owner']);
    expect(rows.every((r) => JSON.stringify(r.permissions) === '{}')).toBe(true);
  });

  it('a system role cannot be given a permission list (the matrix is its list)', async () => {
    await expect(testDb.update(accessRoles).set({ permissions: { finance: ['view'] } })
      .where(and(eq(accessRoles.orgId, orgA), eq(accessRoles.systemKey, 'member'))))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) });
  });
});

describe('members are linked to their role', () => {
  it.each(['owner', 'admin', 'member'])('a new %s points at the org system role of that name', async (role) => {
    const m = await addMember(orgA, role);
    expect(m.accessRoleId).toBe(await systemRoleId(orgA, role));
  });

  it('changing role re-points the member', async () => {
    const m = await addMember(orgA, 'member');
    await testDb.update(orgMembers).set({ role: 'admin' }).where(eq(orgMembers.id, m.memberId));
    const [row] = await testDb.select().from(orgMembers).where(eq(orgMembers.id, m.memberId));
    expect(row.accessRoleId).toBe(await systemRoleId(orgA, 'admin'));
  });

  it('a member cannot hold another org\'s role', async () => {
    const m = await addMember(orgA, 'member');
    const foreign = await systemRoleId(orgB, 'owner');
    await expect(testDb.update(orgMembers).set({ accessRoleId: foreign }).where(eq(orgMembers.id, m.memberId)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23503' }) });
  });
});

describe('parity: reading the new tables changes nothing for existing members', () => {
  it.each(['owner', 'admin', 'member'] as const)('%s: resolveEffectiveAccess agrees with can() on every pair', async (role) => {
    const m = await addMember(orgA, role);
    const access = await resolveEffectiveAccess(testDb, orgA, m.userId);
    expect(access).not.toBeNull();
    for (const [resource, action] of everyPair()) {
      expect(canAccess(access!, resource, action as never), `${role} ${resource}.${action}`).toBe(can(role, resource, action as never));
    }
  });

  it('a member not yet linked to a role row falls back to their text role, not to nothing or everything', async () => {
    const m = await addMember(orgA, 'admin');
    await testDb.execute(sql`UPDATE org_members SET access_role_id = NULL WHERE id = ${m.memberId}`);
    const access = await resolveEffectiveAccess(testDb, orgA, m.userId);
    for (const [resource, action] of everyPair()) {
      expect(canAccess(access!, resource, action as never)).toBe(can('admin', resource, action as never));
    }
  });

  it('a non-member resolves to null', async () => {
    expect(await resolveEffectiveAccess(testDb, orgA, 'nobody')).toBeNull();
  });
});

describe('custom roles, overrides and suspension', () => {
  it('a custom role with per-person overrides resolves to role + grant − revoke', async () => {
    const [keeper] = await testDb.insert(accessRoles).values({
      orgId: orgA, name: 'أمين مخزن', permissions: { inventory: ['view', 'write'], products: ['view'] },
    }).returning();
    const m = await addMember(orgA, 'member');
    await testDb.update(orgMembers).set({
      accessRoleId: keeper.id,
      overrides: { grant: { orders: ['view'] }, revoke: { inventory: ['write'] } },
    }).where(eq(orgMembers.id, m.memberId));

    const access = (await resolveEffectiveAccess(testDb, orgA, m.userId))!;
    expect(canAccess(access, 'inventory', 'view')).toBe(true);
    expect(canAccess(access, 'inventory', 'write')).toBe(false);
    expect(canAccess(access, 'orders', 'view')).toBe(true);
    expect(canAccess(access, 'finance', 'view')).toBe(false);
  });

  it('a suspended member resolves to no permissions at all', async () => {
    const m = await addMember(orgA, 'owner');
    await testDb.update(orgMembers).set({ status: 'suspended' }).where(eq(orgMembers.id, m.memberId));
    const access = (await resolveEffectiveAccess(testDb, orgA, m.userId))!;
    expect(access.suspended).toBe(true);
    expect(everyPair().some(([r, a]) => canAccess(access, r, a as never))).toBe(false);
  });

  it('rejects an unknown principal kind, status or override shape', async () => {
    const m = await addMember(orgA, 'member');
    for (const bad of [
      sql`UPDATE org_members SET principal_kind = 'robot' WHERE id = ${m.memberId}`,
      sql`UPDATE org_members SET status = 'deleted' WHERE id = ${m.memberId}`,
      sql`UPDATE org_members SET overrides = '{"grant": []}'::jsonb WHERE id = ${m.memberId}`,
    ]) {
      await expect(testDb.execute(bad)).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) });
    }
  });
});

describe('member scopes', () => {
  it('a scope belongs to a member of the same org, and repeats are rejected', async () => {
    const m = await addMember(orgA, 'member');
    const [wh] = await testDb.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.orgId, orgA));
    await testDb.insert(memberScopes).values({ orgId: orgA, memberId: m.memberId, scopeKind: 'warehouse', scopeId: wh.id });
    await expect(testDb.insert(memberScopes).values({ orgId: orgA, memberId: m.memberId, scopeKind: 'warehouse', scopeId: wh.id }))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23505' }) });
    // Filed under org B: the (member, org) pair does not exist, so the FK refuses it.
    const [whB] = await testDb.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.orgId, orgB));
    await expect(testDb.insert(memberScopes).values({ orgId: orgB, memberId: m.memberId, scopeKind: 'warehouse', scopeId: whB.id }))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23503' }) });
  });
});

describe('tenant isolation on the new tables', () => {
  it('under org A\'s scope, org B\'s roles are invisible', async () => {
    const visible = await withOrgContext(testDb, orgA, (tx) => tx.select({ orgId: accessRoles.orgId }).from(accessRoles));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((r) => r.orgId === orgA)).toBe(true);
  });
});

describe('end to end: createContext → requirePermission', () => {
  async function callerFor(userId: string) {
    vi.mocked(verifySession).mockResolvedValue({ user: { id: userId, email: `${userId}@test.com` } } as never);
    return appRouter.createCaller(await createContext());
  }

  async function forbidden(p: Promise<unknown>) {
    await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'FORBIDDEN');
  }

  it('a member whose custom role lacks orders.write is refused updateStatus when calling it directly; a per-person grant lets them', async () => {
    const [keeper] = await testDb.insert(accessRoles).values({
      orgId: orgA, name: 'أمين مخزن 2', permissions: { inventory: ['view', 'write'], orders: ['view'] },
    }).returning();
    const m = await addMember(orgA, 'member');
    await testDb.update(orgMembers).set({ accessRoleId: keeper.id }).where(eq(orgMembers.id, m.memberId));
    const [order] = await testDb.insert(orders).values({
      orgId: orgA, orderNumber: `ACL-${++seq}`, status: 'pending', totalAmountMinor: 1000n, currency: 'EGP',
    }).returning();

    await forbidden((await callerFor(m.userId)).orders.updateStatus({ id: order.id, status: 'confirmed' }));
    const [unchanged] = await testDb.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id));
    expect(unchanged.status).toBe('pending');

    await testDb.update(orgMembers).set({ overrides: { grant: { orders: ['write'] }, revoke: {} } })
      .where(eq(orgMembers.id, m.memberId));
    await (await callerFor(m.userId)).orders.updateStatus({ id: order.id, status: 'confirmed' });
    const [moved] = await testDb.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id));
    expect(moved.status).toBe('confirmed');
  });

  it('a revoke takes a permission from an admin, even though their role has it', async () => {
    const m = await addMember(orgA, 'admin');
    await testDb.update(orgMembers).set({ overrides: { grant: {}, revoke: { finance: ['view'] } } })
      .where(eq(orgMembers.id, m.memberId));
    const today = new Date().toISOString().slice(0, 10);
    await forbidden((await callerFor(m.userId)).finance.vatReport({ startDate: today, endDate: today }));
  });

  it('a suspended member is refused before any procedure runs, self-service ones included', async () => {
    const m = await addMember(orgA, 'owner');
    await testDb.update(orgMembers).set({ status: 'suspended' }).where(eq(orgMembers.id, m.memberId));
    vi.mocked(verifySession).mockResolvedValue({ user: { id: m.userId, email: 'x@test.com' } } as never);
    await expect(createContext()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('suspended in one org, active in another: lands in the active one and cannot switch back', async () => {
    const m = await addMember(orgA, 'admin');
    await testDb.insert(orgMembers).values({ orgId: orgB, userId: m.userId, role: 'member' });
    await testDb.update(orgMembers).set({ status: 'suspended' }).where(eq(orgMembers.id, m.memberId));

    const caller = await callerFor(m.userId);
    const { data } = await caller.me.get();
    expect(data.orgId).toBe(orgB);
    expect(data.orgs.map((o) => o.orgId)).toEqual([orgB]);
    await expect(caller.me.switchOrg({ orgId: orgA })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a member holding no permissions can still use self-service procedures', async () => {
    const [nothing] = await testDb.insert(accessRoles).values({ orgId: orgA, name: 'بلا صلاحيات', permissions: {} }).returning();
    const m = await addMember(orgA, 'member');
    await testDb.update(orgMembers).set({ accessRoleId: nothing.id }).where(eq(orgMembers.id, m.memberId));
    const caller = await callerFor(m.userId);
    await expect(caller.notifications.unreadCount()).resolves.toBeDefined();
    await forbidden(caller.dashboard.getStats());
  });
});
