import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../db';
import { orders, auditLog, paymentWebhookEvents } from '@irth/db';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

const paymobRoute = new Hono();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

paymobRoute.post('/', async (c: Context) => {
  const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
  if (!hmacSecret) {
    return c.json({ data: null, error: 'hmac_secret_not_configured', meta: null }, 500);
  }

  const hmacHeader = c.req.header('hmac');
  if (!hmacHeader) {
    return c.json({ data: null, error: 'missing_hmac', meta: null }, 401);
  }

  const bodyRaw = await c.req.text();
  let body: unknown;
  try {
    body = JSON.parse(bodyRaw);
  } catch {
    return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  }

  const { obj } = body as { obj?: Record<string, unknown> };
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
    let val: unknown = obj;
    for (const p of parts) {
      val = (val as Record<string, unknown> | undefined)?.[p];
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

  const paymobTxnId = obj.id != null ? String(obj.id) : undefined;
  if (!paymobTxnId) {
    return c.json({ data: null, error: 'missing_transaction_id', meta: null }, 400);
  }

  // Correlator into our system: the order's own UUID, not the human-readable
  // orderNumber. Order numbers restart per tenant, so "IRT-2026-0001" exists
  // once per org (UNIQUE(org_id, order_number), migration 0029) — a lookup
  // keyed on the number alone has no tenant to disambiguate it and could
  // confirm the wrong org's order. The order UUID is unique by construction,
  // so it is the only safe correlator to hand Paymob as merchant_order_id.
  const orderId = (obj.order as Record<string, unknown> | undefined)?.merchant_order_id as string | undefined;
  if (!orderId || !UUID_RE.test(orderId)) {
    return c.json({ data: null, error: 'invalid_order_id', meta: null }, 400);
  }

  const amountCents = Number(obj.amount_cents);
  if (!Number.isInteger(amountCents)) {
    return c.json({ data: null, error: 'invalid_amount', meta: null }, 400);
  }

  const result = await db.transaction(async (tx) => {
    // Idempotency: claim this Paymob transaction id before touching the
    // order. A unique-constraint violation here means we've already
    // processed this exact event (Paymob retries webhooks on any non-2xx,
    // or even on slow 2xx) — short-circuit instead of re-applying the
    // status transition or double-writing the audit log.
    try {
      await tx.insert(paymentWebhookEvents).values({
        provider: 'paymob',
        eventId: paymobTxnId,
        orderId,
      });
    } catch {
      return { duplicate: true as const };
    }

    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) {
      throw new Error('order_not_found');
    }

    const isSuccess = obj.success === true;
    // A payment that doesn't match what the order actually costs is never
    // confirmed, even if Paymob reports success — otherwise a manipulated
    // or stale webhook could mark an order paid for less than its total.
    const amountMatches = amountCents === order.totalAmountMinor;
    const newStatus = isSuccess && amountMatches ? 'confirmed' : 'payment_failed';

    const [updatedOrder] = await tx.update(orders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();

    await tx.insert(auditLog).values({
      orgId: order.orgId,
      userId: null,
      action: 'PAYMOB_WEBHOOK',
      tableName: 'orders',
      recordId: order.id,
      changes: {
        oldStatus: order.status,
        newStatus,
        paymobTxnId,
        amountCents,
        orderTotalMinor: order.totalAmountMinor,
        amountMatches,
        paymobPayload: obj,
      },
    });

    return { duplicate: false as const, order: updatedOrder };
  }).catch((err: Error) => {
    if (err.message === 'order_not_found') return null;
    throw err;
  });

  if (result === null) {
    return c.json({ data: null, error: 'order_not_found', meta: null }, 404);
  }

  return c.json({ data: { success: true, duplicate: result.duplicate }, error: null, meta: null });
});

export { paymobRoute };
