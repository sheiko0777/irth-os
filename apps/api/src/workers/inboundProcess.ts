import {
  CandidateOrderSchema,
  SECTIONS,
  SUPPORTED_CURRENCIES,
  type Blocker,
  type CandidateOrder,
  type FetchStatus,
  type Section,
  type Sections,
  validateCandidate,
} from '@irth/domain';
import {
  db,
  inboundDeliveries,
  orderImportCandidates,
  outboxEvents,
  promoteCandidate,
  shopifyConnections,
  variantSourceLinks,
  withOrgContext,
  type DbTx,
  type InboundCandidateReprocessPayload,
  type InboundDeliveryProcessPayload,
} from '@irth/db';
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { hydrateShopifyOrder } from '../services/shopifyOrderHydrate';
import { normalizeShopifyOrder } from '../services/shopifyOrderNormalize';
import { envVar } from '../utils/env';

// OR-10 worker handlers. Thin on purpose: promotion itself lives in
// packages/db (promoteCandidate) so admin ops can call it directly. Network
// calls (hydration) always run OUTSIDE a transaction.

type Database = typeof db;
type OutboxEvent = typeof outboxEvents.$inferSelect;
type Candidate = typeof orderImportCandidates.$inferSelect;
type Link = { variantId: string | null; lineKind: 'mapped' | 'custom_nonstock' };

const CONNECTOR_VERSION = 'irth-shopify-order-import/v1';
/** Blockers only a fresh fetch can clear — a reprocess with any of them refetches. */
const FETCH_BLOCKERS = new Set<string>(['hydrate_failed', 'pagination_incomplete', 'line_lost']);
/** Candidates nothing here may touch again. */
const TERMINAL: Array<Candidate['status']> = ['promoted', 'superseded', 'discarded'];

export async function handleInboundDeliveryProcess(database: Database, event: OutboxEvent): Promise<void> {
  const payload = JSON.parse(event.payload) as InboundDeliveryProcessPayload;
  try {
    const loaded = await withOrgContext(database, payload.orgId, async (tx) => {
      const [delivery] = await tx.select().from(inboundDeliveries)
        .where(and(eq(inboundDeliveries.id, payload.deliveryId), eq(inboundDeliveries.orgId, payload.orgId)))
        .for('update');
      if (!delivery || delivery.status === 'processed') return null;
      if (delivery.provider !== 'shopify' || !delivery.connectionId) throw new Error('inbound delivery has no Shopify connection');
      const connection = await loadConnection(tx, payload.orgId, delivery.connectionId);
      const links = await loadLinks(tx, payload.orgId, delivery.connectionId);
      await tx.update(inboundDeliveries).set({ status: 'processing', error: null })
        .where(and(eq(inboundDeliveries.id, delivery.id), eq(inboundDeliveries.orgId, payload.orgId)));
      return { delivery, connection, links };
    });
    if (!loaded) return markOutboxProcessed(database, event.id);

    const hydrated = await hydrateShopifyOrder(loaded.connection, sourceOrderIdFromPayload(loaded.delivery.payload));
    if (!hydrated.order) throw new Error('Shopify order hydration returned no order');
    const normalized = normalizeShopifyOrder(hydrated.order, {
      shopDomain: loaded.connection.shopDomain,
      links: loaded.links,
      evidence: {
        inboundDeliveryId: loaded.delivery.id,
        apiVersion: hydrated.apiVersion,
        connectorVersion: CONNECTOR_VERSION,
        fetchedAt: new Date().toISOString(),
      },
    });
    const validation = validate(normalized, hydrated.sectionsFetch, hydrated.paginationComplete);
    const retry = isRetryable(validation.blockers);

    await withOrgContext(database, payload.orgId, async (tx) => {
      const candidateId = await upsertCandidate(tx, payload.orgId, loaded.connection.id, loaded.delivery.id, normalized, validation, hydrated.apiVersion);
      if (validation.blockers.length === 0) await promoteIfEnabled(tx, payload.orgId, candidateId, event.id);
      await tx.update(inboundDeliveries)
        .set(retry
          ? { status: 'failed', error: 'hydrate_failed' }
          : { status: 'processed', processedAt: new Date(), error: null })
        .where(and(eq(inboundDeliveries.id, loaded.delivery.id), eq(inboundDeliveries.orgId, payload.orgId)));
    });
    // The blocked candidate is already visible; throwing hands the transient
    // fetch failure to the outbox backoff. Exhaustion keeps it blocked.
    if (retry) throw new Error('Shopify order hydration incomplete (hydrate_failed)');
    await markOutboxProcessed(database, event.id);
  } catch (err) {
    await markDeliveryFailed(database, payload, err);
    throw err;
  }
}

