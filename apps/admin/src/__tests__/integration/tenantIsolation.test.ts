/**
 * Proves the database refuses to show one tenant another tenant's rows.
 *
 * This is the test the whole of P2 exists for, and it is deliberately written
 * against real Postgres: RLS is invisible to the mocked unit suite, and the
 * failure mode it guards against — a policy that is present but inert — looks
 * identical to success from the application's side.
 *
 * The specific trap it was written to catch: the connecting role
 * (`neondb_owner`) owns every table and has rolbypassrls, so ENABLE + FORCE
 * ROW LEVEL SECURITY changed nothing for it. Only dropping to the unprivileged
 * `irth_app` role for the duration of a transaction makes policies apply. If
 * `withOrgContext` ever stops doing that, these tests go red.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { orders, organizations, withOrgContext } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgA: string;
let orgB: string;

beforeAll(async () => {
  await truncateAll();

  const [a] = await testDb
    .insert(organizations)
    .values({ name: 'Org A', slug: `org-a-${Date.now()}` })
    .returning();
  const [b] = await testDb
    .insert(organizations)
    .values({ name: 'Org B', slug: `org-b-${Date.now()}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  // One order per tenant, inserted as the owner so the fixture itself is not
  // subject to the policies under test.
  await testDb.insert(orders).values([
    { orgId: orgA, orderNumber: `A-${Date.now()}`, totalAmountMinor: 10_000n, status: 'pending' },
    { orgId: orgB, orderNumber: `B-${Date.now()}`, totalAmountMinor: 20_000n, status: 'pending' },
  ]);
});

afterAll(async () => {
  await closeTestDb();
});

describe('tenant isolation', () => {
  it('sees only its own rows, even with no orgId in the query', async () => {
    // Deliberately unscoped: `select * from orders` with no WHERE. This is the
    // forgotten-predicate case RLS exists to catch.
    const rows = await withOrgContext(testDb, orgA, async (tx) => tx.select().from(orders));

    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(orgA);
  });

  it('gives each tenant a different view of the same table', async () => {
    const fromA = await withOrgContext(testDb, orgA, async (tx) => tx.select().from(orders));
    const fromB = await withOrgContext(testDb, orgB, async (tx) => tx.select().from(orders));

    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
    expect(fromA[0].id).not.toBe(fromB[0].id);
  });

  it('cannot read another tenant even when the id is known and asked for directly', async () => {
    const [bRow] = await testDb.select().from(orders).where(eq(orders.orgId, orgB));

    const stolen = await withOrgContext(testDb, orgA, async (tx) =>
      tx.select().from(orders).where(eq(orders.id, bRow.id)),
    );

    expect(stolen).toHaveLength(0);
  });

  it('cannot update another tenant row', async () => {
    const [bRow] = await testDb.select().from(orders).where(eq(orders.orgId, orgB));

    const updated = await withOrgContext(testDb, orgA, async (tx) =>
      tx.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, bRow.id)).returning(),
    );
    expect(updated).toHaveLength(0);

    // And the row is genuinely untouched, read back as the owner.
    const [after] = await testDb.select().from(orders).where(eq(orders.id, bRow.id));
    expect(after.status).toBe('pending');
  });

  it('cannot delete another tenant row', async () => {
    const [bRow] = await testDb.select().from(orders).where(eq(orders.orgId, orgB));

    const deleted = await withOrgContext(testDb, orgA, async (tx) =>
      tx.delete(orders).where(eq(orders.id, bRow.id)).returning(),
    );
    expect(deleted).toHaveLength(0);

    const stillThere = await testDb.select().from(orders).where(eq(orders.id, bRow.id));
    expect(stillThere).toHaveLength(1);
  });

  it('cannot insert a row belonging to another tenant', async () => {
    // WITH CHECK gates the post-image, so writing someone else's org_id fails
    // rather than silently succeeding and becoming invisible.
    await expect(
      withOrgContext(testDb, orgA, async (tx) =>
        tx.insert(orders).values({
          orgId: orgB,
          orderNumber: `SMUGGLED-${Date.now()}`,
          totalAmountMinor: 1n,
          status: 'pending',
        }),
      ),
    ).rejects.toThrow();
  });

  it('drops the elevated role and the tenant scope when the transaction ends', async () => {
    await withOrgContext(testDb, orgA, async (tx) => tx.select().from(orders));

    // A fresh statement on the same pool must be back to the owner with no
    // tenant set — otherwise the scope leaks into the next request.
    const after = await testDb.execute<{ role: string; org: string | null }>(
      sql`SELECT current_user AS role, current_setting('app.org_id', true) AS org`,
    );
    const [row] = [...after];
    expect(row.role).toBe('neondb_owner');
    expect(row.org === null || row.org === '').toBe(true);
  });

  it('returns nothing — and does not throw — when the tenant is unset', async () => {
    // The forgotten-wrapper case, and the one that used to be an outage.
    //
    // `current_setting(name, true)` is NULL only while the setting has never
    // been touched on that backend. After anything sets it — a stray
    // set_config, or an earlier request on the same pooled connection — it
    // becomes the EMPTY STRING, and the original policy's `''::uuid` raised
    // `invalid input syntax for type uuid: ""` on every query against every
    // protected table. Migration 0032 wraps it in NULLIF so both cases collapse
    // to NULL and the row is simply filtered out.
    await testDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.org_id', '', true)`);
      await tx.execute(sql`SET LOCAL ROLE irth_app`);
      const rows = await tx.select().from(orders);
      expect(rows).toHaveLength(0);
    });
  });

  it('refuses a non-uuid orgId before opening a transaction', async () => {
    await expect(
      withOrgContext(testDb, "' OR 1=1 --", async (tx) => tx.select().from(orders)),
    ).rejects.toThrow(/uuid orgId/);
  });
});
