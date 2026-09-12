import { db } from '@irth/db';
import { outboxEvents, products, productVariants, etaInvoices, buildEtaOrderInput, shopifyConnections, type EtaInvoiceIssuePayload, type OrgInvitePayload, type ShopifyProductPushPayload, type CampaignRecipientSendPayload, campaigns, campaignRecipients, customers } from '@irth/db';
import { issueInvoice, buildEtaConfig } from '@irth/domain';
import { and, eq, lt, lte, or, isNull, inArray, sql } from 'drizzle-orm';
import { sendWhatsAppTemplate, sendTransactionalEmail } from '../services/integrations';
import { renderCampaignEmail, renderOrgInviteEmail, renderOrderConfirmedEmail } from '@irth/emails';
import { upsertShopifyProduct, statusFromLocal } from '../services/shopify';
import { upsertShopifyProductForConnection } from '../services/shopifyConnection';
import { envVar } from '../utils/env';

interface OrderPayload {
    customerPhone: string;
    customerEmail?: string;
    orderNumber: string;
    customerName?: string;
    trackingUrl?: string;
}

/** One claimed row from `outbox_events`. */
type OutboxEvent = typeof outboxEvents.$inferSelect;

/**
 * How many events one call claims. Exported so the cron handler can tell a full
 * batch (more may be waiting) from a short one (the queue is drained).
 */
export const OUTBOX_BATCH_SIZE = 10;

async function markProcessed(database: typeof db, eventId: string): Promise<void> {
    await database.update(outboxEvents)
        .set({ processed: true, processedAt: new Date() })
        .where(eq(outboxEvents.id, eventId));
}

/**
 * Pushes one product to Shopify. Resolves and prefers the org's own encrypted
 * per-org connection over the legacy single-tenant global client, and writes
 * back any Shopify ids the upsert minted. Marks the event processed on success,
 * or on the "nothing to push" cases (product gone, no variants yet).
 */
async function handleShopifyProductPush(database: typeof db, event: OutboxEvent): Promise<void> {
    const { orgId, productId } = JSON.parse(event.payload) as ShopifyProductPushPayload;

    const [product] = await database.select().from(products)
        .where(and(eq(products.id, productId), eq(products.orgId, orgId)));
    // Deleted or reassigned since the event was queued — nothing left
    // to push, and not a failure worth retrying.
    if (!product) {
        await markProcessed(database, event.id);
        return;
    }

    const variants = await database.select().from(productVariants)
        .where(and(eq(productVariants.productId, productId), eq(productVariants.orgId, orgId)));

    // productSet requires at least one variant; a product with none
    // yet (just created, no SKUs added) has nothing to push — not an
    // error, just not ready.
    if (variants.length === 0) {
        await markProcessed(database, event.id);
        return;
    }

    // Prefer the org's own per-org connection (real, encrypted,
    // multi-tenant token) over the legacy global client — that
    // client only ever authenticates as the one shop named by
    // SHOPIFY_SHOP_DOMAIN, so it's only ever correct for the one
    // org SHOPIFY_ORG_ID names. Every other connected org falling
    // through to it would silently push products into the wrong
    // shop (or fail entirely once that shop isn't the pusher's).
    const [connection] = await database.select().from(shopifyConnections)
        .where(and(eq(shopifyConnections.orgId, orgId), eq(shopifyConnections.status, 'active')));

    if (!connection && orgId !== envVar('SHOPIFY_ORG_ID')) {
        throw new Error(`Shopify product push for org ${orgId} has no active connection and does not match the legacy single-tenant org — refusing to avoid a cross-tenant misroute`);
    }

    const productInput = {
        localProductId: product.id,
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
    };

    const result = connection
        ? await upsertShopifyProductForConnection(connection, productInput)
        : await upsertShopifyProduct(productInput);

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

    await markProcessed(database, event.id);
}

/**
 * Issues an ETA e-invoice for an order. ETA keeps its own retry state on
 * `eta_invoices` (retryCount + exponential nextRetryAt); a still-cooling-down
 * row is left untouched so no attempt is burned before it is due, and a
 * retryable failure is re-thrown so the outer catch still bumps the outbox
 * attempts ceiling.
 */
