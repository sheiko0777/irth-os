import { and, eq } from 'drizzle-orm';
import { connections, createConnection, listConnections, shopifyConnections, type ConnectionOpCtx, type ConnectionSummary, type DbTx } from '@irth/db';
import {
  getConnectionSecret,
  keyringFromEnv,
  putConnectionSecret,
  rotateConnectionSecrets,
  type Keyring,
  type SecretAddress,
} from '@irth/db/src/secrets';
import { envVar } from '../../utils/env';
import { decryptShopifyToken } from '../../services/shopifyConnection';

/**
 * The only door in apps/api to connection secrets (CX-07). Everything outside
 * src/integrations/kernel/ must go through here; secretsImportGate.test.ts
 * fails the build otherwise. Values returned by readConnectionSecret are
 * plaintext: never return them from a route or log them.
 *
 * KEK: CONNECTION_SECRETS_KEY_V<n> Worker secret (base64, 32 bytes), write
 * version CONNECTION_SECRETS_KEY_VERSION (default 1). Missing → throws
 * ConnectionSecretsKeyError naming the variable.
 */
export function connectionKeyring(): Keyring {
  return keyringFromEnv(envVar);
}

export async function readConnectionSecret(tx: Pick<DbTx, 'select'>, address: SecretAddress): Promise<string | null> {
  return getConnectionSecret(tx, connectionKeyring(), address);
}

export async function writeConnectionSecret(tx: DbTx, ctx: ConnectionOpCtx, input: { connectionId: string; name: string; value: string }) {
  return putConnectionSecret(tx, ctx, connectionKeyring(), input);
}

export async function rotateConnectionKeys(tx: DbTx, versions: { fromVersion: number; toVersion: number }): Promise<number> {
  return rotateConnectionSecrets(tx, connectionKeyring(), versions);
}

/**
 * Import gate: copies ONE existing shopify_connections credential into
 * connections + connection_secrets, only when called explicitly (no route or
 * cron calls it). The legacy row is left untouched, so the live Shopify
 * webhook/import path keeps working until CX-12 switches over. Idempotent:
 * a store already imported is returned as is, nothing re-encrypted.
 */
export async function importShopifyCredential(tx: DbTx, ctx: ConnectionOpCtx, shopifyConnectionId: string): Promise<ConnectionSummary> {
  const [legacy] = await tx.select().from(shopifyConnections)
    .where(and(eq(shopifyConnections.id, shopifyConnectionId), eq(shopifyConnections.orgId, ctx.orgId)));
  if (!legacy) throw new Error('Shopify connection not found');

  const [already] = await tx.select({ id: connections.id }).from(connections).where(and(
    eq(connections.orgId, ctx.orgId),
    eq(connections.provider, 'shopify'),
    eq(connections.externalAccountId, legacy.shopDomain),
  ));
  const summary = async (id: string) => {
    const found = (await listConnections(tx, ctx, { family: 'storefront' })).find((c) => c.id === id);
    if (!found) throw new Error('Connection not found');
    return found;
  };
  if (already) return summary(already.id);

  const token = await decryptShopifyToken(legacy);
  const connection = await createConnection(tx, ctx, {
    provider: 'shopify',
    family: 'storefront',
    name: legacy.shopDomain,
    externalAccountId: legacy.shopDomain,
    status: legacy.status === 'active' ? 'active' : 'disabled',
    config: {
      scopes: legacy.scopes,
      apiVersion: legacy.apiVersion,
      inventoryLocationId: legacy.inventoryLocationId,
      importedFromShopifyConnectionId: legacy.id,
    },
  });
  await writeConnectionSecret(tx, ctx, { connectionId: connection.id, name: 'access_token', value: token });
  return summary(connection.id);
}
