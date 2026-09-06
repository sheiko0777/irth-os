import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { orders } from '@irth/db';

let selectQueue: unknown[][] = [];
let selectWhereArgs: unknown[] = [];
let insertValuesArgs: unknown[] = [];
let updateSetArgs: unknown[] = [];
let updateWhereArgs: unknown[] = [];
let transitionArgs: unknown[] = [];

vi.mock('../db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        insertValuesArgs.push(vals);
        return Promise.resolve();
      }),
    })),
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
            return Promise.resolve();
          }),
        };
      }),
    })),
  },
}));

vi.mock('@irth/db/src/orderLedger', () => ({
  __esModule: true,
  transitionOrderStatus: vi.fn((db: any, args: any) => {
    transitionArgs.push(args);
    return Promise.resolve({ previousStatus: 'pending' });
  }),
}));

vi.mock('../utils/env', () => ({
  envVar: vi.fn((key: string) => {
    if (key === 'PAYMOB_HMAC_SECRET') return process.env.PAYMOB_HMAC_SECRET;
    return undefined;
  }),
}));

import { paymobRoute } from '../routes/webhooks/paymob';

const SECRET = 'test-secret';
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

function buildObj(merchantOrderId: string | undefined, success = true, amount_cents = 10000, currency = 'EGP', pending = false, is_refunded = false, is_voided = false): Record<string, unknown> {
  return {
    amount_cents,
    created_at: '2026-01-01T00:00:00Z',
    currency,
    error_occured: false,
    has_parent_transaction: false,
    id: 123456,
    integration_id: 1,
    is_3d_secure: false,
    is_auth: false,
    is_capture: false,
    is_refunded,
    is_standalone_payment: true,
    is_voided,
    order: merchantOrderId !== undefined ? { merchant_order_id: merchantOrderId } : {},
    owner: 999,
    pending,
    source_data: { pan: '1234', sub_type: 'Visa', type: 'card' },
    success,
  };
}

async function postWebhook(payload: unknown, headers: Record<string, string> = {}) {
  const app = new Hono();
  app.route('/', paymobRoute);

  const req = new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  return app.request(req);
}

