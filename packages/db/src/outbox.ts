import { outboxEvents } from './schema/outbox';
import { jsonSafe } from './json';
import type { DbTx } from './index';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { orderStatusEnum, shipmentTracking } from './schema';
import { customers } from './schema/customers';
import { orgSettings } from './schema/orgSettings';

const TRACKING_URL_TEMPLATE_KEY = 'shipping.tracking_url_template';

export type OutboxEventType = 'order.confirmed' | 'order.shipped' | 'eta.invoice.issue';

export interface OrderNotificationPayload {
    orderNumber: string;
    customerPhone?: string;
    customerEmail?: string;
    customerName?: string;
    trackingUrl?: string;
}

export interface EtaInvoiceJobPayload {
    orgId: string;
    orderId: string;
    orderNumber: string;
    currency: string;
}

export const OUTBOX_EVENT_BY_STATUS: Partial<Record<(typeof orderStatusEnum.enumValues)[number], OutboxEventType>> = {
    confirmed: 'order.confirmed',
    shipped: 'order.shipped',
};

type OutboxWriter = Pick<DbTx, 'insert' | 'rollback'>;

export async function emitOutboxEvent(
    tx: OutboxWriter,
    event: {
        orgId: string;
        eventType: OutboxEventType;
        payload: OrderNotificationPayload | EtaInvoiceJobPayload;
    },
): Promise<void> {
    await tx.insert(outboxEvents).values({
        orgId: event.orgId,
        eventType: event.eventType,
        payload: JSON.stringify(jsonSafe(event.payload)),
    });
}

export async function buildOrderNotification(
    tx: Pick<DbTx, 'select' | 'rollback'>,
    orgId: string,
    order: { id: string; orderNumber: string; customerId: string | null },
    eventType: Exclude<OutboxEventType, 'eta.invoice.issue'>,
): Promise<OrderNotificationPayload | undefined> {
    const [contact] = order.customerId
        ? await tx
              .select({ name: customers.name, email: customers.email, phone: customers.phone })
              .from(customers)
              .where(and(eq(customers.id, order.customerId), eq(customers.orgId, orgId)))
              .limit(1)
        : [];

    const phone = contact?.phone ?? undefined;
    const email = contact?.email ?? undefined;
    const reachable = eventType === 'order.shipped' ? Boolean(phone) : Boolean(phone || email);
    if (!reachable) return undefined;

    return {
        orderNumber: order.orderNumber,
        customerName: contact?.name ?? undefined,
        customerPhone: phone,
        customerEmail: email,
        trackingUrl: eventType === 'order.shipped' ? await trackingUrlFor(tx, orgId, order.id) : undefined,
    };
}

async function trackingUrlFor(
    tx: Pick<DbTx, 'select' | 'rollback'>,
    orgId: string,
    orderId: string,
): Promise<string | undefined> {
    const [tracked] = await tx
        .select({ trackingNumber: shipmentTracking.trackingNumber })
        .from(shipmentTracking)
        .where(and(
            eq(shipmentTracking.orderId, orderId),
            eq(shipmentTracking.orgId, orgId),
            isNotNull(shipmentTracking.trackingNumber),
        ))
        .orderBy(desc(shipmentTracking.createdAt))
        .limit(1);

    if (!tracked?.trackingNumber) return undefined;

    const [template] = await tx
        .select({ value: orgSettings.value })
        .from(orgSettings)
        .where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, TRACKING_URL_TEMPLATE_KEY)))
        .limit(1);

    if (!template?.value) return undefined;
    return template.value.replace('{tracking}', tracked.trackingNumber);
}
