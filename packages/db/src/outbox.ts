import { outboxEvents } from './schema/outbox';
import { jsonSafe } from './json';
import type { DbTx } from './index';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { orderStatusEnum, shipmentTracking } from './schema';
import { customers } from './schema/customers';
import { orgSettings } from './schema/orgSettings';

/**
 * The event types `apps/api/src/workers/outboxWorker.ts` knows how to process.
 *
 * A row whose `event_type` is not in this union is picked up by the worker,
 * matches neither branch, and is marked processed having sent nothing — a
 * silent no-op that looks identical to success on the Integrations screen.
 * Producers go through this union so a typo is a compile error instead.
 */
/**
 * Org setting holding the courier tracking URL, with a {tracking} placeholder.
 * Nothing in this repo records a public tracking URL for any courier, so the
 * format is configuration rather than a hardcoded guess that would be pasted
 * into a real customer's message.
 */
const TRACKING_URL_TEMPLATE_KEY = 'shipping.tracking_url_template';

export type OutboxEventType = 'order.confirmed' | 'order.shipped' | 'eta.invoice.issue' | 'org.invite.sent' | 'shopify.product.push';

/**
 * Emitted by products.ts on create/update/delete/variant-create. Carries the
 * org + product id rather than a full snapshot: by the time this drains (up
 * to a minute later, per the cron interval), the row may have changed again,
 * and re-reading it fresh in the worker is cheaper than reasoning about
 * whether a stale payload is still accurate.
 *
 * Previously inserted as a raw untyped string by all four `products.ts` call
 * sites, bypassing `emitOutboxEvent`'s type check entirely — the same class
 * of silent-typo risk this union exists to prevent for every other event.
 */
export interface ShopifyProductPushPayload {
    orgId: string;
    productId: string;
}

/**
 * One event type covers the initial invite send and every resend alike —
 * same shape, a fresh token/OTP each time. Carries the OTP code itself
 * (unlike EtaInvoiceIssuePayload's ids-only pattern) because the worker has
 * no other way to reach it: the code lives on `org_invites`, which the
 * worker would otherwise need a second read to fetch, and by drain time
 * (up to a minute later) a resend could have already replaced it — passing
 * the exact code that was current when this event was queued is what keeps
 * the emailed code and the queued send in sync.
 */
export interface OrgInvitePayload {
    orgId: string;
    inviteId: string;
    email: string;
    orgName: string;
    role: string;
    otpCode: string;
    joinUrl: string;
}

/**
 * Carries just the ids, not a snapshot of the order — by the time this
 * drains (up to a minute later, per the cron cadence), re-reading the order
 * fresh via packages/db/src/etaOrderInput.ts is cheaper than reasoning about
 * whether a carried snapshot is still accurate. Same reasoning already used
 * for `shopify.product.push`'s payload.
 */
export interface EtaInvoiceIssuePayload {
    orgId: string;
    orderId: string;
}

/**
 * The payload shape the worker parses out of `outbox_events.payload`.
 *
 * Mirrors `OrderPayload` in outboxWorker.ts field for field. Every field except
 * `orderNumber` is optional HERE and not there, because the worker guards each
 * one at runtime (`if (payload.customerPhone)`, `payload.customerName || <fallback>`,
 * `payload.trackingUrl || ''`) — optional is what its behaviour actually is, and
 * declaring them required would push producers into inventing empty strings to
 * satisfy a type the consumer never enforced.
 *
 * Which branch reads what:
 *   order.confirmed  WhatsApp needs customerPhone; body params are
 *                    customerName then orderNumber. Email needs customerEmail;
 *                    subject and body interpolate orderNumber and customerName.
 *   order.shipped    WhatsApp only. Body params are customerName, orderNumber,
 *                    trackingUrl. There is no email branch.
 *
 * WHY IT LIVES IN packages/db
 *
 * It is a contract between two applications: apps/api owns the consumer,
 * apps/admin owns the producers, and neither depends on the other. Both already
 * depend on @irth/db, which is also where the table lives — so the shape sits
 * next to the column it is serialized into, rather than being copied into each
 * app to drift apart the first time the worker grows a field.
 */
