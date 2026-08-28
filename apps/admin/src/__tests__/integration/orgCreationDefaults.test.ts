/**
 * platformAdmin.createOrg's transactional org-creation flow, against real
 * Postgres.
 *
 * Unlike the rest of this directory (see pnl.test.ts's note: no test here
 * calls `.createCaller`), createOrg's business logic lives ENTIRELY inline in
 * the router mutation — there is no packages/db function like
 * postJournalEntry/recordCostedReceipt to exercise directly. Calling through
 * `platformAdminRouter.createCaller(ctx)` against the real testDb is
 * therefore the only way to prove the actual code under test (the
 * transaction wrapping this change introduces), rather than a hand-copied
 * re-implementation of it that could pass while the real mutation does not.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { organizations, orgInvites, shippingZones, shippingRates, priceLists } from '@irth/db';
import { EGP, parseDecimal } from '@irth/domain';
import { platformAdminRouter } from '@/server/routers/platformAdmin';
import type { Context } from '@/server/trpc';
import { DEFAULT_SETTINGS, SETTING_KEYS } from '@/lib/settings';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

const ADMIN_EMAIL = 'platform-admin@test.local';
const ORIGINAL_PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL;

function ctx(): Context {
  return {
    db: testDb,
    dbUnscoped: testDb,
    session: { user: { id: 'admin-user', email: ADMIN_EMAIL }, session: { activeOrganizationId: null } },
    orgId: 'unused-platform-admin-has-no-tenant-scope',
    userId: 'admin-user',
    role: 'owner',
    // createOrg never calls these — platform administration is intentionally
    // cross-tenant (see caller.ts's comment on dbUnscoped), so there is no
    // real org to scope `withOrg` to here.
    withOrg: async () => {
      throw new Error('withOrg should not be called by createOrg');
    },
    idempotent: async (_operation: string, _key: string | undefined, _request: unknown, fn: () => Promise<unknown>) =>
      fn(),
  } as unknown as Context;
}

function createOrgInput(overrides: Partial<{
  name: string;
  slug: string;
  ownerEmail: string;
  plan: 'starter' | 'growth' | 'enterprise';
  enabledScreens: string[];
  disabledScreens: string[];
  maxUsers: number | null;
  notes: string | null;
}> = {}) {
  return {
    name: 'Test Org',
    slug: `test-org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ownerEmail: 'owner@test.local',
    plan: 'starter' as const,
    enabledScreens: [],
    disabledScreens: [],
    maxUsers: null,
    notes: null,
    ...overrides,
  };
}

beforeAll(async () => {
  await truncateAll();
  process.env.PLATFORM_ADMIN_EMAIL = ADMIN_EMAIL;
});

afterAll(async () => {
  process.env.PLATFORM_ADMIN_EMAIL = ORIGINAL_PLATFORM_ADMIN_EMAIL;
  await closeTestDb();
});

describe('platformAdmin.createOrg — seeds shipping + pricing defaults', () => {
  it('seeds a default shipping zone, a shipping rate, and a default price list, all pointing at the new org', async () => {
    const caller = platformAdminRouter.createCaller(ctx());
    const result = await caller.createOrg(createOrgInput());

    const orgId = result.data.orgId;
    expect(orgId).toBeTruthy();

    const [zone] = await testDb.select().from(shippingZones).where(eq(shippingZones.orgId, orgId));
    expect(zone).toBeTruthy();
    expect(zone.name).toBe('Default Zone');

    const rates = await testDb.select().from(shippingRates).where(eq(shippingRates.orgId, orgId));
    expect(rates).toHaveLength(1);
    expect(rates[0].zoneId).toBe(zone.id);
    expect(rates[0].name).toBe('Standard');
    expect(rates[0].rateType).toBe('flat');

    // The seeded rate must match what settingsRouter.getAll would already be
    // telling the merchant the flat rate is — DEFAULT_SETTINGS merged over an
    // (empty) org_settings table.
    const expectedMinor = parseDecimal(DEFAULT_SETTINGS[SETTING_KEYS.shipping.flat_rate], EGP).minor;
    expect(rates[0].priceMinor).toBe(expectedMinor);

    const priceListRows = await testDb.select().from(priceLists).where(eq(priceLists.orgId, orgId));
    expect(priceListRows).toHaveLength(1);
    expect(priceListRows[0].name).toBe('Default Price List');
    expect(priceListRows[0].isDefault).toBe(true);
  });

  it('a failure forced after the organizations insert leaves no orphaned organizations row', async () => {
    // orgInvites.token carries a unique constraint (packages/db/src/schema.ts).
    // createOrg generates its token via crypto.randomUUID() *before* opening
    // the transaction, so pinning that one call to a token that already
    // exists forces the orgInvites insert — which runs after organizations
    // AND orgFeatureFlags have already succeeded inside the same transaction
    // attempt — to fail on a unique violation. That is a stronger proof than
    // a duplicate-slug retry (which would fail on the very first statement,
    // proving nothing about rollback of work done earlier in the SAME
    // attempt): it shows a downstream failure unwinds the org row an
    // earlier statement in this same call already wrote.
    const FIXED_TOKEN = '11111111-1111-4111-8111-111111111111' as ReturnType<typeof crypto.randomUUID>;

    const [seedOrg] = await testDb.insert(organizations)
      .values({ name: 'Seed Org', slug: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
      .returning();

    await testDb.insert(orgInvites).values({
      orgId: seedOrg.id,
      email: 'seed@test.local',
      token: FIXED_TOKEN,
      role: 'owner',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce(FIXED_TOKEN);

    const doomedSlug = `doomed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const caller = platformAdminRouter.createCaller(ctx());

    await expect(caller.createOrg(createOrgInput({ slug: doomedSlug }))).rejects.toThrow();

    uuidSpy.mockRestore();

    const orphaned = await testDb.select().from(organizations).where(eq(organizations.slug, doomedSlug));
    expect(orphaned).toHaveLength(0);
  });
});
