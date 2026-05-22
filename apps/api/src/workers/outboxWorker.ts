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

export async function processOutbox(database: typeof db): Promise<void> {
    if (!database) return;

    try {
        const pendingEvents = await database.select()
            .from(outboxEvents)
            .where(
                and(
                    eq(outboxEvents.processed, false),
                    lt(outboxEvents.attempts, 5)
                )
            )
            .limit(10);

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
    } catch (e) {
        console.error('Error fetching outbox events', e);
    }
}

export function startOutboxWorker(database: typeof db): ReturnType<typeof setInterval> {
    return setInterval(() => {
        processOutbox(database).catch(console.error);
    }, 30000);
}