describe('paymob webhook', () => {
  beforeEach(() => {
    process.env.PAYMOB_HMAC_SECRET = SECRET;
    selectQueue = [];
    selectWhereArgs = [];
    insertValuesArgs = [];
    updateSetArgs = [];
    updateWhereArgs = [];
    transitionArgs = [];
  });

  afterEach(() => {
    delete process.env.PAYMOB_HMAC_SECRET;
  });

  describe('pre-order-lookup guards', () => {
    it('returns 500 hmac_secret_not_configured when PAYMOB_HMAC_SECRET is unset', async () => {
      delete process.env.PAYMOB_HMAC_SECRET;
      const res = await postWebhook({});
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ data: null, error: 'hmac_secret_not_configured', meta: null });
    });

    it('returns 401 missing_hmac when the hmac header is absent', async () => {
      const res = await postWebhook({});
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ data: null, error: 'missing_hmac', meta: null });
    });

    it('returns 400 invalid_json on an unparsable body', async () => {
      const app = new Hono();
      app.route('/', paymobRoute);
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { hmac: 'anything' },
        body: '{ this is not json }',
      });
      const res = await app.request(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ data: null, error: 'invalid_json', meta: null });
    });

    it('returns 400 invalid_payload when `obj` is missing', async () => {
      const res = await postWebhook({ other: true }, { hmac: 'anything' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ data: null, error: 'invalid_payload', meta: null });
    });

    it('returns 401 invalid_hmac when the signature does not match', async () => {
      const res = await postWebhook({ obj: buildObj('123') }, { hmac: 'bad' });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ data: null, error: 'invalid_hmac', meta: null });
    });
  });

  describe('order id validation', () => {
    it('returns 400 missing_order_id when merchant_order_id is absent', async () => {
      const obj = buildObj(undefined);
      const hmac = computeHmac(obj, SECRET);
      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ data: null, error: 'missing_order_id', meta: null });
    });

    it('returns 400 invalid_order_id when merchant_order_id looks like an order number, not a uuid', async () => {
      const obj = buildObj('IRT-2026-0001');
      const hmac = computeHmac(obj, SECRET);
      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ data: null, error: 'invalid_order_id', meta: null });
    });

    it('returns 404 order_not_found for a well-formed uuid with no matching row', async () => {
      const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      selectQueue = [[]]; // empty result
      const obj = buildObj(orderId);
      const hmac = computeHmac(obj, SECRET);

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ data: null, error: 'order_not_found', meta: null });
      expect(selectWhereArgs[0]).toEqual(eq(orders.id, orderId));
    });
  });

  describe('business logic checks', () => {
    const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const ORG_ID = 'org-b-bbbb';
    const VALID_ORDER = { id: ORDER_ID, orgId: ORG_ID, status: 'pending', totalAmountMinor: 10000n, currency: 'EGP' };

    it('confirms a valid order (genuinely new, matching, successful transaction)', async () => {
      selectQueue = [[VALID_ORDER]];
      const obj = buildObj(ORDER_ID, true);
      const hmac = computeHmac(obj, SECRET);

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(200);

      expect(transitionArgs[0]).toMatchObject({ orderId: ORDER_ID, orgId: ORG_ID, newStatus: 'confirmed' });
    });

    it('replay of the same transaction id is a no-op (still 200, no second update, no second audit row)', async () => {
      selectQueue = [[VALID_ORDER]];
      const obj = buildObj(ORDER_ID, true);
      const hmac = computeHmac(obj, SECRET);

      // We explicitly override the `insert` mock to throw a duplicate constraint error just for this test
      const { db: mockedDb } = await import('../db');
      vi.mocked(mockedDb.insert).mockImplementationOnce(() => ({
        values: vi.fn(() => Promise.reject({ code: '23505' })),
      } as any));

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(200);

      expect(transitionArgs).toHaveLength(0); // transition NOT called
    });

    it('rejects on wrong amount without confirming', async () => {
      selectQueue = [[VALID_ORDER]];
      const obj = buildObj(ORDER_ID, true, 20000); // Mismatch amount
      const hmac = computeHmac(obj, SECRET);

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(200);

      expect(transitionArgs).toHaveLength(0);
      expect(JSON.stringify(insertValuesArgs)).toContain('amount_currency_mismatch');
    });

    it('rejects on wrong currency without confirming', async () => {
      selectQueue = [[VALID_ORDER]];
      const obj = buildObj(ORDER_ID, true, 10000, 'USD'); // Mismatch currency
      const hmac = computeHmac(obj, SECRET);

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(200);

      expect(transitionArgs).toHaveLength(0);
      expect(JSON.stringify(insertValuesArgs)).toContain('amount_currency_mismatch');
    });

    it('pending: true transaction does not confirm', async () => {
      selectQueue = [[VALID_ORDER]];
      const obj = buildObj(ORDER_ID, true, 10000, 'EGP', true); // pending = true
      const hmac = computeHmac(obj, SECRET);

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(200);

      expect(transitionArgs).toHaveLength(0);
      expect(JSON.stringify(insertValuesArgs)).toContain('not_a_genuine_capture');
    });

    it('is_refunded: true transaction does not confirm', async () => {
      selectQueue = [[VALID_ORDER]];
      const obj = buildObj(ORDER_ID, true, 10000, 'EGP', false, true); // is_refunded = true
      const hmac = computeHmac(obj, SECRET);

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(200);

      expect(transitionArgs).toHaveLength(0);
      expect(JSON.stringify(insertValuesArgs)).toContain('not_a_genuine_capture');
    });

    it('records but does not confirm on success: false', async () => {
      selectQueue = [[VALID_ORDER]];
      const obj = buildObj(ORDER_ID, false);
      const hmac = computeHmac(obj, SECRET);

      const res = await postWebhook({ obj }, { hmac });
      expect(res.status).toBe(200);

      expect(transitionArgs).toHaveLength(0);
      expect(JSON.stringify(insertValuesArgs)).toContain('not_a_genuine_capture');
    });
  });
});
