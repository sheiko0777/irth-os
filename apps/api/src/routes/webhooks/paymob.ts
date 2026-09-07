import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../db';
import { orders, auditLog, paymobWebhookDeliveries, transitionOrderStatus } from '@irth/db';
import { eq, and } from 'drizzle-orm';
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

  const transactionId = String(obj.id);

  // Idempotency: Insert transaction first to claim the delivery, catch unique violation
  // to detect re-delivery of the same transaction id.
  try {
    await db.insert(paymobWebhookDeliveries).values({
      orgId: order.orgId,
      orderId: order.id,
      transactionId,
      payload: obj,
      status: 'processed'
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      // It's a duplicate delivery, return 200 without reprocessing.
      return c.json({ data: { success: true }, error: null, meta: null });
    }
    throw err;
  }

  // Amount/currency check
  // Compare amount and currency. Both must match. amount_cents arrives as a
  // JSON number (float-precision) while totalAmountMinor is an exact bigint —
  // comparing via String() coerces both through Number's lossy range instead
  // of comparing the exact integers, so this converts amount_cents to a
  // BigInt explicitly. A non-integer/malformed amount_cents is itself a
  // mismatch, not a thrown error.
  let isAmountMatch: boolean;
  try {
    isAmountMatch = BigInt(obj.amount_cents) === order.totalAmountMinor;
  } catch {
    isAmountMatch = false;
  }
  const isCurrencyMatch = typeof obj.currency === 'string' && obj.currency.toLowerCase() === (order.currency || '').toLowerCase();

  if (!isAmountMatch || !isCurrencyMatch) {
    // Mismatch - mark delivery as rejected, log audit, and return 200
    await db.update(paymobWebhookDeliveries)
      .set({ status: 'rejected' })
      .where(and(eq(paymobWebhookDeliveries.orgId, order.orgId), eq(paymobWebhookDeliveries.transactionId, transactionId)));

    await db.insert(auditLog).values({
      orgId: order.orgId,
      userId: null,
      action: 'PAYMOB_WEBHOOK',
      tableName: 'orders',
      recordId: order.id,
      changes: {
        oldStatus: order.status,
        newStatus: order.status,
        error: 'amount_currency_mismatch',
        paymobPayload: obj,
        expected: { amount: String(order.totalAmountMinor), currency: order.currency }
      }
    });

    return c.json({ data: { success: true }, error: null, meta: null });
  }

  // Genuine capture condition check
  const isSuccess = obj.success === true;
  const isGenuineCapture = isSuccess && obj.pending !== true && obj.is_refunded !== true && obj.is_voided !== true;

  if (isGenuineCapture) {
    // Attempt the atomic status transition, restricted to not regress past 'pending'/'payment_failed'
    const transitionResult = await transitionOrderStatus(db as any, {
      orgId: order.orgId,
      orderId: order.id,
      newStatus: 'confirmed',
      onlyIfPreviousStatusIn: ['pending', 'payment_failed'],
      setPaymentMethod: 'online'
    });

    // If it successfully transitioned (or if not, we audit it anyway, though transitionResult is null if no matching row to update)
    await db.insert(auditLog).values({
      orgId: order.orgId,
      userId: null,
      action: 'PAYMOB_WEBHOOK',
      tableName: 'orders',
      recordId: order.id,
      changes: {
        oldStatus: transitionResult?.previousStatus ?? order.status,
        newStatus: transitionResult ? 'confirmed' : order.status, // untouched if null
        paymobPayload: obj,
        transitionSkipped: !transitionResult // log if we skipped because it was already beyond pending/payment_failed
      }
    });
  } else {
    // Not a genuine capture (e.g. pending, void, refund, or failure), record delivery but do not confirm order.
    // We already inserted the 'processed' webhook delivery. Add audit log for traceability.
    await db.insert(auditLog).values({
      orgId: order.orgId,
      userId: null,
      action: 'PAYMOB_WEBHOOK',
      tableName: 'orders',
      recordId: order.id,
      changes: {
        oldStatus: order.status,
        newStatus: order.status,
        error: 'not_a_genuine_capture',
        paymobPayload: obj
      }
    });
  }

  return c.json({ data: { success: true }, error: null, meta: null });
});

export { paymobRoute };
