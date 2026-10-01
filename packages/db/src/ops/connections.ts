import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { auditLog } from '../schema';
import { CONNECTION_FAMILIES, CONNECTION_STATUSES, connectionSecrets, connections } from '../schema/connections';
import type { AuditActorKind, AuditChannel, DbTx } from '../index';

/**
 * Connection metadata ops (CX-07). Nothing here encrypts or decrypts: secret
 * values go through packages/db/src/secrets.ts, and every output below is
 * parsed through a .strict() zod schema that has no ciphertext, key or
 * plaintext field, so a widened select cannot leak one.
 *
 * All ops take a transaction from withOrgContext — RLS plus the composite
 * (x_id, org_id) FKs keep them inside ctx.orgId.
 */

export interface ConnectionOpCtx {
  orgId: string;
  userId: string | null;
  actorKind?: AuditActorKind;
  channel?: AuditChannel;
  requestId?: string | null;
}

type Tx = Pick<DbTx, 'select' | 'insert' | 'update' | 'delete' | 'rollback'>;

/** Audit row for a connection/secret change. `changes` must never carry a secret value. */
export async function auditConnectionChange(
  tx: Pick<DbTx, 'insert' | 'rollback'>,
  ctx: ConnectionOpCtx,
  action: string,
  tableName: 'connections' | 'connection_secrets',
  recordId: string | null,
  changes: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action,
    tableName,
    recordId,
    changes,
    actorKind: ctx.actorKind ?? 'user',
    channel: ctx.channel ?? 'admin',
    requestId: ctx.requestId ?? null,
  });
}

// Keys that look like credentials are refused in config: secrets belong in
// connection_secrets, and config is returned to every viewer.
const SECRET_LIKE_KEY = /secret|token|password|passwd|api_?key|private/i;

export const ConnectionConfig = z.record(z.unknown()).refine(
  (cfg) => Object.keys(cfg).every((k) => !SECRET_LIKE_KEY.test(k)),
  { message: 'config must not contain credential-like keys; store them with putConnectionSecret' },
);

export const CreateConnectionInput = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  family: z.enum(CONNECTION_FAMILIES),
  name: z.string().trim().min(1).max(200),
  externalAccountId: z.string().trim().min(1).max(255).nullish(),
  brandId: z.string().uuid().nullish(),
  legalEntityId: z.string().uuid().nullish(),
  status: z.enum(CONNECTION_STATUSES).default('pending'),
  priority: z.number().int().min(0).max(1000).default(0),
  config: ConnectionConfig.default({}),
});
export type CreateConnectionInput = z.input<typeof CreateConnectionInput>;

export const ConnectionSecretMeta = z.object({
  name: z.string(),
  keyVersion: z.number().int(),
  last4: z.string().nullable(),
  createdAt: z.date(),
  rotatedAt: z.date().nullable(),
}).strict();
export type ConnectionSecretMeta = z.infer<typeof ConnectionSecretMeta>;

export const ConnectionSummary = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  family: z.enum(CONNECTION_FAMILIES),
  name: z.string(),
  externalAccountId: z.string().nullable(),
  brandId: z.string().uuid().nullable(),
  legalEntityId: z.string().uuid().nullable(),
  status: z.enum(CONNECTION_STATUSES),
  priority: z.number().int(),
  config: z.record(z.unknown()),
  health: z.unknown(),
  lastError: z.string().nullable(),
  lastHealthAt: z.date().nullable(),
  lastWebhookAt: z.date().nullable(),
  disabledAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  secrets: z.array(ConnectionSecretMeta),
}).strict();
export type ConnectionSummary = z.infer<typeof ConnectionSummary>;

const summaryColumns = {
  id: connections.id,
  provider: connections.provider,
  family: connections.family,
  name: connections.name,
  externalAccountId: connections.externalAccountId,
  brandId: connections.brandId,
  legalEntityId: connections.legalEntityId,
  status: connections.status,
  priority: connections.priority,
  config: connections.config,
  health: connections.health,
  lastError: connections.lastError,
  lastHealthAt: connections.lastHealthAt,
  lastWebhookAt: connections.lastWebhookAt,
  disabledAt: connections.disabledAt,
  createdAt: connections.createdAt,
  updatedAt: connections.updatedAt,
};