export async function handleInboundCandidateReprocess(database: Database, event: OutboxEvent): Promise<void> {
  const payload = JSON.parse(event.payload) as InboundCandidateReprocessPayload;
  const loaded = await withOrgContext(database, payload.orgId, async (tx) => {
    const [candidate] = await tx.select().from(orderImportCandidates)
      .where(and(eq(orderImportCandidates.id, payload.candidateId), eq(orderImportCandidates.orgId, payload.orgId)))
      .limit(1);
    if (!candidate?.connectionId || TERMINAL.includes(candidate.status)) return null;
    const connection = await loadConnection(tx, payload.orgId, candidate.connectionId);
    const links = await loadLinks(tx, payload.orgId, candidate.connectionId);
    return { candidate, connection, links };
  });
  if (!loaded) return markOutboxProcessed(database, event.id);

  const { candidate, connection, links } = loaded;
  const storedBlockers = candidate.blockers as Blocker[];
  const refetch = payload.refetch === true || !candidate.normalized || storedBlockers.some((b) => FETCH_BLOCKERS.has(b.code));

  let normalized: CandidateOrder;
  let validation: ReturnType<typeof validate>;
  let apiVersion = candidate.apiVersion ?? connection.apiVersion;
  if (refetch) {
    const hydrated = await hydrateShopifyOrder(connection, candidate.sourceOrderId);
    if (!hydrated.order) throw new Error('Shopify order hydration returned no order');
    apiVersion = hydrated.apiVersion;
    normalized = normalizeShopifyOrder(hydrated.order, {
      shopDomain: connection.shopDomain,
      links,
      evidence: {
        inboundDeliveryId: candidate.inboundDeliveryId ?? candidate.id,
        apiVersion,
        connectorVersion: CONNECTOR_VERSION,
        fetchedAt: new Date().toISOString(),
      },
    });
    validation = validate(normalized, hydrated.sectionsFetch, hydrated.paginationComplete);
  } else {
    // Re-validate the stored snapshot against today's mappings, keeping the
    // fetch outcome recorded on its sections (a redacted buyer stays redacted).
    normalized = remapLines(CandidateOrderSchema.parse(candidate.normalized), links);
    const stored = candidate.sections as Partial<Record<Section, { status?: string }>>;
    validation = validate(normalized, Object.fromEntries(SECTIONS.map((s) => [s, stored[s]?.status ?? 'loaded'])), true);
  }
  const retry = isRetryable(validation.blockers);

  await withOrgContext(database, payload.orgId, async (tx) => {
    const candidateId = await upsertCandidate(tx, payload.orgId, connection.id, candidate.inboundDeliveryId, normalized, validation, apiVersion);
    if (candidateId !== candidate.id) {
      // A refetch found a newer provider version: it lives on its own row.
      await tx.update(orderImportCandidates).set({ status: 'superseded', updatedAt: new Date() })
        .where(and(
          eq(orderImportCandidates.id, candidate.id),
          eq(orderImportCandidates.orgId, payload.orgId),
          inArray(orderImportCandidates.status, ['hydrating', 'blocked']),
        ));
    }
    if (validation.blockers.length === 0) await promoteIfEnabled(tx, payload.orgId, candidateId, event.id);
  });
  if (retry) throw new Error('Shopify order hydration incomplete (hydrate_failed)');
  await markOutboxProcessed(database, event.id);
}

/**
 * Called once an inbound event exhausts OUTBOX_MAX_ATTEMPTS: the import must
 * end as a visible blocked candidate with hydrate_failed, never as a silent
 * dead letter. Never throws (it runs inside the worker's failure path).
 */