async function handleEtaInvoiceIssue(database: typeof db, event: OutboxEvent): Promise<void> {
    const { orgId, orderId } = JSON.parse(event.payload) as EtaInvoiceIssuePayload;

    const [existing] = await database.select().from(etaInvoices)
        .where(and(eq(etaInvoices.orgId, orgId), eq(etaInvoices.orderId, orderId)));

    // Still cooling down from a previous retryable failure —
    // leave the outbox row untouched (not processed, attempts
    // unchanged) so the next tick re-evaluates, instead of
    // burning an attempt on a retry that isn't due yet.
    if (existing?.nextRetryAt && existing.nextRetryAt > new Date()) {
        return;
    }

    const etaInput = await buildEtaOrderInput(database, orgId, orderId);
    if (!etaInput) {
        // Order missing or has no items — not something a
        // retry fixes.
        await markProcessed(database, event.id);
        return;
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
        await markProcessed(database, event.id);
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
        await markProcessed(database, event.id);
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
}

/**
 * Sends one campaign message (WhatsApp or email) to one recipient and, in a
 * single transaction, advances the recipient to `sent`, bumps the campaign's
 * delivered count, and closes the campaign out when no `pending` recipients
 * remain. A missing phone/email throws so the shared attempts/backoff path —
 * and the dead-letter finalization in the outer catch — takes over.
 */
async function handleCampaignRecipientSend(database: typeof db, event: OutboxEvent): Promise<void> {
    const payload = JSON.parse(event.payload) as CampaignRecipientSendPayload;

    const [recipient] = await database.select().from(campaignRecipients)
        .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
        .innerJoin(customers, eq(customers.id, campaignRecipients.customerId))
        .where(and(eq(campaignRecipients.id, payload.recipientId), eq(campaignRecipients.orgId, payload.orgId)));

    if (!recipient) {
        // Deleted or missing, cannot proceed.
        await markProcessed(database, event.id);
        return;
    }

    if (recipient.campaigns.status === 'cancelled') {
        await database.update(campaignRecipients)
            .set({ status: 'skipped_cancelled', updatedAt: new Date() })
            .where(eq(campaignRecipients.id, recipient.campaign_recipients.id));
        await markProcessed(database, event.id);
        return;
    }

    if (recipient.campaign_recipients.status !== 'pending') {
        // Already resolved by an earlier attempt (sent, or
        // skipped for some other reason) — nothing left to do.
        await markProcessed(database, event.id);
        return;
    }

    let providerMessageId: string | null = null;
    if (recipient.campaign_recipients.channel === 'whatsapp' && recipient.customers.phone) {
        const res = await sendWhatsAppTemplate(recipient.customers.phone, 'campaign_message', [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: recipient.customers.name || 'عميلنا العزيز' },
                    { type: 'text', text: recipient.campaigns.message }
                ]
            }
        ]) as { messages?: { id?: string }[] };
        providerMessageId = res?.messages?.[0]?.id ?? null;
    } else if (recipient.campaign_recipients.channel === 'email' && recipient.customers.email) {
        const res = await sendTransactionalEmail({
            to: recipient.customers.email,
            subject: recipient.campaigns.name,
            html: await renderCampaignEmail({
                customerName: recipient.customers.name || 'عميلنا العزيز',
                message: recipient.campaigns.message,
            }),
        }) as { id?: string };
        providerMessageId = res?.id ?? null;
    } else {
        // Not a transient failure — retrying won't add a phone/
        // email that doesn't exist. Still goes through the
        // normal attempts/backoff path below; the dead-letter
        // finalization in the outer catch marks it 'failed'
        // once attempts are exhausted rather than retrying
        // forever.
        throw new Error('Unsupported channel or missing contact info for this recipient');
    }

    await database.transaction(async (tx) => {
        await tx.update(campaignRecipients)
            .set({ status: 'sent', providerMessageId, sentAt: new Date(), updatedAt: new Date() })
            .where(eq(campaignRecipients.id, recipient.campaign_recipients.id));
        await tx.update(campaigns)
            .set({ deliveredCount: sql`${campaigns.deliveredCount} + 1`, updatedAt: new Date() })
            .where(eq(campaigns.id, recipient.campaigns.id));

        const [remaining] = await tx.select({ count: sql<number>`count(*)` }).from(campaignRecipients)
            .where(and(eq(campaignRecipients.campaignId, recipient.campaigns.id), eq(campaignRecipients.status, 'pending')));
        if (Number(remaining.count) === 0) {
            await tx.update(campaigns)
                .set({
                    status: sql`CASE WHEN ${campaigns.failedCount} > 0 THEN 'failed'::campaign_status ELSE 'sent'::campaign_status END`,
                    updatedAt: new Date(),
                })
                .where(eq(campaigns.id, recipient.campaigns.id));
        }
    });

    await markProcessed(database, event.id);
}

/** Emails an org invite (join link + OTP). */
async function handleOrgInviteSent(database: typeof db, event: OutboxEvent): Promise<void> {
    const payload = JSON.parse(event.payload) as OrgInvitePayload;
    const roleLabel = payload.role === 'owner' ? 'مالك' : payload.role === 'admin' ? 'مدير' : 'عضو';
    await sendTransactionalEmail({
        to: payload.email,
        subject: `دعوة للانضمام إلى ${payload.orgName}`,
        html: await renderOrgInviteEmail({
            orgName: payload.orgName,
            roleLabel,
            joinUrl: payload.joinUrl,
            otpCode: payload.otpCode,
        }),
    });
    await markProcessed(database, event.id);
}

/** Customer-facing order.confirmed / order.shipped WhatsApp + email notices. */
async function handleOrderNotification(database: typeof db, event: OutboxEvent): Promise<void> {
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
                html: await renderOrderConfirmedEmail({
                    customerName: payload.customerName || 'عميلنا العزيز',
                    orderNumber: payload.orderNumber,
                }),
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
    } else {
        throw new Error(`Unknown outbox event type: ${event.eventType}`);
    }

    await markProcessed(database, event.id);
}

