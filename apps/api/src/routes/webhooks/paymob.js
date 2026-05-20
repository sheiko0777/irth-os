import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db';
import { orders, auditLog } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import crypto from 'node:crypto';
const paymobRoute = new Hono();
const paymobSchema = z.object({
    obj: z.object({
        amount_cents: z.number().optional(),
        created_at: z.string().optional(),
        currency: z.string().optional(),
        error_occured: z.boolean().optional(),
        has_parent_transaction: z.boolean().optional(),
        id: z.number().optional(),
        integration_id: z.number().optional(),
        is_3d_secure: z.boolean().optional(),
        is_auth: z.boolean().optional(),
        is_capture: z.boolean().optional(),
        is_refunded: z.boolean().optional(),
        is_standalone_payment: z.boolean().optional(),
        is_voided: z.boolean().optional(),
        order: z.object({
            id: z.number().optional(),
            merchant_order_id: z.string().optional()
        }).optional(),
        owner: z.number().optional(),
        pending: z.boolean().optional(),
        source_data: z.object({
            pan: z.string().optional(),
            sub_type: z.string().optional(),
            type: z.string().optional()
        }).optional(),
        success: z.boolean().optional(),
        payment_key_claims: z.object({
            extra: z.object({
                org_id: z.string().uuid()
            }).optional()
        }).optional()
    }).passthrough()
}).passthrough();
paymobRoute.post('/', async (c) => {
    const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
    if (!hmacSecret) {
        return c.json({ data: null, error: 'hmac_secret_not_configured', meta: null }, 500);
    }
    const hmacHeader = c.req.header('hmac');
    if (!hmacHeader) {
        return c.json({ data: null, error: 'missing_hmac', meta: null }, 401);
    }
    const bodyRaw = await c.req.text();
    const body = JSON.parse(bodyRaw);
    // Rule 3: Zod .parse()
    const parsedBody = paymobSchema.parse(body);
    const { obj } = parsedBody;
    const lexoKeys = [
        'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
        'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
        'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending', 'source_data.pan',
        'source_data.sub_type', 'source_data.type', 'success'
    ];
    let concatenatedString = '';
    for (const key of lexoKeys) {
        const parts = key.split('.');
        let val = obj;
        for (const p of parts) {
            if (val && typeof val === 'object' && p in val) {
                val = val[p];
            }
            else {
                val = undefined;
            }
        }
        concatenatedString += val ?? '';
    }
    const calculatedHmac = crypto.createHmac('sha512', hmacSecret).update(concatenatedString).digest('hex');
    if (calculatedHmac !== hmacHeader) {
        return c.json({ data: null, error: 'invalid_hmac', meta: null }, 401);
    }
    const orderIdFromPaymob = obj.order?.merchant_order_id;
    if (!orderIdFromPaymob) {
        return c.json({ data: null, error: 'missing_order_id', meta: null }, 400);
    }
    // Rule 1: Scoped by org_id
    const orgId = obj.payment_key_claims?.extra?.org_id;
    if (!orgId) {
        return c.json({ data: null, error: 'missing_org_id', meta: null }, 400);
    }
    const [order] = await db.select().from(orders).where(and(eq(orders.orderNumber, orderIdFromPaymob), eq(orders.orgId, orgId)));
    if (!order) {
        return c.json({ data: null, error: 'order_not_found', meta: null }, 404);
    }
    const isSuccess = obj.success === true;
    const newStatus = isSuccess ? 'confirmed' : 'payment_failed';
    const [updatedOrder] = await db.update(orders)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.orgId, order.orgId)))
        .returning();
    await db.insert(auditLog).values({
        orgId: order.orgId,
        userId: null,
        action: 'PAYMOB_WEBHOOK',
        tableName: 'orders',
        recordId: order.id,
        changes: { oldStatus: order.status, newStatus, paymobPayload: obj }
    });
    return c.json({ data: { success: true }, error: null, meta: null });
});
export { paymobRoute };