export async function blockInboundImportAfterExhaustion(database: Database, event: OutboxEvent, error: unknown): Promise<void> {
  const message = safeErrorMessage(error);
  try {
    if (event.eventType === 'inbound.candidate.reprocess') {
      const payload = JSON.parse(event.payload) as InboundCandidateReprocessPayload;
      await withOrgContext(database, payload.orgId, (tx) => blockCandidate(tx, payload.orgId, payload.candidateId, message));
      return;
    }
    if (event.eventType !== 'inbound.delivery.process') return;
    const payload = JSON.parse(event.payload) as InboundDeliveryProcessPayload;
    await withOrgContext(database, payload.orgId, async (tx) => {
      const [delivery] = await tx.select().from(inboundDeliveries)
        .where(and(eq(inboundDeliveries.id, payload.deliveryId), eq(inboundDeliveries.orgId, payload.orgId)))
        .limit(1);
      if (!delivery || delivery.status === 'processed') return;
      await tx.update(inboundDeliveries).set({ status: 'blocked', error: message })
        .where(and(eq(inboundDeliveries.id, delivery.id), eq(inboundDeliveries.orgId, payload.orgId)));

      // Hydration got far enough to stage a candidate: block that one.
      const staged = await tx.select({ id: orderImportCandidates.id }).from(orderImportCandidates)
        .where(and(eq(orderImportCandidates.orgId, payload.orgId), eq(orderImportCandidates.inboundDeliveryId, delivery.id)));
      if (staged.length > 0) {
        for (const c of staged) await blockCandidate(tx, payload.orgId, c.id, message);
        return;
      }
      const sourceOrderId = trySourceOrderId(delivery.payload);
      if (!delivery.connectionId || !sourceOrderId) return; // nothing to key a candidate on; the delivery row is blocked
      // Evidence-only row keyed by the webhook's own updated_at (no fetched
      // version exists); a later reprocess refetches and supersedes it.
      await tx.insert(orderImportCandidates).values({
        orgId: payload.orgId,
        connectionId: delivery.connectionId,
        provider: delivery.provider,
        sourceOrderId,
        sourceOrderNumber: sourceOrderNumberFromPayload(delivery.payload),
        sourceUpdatedAt: sourceUpdatedAtFromPayload(delivery.payload, delivery.triggeredAt ?? delivery.receivedAt),
        inboundDeliveryId: delivery.id,
        status: 'blocked',
        sections: failedSections(),
        blockers: [hydrateFailedBlocker(message)],
        apiVersion: delivery.apiVersion,
        connectorVersion: CONNECTOR_VERSION,
        lastError: message,
      }).onConflictDoNothing();
    });
  } catch (blockError) {
    // Ids only: no payload, no message text that could carry buyer data.
    console.error('[inboundProcess] failed to block exhausted import', { outboxEventId: event.id, orgId: event.orgId, eventType: event.eventType, cause: safeErrorMessage(blockError) });
  }
}

/**
 * Kill switch, default OFF: while the legacy /orders-create webhook still
 * creates orders, promoting from the inbox too could double-import. When off,
 * the candidate is still hydrated, validated and staged — only promotion is
 * skipped. A staged 'hydrating' candidate is promoted later by an
 * 'inbound.candidate.reprocess' once the switch is on.
 */
async function promoteIfEnabled(tx: DbTx, orgId: string, candidateId: string, outboxEventId: string): Promise<void> {
  if (envVar('INBOX_PROMOTION_ENABLED') === '1') {
    await promoteCandidate(tx, { orgId, candidateId });
    return;
  }
  console.info('[inboundProcess] promotion disabled (INBOX_PROMOTION_ENABLED!=1); candidate staged', { orgId, candidateId, outboxEventId });
}

async function blockCandidate(tx: DbTx, orgId: string, candidateId: string, message: string): Promise<void> {
  const [candidate] = await tx.select().from(orderImportCandidates)
    .where(and(eq(orderImportCandidates.id, candidateId), eq(orderImportCandidates.orgId, orgId)))
    .for('update');
  if (!candidate || TERMINAL.includes(candidate.status)) return;
  const kept = (candidate.blockers as Blocker[]).filter((b) => b.code !== 'hydrate_failed');
  await tx.update(orderImportCandidates).set({
    status: 'blocked',
    blockers: [...kept, hydrateFailedBlocker(message)],
    lastError: message,
    updatedAt: new Date(),
  }).where(and(eq(orderImportCandidates.id, candidate.id), eq(orderImportCandidates.orgId, orgId)));
}

