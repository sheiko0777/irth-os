import { db } from '@irth/db';
import { outboxEvents, products, productVariants, etaInvoices } from '@irth/db';
import { and, eq, lt } from 'drizzle-orm';
import { sendWhatsAppTemplate, sendTransactionalEmail } from '../services/integrations';
import { upsertShopifyProduct, statusFromLocal } from '../services/shopify';
import { buildEtaOrderInput } from '../services/buildEtaOrderInput';
import { issueInvoice } from '../services/eta';

interface OrderPayload {
    customerPhone: string;
    customerEmail?: string;
    orderNumber: string;
    customerName?: string;
    trackingUrl?: string;
}

interface ShopifyProductPushPayload {
    orgId: string;
    productId: string;
}

interface EtaInvoicePayload {
    orgId: string;
    orderId: string;
    orderNumber: string;
    currency: string;
}

export const OUTBOX_BATCH_SIZE = 10;

export async function processOutbox(database: typeof db): Promise<number> {
    if (!database) return 0;

    try {
        const pendingEvents = await database.select()
            .from(outboxEvents)
            .where(and(eq(outboxEvents.processed, false), lt(outboxEvents.attempts, 5)))
            .limit(OUTBOX_BATCH_SIZE);

        for (const event of pendingEvents) {
            try {
                if (event.eventType === 'shopify.product.push') {
                    const { orgId, productId } = JSON.parse(event.payload) as ShopifyProductPushPayload;
                    const [product] = await database.select().from(products)
                        .where(and(eq(products.id, productId), eq(products.orgId, orgId)));
                    if (!product) {
                        await database.update(outboxEvents).set({ processed: true, processedAt: new Date() }).where(eq(outboxEvents.id, event.id));
                        continue;
                    }

                    const variants = await database.select().from(productVariants)
                        .where(and(eq(productVariants.productId, productId), eq(productVariants.orgId, orgId)));
                    if (variants.length === 0) {
                        await database.update(outboxEvents).set({ processed: true, processedAt: new Date() }).where(eq(outboxEvents.id, event.id));
                        continue;
                    }

                    const result = await upsertShopifyProduct({
                        shopifyProductId: product.shopifyProductId,
                        title: product.name,
                        descriptionHtml: product.description ?? undefined,
                        status: statusFromLocal(product.status),
                        variants: variants.map(v => ({
                            shopifyVariantId: v.shopifyVariantId,
                            sku: v.sku,
                            priceMinor: v.priceMinor ?? product.priceMinor,
                            currency: product.currency,
                        })),
                    });

                    if (product.shopifyProductId !== result.shopifyProductId) {
                        await database.update(products).set({ shopifyProductId: result.shopifyProductId }).where(eq(products.id, productId));
                    }
                    for (const returned of result.variants) {
                        const local = variants.find(v => v.sku === returned.sku);
                        if (local && local.shopifyVariantId !== returned.shopifyVariantId) {
                            await database.update(productVariants).set({ shopifyVariantId: returned.shopifyVariantId }).where(eq(productVariants.id, local.id));
                        }
                    }

                    await database.update(outboxEvents).set({ processed: true, processedAt: new Date() }).where(eq(outboxEvents.id, event.id));
                    continue;
                }

                if (event.eventType === 'eta.invoice.issue') {
                    const payload = JSON.parse(event.payload) as EtaInvoicePayload;
                    const [invoice] = await database.select().from(etaInvoices)
                        .where(and(eq(etaInvoices.orgId, payload.orgId), eq(etaInvoices.orderId, payload.orderId)))
                        .limit(1);

                    if (!invoice || invoice.status === 'valid' || invoice.status === 'submitted') {
                        await database.update(outboxEvents).set({ processed: true, processedAt: new Date() }).where(eq(outboxEvents.id, event.id));
                        continue;
                    }

                    const etaInput = await buildEtaOrderInput(
                        payload.orgId,
                        payload.orderId,
                        payload.orderNumber,
                        payload.currency,
                    );

                    if (!etaInput) {
                        await database.update(etaInvoices).set({
                            status: 'rejected',
                            errorMessage: 'ETA invoice input could not be built: order has no declared line items.',
                            retryCount: invoice.retryCount + 1,
                        }).where(and(eq(etaInvoices.id, invoice.id), eq(etaInvoices.orgId, payload.orgId)));
                        await database.update(outboxEvents).set({ processed: true, processedAt: new Date() }).where(eq(outboxEvents.id, event.id));
                        continue;
                    }

                    const result = await issueInvoice(etaInput);
                    if (!result) {
                        await database.update(etaInvoices).set({
                            status: 'pending',
                            errorMessage: 'ETA submission attempt returned no accepted document.',
                            retryCount: invoice.retryCount + 1,
                        }).where(and(eq(etaInvoices.id, invoice.id), eq(etaInvoices.orgId, payload.orgId)));
                        // Leave the outbox event unprocessed. The normal attempt
                        // counter will retry it up to the worker's bounded limit.
                        await database.update(outboxEvents).set({
                            attempts: event.attempts + 1,
                            lastError: 'ETA submission attempt returned no accepted document.',
                        }).where(eq(outboxEvents.id, event.id));
                        continue;
                    }

                    await database.update(etaInvoices).set({
                        status: 'submitted',
                        etaUuid: result.uuid,
                        longId: result.longId ?? null,
                        submittedAt: new Date(),
                        errorMessage: null,
                        retryCount: invoice.retryCount,
                    }).where(and(eq(etaInvoices.id, invoice.id), eq(etaInvoices.orgId, payload.orgId)));

                    await database.update(outboxEvents).set({ processed: true, processedAt: new Date() }).where(eq(outboxEvents.id, event.id));
                    continue;
                }

                const payload = JSON.parse(event.payload) as OrderPayload;

                if (event.eventType === 'order.confirmed') {
                    if (payload.customerPhone) {
                        await sendWhatsAppTemplate(payload.customerPhone, 'order_confirmed', [{
                            type: 'body',
                            parameters: [
                                { type: 'text', text: payload.customerName || 'عميلنا العزيز' },
                                { type: 'text', text: payload.orderNumber }
                            ]
                        }]);
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
                        await sendWhatsAppTemplate(payload.customerPhone, 'order_shipped', [{
                            type: 'body',
                            parameters: [
                                { type: 'text', text: payload.customerName || 'عميلنا العزيز' },
                                { type: 'text', text: payload.orderNumber },
                                { type: 'text', text: payload.trackingUrl || '' }
                            ]
                        }]);
                    }
                }

                await database.update(outboxEvents).set({ processed: true, processedAt: new Date() }).where(eq(outboxEvents.id, event.id));
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await database.update(outboxEvents).set({
                    attempts: event.attempts + 1,
                    lastError: errorMessage
                }).where(eq(outboxEvents.id, event.id));
            }
        }
        return pendingEvents.length;
    } catch (e) {
        console.error('Error fetching outbox events', e);
        return 0;
    }
}
