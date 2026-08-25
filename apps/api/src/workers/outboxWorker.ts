import { db } from '@irth/db';
import { outboxEvents } from '@irth/db';
import { and, eq, lt } from 'drizzle-orm';
import { sendWhatsAppTemplate, sendTransactionalEmail } from '../services/integrations';

interface OrderPayload {
    customerPhone: string;
    customerEmail?: string;
    orderNumber: string;
    customerName?: string;
    trackingUrl?: string;
}

/**
 * How many events one call claims. Exported so the cron handler can tell a full
 * batch (more may be waiting) from a short one (the queue is drained).
 */
export const OUTBOX_BATCH_SIZE = 10;

/**
 * Processes one batch of pending outbox events and returns how many it took.
 *
 * Runs WITHOUT a tenant scope on purpose: this is a system drain over every
 * org's events, so it stays on the owning role rather than going through
 * `withOrgContext`. That is the same deliberate cross-tenant escape hatch as
 * `platformAdminProcedure` in the admin app, and the reason it is safe here is
 * that no caller supplies input — the worker only reads rows the app itself
 * wrote and sends them to the address recorded on each one.
 */
export async function processOutbox(database: typeof db): Promise<number> {
    if (!database) return 0;

    try {
        const pendingEvents = await database.select()
            .from(outboxEvents)
            .where(
                and(
                    eq(outboxEvents.processed, false),
                    lt(outboxEvents.attempts, 5)
                )
            )
            .limit(OUTBOX_BATCH_SIZE);

        for (const event of pendingEvents) {
            try {
                const payload = JSON.parse(event.payload) as OrderPayload;

                if (event.eventType === 'order.confirmed') {
                    if (payload.customerPhone) {
                        await sendWhatsAppTemplate(payload.customerPhone, 'order_confirmed', [
                            {
                                type: 'body',
                                parameters: [
                                    { type: 'text', text: payload.customerName || 'عميلنا العزيز' },
                                    { type: 'text', text: payload.orderNumber }
                                ]
                            }
                        ]);
                    }
                    if (payload.customerEmail) {
                        await sendTransactionalEmail({
                            to: payload.customerEmail,
                            subject: `تم تأكيد طلبك رقم ${payload.orderNumber}`,
                            html: `<h1>مرحباً ${payload.customerName || 'عميلنا العزيز'}</h1><p>تم تأكيد طلبك رقم ${payload.orderNumber} بنجاح.</p>`
                        });
                    }
                } else if (event.eventType === 'order.shipped') {
                     if (payload.customerPhone) {
                        await sendWhatsAppTemplate(payload.customerPhone, 'order_shipped', [
                            {
                                type: 'body',
                                parameters: [
                                    { type: 'text', text: payload.customerName || 'عميلنا العزيز' },
                                    { type: 'text', text: payload.orderNumber },
                                    { type: 'text', text: payload.trackingUrl || '' }
                                ]
                            }
                        ]);
                    }
                }

                await database.update(outboxEvents)
                    .set({ processed: true, processedAt: new Date() })
                    .where(eq(outboxEvents.id, event.id));

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await database.update(outboxEvents)
                    .set({
                        attempts: event.attempts + 1,
                        lastError: errorMessage
                    })
                    .where(eq(outboxEvents.id, event.id));
            }
        }
        return pendingEvents.length;
    } catch (e) {
        console.error('Error fetching outbox events', e);
        return 0;
    }
}

// `startOutboxWorker` used to live here, wrapping processOutbox in a 30s
// setInterval. It was never called by anything, and could not have worked if it
// had been: a Worker isolate does not stay alive between requests, so the timer
// is torn down before it ever fires. Its presence made the outbox look drained
// when nothing was draining it — every producer wrote events that no one read.
// The drain is now a `scheduled()` handler on a cron trigger; see
// apps/api/src/index.ts and the [triggers] block in wrangler.toml.
