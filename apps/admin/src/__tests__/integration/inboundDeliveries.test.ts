/**
 * OR-01 / migration 0084 against real Postgres: inbound_deliveries keeps the
 * exact request bytes (bytea round-trip, sha256 agrees in JS and in SQL), the
 * dedup key (provider, connection_id, delivery_key) is unique, RLS confines
 * reads and writes to the caller's org, retention defaults to 24 months
 * after receipt, and the status CHECK refuses anything off-vocabulary.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { inboundDeliveries, organizations, shopifyConnections, withOrgContext } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

// Deliberately not valid UTF-8 (0xff, a NUL): bytea must not care.
const BYTES = new Uint8Array([0x7b, 0x22, 0x69, 0x64, 0x22, 0x3a, 0x31, 0x7d, 0x00, 0xff, 0xfe]);
const SHA = createHash('sha256').update(BYTES).digest('hex');

let orgA: string;
let orgB: string;
let connA: string;

function delivery(orgId: string, connectionId: string, deliveryKey: string) {
  return {
    orgId, connectionId, deliveryKey, topic: 'orders/create',
    rawBody: BYTES, bodySha256: SHA, headers: { 'x-shopify-api-version': '2026-07' }, apiVersion: '2026-07',
  };
}

beforeAll(async () => {
  await truncateAll();
  const stamp = Date.now();
  const [a] = await testDb.insert(organizations).values({ name: 'Inbound A', slug: `inbound-a-${stamp}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Inbound B', slug: `inbound-b-${stamp}` }).returning();
  orgA = a.id;
  orgB = b.id;
  const [conn] = await testDb.insert(shopifyConnections).values({
    orgId: orgA, shopDomain: `inbound-a-${stamp}.myshopify.com`, accessTokenCiphertext: 'test-only', accessTokenIv: 'test-only',
    scopes: 'read_orders', apiVersion: '2026-07', pixelIngestionKey: `test-only-${stamp}`,
  }).returning();
  connA = conn.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe('inbound_deliveries (0084)', () => {
  it('round-trips the raw bytes exactly, and the stored sha256 matches them', async () => {
    const [row] = await withOrgContext(testDb, orgA, (tx) =>
      tx.insert(inboundDeliveries).values(delivery(orgA, connA, 'wh-bytes')).returning());
    expect(row.provider).toBe('shopify');
    expect(row.status).toBe('received');
    expect(row.attempts).toBe(0);

    const [read] = await withOrgContext(testDb, orgA, (tx) =>
      tx.select().from(inboundDeliveries).where(eq(inboundDeliveries.id, row.id)));
    expect(Buffer.from(read.rawBody).equals(Buffer.from(BYTES))).toBe(true);
    expect(createHash('sha256').update(read.rawBody).digest('hex')).toBe(read.bodySha256);

    const [db] = await testDb.execute<{ sha: string }>(sql`
      SELECT encode(sha256(raw_body), 'hex') AS sha FROM inbound_deliveries WHERE id = ${row.id}`);
    expect(db.sha).toBe(SHA);
  });

  it('rejects a second delivery with the same (provider, connection, delivery_key)', async () => {
    await testDb.insert(inboundDeliveries).values(delivery(orgA, connA, 'wh-dup'));
    await expect(testDb.insert(inboundDeliveries).values(delivery(orgA, connA, 'wh-dup')))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23505' }) });
    // Same key under another provider is a different delivery.
    await expect(testDb.insert(inboundDeliveries).values({ ...delivery(orgA, connA, 'wh-dup'), provider: 'other_provider' }))
      .resolves.toBeDefined();
  });

  it("RLS hides org A's deliveries from org B and refuses writing into org A", async () => {
    const seen = await withOrgContext(testDb, orgB, (tx) => tx.select({ id: inboundDeliveries.id }).from(inboundDeliveries));
    expect(seen).toEqual([]);
    await expect(withOrgContext(testDb, orgB, (tx) =>
      tx.insert(inboundDeliveries).values(delivery(orgA, connA, 'wh-cross')))).rejects.toBeTruthy();
    const own = await withOrgContext(testDb, orgA, (tx) => tx.select({ id: inboundDeliveries.id }).from(inboundDeliveries));
    expect(own.length).toBeGreaterThan(0);
  });

  it('retention_until defaults to received_at + 24 months', async () => {
    const [row] = await testDb.insert(inboundDeliveries).values(delivery(orgA, connA, 'wh-retention')).returning();
    const [check] = await testDb.execute<{ drift: number }>(sql`
      SELECT abs(extract(epoch FROM retention_until - (received_at + interval '24 months')::timestamptz))::float AS drift
        FROM inbound_deliveries WHERE id = ${row.id}`);
    expect(check.drift).toBeLessThan(1);
  });

  it('the CHECKs refuse an unknown status or a malformed provider', async () => {
    await expect(testDb.execute(sql`
      INSERT INTO inbound_deliveries (org_id, connection_id, delivery_key, topic, raw_body, body_sha256, status)
      VALUES (${orgA}, ${connA}, 'wh-bad-status', 'orders/create', '\\x00'::bytea, ${SHA}, 'done')`))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) });
    await expect(testDb.insert(inboundDeliveries).values({ ...delivery(orgA, connA, 'wh-bad-provider'), provider: 'Shopify!' }))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) });
  });
});
