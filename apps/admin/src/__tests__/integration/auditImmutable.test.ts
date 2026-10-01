/**
 * audit_log is append-only (0082), against real Postgres.
 *
 * Two layers, both proven here: irth_app has no UPDATE/DELETE grant, and a
 * BEFORE UPDATE OR DELETE trigger raises for every role — including the owner
 * connection (neondb_owner, BYPASSRLS), which grants alone cannot stop.
 * Also pins the v2 defaults and the BEFORE INSERT fill of actor_id/resource_id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLog, organizations, withAudit, withOrgContext } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgId: string;
let rowId: string;
const recordId = '00000000-0000-4000-8000-000000000001';

const failure = (err: unknown): { code?: string; message: string } => {
  for (let e = err; e instanceof Error; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return { code, message: e.message };
  }
  return { message: String(err) };
};

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    return failure(err);
  }
  throw new Error('expected the statement to be refused');
}

beforeAll(async () => {
  await truncateAll();
  const [org] = await testDb.insert(organizations)
    .values({ name: 'Audit Org', slug: `audit-${Date.now()}` }).returning();
  orgId = org.id;
  await withOrgContext(testDb, orgId, (tx) => withAudit(tx, async () => ({ id: recordId }), {
    orgId, userId: 'user-audit', action: 'CREATE', tableName: 'orders', changes: { total: 5n },
  }));
  const [row] = await testDb.select().from(auditLog).where(eq(auditLog.orgId, orgId));
  rowId = row.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe('audit_log v2 columns', () => {
  it('a pre-v2 withAudit call writes user/admin/success, and the insert trigger fills actor_id and resource_id', async () => {
    const [row] = await testDb.select().from(auditLog).where(eq(auditLog.id, rowId));
    expect(row).toMatchObject({
      actorKind: 'user', channel: 'admin', outcome: 'success',
      userId: 'user-audit', actorId: 'user-audit',
      recordId, resourceId: recordId,
      changes: { total: '5' },
    });
  });
});

describe('audit_log is append-only', () => {
  it('refuses UPDATE as irth_app', async () => {
    const err = await refusal(() => withOrgContext(testDb, orgId, (tx) =>
      tx.update(auditLog).set({ action: 'TAMPERED' }).where(eq(auditLog.id, rowId))));
    expect(err.code).toBe('42501');
  });

  it('refuses DELETE as irth_app', async () => {
    const err = await refusal(() => withOrgContext(testDb, orgId, (tx) =>
      tx.delete(auditLog).where(eq(auditLog.id, rowId))));
    expect(err.code).toBe('42501');
  });

  it('refuses UPDATE as the owner connection (trigger, not grants)', async () => {
    const err = await refusal(() => testDb.update(auditLog).set({ action: 'TAMPERED' }).where(eq(auditLog.id, rowId)));
    expect(err.code).toBe('42501');
    expect(err.message).toMatch(/append-only/);
  });

  it('refuses DELETE as the owner connection (trigger, not grants)', async () => {
    const err = await refusal(() => testDb.delete(auditLog).where(eq(auditLog.id, rowId)));
    expect(err.code).toBe('42501');
    expect(err.message).toMatch(/append-only/);
  });

  it('the row is unchanged after every attempt', async () => {
    const rows = await testDb.select().from(auditLog).where(eq(auditLog.id, rowId));
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('CREATE');
  });
});
