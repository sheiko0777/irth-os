/**
 * CX-07 / migration 0083 against real Postgres:
 *  - RLS: an org sees and writes only its own connections and secrets, and a
 *    secret cannot be attached to another org's connection (composite FK).
 *  - No plaintext at rest: the stored row never contains the value.
 *  - KEK rotation: rows sealed under V1 stay readable by key_version while V2
 *    is current; rotateConnectionSecrets re-wraps them and they then decrypt
 *    with V2 alone.
 *  - create / set / rotate / delete / disable are audited, without values.
 * KEKs are random per run; nothing here is a real credential.
 */
import { Buffer } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLog, connectionSecrets, connections, createConnection, deleteConnectionSecret, disableConnection,
  listConnections, organizations, withOrgContext,
} from '@irth/db';
import { getConnectionSecret, keyringFromEnv, putConnectionSecret, rotateConnectionSecrets } from '@irth/db/src/secrets';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

const v1 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const v2 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const keyringV1 = keyringFromEnv((k) => ({ CONNECTION_SECRETS_KEY_V1: v1 } as Record<string, string>)[k]);
const keyringBoth = keyringFromEnv((k) => ({ CONNECTION_SECRETS_KEY_VERSION: '2', CONNECTION_SECRETS_KEY_V1: v1, CONNECTION_SECRETS_KEY_V2: v2 } as Record<string, string>)[k]);
const keyringV2 = keyringFromEnv((k) => ({ CONNECTION_SECRETS_KEY_VERSION: '2', CONNECTION_SECRETS_KEY_V2: v2 } as Record<string, string>)[k]);

const VALUE_A = 'test-only-org-a-value-0001';
const VALUE_B = 'test-only-org-b-value-0002';

let orgA: string;
let orgB: string;
let connA: string;
let connB: string;
const ctx = (orgId: string) => ({ orgId, userId: null, actorKind: 'system' as const, channel: 'api' as const });