/** Metadata only — never selects wrapped_dek / ciphertext / iv columns. */
export async function listConnectionSecretMeta(tx: Tx, connectionIds: string[]): Promise<Map<string, ConnectionSecretMeta[]>> {
  const out = new Map<string, ConnectionSecretMeta[]>();
  if (connectionIds.length === 0) return out;
  const rows = await tx.select({
    connectionId: connectionSecrets.connectionId,
    name: connectionSecrets.name,
    keyVersion: connectionSecrets.keyVersion,
    last4: connectionSecrets.last4,
    createdAt: connectionSecrets.createdAt,
    rotatedAt: connectionSecrets.rotatedAt,
  }).from(connectionSecrets)
    .where(inArray(connectionSecrets.connectionId, connectionIds))
    .orderBy(asc(connectionSecrets.name));
  for (const { connectionId, ...meta } of rows) {
    const list = out.get(connectionId) ?? [];
    list.push(meta);
    out.set(connectionId, list);
  }
  return out;
}

export async function listConnections(tx: Tx, ctx: ConnectionOpCtx, filter: { family?: (typeof CONNECTION_FAMILIES)[number] } = {}): Promise<ConnectionSummary[]> {
  const rows = await tx.select(summaryColumns).from(connections)
    .where(and(eq(connections.orgId, ctx.orgId), filter.family ? eq(connections.family, filter.family) : undefined))
    .orderBy(asc(connections.family), asc(connections.priority), asc(connections.createdAt));
  const secrets = await listConnectionSecretMeta(tx, rows.map((r) => r.id));
  return ConnectionSummary.array().parse(rows.map((r) => ({ ...r, secrets: secrets.get(r.id) ?? [] })));
}

export async function createConnection(tx: Tx, ctx: ConnectionOpCtx, input: CreateConnectionInput): Promise<ConnectionSummary> {
  const data = CreateConnectionInput.parse(input);
  const [row] = await tx.insert(connections).values({ ...data, orgId: ctx.orgId }).returning(summaryColumns);
  await auditConnectionChange(tx, ctx, 'CONNECTION_CREATED', 'connections', row.id, {
    provider: row.provider, family: row.family, name: row.name, externalAccountId: row.externalAccountId, status: row.status,
  });
  return ConnectionSummary.parse({ ...row, secrets: [] });
}

/** Soft-disables; secrets stay so re-enabling needs no re-entry. */
export async function disableConnection(tx: Tx, ctx: ConnectionOpCtx, connectionId: string, reason?: string): Promise<ConnectionSummary> {
  const [row] = await tx.update(connections)
    .set({ status: 'disabled', disabledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(connections.id, connectionId), eq(connections.orgId, ctx.orgId)))
    .returning(summaryColumns);
  if (!row) throw new Error('Connection not found');
  await auditConnectionChange(tx, ctx, 'CONNECTION_DISABLED', 'connections', row.id, { reason: reason ?? null });
  const secrets = await listConnectionSecretMeta(tx, [row.id]);
  return ConnectionSummary.parse({ ...row, secrets: secrets.get(row.id) ?? [] });
}

/** Removes one secret. Audited with the name only. */
export async function deleteConnectionSecret(tx: Tx, ctx: ConnectionOpCtx, connectionId: string, name: string): Promise<boolean> {
  const deleted = await tx.delete(connectionSecrets)
    .where(and(eq(connectionSecrets.connectionId, connectionId), eq(connectionSecrets.orgId, ctx.orgId), eq(connectionSecrets.name, name)))
    .returning({ id: connectionSecrets.id });
  if (deleted.length === 0) return false;
  await auditConnectionChange(tx, ctx, 'CONNECTION_SECRET_DELETED', 'connection_secrets', deleted[0].id, { connectionId, name });
  return true;
}
