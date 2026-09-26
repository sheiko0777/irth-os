/**
 * PR-1c: the roles screen's router against real Postgres — the guarantees are
 * the database's and the transaction's: audit rows commit with the write, the
 * unique name, the guards in each WHERE clause, and tenant scoping.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  accessRoles, auditLog, effectiveAccess, orgMembers, organizations, permissionsForRole, withOrgContext, type Role,
} from '@irth/db';
import type { Context } from '@/server/trpc';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { rolesRouter } = await import('@/server/routers/roles');

let orgA: string;
let orgB: string;

function caller(orgId: string, role: Role = 'owner') {
  return rolesRouter.createCaller({
    db: testDb, orgId, userId: `${role}-user`, role, access: effectiveAccess({ systemKey: role }),
    session: { user: { id: `${role}-user`, email: `${role}@test.com` } },
    withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, orgId, fn),
  } as unknown as Context);
}

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (err) { return err instanceof TRPCError ? err.code : String(err); }
}

async function auditActions(orgId: string) {
  const rows = await testDb.select({ action: auditLog.action }).from(auditLog)
    .where(and(eq(auditLog.orgId, orgId), eq(auditLog.tableName, 'access_roles')));
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  await truncateAll();
  const [a] = await testDb.insert(organizations).values({ name: 'Roles A', slug: `roles-a-${Date.now()}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Roles B', slug: `roles-b-${Date.now()}` }).returning();
  orgA = a.id;
  orgB = b.id;
  // Every real org has an owner, and 0075 refuses member changes that would
  // leave one without.
  await testDb.insert(orgMembers).values({ orgId: orgA, userId: 'owner-user', role: 'owner' });
});
afterAll(async () => { await closeTestDb(); });

describe('roles.list', () => {
  it('shows the three system roles with the matrix as their permissions, and only this org\'s roles', async () => {
    await caller(orgB).create({ name: 'دور في B', principalKind: 'staff', permissions: { orders: ['view'] } });
    const { data } = await caller(orgA).list();
    expect(data.map((r) => r.systemKey)).toEqual(['owner', 'admin', 'member']);
    expect(data.find((r) => r.systemKey === 'member')?.permissions).toEqual(permissionsForRole('member'));
    expect(data.every((r) => r.isSystem)).toBe(true);
  });

  it('an admin can read roles but not change them', async () => {
    expect(await code(caller(orgA, 'admin').list())).toBe('OK');
    expect(await code(caller(orgA, 'admin').create({ name: 'x', principalKind: 'staff', permissions: {} }))).toBe('FORBIDDEN');
    expect(await code(caller(orgA, 'member').list())).toBe('FORBIDDEN');
  });
});

describe('roles.create / update / delete', () => {
  it('creates a custom role with a canonical list, audited in the same org', async () => {
    const { data } = await caller(orgA).create({
      name: 'أمين مخزن', principalKind: 'staff',
      permissions: { inventory: ['write', 'view', 'view'], orders: [] },
    });
    expect(data.permissions).toEqual({ inventory: ['view', 'write'] });
    expect(data.orgId).toBe(orgA);
    expect(await auditActions(orgA)).toContain('CREATE_ROLE');
  });

  it('rejects a permission the matrix does not declare, and writes nothing', async () => {
    const before = await testDb.select().from(accessRoles).where(eq(accessRoles.orgId, orgA));
    expect(await code(caller(orgA).create({ name: 'مزيف', principalKind: 'staff', permissions: { finance: ['steal'] } }))).toBe('BAD_REQUEST');
    expect(await code(caller(orgA).create({ name: 'مزيف', principalKind: 'staff', permissions: { vault: ['view'] } }))).toBe('BAD_REQUEST');
    const after = await testDb.select().from(accessRoles).where(eq(accessRoles.orgId, orgA));
    expect(after.length).toBe(before.length);
  });

  it('a duplicate name is a CONFLICT', async () => {
    expect(await code(caller(orgA).create({ name: 'أمين مخزن', principalKind: 'staff', permissions: {} }))).toBe('CONFLICT');
  });

  it('a system role cannot be edited or deleted', async () => {
    const [member] = await testDb.select().from(accessRoles)
      .where(and(eq(accessRoles.orgId, orgA), eq(accessRoles.systemKey, 'member')));
    expect(await code(caller(orgA).update({ id: member.id, permissions: { finance: ['view'] } }))).toBe('FORBIDDEN');
    expect(await code(caller(orgA).delete({ id: member.id }))).toBe('FORBIDDEN');
    const [after] = await testDb.select().from(accessRoles).where(eq(accessRoles.id, member.id));
    expect(after.permissions).toEqual({});
  });

  it('edits a custom role and records before and after', async () => {
    const { data: role } = await caller(orgA).create({ name: 'محاسب', principalKind: 'staff', permissions: { finance: ['view'] } });
    const { data } = await caller(orgA).update({ id: role.id, name: 'محاسب أول', permissions: { finance: ['view', 'write'] } });
    expect(data.name).toBe('محاسب أول');
    expect(data.permissions).toEqual({ finance: ['view', 'write'] });
    const [audit] = await testDb.select().from(auditLog)
      .where(and(eq(auditLog.orgId, orgA), eq(auditLog.action, 'UPDATE_ROLE'), eq(auditLog.recordId, role.id)));
    expect(audit.changes).toMatchObject({ from: { name: 'محاسب' }, to: { name: 'محاسب أول' } });
  });

  it('refuses to delete a role that members hold; deletes one that nobody holds', async () => {
    const { data: held } = await caller(orgA).create({ name: 'مندوب', principalKind: 'delivery_rep', permissions: { orders: ['view'] } });
    const [m] = await testDb.insert(orgMembers).values({ orgId: orgA, userId: 'rep-user', role: 'member' }).returning();
    await testDb.update(orgMembers).set({ accessRoleId: held.id }).where(eq(orgMembers.id, m.id));
    expect(await code(caller(orgA).delete({ id: held.id }))).toBe('CONFLICT');
    expect(await testDb.select().from(accessRoles).where(eq(accessRoles.id, held.id))).toHaveLength(1);

    const { data: unused } = await caller(orgA).create({ name: 'مؤقت', principalKind: 'staff', permissions: {} });
    await caller(orgA).delete({ id: unused.id });
    expect(await testDb.select().from(accessRoles).where(eq(accessRoles.id, unused.id))).toHaveLength(0);
    expect(await auditActions(orgA)).toContain('DELETE_ROLE');
  });

  it('another org\'s role is NOT_FOUND, never edited or deleted', async () => {
    const [foreign] = await testDb.select().from(accessRoles)
      .where(and(eq(accessRoles.orgId, orgB), eq(accessRoles.name, 'دور في B')));
    expect(await code(caller(orgA).update({ id: foreign.id, name: 'مخطوف' }))).toBe('NOT_FOUND');
    expect(await code(caller(orgA).delete({ id: foreign.id }))).toBe('NOT_FOUND');
    const [after] = await testDb.select().from(accessRoles).where(eq(accessRoles.id, foreign.id));
    expect(after.name).toBe('دور في B');
  });
});
