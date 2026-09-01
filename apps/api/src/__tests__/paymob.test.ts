/**
 * Paymob webhook order-resolution fix.
 *
 * `merchant_order_id` used to be looked up against `orders.orderNumber`,
 * which is unique only PER ORG (uniqueIndex on (org_id, order_number),
 * migration 0035) — two different orgs can have an order numbered
 * "IRT-2026-0001". The lookup resolved to whichever org's row matched
 * first, confirming or failing payment for the WRONG tenant's order.
 *
 * The fix requires `merchant_order_id` to be `orders.id` (a globally-unique
 * uuid) and rejects anything that isn't a well-formed uuid before it ever
 * reaches the database. The "core regression" test below mocks two orders
 * that share an orderNumber across two different orgs and proves the
 * update/audit calls land on the right one.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import crypto from 'node:crypto';
import { eq, and, inArray } from 'drizzle-orm';
import { orders } from '@irth/db';

// Populated per-test, consumed/inspected in call order by the mocked `db`
// below. Reset in the top of each test that cares about it.
let selectQueue: unknown[][] = [];
let updateQueue: unknown[][] = [];
let selectWhereArgs: unknown[] = [];
let updateWhereArgs: unknown[] = [];
let updateSetArgs: unknown[] = [];
let insertValuesArgs: unknown[] = [];

type IdempotencyArgs = {
  orgId: string;
  operation: string;
  key: string | undefined;
  request: unknown;
};

let idempotencyCalls: IdempotencyArgs[] = [];
let idempotencyCache = new Map<string, { request: string; response: unknown }>();
let orgContextOrgIds: string[] = [];

vi.mock('@irth/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/db')>();
  return {
    ...actual,
    withIdempotency: vi.fn(async (_db: unknown, args: IdempotencyArgs, operation: () => Promise<unknown>) => {
      idempotencyCalls.push(args);
      if (args.key === undefined) return operation();

      const cacheKey = [args.orgId, args.operation, args.key].join(':');
      const request = JSON.stringify(args.request);
      const cached = idempotencyCache.get(cacheKey);
      if (cached) {
        if (cached.request !== request) throw new actual.IdempotencyError('different request', 'BAD_REQUEST');
        return cached.response;
      }

      const response = await operation();
      idempotencyCache.set(cacheKey, { request, response });
      return response;
    }),
    withOrgContext: vi.fn(async (dbInstance: unknown, orgId: string, operation: (tx: unknown) => Promise<unknown>) => {
      orgContextOrgIds.push(orgId);
      return operation(dbInstance);
    }),
  };
});

vi.mock('../db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((cond: unknown) => {
          selectWhereArgs.push(cond);
          return Promise.resolve(selectQueue.shift() ?? []);
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: unknown) => {
        updateSetArgs.push(vals);
        return {
          where: vi.fn((cond: unknown) => {
            updateWhereArgs.push(cond);
            return {
              returning: vi.fn(() => Promise.resolve(updateQueue.shift() ?? [])),
            };
          }),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        insertValuesArgs.push(vals);
        return Promise.resolve(undefined);
      }),
    })),
  },
  // envVar() (apps/api/src/utils/env.ts) reads getEnv() first and falls back
  // to process.env — returning null here forces every test onto the
  // process.env path, which each test controls directly.
  getEnv: () => null,
}));

import { paymobRoute } from '../routes/webhooks/paymob';

function buildApp() {
  const app = new Hono();
  app.route('/webhooks/paymob', paymobRoute);
  return app;
}

const SECRET = 'test-paymob-hmac-secret';

// Mirrors the exact `lexoKeys` list and concatenation logic in
// routes/webhooks/paymob.ts, so tests can produce a signature the route's
// own HMAC check will accept.
const LEXO_KEYS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
  'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
  'is_standalone_payment', 'is_voided', 'order', 'owner', 'pending', 'source_data.pan',
  'source_data.sub_type', 'source_data.type', 'success',
];

function computeHmac(obj: Record<string, unknown>, secret: string): string {
  let concatenated = '';
  for (const key of LEXO_KEYS) {
    const parts = key.split('.');
    let val: unknown = obj;
    for (const p of parts) {
      val = (val as Record<string, unknown> | undefined)?.[p];
    }
    concatenated += (val ?? '') as string;
  }
  return crypto.createHmac('sha512', secret).update(concatenated).digest('hex');
}

function buildObj(merchantOrderId: string | undefined, success = true): Record<string, unknown> {
  return {
    amount_cents: 10000,
    created_at: '2026-01-01T00:00:00Z',
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 123456,
    integration_id: 1,
    is_3d_secure: false,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: merchantOrderId !== undefined ? { merchant_order_id: merchantOrderId } : {},
    owner: 999,
    pending: false,
    source_data: { pan: '1234', sub_type: 'Visa', type: 'card' },
    success,
  };
}

async function postWebhook(
  body: unknown,
  opts: { hmac?: string; rawBody?: string } = {},
) {
  const rawBody = opts.rawBody ?? JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.hmac !== undefined) headers['hmac'] = opts.hmac;
  return buildApp().request('/webhooks/paymob', { method: 'POST', headers, body: rawBody });
}

beforeEach(() => {
  selectQueue = [];
  updateQueue = [];
  selectWhereArgs = [];
  updateWhereArgs = [];
  updateSetArgs = [];
  insertValuesArgs = [];
  idempotencyCalls = [];
  idempotencyCache = new Map<string, { request: string; response: unknown }>();
  orgContextOrgIds = [];
  delete process.env.PAYMOB_HMAC_SECRET;
});

describe('paymob webhook — pre-order-lookup guards', () => {
  it('returns 500 hmac_secret_not_configured when PAYMOB_HMAC_SECRET is unset', async () => {
    const res = await postWebhook({});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ data: null, error: 'hmac_secret_not_configured', meta: null });
  });

  it('returns 401 missing_hmac when the hmac header is absent', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    const res = await postWebhook({});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ data: null, error: 'missing_hmac', meta: null });
  });

  it('returns 400 invalid_json on an unparsable body', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    const res = await postWebhook(undefined, { hmac: 'irrelevant', rawBody: '{not-json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ data: null, error: 'invalid_json', meta: null });
  });

  it('returns 400 invalid_payload when `obj` is missing', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    const res = await postWebhook({ notObj: true }, { hmac: 'irrelevant' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ data: null, error: 'invalid_payload', meta: null });
  });

  it('returns 401 invalid_hmac when the signature does not match', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    const obj = buildObj('11111111-1111-4111-8111-111111111111');
    // A genuinely valid signature first — proves the tamper below is what
    // trips the rejection, not a signature that was never going to verify.
    const validHmac = computeHmac(obj, SECRET);
    const tamperedHmac = validHmac.slice(0, -1) + (validHmac.at(-1) === '0' ? '1' : '0');

    const res = await postWebhook({ obj }, { hmac: tamperedHmac });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ data: null, error: 'invalid_hmac', meta: null });
  });
});

describe('paymob webhook — order id validation (post-fix)', () => {
  it('returns 400 missing_order_id when merchant_order_id is absent', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    const obj = buildObj(undefined);
    const hmac = computeHmac(obj, SECRET);

    const res = await postWebhook({ obj }, { hmac });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ data: null, error: 'missing_order_id', meta: null });
  });

  // Regression: proves the old vulnerable orderNumber-keyed lookup is gone.
  // An order-number-shaped string must be rejected before it ever reaches
  // the database, not silently accepted and looked up by orderNumber.
  it('returns 400 invalid_order_id when merchant_order_id looks like an order number, not a uuid', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    const obj = buildObj('IRT-2026-0001');
    const hmac = computeHmac(obj, SECRET);

    const res = await postWebhook({ obj }, { hmac });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ data: null, error: 'invalid_order_id', meta: null });
    expect(selectWhereArgs).toHaveLength(0); // never touched the database
  });

  it('returns 404 order_not_found for a well-formed uuid with no matching row', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    selectQueue = [[]];
    const orderId = '11111111-1111-4111-8111-111111111111';
    const obj = buildObj(orderId);
    const hmac = computeHmac(obj, SECRET);

    const res = await postWebhook({ obj }, { hmac });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ data: null, error: 'order_not_found', meta: null });
    expect(selectWhereArgs[0]).toEqual(eq(orders.id, orderId));
  });
});

describe('paymob webhook — cross-tenant regression', () => {
  const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ORDER_A_ID = 'aaaaaaa1-0000-4000-8000-000000000001';
  const ORDER_B_ID = 'bbbbbbb1-0000-4000-8000-000000000001';
  const SHARED_ORDER_NUMBER = 'IRT-2026-0001';

  it('confirms org B\'s order, never org A\'s, when both orgs share the same orderNumber', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;

    const orderA = { id: ORDER_A_ID, orgId: ORG_A, orderNumber: SHARED_ORDER_NUMBER, status: 'pending' };
    const orderB = { id: ORDER_B_ID, orgId: ORG_B, orderNumber: SHARED_ORDER_NUMBER, status: 'pending' };
    // Sanity: the fixture is genuinely cross-tenant, not two identical rows.
    expect(orderA.orgId).not.toBe(orderB.orgId);
    expect(orderA.orderNumber).toBe(orderB.orderNumber);

    // merchant_order_id = orderB.id. The lookup is keyed on orders.id (a
    // globally-unique uuid), so only order B's row can ever come back —
    // there is no way for the mocked DB layer to hand back order A's row by
    // mistake the way the old orderNumber-keyed lookup could.
    selectQueue = [[orderB]];
    updateQueue = [[{ ...orderB, status: 'confirmed' }]];

    const obj = buildObj(ORDER_B_ID, true);
    const hmac = computeHmac(obj, SECRET);

    const res = await postWebhook({ obj }, { hmac });
    expect(res.status).toBe(200);

    // The select itself must be keyed by orders.id, never orders.orderNumber.
    expect(selectWhereArgs[0]).toEqual(eq(orders.id, ORDER_B_ID));
    expect(selectWhereArgs[0]).not.toEqual(eq(orders.orderNumber, SHARED_ORDER_NUMBER));

    // The update and the audit insert must reference org B's id/orgId —
    // never org A's, even though both orders share an orderNumber.
    expect(updateWhereArgs[0]).toEqual(and(
      eq(orders.id, ORDER_B_ID),
      eq(orders.orgId, ORG_B),
      inArray(orders.status, ['pending', 'payment_failed']),
    ));
    expect(updateWhereArgs[0]).not.toEqual(and(eq(orders.id, ORDER_A_ID), eq(orders.orgId, ORG_A)));

    expect(insertValuesArgs[0]).toMatchObject({ orgId: ORG_B, recordId: ORDER_B_ID });
    expect(insertValuesArgs[0]).not.toMatchObject({ orgId: ORG_A });
  });
});

describe('paymob webhook — status transitions', () => {
  const ORDER_ID = '22222222-2222-4222-8222-222222222222';
  const ORG_ID = '33333333-3333-4333-8333-333333333333';

  it('marks the order confirmed on success:true and records it in the audit log', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    const order = { id: ORDER_ID, orgId: ORG_ID, orderNumber: 'IRT-2026-0002', status: 'pending' };
    selectQueue = [[order]];
    updateQueue = [[{ ...order, status: 'confirmed' }]];

    const obj = buildObj(ORDER_ID, true);
    const hmac = computeHmac(obj, SECRET);

    const res = await postWebhook({ obj }, { hmac });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { success: true }, error: null, meta: null });

    expect(updateSetArgs[0]).toMatchObject({ status: 'confirmed' });
    expect(insertValuesArgs[0]).toMatchObject({
      changes: expect.objectContaining({ newStatus: 'confirmed' }),
    });
  });

  it('marks the order payment_failed on success:false and records it in the audit log', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    const order = { id: ORDER_ID, orgId: ORG_ID, orderNumber: 'IRT-2026-0003', status: 'pending' };
    selectQueue = [[order]];
    updateQueue = [[{ ...order, status: 'payment_failed' }]];

    const obj = buildObj(ORDER_ID, false);
    const hmac = computeHmac(obj, SECRET);

    const res = await postWebhook({ obj }, { hmac });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { success: true }, error: null, meta: null });

    expect(updateSetArgs[0]).toMatchObject({ status: 'payment_failed' });
    expect(insertValuesArgs[0]).toMatchObject({
      changes: expect.objectContaining({ newStatus: 'payment_failed' }),
    });
  });

  it('uses Paymob transaction id as the idempotency key and does not reapply a redelivery', async () => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    const order = { id: ORDER_ID, orgId: ORG_ID, orderNumber: 'IRT-2026-0004', status: 'pending' };
    selectQueue = [[order], [order]];
    updateQueue = [[{ ...order, status: 'confirmed' }]];

    const obj = buildObj(ORDER_ID, true);
    const hmac = computeHmac(obj, SECRET);

    const first = await postWebhook({ obj }, { hmac });
    const second = await postWebhook({ obj }, { hmac });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(updateSetArgs).toHaveLength(1);
    expect(insertValuesArgs).toHaveLength(1);
    expect(orgContextOrgIds).toEqual([ORG_ID]);
    expect(idempotencyCalls).toHaveLength(2);
    expect(idempotencyCalls[0]).toMatchObject({
      orgId: ORG_ID,
      operation: 'paymob.webhook',
      key: '123456',
      request: obj,
    });
  });

  it.each(['shipped', 'delivered', 'cancelled'] as const)(
    'does not regress a %s order to confirmed on a stale success callback',
    async (status) => {
      process.env.PAYMOB_HMAC_SECRET = SECRET;
      const order = { id: ORDER_ID, orgId: ORG_ID, orderNumber: 'IRT-2026-0005', status };
      selectQueue = [[order]];
      updateQueue = [[]];

      const obj = buildObj(ORDER_ID, true);
      const hmac = computeHmac(obj, SECRET);

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { success: true }, error: null, meta: null });

      expect(updateSetArgs[0]).toMatchObject({ status: 'confirmed' });
      expect(updateWhereArgs[0]).toEqual(and(
        eq(orders.id, ORDER_ID),
        eq(orders.orgId, ORG_ID),
        inArray(orders.status, ['pending', 'payment_failed']),
      ));
      expect(insertValuesArgs).toHaveLength(0);
    },
  );

  it.each(['shipped', 'delivered', 'cancelled'] as const)(
    'does not regress a %s order to payment_failed on a stale failure callback',
    async (status) => {
      process.env.PAYMOB_HMAC_SECRET = SECRET;
      const order = { id: ORDER_ID, orgId: ORG_ID, orderNumber: 'IRT-2026-0006', status };
      selectQueue = [[order]];
      updateQueue = [[]];

      const obj = buildObj(ORDER_ID, false);
      const hmac = computeHmac(obj, SECRET);

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { success: true }, error: null, meta: null });

      expect(updateSetArgs[0]).toMatchObject({ status: 'payment_failed' });
      expect(updateWhereArgs[0]).toEqual(and(
        eq(orders.id, ORDER_ID),
        eq(orders.orgId, ORG_ID),
        inArray(orders.status, ['pending']),
      ));
      expect(insertValuesArgs).toHaveLength(0);
    },
  );
});
