/**
 * Four defects that made ordinary writes fail against real Postgres, each
 * invisible to the mocked unit suite because a mock accepts any value for any
 * column.
 *
 * All four were found by narrowing withAudit's first parameter to require a
 * transaction: the compiler pointed at apps/api, and reading those call sites
 * turned up type mismatches the schema had been carrying all along.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { auditLog, orders, organizations, withAudit } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

/** Shape Better Auth's default generator produces: a-z 0-9 A-Z - _, not a uuid. */
const BETTER_AUTH_USER_ID = 'yLmN3pQr7sT9uVwX2yZaB4cD6eF8gH0i';

let orgA: string;
let orgB: string;

beforeAll(async () => {
  await truncateAll();
  const [a] = await testDb.insert(organizations)
    .values({ name: 'Org A', slug: `num-a-${Date.now()}` }).returning();
  const [b] = await testDb.insert(organizations)
    .values({ name: 'Org B', slug: `num-b-${Date.now()}` }).returning();
  orgA = a.id;
  orgB = b.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe('audit_log accepts the user ids that actually exist (0034)', () => {
  it('stores a Better Auth user id', async () => {
    // Was `uuid`, so this raised 22P02 — on EVERY audited mutation by a
    // logged-in user, in both apps. org_members.user_id was already text and
    // already held these ids; audit_log was the lone outlier.
    const [row] = await testDb.insert(auditLog).values({
      orgId: orgA,
      userId: BETTER_AUTH_USER_ID,
      action: 'CREATE',
      tableName: 'orders',
      recordId: null,
      changes: {},
    }).returning();

    expect(row.userId).toBe(BETTER_AUTH_USER_ID);
  });

  it('still rejects a non-uuid record_id, which is a different column', async () => {
    // record_id genuinely refers to a uuid primary key, so it stays uuid. The
    // fix for withAudit's old 'unknown_id' fallback was to write NULL (0033),
    // not to widen this column — asserted so a future "just make it text"
    // cannot pass unnoticed.
    const sqlState = (err: unknown): string | undefined => {
      for (let e = err; e instanceof Error; e = (e as { cause?: unknown }).cause) {
        const code = (e as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
      return undefined;
    };

    let code: string | undefined;
    try {
      await testDb.execute(sql`
        INSERT INTO audit_log (org_id, user_id, action, table_name, record_id, changes)
        VALUES (${orgA}, NULL, 'CREATE', 'orders', 'unknown_id', '{}'::jsonb)
      `);
    } catch (err) {
      code = sqlState(err);
    }
    expect(code).toBe('22P02');
  });
});

describe('withAudit writes NULL rather than a fabricated record id (0033)', () => {
  it('audits an operation that yields no id', async () => {
    // The bulk path: `withAudit` used to substitute the string 'unknown_id',
    // which the uuid column rejected — so the audit insert threw and, before
    // these writes were transactional, it threw AFTER the business write had
    // committed. The change happened, the record of it did not, and the caller
    // saw a failure.
    const before = await testDb.select().from(auditLog);

    await testDb.transaction(async (tx) => {
      await withAudit(
        tx,
        async () => ({}),                    // no id — a batch, not one row
        {
          orgId: orgA,
          userId: BETTER_AUTH_USER_ID,
          action: 'bulk_update_status',
          tableName: 'orders',
          changes: { ids: ['a', 'b', 'c'] },
        },
      );
    });

    const after = await testDb.select().from(auditLog);
    expect(after.length).toBe(before.length + 1);

    const written = after.find((r) => r.action === 'bulk_update_status');
    expect(written?.recordId).toBeNull();
    // The detail the row does carry is what makes NULL acceptable here.
    expect(written?.changes).toMatchObject({ ids: ['a', 'b', 'c'] });
  });
});

describe('withAudit survives money in the changeset', () => {
  it('writes an audit row whose changes contain bigint', async () => {
    // `changes` is jsonb, and the postgres driver serializes jsonb parameters
    // with JSON.stringify — which THROWS on bigint, it does not coerce:
    //
    //     TypeError: Do not know how to serialize a BigInt
    //
    // Every money column became bigint in 0028, so any audited write whose
    // changeset mentioned an amount took down the write it was recording.
    // Order creation passes `changes: { items: [...] }` with priceMinor on each
    // line, which is exactly this shape.
    await testDb.transaction(async (tx) => {
      await withAudit(
        tx,
        async () => ({ id: orgA }),
        {
          orgId: orgA,
          userId: BETTER_AUTH_USER_ID,
          // Distinct action: the first test in this file also writes
          // CREATE/orders, and `find` would return that row instead.
          action: 'CREATE_WITH_MONEY',
          tableName: 'orders',
          changes: {
            totalAmountMinor: 19999n,
            items: [{ variantId: 'v1', quantity: 2, priceMinor: 9999n }],
          },
        },
      );
    });

    const rows = await testDb.select().from(auditLog);
    const written = rows.find((r) => r.action === 'CREATE_WITH_MONEY');
    const changes = written?.changes as Record<string, unknown>;

    // Stored as decimal STRINGS: Number() is lossy past 2^53, and money is
    // precisely what must not round.
    expect(changes.totalAmountMinor).toBe('19999');
    expect((changes.items as Record<string, unknown>[])[0].priceMinor).toBe('9999');
  });
});

describe('document numbers are unique per tenant, not globally (0035)', () => {
  it('lets two organizations each hold IRT-2026-0001', async () => {
    // `orders_order_number_unique` was UNIQUE(order_number) alone. Since every
    // org's first order is numbered IRT-2026-0001, the SECOND organization ever
    // to place an order hit a unique violation and could not order at all —
    // one tenant's ordinary use locking another out, by schema.
    await testDb.insert(orders).values({
      orgId: orgA, orderNumber: 'IRT-2026-0001', totalAmountMinor: 1000n, status: 'pending',
    });

    await expect(
      testDb.insert(orders).values({
        orgId: orgB, orderNumber: 'IRT-2026-0001', totalAmountMinor: 2000n, status: 'pending',
      }),
    ).resolves.toBeDefined();
  });

  it('still rejects a duplicate within one organization', async () => {
    // The other half: per-tenant must not mean unconstrained. This is what
    // turns the count(*)+1 race from a silent duplicate into a loud failure.
    await testDb.insert(orders).values({
      orgId: orgA, orderNumber: 'IRT-2026-0042', totalAmountMinor: 1000n, status: 'pending',
    });

    await expect(
      testDb.insert(orders).values({
        orgId: orgA, orderNumber: 'IRT-2026-0042', totalAmountMinor: 9999n, status: 'pending',
      }),
    ).rejects.toThrow();
  });
});
