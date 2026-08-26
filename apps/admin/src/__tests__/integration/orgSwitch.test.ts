/**
 * Proves the active-org resolver + switch mutation work end to end against
 * real Postgres — the revoked-membership fallback and "does the resolved org
 * actually scope subsequent queries" parts cannot be proven against a mock.
 * See packages/db/src/orgContext.ts and its own unit tests for the pure logic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { organizations, orgMembers, orders, user, resolveActiveOrgMembership, setActiveOrg, withOrgContext } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgA: string;
let orgB: string;
const userId = `test-user-${Date.now()}`;

beforeAll(async () => {
  await truncateAll();

  const [a] = await testDb.insert(organizations).values({ name: 'Org A', slug: `org-a-${Date.now()}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Org B', slug: `org-b-${Date.now()}` }).returning();
  orgA = a.id;
  orgB = b.id;

  await testDb.insert(user).values({ id: userId, name: 'Test User', email: `${userId}@test.com` });

  // Explicit createdAt so "oldest membership" is deterministic, not a race
  // against whichever millisecond these two inserts happen to land in.
  await testDb.insert(orgMembers).values({ orgId: orgA, userId, role: 'owner', createdAt: new Date('2026-01-01') });
  await testDb.insert(orgMembers).values({ orgId: orgB, userId, role: 'member', createdAt: new Date('2026-01-02') });
});

afterAll(async () => {
  await closeTestDb();
});

describe('active org resolution + switching', () => {
  it('resolves the oldest membership when no pin has ever been set', async () => {
    const result = await resolveActiveOrgMembership(testDb, userId);
    expect(result).toEqual({ orgId: orgA, role: 'owner' });
  });

  it('setActiveOrg persists a switch, and resolution then reflects it', async () => {
    const result = await setActiveOrg(testDb, userId, orgB);
    expect(result).toEqual({ orgId: orgB, role: 'member' });

    const resolved = await resolveActiveOrgMembership(testDb, userId);
    expect(resolved).toEqual({ orgId: orgB, role: 'member' });
  });

  it('falls back automatically when the pinned membership is revoked', async () => {
    await testDb.delete(orgMembers).where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgB)));

    const resolved = await resolveActiveOrgMembership(testDb, userId);
    expect(resolved).toEqual({ orgId: orgA, role: 'owner' });
  });

  it('the resolved org actually scopes subsequent queries', async () => {
    // Re-establish a real switch (B was deleted above) to prove this isn't
    // just falling back to A by coincidence — restore B's membership,
    // switch to it, then prove a scoped query under the resolved org sees
    // only that org's rows.
    await testDb.insert(orgMembers).values({ orgId: orgB, userId, role: 'member', createdAt: new Date('2026-01-02') });
    await setActiveOrg(testDb, userId, orgB);
    const resolved = await resolveActiveOrgMembership(testDb, userId);
    expect(resolved?.orgId).toBe(orgB);

    await testDb.insert(orders).values([
      { orgId: orgA, orderNumber: `A-${Date.now()}`, totalAmountMinor: 1_000n, status: 'pending' },
      { orgId: orgB, orderNumber: `B-${Date.now()}`, totalAmountMinor: 2_000n, status: 'pending' },
    ]);

    const rows = await withOrgContext(testDb, resolved!.orgId, async (tx) => tx.select().from(orders));
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(orgB);
  });
});
