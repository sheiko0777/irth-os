/**
 * Proves the integration harness talks to a real Postgres and that the real
 * schema is deployed — and, with the last case, proves it catches a defect the
 * mocked unit suite passes straight over.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { auditLog, organizations } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

beforeAll(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDb();
});

describe('integration harness', () => {
  it('runs against a real Postgres, not the mock', async () => {
    const rows = await testDb.execute<{ v: string }>(sql`SELECT version() AS v`);
    const version = [...rows][0]?.v ?? '';
    // The mock in src/__tests__/helpers/mockDb.ts resolves every query to [],
    // so reaching a real server string here is the assertion that matters.
    expect(version).toMatch(/PostgreSQL/);
  });

  it('has the migrated schema, not an empty database', async () => {
    const rows = await testDb.execute<{ tablename: string }>(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    const tables = new Set([...rows].map((r) => r.tablename));

    for (const expected of ['organizations', 'orders', 'order_items', 'products', 'audit_log']) {
      expect(tables.has(expected), `missing table: ${expected}`).toBe(true);
    }
  });

  it('enforces constraints the mock cannot', async () => {
    // organizations.slug is UNIQUE. The mock would happily "insert" twice.
    await testDb.insert(organizations).values({ name: 'Org A', slug: 'dup-slug' });

    await expect(
      testDb.insert(organizations).values({ name: 'Org B', slug: 'dup-slug' }),
    ).rejects.toThrow();
  });

  /**
   * Characterisation of a known defect, kept as proof rather than prose.
   *
   * `withAudit` (packages/db/src/index.ts) falls back to the *string*
   * `'unknown_id'` when the wrapped operation returns no `id`, but
   * `audit_log.record_id` is `uuid NOT NULL`. Postgres rejects it with 22P02,
   * so instead of a slightly-incomplete audit row you get a thrown error — and
   * because most call sites are not in a transaction, the business write has
   * already committed by then.
   *
   * FIXED in 0033, but not the way this comment originally predicted. The
   * column stays `uuid` — record_id genuinely refers to a uuid primary key, so
   * widening it would be the wrong repair. What changed is `withAudit`: it now
   * writes NULL when the operation yields no id, which is honest for a bulk
   * update that has no single subject row.
   *
   * So this test keeps asserting exactly what it always did — Postgres rejects
   * the string — because that is still correct and is the reason the fallback
   * had to go. That withAudit no longer produces it is asserted separately in
   * identityAndNumbering.test.ts.
   */
  it('rejects the string withAudit used to fall back to for record_id', async () => {
    const [org] = await testDb
      .insert(organizations)
      .values({ name: 'Audit Org', slug: 'audit-org' })
      .returning();

    // Drizzle wraps driver failures in DrizzleQueryError, so the Postgres
    // SQLSTATE sits on `.cause`, not on the thrown error itself. Reading
    // `err.code` directly yields undefined and the assertion silently inverts.
    const sqlState = (err: unknown): string | undefined => {
      for (let e = err; e instanceof Error; e = (e as { cause?: unknown }).cause) {
        const code = (e as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
      return undefined;
    };

    let code: string | undefined;
    try {
      await testDb.insert(auditLog).values({
        orgId: org.id,
        userId: null,
        action: 'CREATE',
        tableName: 'orders',
        // Exactly what withAudit writes when `result?.id` is undefined.
        recordId: 'unknown_id' as unknown as string,
        changes: {},
      });
    } catch (err) {
      code = sqlState(err);
    }

    // 22P02 = invalid_text_representation. A mocked db returns [] and this
    // whole class of defect stays invisible.
    expect(code).toBe('22P02');
  });
});
