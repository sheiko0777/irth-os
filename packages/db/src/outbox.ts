import { outboxEvents } from './schema/outbox';
import { jsonSafe } from './json';
import type { DbTx } from './index';

/**
 * The event types `apps/api/src/workers/outboxWorker.ts` knows how to process.
 *
 * A row whose `event_type` is not in this union is picked up by the worker,
 * matches neither branch, and is marked processed having sent nothing — a
 * silent no-op that looks identical to success on the Integrations screen.
 * Producers go through this union so a typo is a compile error instead.
 */
export type OutboxEventType = 'order.confirmed' | 'order.shipped';

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
    event: { orgId: string; eventType: OutboxEventType; payload: OrderNotificationPayload },
): Promise<void> {
    await tx.insert(outboxEvents).values({
        orgId: event.orgId,
        eventType: event.eventType,
        payload: JSON.stringify(jsonSafe(event.payload)),
    });
}