beforeAll(async () => {
  await truncateAll();
  const [a] = await testDb.insert(organizations).values({ name: 'Conn A', slug: `conn-a-${Date.now()}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Conn B', slug: `conn-b-${Date.now()}` }).returning();
  orgA = a.id;
  orgB = b.id;
  connA = await withOrgContext(testDb, orgA, async (tx) => {
    const c = await createConnection(tx, ctx(orgA), { provider: 'bosta', family: 'courier', name: 'Bosta A' });
    await putConnectionSecret(tx, ctx(orgA), keyringV1, { connectionId: c.id, name: 'api_key', value: VALUE_A });
    return c.id;
  });
  connB = await withOrgContext(testDb, orgB, async (tx) => {
    const c = await createConnection(tx, ctx(orgB), { provider: 'bosta', family: 'courier', name: 'Bosta B' });
    await putConnectionSecret(tx, ctx(orgB), keyringV1, { connectionId: c.id, name: 'api_key', value: VALUE_B });
    return c.id;
  });
});

afterAll(async () => {
  await closeTestDb();
});

describe('connections + connection_secrets (0083)', () => {
  it('an org lists only its own connections, with secret metadata and no values', async () => {
    const list = await withOrgContext(testDb, orgA, (tx) => listConnections(tx, ctx(orgA)));
    expect(list.map((c) => c.id)).toEqual([connA]);
    expect(list[0].secrets).toEqual([expect.objectContaining({ name: 'api_key', keyVersion: 1, last4: '0001' })]);
    expect(JSON.stringify(list)).not.toContain(VALUE_A);
    expect(JSON.stringify(list)).not.toMatch(/ciphertext|wrappedDek|dekIv/);
  });

  it('RLS hides the other org rows even without a WHERE', async () => {
    const seen = await withOrgContext(testDb, orgA, async (tx) => ({
      conns: await tx.select({ id: connections.id }).from(connections),
      secrets: await tx.select({ id: connectionSecrets.id, orgId: connectionSecrets.orgId }).from(connectionSecrets),
    }));
    expect(seen.conns.map((r) => r.id)).toEqual([connA]);
    expect(seen.secrets.every((r) => r.orgId === orgA)).toBe(true);
    const fromB = await withOrgContext(testDb, orgA, (tx) => getConnectionSecret(tx, keyringV1, { orgId: orgB, connectionId: connB, name: 'api_key' }));
    expect(fromB).toBeNull();
  });

  it("refuses a secret on another org's connection", async () => {
    await expect(withOrgContext(testDb, orgA, (tx) =>
      putConnectionSecret(tx, ctx(orgA), keyringV1, { connectionId: connB, name: 'webhook_secret', value: 'test-only-x' }),
    )).rejects.toBeTruthy();
  });

  it('stores no plaintext at rest', async () => {
    const rows = await testDb.select().from(connectionSecrets);
    expect(rows).toHaveLength(2);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(VALUE_A);
    expect(dump).not.toContain(VALUE_B);
    for (const r of rows) {
      expect(Buffer.from(r.ciphertext, 'base64').toString('utf8')).not.toContain('test-only');
    }
  });

  it('rotation keeps V1 rows readable by key_version, then re-wraps them to V2', async () => {
    // A value written while V2 is current sits beside the V1 rows.
    await withOrgContext(testDb, orgA, (tx) =>
      putConnectionSecret(tx, ctx(orgA), keyringBoth, { connectionId: connA, name: 'webhook_secret', value: 'test-only-webhook-v2' }));
    const read = (orgId: string, connectionId: string, name: string, keyring = keyringBoth) =>
      withOrgContext(testDb, orgId, (tx) => getConnectionSecret(tx, keyring, { orgId, connectionId, name }));

    expect(await read(orgA, connA, 'api_key')).toBe(VALUE_A);
    expect(await read(orgA, connA, 'webhook_secret')).toBe('test-only-webhook-v2');
    await expect(read(orgA, connA, 'api_key', keyringV2)).rejects.toThrow('CONNECTION_SECRETS_KEY_V1');

    const before = await testDb.select().from(connectionSecrets).where(eq(connectionSecrets.keyVersion, 1));
    // The rotation job runs on the owner connection (BYPASSRLS): every org in one pass.
    const rotated = await testDb.transaction((tx) => rotateConnectionSecrets(tx, keyringBoth, { fromVersion: 1, toVersion: 2 }));
    expect(rotated).toBe(2);

    const after = await testDb.select().from(connectionSecrets);
    expect(after.every((r) => r.keyVersion === 2)).toBe(true);
    for (const b of before) {
      const a = after.find((r) => r.id === b.id)!;
      expect(a.ciphertext).toBe(b.ciphertext);
      expect(a.wrappedDek).not.toBe(b.wrappedDek);
    }
    expect(await read(orgA, connA, 'api_key', keyringV2)).toBe(VALUE_A);
    expect(await read(orgB, connB, 'api_key', keyringV2)).toBe(VALUE_B);

    const kekAudit = await testDb.select().from(auditLog).where(eq(auditLog.action, 'CONNECTION_SECRETS_KEK_ROTATED'));
    expect(kekAudit.map((r) => r.orgId).sort()).toEqual([orgA, orgB].sort());
  });

  it('rotating a value, deleting a secret and disabling a connection are audited without values', async () => {
    const result = await withOrgContext(testDb, orgA, async (tx) => {
      const put = await putConnectionSecret(tx, ctx(orgA), keyringV2, { connectionId: connA, name: 'api_key', value: 'test-only-new-value-9999' });
      const deleted = await deleteConnectionSecret(tx, ctx(orgA), connA, 'webhook_secret');
      const disabled = await disableConnection(tx, ctx(orgA), connA, 'test');
      return { put, deleted, disabled };
    });
    expect(result.put).toMatchObject({ rotated: true, keyVersion: 2, last4: '9999' });
    expect(result.deleted).toBe(true);
    expect(result.disabled.status).toBe('disabled');

    const audit = await testDb.select().from(auditLog).where(eq(auditLog.orgId, orgA));
    const actions = audit.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining([
      'CONNECTION_CREATED', 'CONNECTION_SECRET_SET', 'CONNECTION_SECRET_ROTATED', 'CONNECTION_SECRET_DELETED', 'CONNECTION_DISABLED',
    ]));
    expect(JSON.stringify(audit)).not.toMatch(/test-only-(org-a|new|webhook)/);
  });
});