async function loadConnection(tx: DbTx, orgId: string, connectionId: string) {
  const [connection] = await tx.select().from(shopifyConnections)
    .where(and(eq(shopifyConnections.id, connectionId), eq(shopifyConnections.orgId, orgId)))
    .limit(1);
  if (!connection) throw new Error('Shopify connection not found');
  return connection;
}

async function loadLinks(tx: DbTx, orgId: string, connectionId: string): Promise<Map<string, Link>> {
  const rows = await tx.select({
    sourceVariantId: variantSourceLinks.sourceVariantId,
    variantId: variantSourceLinks.variantId,
    lineKind: variantSourceLinks.lineKind,
  }).from(variantSourceLinks)
    .where(and(eq(variantSourceLinks.orgId, orgId), eq(variantSourceLinks.connectionId, connectionId), ne(variantSourceLinks.state, 'deleted')));
  return new Map(rows.map((row) => [row.sourceVariantId, { variantId: row.variantId, lineKind: row.lineKind }]));
}

/**
 * Upserts the candidate row for this provider version and returns its id.
 * A row already promoted / superseded / discarded is left untouched (a
 * same-version redelivery must not rewrite an accepted snapshot).
 */
async function upsertCandidate(
  tx: DbTx,
  orgId: string,
  connectionId: string,
  inboundDeliveryId: string | null,
  normalized: CandidateOrder,
  validation: { sections: Sections; blockers: Blocker[] },
  apiVersion: string,
): Promise<string> {
  const sourceUpdatedAt = new Date(normalized.header.source_updated_at);
  const values = {
    inboundDeliveryId,
    status: validation.blockers.length > 0 ? 'blocked' as const : 'hydrating' as const,
    normalized,
    sections: validation.sections,
    blockers: validation.blockers,
    lineCount: normalized.lines.length,
    apiVersion,
    connectorVersion: CONNECTOR_VERSION,
    lastError: null,
  };
  const [row] = await tx.insert(orderImportCandidates).values({
    orgId,
    connectionId,
    provider: 'shopify',
    sourceOrderId: normalized.header.source_order_id,
    sourceOrderNumber: normalized.header.source_order_number ?? null,
    sourceUpdatedAt,
    ...values,
  }).onConflictDoUpdate({
    target: [orderImportCandidates.provider, orderImportCandidates.connectionId, orderImportCandidates.sourceOrderId, orderImportCandidates.sourceUpdatedAt],
    set: { ...values, attempts: sql`${orderImportCandidates.attempts} + 1`, updatedAt: new Date() },
    setWhere: notInArray(orderImportCandidates.status, TERMINAL),
  }).returning({ id: orderImportCandidates.id });
  if (row) return row.id;

  const [existing] = await tx.select({ id: orderImportCandidates.id }).from(orderImportCandidates)
    .where(and(
      eq(orderImportCandidates.orgId, orgId),
      eq(orderImportCandidates.provider, 'shopify'),
      eq(orderImportCandidates.connectionId, connectionId),
      eq(orderImportCandidates.sourceOrderId, normalized.header.source_order_id),
      eq(orderImportCandidates.sourceUpdatedAt, sourceUpdatedAt),
    ))
    .limit(1);
  if (!existing) throw new Error('candidate upsert returned no row');
  return existing.id;
}

/**
 * validateCandidate's FetchStatus only admits redaction statuses on buyer /
 * addresses. Any other section the provider did not expose (e.g. risk on
 * `context`) validates as loaded and is restamped afterwards, so an optional
 * path never blocks — or crashes — an import.
 */
