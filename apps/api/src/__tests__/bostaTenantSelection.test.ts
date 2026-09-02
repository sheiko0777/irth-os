/**
 * The Bosta webhook picks a TENANT, not just a row.
 *
 * A webhook carries no session, so the shipment this route resolves decides
 * which org gets the status change, the audit row, the ETA e-invoice — and,
 * since postOrderDeliveredEntry was wired in, the revenue, VAT, COGS and
 * receivable postings too. A wrong pick books money into someone else's
 * ledger.
 *
 * The lookup used to be `where(trackingNumber = ?)` followed by `[shipment]`,
 * justified by a comment asserting the tracking number was "globally unique,
 * not per-org". It is not: shipment_tracking.tracking_number is a NULLABLE
 * varchar(255) with no unique constraint in any migration, and the route did
 * not even filter on `provider` despite being the Bosta-specific endpoint.
 * On a collision `[shipment]` silently took whichever row the planner
 * happened to return first.
 *
 * These tests pin the two narrowings: Bosta-only, and refuse rather than
 * guess when more than one row matches.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db', () => ({
  db: { select: vi.fn() },
  getDb: vi.fn(),
}));

// The signature check is not what is under test — bypass it and hand the
// handler the raw body it expects, exactly as verifyHmac does on success.
vi.mock('../middlewares/verifyWebhook', () => ({
  verifyHmac: () => async (c: { set: (k: string, v: unknown) => void; req: { text: () => Promise<string> } }, next: () => Promise<void>) => {
    c.set('rawBody', await c.req.text());
    await next();
  },
}));

import { db } from '../db';
import { bostaRoute } from '../routes/webhooks/bosta';

/** Minimal thenable that records the predicates it was handed. */
function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

/** Posts a webhook body through the real route, signature check bypassed. */
function post(body: unknown) {
  const app = new Hono();
  app.route('/', bostaRoute);
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const PAYLOAD = { trackingNumber: 'BOSTA-DUP-1', state: 'Delivered' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bosta webhook tenant selection', () => {
  it('refuses to guess when one tracking number matches two shipments', async () => {
    // Two orgs, one waybill number. Couriers reuse and recycle these, so this
    // is ordinary rather than exotic — and there is no correct way to choose.
    const chain = chainable([
      { id: 's1', orgId: 'org-a', orderId: 'o1', provider: 'bosta' },
      { id: 's2', orgId: 'org-b', orderId: 'o2', provider: 'bosta' },
    ]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const res = await post(PAYLOAD);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'ambiguous_tracking_number' });
  });

  it('404s rather than falling through when nothing matches', async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chainable([]));

    const res = await post(PAYLOAD);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'shipment_not_found' });
  });

  it('bounds the lookup so an ambiguous match is detectable', async () => {
    // limit(2) is what makes "more than one" observable at all. limit(1), or
    // no limit with `[shipment]`, both collapse a collision into a silent
    // arbitrary pick.
    const chain = chainable([]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await post(PAYLOAD);

    expect(chain.limit).toHaveBeenCalledWith(2);
  });
});
