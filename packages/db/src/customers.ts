import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { DbTx } from './index';
import { customerIdentities, type CustomerIdentityKind } from './schema/customers';

// DM-06: identity lookups over customer_identities (0087). Read/insert only —
// merging stays an explicit, separate operation; nothing here re-points rows.

export type CustomerIdentity = typeof customerIdentities.$inferSelect;

export interface IdentityKey {
  kind: CustomerIdentityKind;
  connectionId: string | null;
  externalId: string;
}

/** Emails compare case-insensitively; every external id is trimmed. */
export function normalizeIdentityExternalId(kind: CustomerIdentityKind, externalId: string): string {
  const trimmed = externalId.trim();
  return kind === 'email' ? trimmed.toLowerCase() : trimmed;
}

function keyWhere(orgId: string, key: IdentityKey) {
  return and(
    eq(customerIdentities.orgId, orgId),
    eq(customerIdentities.kind, key.kind),
    key.connectionId === null ? isNull(customerIdentities.connectionId) : eq(customerIdentities.connectionId, key.connectionId),
    eq(customerIdentities.externalId, normalizeIdentityExternalId(key.kind, key.externalId)),
  );
}

export async function findCustomerByIdentity(
  tx: Pick<DbTx, 'select'>,
  orgId: string,
  key: IdentityKey,
): Promise<string | null> {
  const [row] = await tx.select({ customerId: customerIdentities.customerId })
    .from(customerIdentities).where(keyWhere(orgId, key)).limit(1);
  return row?.customerId ?? null;
}

/**
 * Records an identity; a no-op when (org, kind, connection, external_id)
 * already exists. Returns the stored row — which may belong to a DIFFERENT
 * customer if the identity was already claimed; callers that care compare
 * customerId. Returns null for a blank external id.
 */
export async function upsertIdentity(
  tx: Pick<DbTx, 'select' | 'insert'>,
  orgId: string,
  input: IdentityKey & { customerId: string; verified?: boolean },
): Promise<CustomerIdentity | null> {
  const externalId = normalizeIdentityExternalId(input.kind, input.externalId);
  if (!externalId) return null;
  const [inserted] = await tx.insert(customerIdentities).values({
    orgId,
    customerId: input.customerId,
    connectionId: input.connectionId,
    kind: input.kind,
    externalId,
    verified: input.verified ?? false,
  }).onConflictDoNothing().returning();
  if (inserted) return inserted;
  const [existing] = await tx.select().from(customerIdentities)
    .where(keyWhere(orgId, { ...input, externalId })).limit(1);
  return existing ?? null;
}

export interface MergeCandidate {
  customerId: string;
  /** 3 = verified shopify/woocommerce id, 2 = phone, 1 = email, 0 = other. */
  strength: number;
  /** Which shared identity kinds linked this candidate to the customer. */
  matchedOn: Array<'email' | 'phone'>;
}

function identityStrength(kind: CustomerIdentityKind, verified: boolean): number {
  if ((kind === 'shopify' || kind === 'woocommerce') && verified) return 3;
  if (kind === 'phone') return 2;
  if (kind === 'email') return 1;
  return 0;
}

/**
 * Pure ranking behind suggestMerge: a candidate's strength is its strongest
 * identity; ties go to a phone match over an email-only one, then customerId.
 */
export function rankMergeCandidates(
  matches: Array<{ customerId: string; kind: 'email' | 'phone' }>,
  candidateIdentities: Array<{ customerId: string; kind: CustomerIdentityKind; verified: boolean }>,
): MergeCandidate[] {
  const byId = new Map<string, MergeCandidate>();
  for (const m of matches) {
    const c = byId.get(m.customerId) ?? { customerId: m.customerId, strength: 0, matchedOn: [] };
    if (!c.matchedOn.includes(m.kind)) c.matchedOn.push(m.kind);
    byId.set(m.customerId, c);
  }
  for (const i of candidateIdentities) {
    const c = byId.get(i.customerId);
    if (c) c.strength = Math.max(c.strength, identityStrength(i.kind, i.verified));
  }
  const phoneRank = (c: MergeCandidate) => (c.matchedOn.includes('phone') ? 1 : 0);
  return [...byId.values()]
    .map((c) => ({ ...c, matchedOn: c.matchedOn.sort() }))
    .sort((a, b) => b.strength - a.strength || phoneRank(b) - phoneRank(a) || a.customerId.localeCompare(b.customerId));
}

/**
 * Other customers in the org holding an email/phone identity with the same
 * external id as one of this customer's (on any connection). Read-only — it
 * suggests, the caller decides; there is no auto-merge.
 */
export async function suggestMerge(
  tx: Pick<DbTx, 'select'>,
  orgId: string,
  customerId: string,
): Promise<MergeCandidate[]> {
  const own = await tx.select({ kind: customerIdentities.kind, externalId: customerIdentities.externalId })
    .from(customerIdentities)
    .where(and(
      eq(customerIdentities.orgId, orgId),
      eq(customerIdentities.customerId, customerId),
      inArray(customerIdentities.kind, ['email', 'phone']),
    ));
  if (own.length === 0) return [];

  const matches = await tx.select({ customerId: customerIdentities.customerId, kind: customerIdentities.kind })
    .from(customerIdentities)
    .where(and(
      eq(customerIdentities.orgId, orgId),
      ne(customerIdentities.customerId, customerId),
      or(...own.map((o) => and(eq(customerIdentities.kind, o.kind), eq(customerIdentities.externalId, o.externalId)))),
    ));
  if (matches.length === 0) return [];

  const candidateIds = [...new Set(matches.map((m) => m.customerId))];
  const identities = await tx.select({
    customerId: customerIdentities.customerId, kind: customerIdentities.kind, verified: customerIdentities.verified,
  }).from(customerIdentities)
    .where(and(eq(customerIdentities.orgId, orgId), inArray(customerIdentities.customerId, candidateIds)));

  return rankMergeCandidates(matches as Array<{ customerId: string; kind: 'email' | 'phone' }>, identities);
}
