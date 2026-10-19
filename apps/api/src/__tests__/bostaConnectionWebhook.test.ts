/**
 * Per-tenant Bosta webhook: /bosta/:orgId/:connectionId verifies the signature
 * against THAT connection's own secret and pins the lookup to its org, so a
 * secret held by one merchant cannot forge another merchant's deliveries.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import * as dbExports from '@irth/db';

vi.mock('../db', () => ({ db: { select: vi.fn() }, getDb: vi.fn(), getEnv: () => ({}) }));
vi.mock('../integrations/kernel/secrets', () => ({ readConnectionSecret: vi.fn() }));
vi.mock('../routes/webhooks/resolveCourierShipmentByTracking', () => ({
  resolveCourierShipmentByTracking: vi.fn(async () => ({ status: 'none', shipment: null })),
}));

import { readConnectionSecret } from '../integrations/kernel/secrets';
import { resolveCourierShipmentByTracking } from '../routes/webhooks/resolveCourierShipmentByTracking';
import { bostaWebhookRoute } from '../routes/webhooks/bosta-webhook';

const orgId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const connectionId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'limit']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function post(path: string, signatureSecret: string) {
  const body = JSON.stringify({ data: { trackingNumber: 'T1', state: 'DELIVERED' } });
  const app = new Hono();
  app.route('/', bostaWebhookRoute);
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Bosta-Signature': await sign(signatureSecret, body) },
    body,
  });
}

function stubConnection(found: boolean) {
  vi.spyOn(dbExports, 'withOrgContext').mockImplementation((_d, _o, fn) =>
    (fn as (tx: unknown) => Promise<unknown>)(chainable(found ? [{ id: connectionId }] : [])));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('bosta per-connection webhook', () => {
  it('rejects a signature made with a different secret', async () => {
    stubConnection(true);
    vi.mocked(readConnectionSecret).mockResolvedValue('tenant-a-secret');
    const res = await post(`/${orgId}/${connectionId}`, 'tenant-b-secret');
    expect(res.status).toBe(401);
    expect(resolveCourierShipmentByTracking).not.toHaveBeenCalled();
  });

  it('accepts the connection secret and pins the shipment lookup to the path org', async () => {
    stubConnection(true);
    vi.mocked(readConnectionSecret).mockResolvedValue('tenant-a-secret');
    const res = await post(`/${orgId}/${connectionId}`, 'tenant-a-secret');
    expect(res.status).not.toBe(401);
    expect(resolveCourierShipmentByTracking).toHaveBeenCalledWith(expect.anything(), 'bosta', 'T1', orgId);
  });

  it('refuses an unknown or inactive connection without trying any secret', async () => {
    stubConnection(false);
    const res = await post(`/${orgId}/${connectionId}`, 'anything');
    expect(res.status).toBe(500);
    expect(readConnectionSecret).not.toHaveBeenCalled();
  });

  it('refuses malformed ids before touching the database', async () => {
    const spy = vi.spyOn(dbExports, 'withOrgContext');
    const res = await post('/not-a-uuid/also-not', 'x');
    expect(res.status).toBe(500);
    expect(spy).not.toHaveBeenCalled();
  });
});