/**
 * Which order statuses the customer is told about, and under which event type.
 *
 * Derived from the consumer, not from what feels notification-worthy:
 * `apps/api/src/workers/outboxWorker.ts` branches on exactly `order.confirmed`
 * and `order.shipped`. An event for `delivered` or `cancelled` would be polled,
 * match no branch, and be marked processed having sent nothing — indistinguish-
 * able from a successful send on the Integrations screen. Add the worker branch
 * first, then the entry here.
 */
export const OUTBOX_EVENT_BY_STATUS: Partial<Record<(typeof orderStatusEnum.enumValues)[number], OutboxEventType>> = {
    confirmed: 'order.confirmed',
    shipped: 'order.shipped',
};

export interface OrderNotificationPayload {
    orderNumber: string;
    customerPhone?: string;
    customerEmail?: string;
    customerName?: string;
    trackingUrl?: string;
}

/**
 * A transaction handle — NOT the plain db. Same trick as `withAudit`'s
 * `AuditWriter`: `rollback` exists on PgTransaction and not on
 * PostgresJsDatabase, so `emitOutboxEvent(db, …)` and `emitOutboxEvent(ctx.db,
 * …)` stop compiling. It is never called.
 *
 * This is the entire point of the outbox pattern rather than a nicety. An event
 * written on its own connection can describe a state change that then rolled
 * back — the customer is told their order shipped when the shipment record does
 * not exist. Making it a type error is the only version of "same transaction"
 * that holds; a convention did not hold for withAudit either (see 0033).
 */
type OutboxWriter = Pick<DbTx, 'insert' | 'rollback'>;

/**
 * Queues one event for the outbox worker, inside the caller's transaction.
 *
 * `payload` is a `text` column, not `jsonb`, so it is stringified here — and it
 * goes through `jsonSafe` first because JSON.stringify THROWS on bigint
 * ("Do not know how to serialize a BigInt") and money in this codebase is
 * bigint minor units. No payload field is money today; the guard is here so
 * that adding one later serializes to a decimal string rather than taking down
 * the order status change that was supposed to emit it.
 *
 * `JSON.stringify` drops keys whose value is `undefined`, so an absent phone or
 * tracking URL simply does not appear in the stored JSON — which is what the
 * worker's `if (payload.customerPhone)` guards already expect.
 */
export async function emitOutboxEvent(
    tx: OutboxWriter,
    event: { orgId: string; eventType: OutboxEventType; payload: OrderNotificationPayload | EtaInvoiceIssuePayload | OrgInvitePayload | ShopifyProductPushPayload },
): Promise<void> {
    await tx.insert(outboxEvents).values({
        orgId: event.orgId,
        eventType: event.eventType,
        payload: JSON.stringify(jsonSafe(event.payload)),
    });
}

/**
 * Builds the payload the worker expects, or `undefined` when the event has no
 * channel it could act on.
 *
 * Shared rather than duplicated: four producers now emit these events (admin
 * order status, admin bulk status, the API status route, and the courier
 * webhooks). Four copies of "which contact field does order.shipped require"
 * would drift, and the one that drifted would send a WhatsApp message to an
 * empty phone number.
 *
 * Takes a transaction handle, so the contact lookup sees the same snapshot as
 * the status change that triggered it.
 */
export async function buildOrderNotification(
    tx: Pick<DbTx, 'select' | 'rollback'>,
    orgId: string,
    order: { id: string; orderNumber: string; customerId: string | null },
    eventType: OutboxEventType,
): Promise<OrderNotificationPayload | undefined> {
    // orders.customerId is nullable and is NOT a user id — it references
    // customers.id, which is where the contact details live. An order placed
    // before a customer record exists has nobody to notify.
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

/** Latest waybill for the order rendered into the org's tracking URL template, or undefined. */
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
            // A shipment row is created before the waybill comes back from the
            // courier, so the most recent row is not necessarily the one that
            // has a number. Skip the ones that do not.
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
