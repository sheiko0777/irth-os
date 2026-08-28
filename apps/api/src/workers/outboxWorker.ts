import { db } from '@irth/db';
import { outboxEvents, products, productVariants, etaInvoices, buildEtaOrderInput, type EtaInvoiceIssuePayload, type OrgInvitePayload } from '@irth/db';
import { issueInvoice, buildEtaConfig } from '@irth/domain';
import { and, eq, lt } from 'drizzle-orm';
import { sendWhatsAppTemplate, sendTransactionalEmail } from '../services/integrations';
import { upsertShopifyProduct, statusFromLocal } from '../services/shopify';
import { envVar } from '../utils/env';

interface OrderPayload {
    customerPhone: string;
    customerEmail?: string;
    orderNumber: string;
    customerName?: string;
    trackingUrl?: string;
}

/**
 * Emitted by products.ts on create/update. Carries the org + product id
 * rather than the full product body: by the time this drains (up to a
 * minute later, per the cron interval), the row may have changed again, and
 * re-reading it fresh is cheaper than reasoning about whether a stale
 * payload is still accurate.
 */
interface ShopifyProductPushPayload {
    orgId: string;
    productId: string;
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
                if (event.eventType === 'shopify.product.push') {
                    const { orgId, productId } = JSON.parse(event.payload) as ShopifyProductPushPayload;

                    const [product] = await database.select().from(products)
                        .where(and(eq(products.id, productId), eq(products.orgId, orgId)));
                    // Deleted or reassigned since the event was queued — nothing left
                    // to push, and not a failure worth retrying.
                    if (!product) {
                        await database.update(outboxEvents)
                            .set({ processed: true, processedAt: new Date() })
                            .where(eq(outboxEvents.id, event.id));
                        continue;
                    }

                    const variants = await database.select().from(productVariants)
                        .where(and(eq(productVariants.productId, productId), eq(productVariants.orgId, orgId)));

                    // productSet requires at least one variant; a product with none
                    // yet (just created, no SKUs added) has nothing to push — not an
                    // error, just not ready.
                    if (variants.length === 0) {
                        await database.update(outboxEvents)
                            .set({ processed: true, processedAt: new Date() })
                            .where(eq(outboxEvents.id, event.id));
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
                            // A variant with no price of its own inherits the
                            // product's (schema.ts's own note on this column) — same
                            // fallback here so Shopify never receives a $0 line.
                            priceMinor: v.priceMinor ?? product.priceMinor,
                            currency: product.currency,
                        })),
                    });

                    // Two separate updates rather than one join-shaped write: Drizzle
                    // has no portable "update N rows with N different values" batch
                    // form, and this list is small (one product's own variants).
                    if (product.shopifyProductId !== result.shopifyProductId) {
                        await database.update(products)
                            .set({ shopifyProductId: result.shopifyProductId })
                            .where(eq(products.id, productId));
                    }
                    for (const returned of result.variants) {
                        const local = variants.find(v => v.sku === returned.sku);
                        if (local && local.shopifyVariantId !== returned.shopifyVariantId) {
                            await database.update(productVariants)
                                .set({ shopifyVariantId: returned.shopifyVariantId })
                                .where(eq(productVariants.id, local.id));
                        }
                    }

                    await database.update(outboxEvents)
                        .set({ processed: true, processedAt: new Date() })
                        .where(eq(outboxEvents.id, event.id));
                    continue;
                }

                if (event.eventType === 'eta.invoice.issue') {
                    const { orgId, orderId } = JSON.parse(event.payload) as EtaInvoiceIssuePayload;

                    const [existing] = await database.select().from(etaInvoices)
                        .where(and(eq(etaInvoices.orgId, orgId), eq(etaInvoices.orderId, orderId)));

                    // Still cooling down from a previous retryable failure —
                    // leave the outbox row untouched (not processed, attempts
                    // unchanged) so the next tick re-evaluates, instead of
                    // burning an attempt on a retry that isn't due yet.
                    if (existing?.nextRetryAt && existing.nextRetryAt > new Date()) {
                        continue;
                    }

                    const etaInput = await buildEtaOrderInput(database, orgId, orderId);
                    if (!etaInput) {
                        // Order missing or has no items — not something a
                        // retry fixes.
                        await database.update(outboxEvents)
                            .set({ processed: true, processedAt: new Date() })
                            .where(eq(outboxEvents.id, event.id));
                        continue;
                    }

                    const result = await issueInvoice(etaInput, buildEtaConfig(envVar));

                    if (result.ok) {
                        await database.insert(etaInvoices).values({
                            orgId, orderId, etaUuid: result.uuid, longId: result.longId ?? null,
                            qrCodeData: result.qrCodeData ?? null, status: 'submitted',
                            submittedAt: new Date(), retryCount: 0, nextRetryAt: null, errorMessage: null,
                        }).onConflictDoUpdate({
                            target: etaInvoices.orderId,
                            set: {
                                etaUuid: result.uuid, longId: result.longId ?? null, qrCodeData: result.qrCodeData ?? null,
                                status: 'submitted', submittedAt: new Date(), retryCount: 0, nextRetryAt: null, errorMessage: null,
                            },
                        });
                        await database.update(outboxEvents)
                            .set({ processed: true, processedAt: new Date() })
                            .where(eq(outboxEvents.id, event.id));
                    } else if (!result.retryable) {
                        // No amount of outbox retrying fixes a config/data/
                        // compliance problem — stop auto-retrying, but leave
                        // the row for the existing manual "Submit" in
                        // apps/admin's eta router.
                        await database.insert(etaInvoices).values({
                            orgId, orderId, status: 'error', errorMessage: result.message, nextRetryAt: null,
                        }).onConflictDoUpdate({
                            target: etaInvoices.orderId,
                            set: { status: 'error', errorMessage: result.message, nextRetryAt: null },
                        });
                        await database.update(outboxEvents)
                            .set({ processed: true, processedAt: new Date() })
                            .where(eq(outboxEvents.id, event.id));
                    } else {
                        const attempts = (existing?.retryCount ?? 0) + 1;
                        // Exponential, capped at 60 minutes — no existing
                        // backoff utility in this codebase to reuse, and the
                        // outbox's own attempts<5 ceiling (below) already
                        // caps total retries; this only spaces them out.
                        const backoffMinutes = Math.min(2 ** attempts, 60);
                        const nextRetryAt = new Date(Date.now() + backoffMinutes * 60_000);
                        await database.insert(etaInvoices).values({
                            orgId, orderId, status: 'error', errorMessage: result.message, retryCount: attempts, nextRetryAt,
                        }).onConflictDoUpdate({
                            target: etaInvoices.orderId,
                            set: { status: 'error', errorMessage: result.message, retryCount: attempts, nextRetryAt },
                        });
                        // Re-thrown so the outer catch still bumps
                        // outbox_events.attempts/lastError — the existing
                        // attempts<5 ceiling stays the dead-letter safety net
                        // for every event type; only the RATE changes here
                        // (exponential backoff via nextRetryAt), not the
                        // ceiling.
                        throw new Error(result.message);
                    }
                    continue;
                }

                if (event.eventType === 'org.invite.sent') {
                    const payload = JSON.parse(event.payload) as OrgInvitePayload;
                    const roleLabel = payload.role === 'owner' ? 'مالك' : payload.role === 'admin' ? 'مدير' : 'عضو';
                    await sendTransactionalEmail({
                        to: payload.email,
                        subject: `دعوة للانضمام إلى ${payload.orgName}`,
                        html: `<h1>مرحباً</h1><p>تمت دعوتك للانضمام إلى <strong>${payload.orgName}</strong> بصفة ${roleLabel}.</p><p><a href="${payload.joinUrl}">اضغط هنا لقبول الدعوة</a></p><p>رمز التأكيد: <strong style="font-size:20px;letter-spacing:2px">${payload.otpCode}</strong></p><p>سيُطلب منك إدخال هذا الرمز عند قبول الدعوة. صالح لمدة ١٥ دقيقة.</p>`,
                    });
                    await database.update(outboxEvents)
                        .set({ processed: true, processedAt: new Date() })
                        .where(eq(outboxEvents.id, event.id));
                    continue;
                }

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
