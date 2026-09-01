import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../db';
import { orders, auditLog, withIdempotency, withOrgContext, IdempotencyError } from '@irth/db';
import { eq, and, inArray } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { envVar } from '../../utils/env';

const paymobRoute = new Hono();

paymobRoute.post('/', async (c: Context) => {
  // Request-time read through the captured Worker env — process.env is empty
  // on Workers (see db.ts), so this secret was previously always undefined.
  const hmacSecret = envVar('PAYMOB_HMAC_SECRET');
  if (!hmacSecret) {
    return c.json({ data: null, error: 'hmac_secret_not_configured', meta: null }, 500);
  }

  const hmacHeader = c.req.header('hmac');
  if (!hmacHeader) {
    return c.json({ data: null, error: 'missing_hmac', meta: null }, 401);
  }

  const bodyRaw = await c.req.text();

  // The `hmac` header is checked below, but only after the concatenated-field
  // string is built from `body` — so a malformed payload must be rejected
  // before that point, not left to throw uncaught mid-handler.
  let body;
  try {
    body = JSON.parse(bodyRaw);
  } catch {
    return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  }

  const { obj } = body;
  if (!obj) {
      return c.json({ data: null, error: 'invalid_payload', meta: null }, 400);
  }

  const lexoKeys = [
    'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
    'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
    'is_standalone_payment', 'is_voided', 'order', 'owner', 'pending', 'source_data.pan',
    'source_data.sub_type', 'source_data.type', 'success'
  ];
  
  let concatenatedString = '';
  for (const key of lexoKeys) {
      const parts = key.split('.');
      let val = obj;
      for (const p of parts) {
          val = val?.[p];
      }
      concatenatedString += val ?? '';
  }

  const expected = crypto.createHmac('sha512', hmacSecret).update(concatenatedString).digest('hex');
  const sigBuf = Buffer.from(hmacHeader, 'hex');
  const expBuf = Buffer.from(expected, 'hex');

  const hashedSig = crypto.createHash('sha256').update(sigBuf).digest();
  const hashedExp = crypto.createHash('sha256').update(expBuf).digest();

  if (!crypto.timingSafeEqual(hashedSig, hashedExp)) {
    return c.json({ data: null, error: 'invalid_hmac', meta: null }, 401);
  }

  const orderIdFromPaymob = obj.order?.merchant_order_id as string | undefined;
  if (!orderIdFromPaymob) {
    return c.json({ data: null, error: 'missing_order_id', meta: null }, 400);
  }

  // merchant_order_id MUST be orders.id (a globally-unique uuid), never
  // orders.orderNumber. orderNumber is unique only PER ORG (uniqueIndex on
  // (orgId, orderNumber), migration 0035) — two orgs can share
  // "IRT-2026-0001". A lookup keyed on orderNumber alone cannot distinguish
  // them and resolves to whichever org's row happens to match, confirming or
  // failing payment for the WRONG tenant's order. Nothing in this repository
  // currently creates a Paymob payment intention (i.e. nothing sets
  // merchant_order_id) — whoever wires up Paymob checkout MUST pass
  // `orders.id`, never `orders.orderNumber`, as merchant_order_id.
  if (!z.string().uuid().safeParse(orderIdFromPaymob).success) {
    return c.json({ data: null, error: 'invalid_order_id', meta: null }, 400);
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderIdFromPaymob));
  if (!order) {
    return c.json({ data: null, error: 'order_not_found', meta: null }, 404);
  }

  const isSuccess = obj.success === true;
  const newStatus = isSuccess ? 'confirmed' : 'payment_failed';
  const allowedCurrentStatuses = isSuccess ? (['pending', 'payment_failed'] as const) : (['pending'] as const);

  try {
    await withIdempotency(
      db,
      { orgId: order.orgId, operation: 'paymob.webhook', key: String(obj.id), request: obj },
      () => withOrgContext(db, order.orgId, async (tx) => {
        const [updatedOrder] = await tx.update(orders)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(and(
            eq(orders.id, order.id),
            eq(orders.orgId, order.orgId),
            inArray(orders.status, allowedCurrentStatuses),
          ))
          .returning();

        if (!updatedOrder) {
          return { success: true };
        }

        await tx.insert(auditLog).values({
          orgId: order.orgId,
          userId: null,
          action: 'PAYMOB_WEBHOOK',
          tableName: 'orders',
          recordId: order.id,
          changes: { oldStatus: order.status, newStatus, paymobPayload: obj }
        });

        return { success: true };
      }),
    );
  } catch (err) {
    if (err instanceof IdempotencyError) {
      return c.json(
        { data: null, error: err.message, meta: null },
        err.code === 'CONFLICT' ? 409 : 400,
      );
    }
    throw err;
  }

  return c.json({ data: { success: true }, error: null, meta: null });
});

export { paymobRoute };
