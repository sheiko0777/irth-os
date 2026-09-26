/**
 * PR-1d against real Postgres: accounts the owner creates directly, role
 * assignment, per-person exceptions, suspension, password resets, the
 * temporary-password gate, sign-in by username, the last-owner guard (0075)
 * and the audit row for a refused call.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { verifyPassword } from 'better-auth/crypto';
import {
  accessRoles, account, auditLog, effectiveAccess, orgMembers, organizations, session, user, withOrgContext,
  type EffectiveAccess, type Role,
} from '@irth/db';
import type { Context } from '@/server/trpc';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { verifySession } = await import('@/lib/auth');
const { createContext } = await import('@/server/trpc');
const { appRouter } = await import('@/server/routers/_app');
const { auth } = await import('@/lib/auth-server');

let orgA: string;
let orgB: string;
let repRole: string;       // custom: orders.view only
let powerRole: string;     // custom: includes members.changeRole
let adminMemberId: string;

function callerAs(orgId: string, userId: string, role: Role, access: EffectiveAccess = effectiveAccess({ systemKey: role })) {
  return appRouter.createCaller({
    db: testDb, orgId, userId, role, access,
    session: { user: { id: userId, email: `${userId}@test.com` } },
    withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, orgId, fn),
  } as unknown as Context);
}
const owner = () => callerAs(orgA, 'owner-a', 'owner');
const admin = () => callerAs(orgA, 'admin-a', 'admin');
// An admin the owner has personally granted members.changeRole — so what
// refuses them below is delegation and coverage, not a missing permission.
const adminPlus = () => callerAs(orgA, 'admin-a', 'admin',
  effectiveAccess({ systemKey: 'admin', overrides: { grant: { members: ['changeRole'] } } }));

async function signedInAs(userId: string) {
  vi.mocked(verifySession).mockResolvedValue({ user: { id: userId, email: `${userId}@test.com` } } as never);
  return appRouter.createCaller(await createContext());
}

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (err) { return err instanceof TRPCError ? `${err.code}${err.message === 'PASSWORD_CHANGE_REQUIRED' ? ':PWD' : ''}` : String(err); }
}

async function memberOf(memberId: string) {
  const [row] = await testDb.select().from(orgMembers).where(eq(orgMembers.id, memberId));
  return row;
}

beforeAll(async () => {
  await truncateAll();
  const [a] = await testDb.insert(organizations).values({ name: 'Accounts A', slug: `acc-a-${Date.now()}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Accounts B', slug: `acc-b-${Date.now()}` }).returning();
  orgA = a.id;
  orgB = b.id;
  await testDb.insert(orgMembers).values({ orgId: orgA, userId: 'owner-a', role: 'owner' });
  const [adm] = await testDb.insert(orgMembers).values({ orgId: orgA, userId: 'admin-a', role: 'admin' }).returning();
  adminMemberId = adm.id;
  await testDb.insert(orgMembers).values({ orgId: orgB, userId: 'owner-b', role: 'owner' });
  const [rep] = await testDb.insert(accessRoles).values({ orgId: orgA, name: 'مندوب توصيل', principalKind: 'delivery_rep', permissions: { orders: ['view'] } }).returning();
  const [power] = await testDb.insert(accessRoles).values({ orgId: orgA, name: 'مدير أعضاء', permissions: { members: ['changeRole', 'view'] } }).returning();
  repRole = rep.id;
  powerRole = power.id;
});
afterAll(async () => { await closeTestDb(); });

describe('accounts.create', () => {
  it('creates user, credential and membership in one go; the temporary password is returned once and stored hashed', async () => {
    const { data } = await owner().accounts.create({ name: 'أحمد المندوب', username: '01012345678', accessRoleId: repRole });
    const member = await memberOf(data.memberId);
    expect(member).toMatchObject({ orgId: orgA, accessRoleId: repRole, principalKind: 'delivery_rep', mustChangePassword: true, role: 'member' });
    const [u] = await testDb.select().from(user).where(eq(user.id, member.userId));
    expect(u).toMatchObject({ username: '01012345678', email: '01012345678@accounts.irth.invalid' });
    const [cred] = await testDb.select().from(account).where(eq(account.userId, member.userId));
    expect(cred.providerId).toBe('credential');
    expect(cred.password).not.toContain(data.temporaryPassword);
    expect(await verifyPassword({ hash: cred.password!, password: data.temporaryPassword })).toBe(true);
    const [audit] = await testDb.select().from(auditLog).where(and(eq(auditLog.orgId, orgA), eq(auditLog.action, 'CREATE_ACCOUNT')));
    expect(JSON.stringify(audit.changes)).not.toContain(data.temporaryPassword);
  });

  it('a taken username is a CONFLICT and leaves nothing behind', async () => {
    const before = await testDb.select().from(user);
    expect(await code(owner().accounts.create({ name: 'تاني', username: '01012345678', accessRoleId: repRole }))).toBe('CONFLICT');
    expect(await testDb.select().from(user)).toHaveLength(before.length);
  });

  it('an admin cannot create an owner, or a role holding more than the admin holds', async () => {
    const [ownerRole] = await testDb.select().from(accessRoles).where(and(eq(accessRoles.orgId, orgA), eq(accessRoles.systemKey, 'owner')));
    expect(await code(admin().accounts.create({ name: 'x', username: 'would_be_owner', accessRoleId: ownerRole.id }))).toBe('FORBIDDEN');
    expect(await code(admin().accounts.create({ name: 'x', username: 'would_be_power', accessRoleId: powerRole }))).toBe('FORBIDDEN');
    expect(await code(admin().accounts.create({ name: 'x', username: 'plain_rep', accessRoleId: repRole }))).toBe('OK');
  });
});

describe('first sign-in: username, temporary password, forced change', () => {
  it('signs in by username, is refused everything until the password is changed, then works', async () => {
    const { data } = await owner().accounts.create({ name: 'مندوب ٢', username: '01099999999', accessRoleId: repRole });
    const signIn = await auth.api.signInUsername({ body: { username: '01099999999', password: data.temporaryPassword } });
    expect(signIn?.user?.id).toBeTruthy();
    const userId = signIn!.user.id;

    const before = await signedInAs(userId);
    expect(await code(before.orders.list({}))).toBe('FORBIDDEN:PWD');
    expect((await before.me.get()).data.mustChangePassword).toBe(true);
    expect(await code(before.me.changePassword({ currentPassword: 'wrong-one', newPassword: 'NewPass!2026' }))).toBe('UNAUTHORIZED');

    await before.me.changePassword({ currentPassword: data.temporaryPassword, newPassword: 'NewPass!2026' });
    const after = await signedInAs(userId);
    expect(await code(after.orders.list({}))).toBe('OK');
    expect(await code(after.products.list({}))).toBe('FORBIDDEN');
    await expect(auth.api.signInUsername({ body: { username: '01099999999', password: data.temporaryPassword } })).rejects.toBeTruthy();
    expect(await auth.api.signInUsername({ body: { username: '01099999999', password: 'NewPass!2026' } })).toBeTruthy();
  });
});

describe('assignRole and personal exceptions', () => {
  it('assigns a custom role that sticks, even as the legacy text changes with it (0075)', async () => {
    const [m] = await testDb.insert(orgMembers).values({ orgId: orgA, userId: 'staff-1', role: 'admin' }).returning();
    await owner().accounts.assignRole({ memberId: m.id, accessRoleId: repRole });
    expect(await memberOf(m.id)).toMatchObject({ accessRoleId: repRole, role: 'member', principalKind: 'delivery_rep' });
  });

  it('an admin cannot touch the owner, themselves, or a member granted more than the admin holds', async () => {
    const [ownerRow] = await testDb.select().from(orgMembers).where(and(eq(orgMembers.orgId, orgA), eq(orgMembers.userId, 'owner-a')));
    expect(await code(adminPlus().accounts.assignRole({ memberId: ownerRow.id, accessRoleId: repRole }))).toBe('FORBIDDEN');
    expect(await code(adminPlus().accounts.assignRole({ memberId: adminMemberId, accessRoleId: repRole }))).toBe('FORBIDDEN');
    const [m] = await testDb.insert(orgMembers).values({ orgId: orgA, userId: 'staff-2', role: 'member' }).returning();
    await owner().accounts.setOverrides({ memberId: m.id, grant: { members: ['remove'] }, revoke: {} });
    expect(await code(adminPlus().accounts.setOverrides({ memberId: m.id, grant: {}, revoke: {} }))).toBe('FORBIDDEN');
    // And a plain admin, without changeRole, is refused by the permission itself.
    expect(await code(admin().accounts.assignRole({ memberId: m.id, accessRoleId: repRole }))).toBe('FORBIDDEN');
  });

  it('grants and revokes change what the member can do, and only for them', async () => {
    const [m] = await testDb.insert(orgMembers).values({ orgId: orgA, userId: 'staff-3', role: 'member' }).returning();
    expect(await code(adminPlus().accounts.setOverrides({ memberId: m.id, grant: { members: ['remove'] }, revoke: {} }))).toBe('FORBIDDEN');
    await adminPlus().accounts.setOverrides({ memberId: m.id, grant: { orders: ['write'] }, revoke: { customers: ['view'] } });
    const { data } = await owner().accounts.effective({ memberId: m.id });
    expect(data.permissions).toContain('orders.write');
    expect(data.permissions).not.toContain('customers.view');
  });

  it('another org\'s member is NOT_FOUND', async () => {
    const [foreign] = await testDb.select().from(orgMembers).where(eq(orgMembers.orgId, orgB));
    expect(await code(owner().accounts.assignRole({ memberId: foreign.id, accessRoleId: repRole }))).toBe('NOT_FOUND');
    expect(await code(owner().accounts.setStatus({ memberId: foreign.id, status: 'suspended' }))).toBe('NOT_FOUND');
  });
});

describe('suspension, password reset, last owner', () => {
  it('a suspended member is refused at sign-in to the org; reactivation restores them', async () => {
    const { data } = await owner().accounts.create({ name: 'مؤقت', username: 'temp_staff', accessRoleId: repRole });
    const { userId } = await memberOf(data.memberId);
    await owner().accounts.setStatus({ memberId: data.memberId, status: 'suspended' });
    vi.mocked(verifySession).mockResolvedValue({ user: { id: userId, email: 'x@test.com' } } as never);
    await expect(createContext()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await owner().accounts.setStatus({ memberId: data.memberId, status: 'active' });
    expect(await createContext()).toBeTruthy();
  });

  it('reset: new temporary password, sessions ended, must change again — and never for someone in another org', async () => {
    const { data } = await owner().accounts.create({ name: 'نسي', username: 'forgot_pw', accessRoleId: repRole });
    const { userId } = await memberOf(data.memberId);
    await testDb.update(orgMembers).set({ mustChangePassword: false }).where(eq(orgMembers.id, data.memberId));
    await testDb.insert(session).values({ id: 's-forgot', token: 'tok-forgot', userId, expiresAt: new Date(Date.now() + 3_600_000), updatedAt: new Date() });

    const { data: reset } = await owner().accounts.resetPassword({ memberId: data.memberId });
    expect(await testDb.select().from(session).where(eq(session.userId, userId))).toHaveLength(0);
    expect((await memberOf(data.memberId)).mustChangePassword).toBe(true);
    const [cred] = await testDb.select().from(account).where(eq(account.userId, userId));
    expect(await verifyPassword({ hash: cred.password!, password: reset.temporaryPassword })).toBe(true);

    await testDb.insert(orgMembers).values({ orgId: orgB, userId, role: 'member' });
    expect(await code(owner().accounts.resetPassword({ memberId: data.memberId }))).toBe('FORBIDDEN');
  });

  it('the last active owner cannot be suspended, demoted or removed — by any path', async () => {
    const [ownerRow] = await testDb.select().from(orgMembers).where(and(eq(orgMembers.orgId, orgB), eq(orgMembers.userId, 'owner-b')));
    await expect(testDb.update(orgMembers).set({ status: 'suspended' }).where(eq(orgMembers.id, ownerRow.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) });
    await expect(testDb.update(orgMembers).set({ role: 'admin' }).where(eq(orgMembers.id, ownerRow.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) });
    await expect(testDb.delete(orgMembers).where(eq(orgMembers.id, ownerRow.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) });

    // Handing ownership over in one transaction is fine.
    const [second] = await testDb.insert(orgMembers).values({ orgId: orgB, userId: 'owner-b2', role: 'owner' }).returning();
    await testDb.update(orgMembers).set({ status: 'suspended' }).where(eq(orgMembers.id, ownerRow.id));
    expect((await memberOf(second.id)).status).toBe('active');
  });
});

describe('refused calls are audited', () => {
  it('writes one PERMISSION_DENIED row per member, procedure and minute', async () => {
    const member = callerAs(orgA, 'member-x', 'member');
    expect(await code(member.roles.create({ name: 'x', principalKind: 'staff', permissions: {} }))).toBe('FORBIDDEN');
    expect(await code(member.roles.create({ name: 'y', principalKind: 'staff', permissions: {} }))).toBe('FORBIDDEN');
    const rows = await testDb.select().from(auditLog)
      .where(and(eq(auditLog.orgId, orgA), eq(auditLog.action, 'PERMISSION_DENIED'), eq(auditLog.userId, 'member-x')));
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toMatchObject({ path: 'roles.create', permission: 'roles.manage' });
  });
});