function validate(normalized: CandidateOrder, statuses: Partial<Record<Section, string>>, paginationComplete: boolean) {
  const fetch: Record<string, string> = {};
  const restamp: Array<[Section, string]> = [];
  for (const section of SECTIONS) {
    const status = statuses[section] ?? 'loaded';
    const redaction = status === 'permission_denied' || status === 'not_exposed_by_provider';
    if (status === 'fetch_failed' || (redaction && (section === 'buyer' || section === 'addresses'))) fetch[section] = status;
    else {
      fetch[section] = 'loaded';
      if (redaction) restamp.push([section, status]);
    }
  }
  const result = validateCandidate(
    normalized,
    { ...fetch, paginationComplete, sourceLineCount: normalized.lines.length } as FetchStatus,
    {
      connectionDimensionsResolved: true, // TODO(OR-10/DM): resolve from the connection once orders carries legal_entity/brand/channel.
      supportedCurrencies: SUPPORTED_CURRENCIES,
    },
  );
  const sections = { ...result.sections } as Sections;
  for (const [section, status] of restamp) {
    sections[section] = { status: status as Sections[Section]['status'], fetchedAt: normalized.evidence.fetched_at };
  }
  return { sections, blockers: result.blockers };
}

function isRetryable(blockers: Blocker[]): boolean {
  return blockers.some((b) => b.code === 'hydrate_failed');
}

function remapLines(candidate: CandidateOrder, links: Map<string, Link>): CandidateOrder {
  return CandidateOrderSchema.parse({
    ...candidate,
    lines: candidate.lines.map((line) => {
      const link = links.get(line.source_variant_id ?? `line:${line.source_line_id}`);
      const mapping = link?.lineKind === 'custom_nonstock'
        ? { state: 'custom_nonstock' as const }
        : link?.variantId
          ? { state: 'mapped' as const, variant_id: link.variantId }
          : { state: 'unmapped' as const };
      return { ...line, mapping };
    }),
  });
}

async function markOutboxProcessed(database: Database, eventId: string): Promise<void> {
  await database.update(outboxEvents).set({ processed: true, processedAt: new Date() }).where(eq(outboxEvents.id, eventId));
}

async function markDeliveryFailed(database: Database, payload: InboundDeliveryProcessPayload, err: unknown): Promise<void> {
  await withOrgContext(database, payload.orgId, async (tx) => {
    await tx.update(inboundDeliveries).set({
      status: 'failed',
      error: safeErrorMessage(err),
      attempts: sql`${inboundDeliveries.attempts} + 1`,
    }).where(and(
      eq(inboundDeliveries.id, payload.deliveryId),
      eq(inboundDeliveries.orgId, payload.orgId),
      ne(inboundDeliveries.status, 'processed'),
    ));
  }).catch(() => undefined);
}

/**
 * The driver-level message only. drizzle's DrizzleQueryError message embeds the
 * query PARAMS (buyer names, emails, addresses), so it must never be stored
 * on a candidate or shown in the Import-blocked queue.
 */
export function safeErrorMessage(err: unknown): string {
  const cause = (err as { cause?: unknown } | null)?.cause;
  const source = cause instanceof Error ? cause : err;
  return (source instanceof Error ? source.message : String(source)).slice(0, 500);
}

function sourceOrderIdFromPayload(payload: unknown): string {
  const id = trySourceOrderId(payload);
  if (!id) throw new Error('inbound delivery payload does not contain an order id');
  return id;
}

/** orders/* carry the order itself; refunds, fulfillments and transactions carry order_id; orders/edited nests it in order_edit. */
function trySourceOrderId(payload: unknown): string | null {
  const record = objectPayload(payload);
  const id = stringValue(objectPayload(record.order_edit).order_id)
    ?? stringValue(record.order_id)
    ?? stringValue(record.admin_graphql_api_id)
    ?? stringValue(record.id);
  if (!id) return null;
  return id.startsWith('gid://') ? id : `gid://shopify/Order/${id}`;
}

function sourceOrderNumberFromPayload(payload: unknown): string | null {
  const record = objectPayload(payload);
  return stringValue(record.name) ?? stringValue(record.order_number);
}

function sourceUpdatedAtFromPayload(payload: unknown, fallback: Date): Date {
  const record = objectPayload(payload);
  const value = stringValue(record.updated_at);
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function objectPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}

function failedSections() {
  const fetchedAt = new Date().toISOString();
  return Object.fromEntries(SECTIONS.map((section) => [section, { status: 'fetch_failed', fetchedAt }]));
}

function hydrateFailedBlocker(message: string): Blocker {
  return { code: 'hydrate_failed', section: 'evidence', detail: message, nextAction: 'orders.import.next.retryHydration' };
}