/**
 * Once attempts are exhausted a campaign recipient must not be left 'pending'
 * forever (the campaign would never leave 'sending'): record the failure,
 * count it, and re-check completion the same way the success path does.
 */
async function finalizeDeadLetteredCampaignRecipient(database: typeof db, event: OutboxEvent, errorMessage: string): Promise<void> {
    try {
        const payload = JSON.parse(event.payload) as CampaignRecipientSendPayload;
        await database.transaction(async (tx) => {
            const [recipient] = await tx.select().from(campaignRecipients)
                .where(and(eq(campaignRecipients.id, payload.recipientId), eq(campaignRecipients.orgId, payload.orgId)));
            if (!recipient || recipient.status !== 'pending') return;

            await tx.update(campaignRecipients)
                .set({ status: 'failed', error: errorMessage, updatedAt: new Date() })
                .where(eq(campaignRecipients.id, recipient.id));
            await tx.update(campaigns)
                .set({ failedCount: sql`${campaigns.failedCount} + 1`, updatedAt: new Date() })
                .where(eq(campaigns.id, recipient.campaignId));

            const [remaining] = await tx.select({ count: sql<number>`count(*)` }).from(campaignRecipients)
                .where(and(eq(campaignRecipients.campaignId, recipient.campaignId), eq(campaignRecipients.status, 'pending')));
            if (Number(remaining.count) === 0) {
                await tx.update(campaigns)
                    .set({ status: 'failed', updatedAt: new Date() })
                    .where(eq(campaigns.id, recipient.campaignId));
            }
        });
    } catch (finalizeError) {
        console.error('Failed to finalize dead-lettered campaign recipient', finalizeError);
    }
}

/**
 * Claims one batch of pending events and dispatches each to its handler.
 * On a handler error, bumps `attempts`/`lastError` and (for every type except
 * ETA, which keeps its own retry state) sets a jittered exponential
 * `nextRetryAt`; a campaign recipient about to cross the attempts<5 ceiling is
 * dead-letter finalized so its campaign can complete.
 */
async function dispatchEvent(database: typeof db, event: OutboxEvent): Promise<void> {
    switch (event.eventType) {
        case 'shopify.product.push':
            return handleShopifyProductPush(database, event);
        case 'eta.invoice.issue':
            return handleEtaInvoiceIssue(database, event);
        case 'campaign.recipient.send':
            return handleCampaignRecipientSend(database, event);
        case 'org.invite.sent':
            return handleOrgInviteSent(database, event);
        case 'order.confirmed':
        case 'order.shipped':
            return handleOrderNotification(database, event);
        default:
            throw new Error(`Unknown outbox event type: ${event.eventType}`);
    }
}

async function recordEventFailure(database: typeof db, event: OutboxEvent, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // ETA keeps its own retry state on eta_invoices. All other
    // event types share this outbox-level cooldown.
    const baseBackoffMinutes = Math.min(2 ** (event.attempts + 1), 60);
    // +/-20% jitter prevents every event delayed by the same
    // provider outage from becoming eligible on the same tick.
    // Clamp after jitter so the established 60-minute ceiling
    // remains a hard cap.
    const jitteredBackoffMinutes = Math.min(
        baseBackoffMinutes * (0.8 + Math.random() * 0.4),
        60,
    );
    const nextRetryAt = event.eventType === 'eta.invoice.issue'
        ? undefined
        : new Date(Date.now() + jitteredBackoffMinutes * 60_000);
    const attemptsAfterThis = event.attempts + 1;
    await database.update(outboxEvents)
        .set({
            attempts: attemptsAfterThis,
            lastError: errorMessage,
            ...(nextRetryAt ? { nextRetryAt } : {})
        })
        .where(eq(outboxEvents.id, event.id));

    // The claim query excludes attempts >= 5 — this event is
    // about to become permanently dead-lettered.
    if (event.eventType === 'campaign.recipient.send' && attemptsAfterThis >= 5) {
        await finalizeDeadLetteredCampaignRecipient(database, event, errorMessage);
    }
}

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
        const pendingEvents = await database.transaction(async (tx) => {
            const now = new Date();
            const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
            const toClaim = await tx.select()
                .from(outboxEvents)
                .where(
                    and(
                        eq(outboxEvents.processed, false),
                        lt(outboxEvents.attempts, 5),
                        or(
                            isNull(outboxEvents.nextRetryAt),
                            lte(outboxEvents.nextRetryAt, now)
                        ),
                        or(
                            isNull(outboxEvents.claimedAt),
                            lt(outboxEvents.claimedAt, staleThreshold)
                        )
                    )
                )
                .limit(OUTBOX_BATCH_SIZE)
                .for('update', { skipLocked: true });

            if (toClaim.length === 0) return [];

            await tx.update(outboxEvents)
                .set({ claimedAt: new Date() })
                .where(inArray(outboxEvents.id, toClaim.map(e => e.id)));

            return toClaim;
        });

        for (const event of pendingEvents) {
            try {
                await dispatchEvent(database, event);
            } catch (error) {
                await recordEventFailure(database, event, error);
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
