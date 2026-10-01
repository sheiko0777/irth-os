import { Buffer } from 'node:buffer';
import { and, eq } from 'drizzle-orm';
import { connectionSecrets } from './schema/connections';
import { auditConnectionChange, type ConnectionOpCtx } from './ops/connections';
import type { DbTx } from './index';

/**
 * Connection secrets kernel (CX-07). SERVER-ONLY — not re-exported from the
 * @irth/db barrel; import '@irth/db/src/secrets'. decryptSecret and
 * getConnectionSecret may only be used inside this file and
 * apps/api/src/integrations/kernel/ (secretsImportGate.test.ts).
 *
 * Envelope encryption with WebCrypto AES-256-GCM (works on Workers and Node —
 * node:crypto's Cipher classes are not available on Workers, see
 * apps/api/src/services/shopifyConnection.ts):
 *   value  --AES-GCM(DEK, iv,     aad)--> ciphertext   (fresh 32-byte DEK per write)
 *   DEK    --AES-GCM(KEK, dek_iv, aad)--> wrapped_dek  (KEK = CONNECTION_SECRETS_KEY_V<key_version>)
 * aad binds org/connection/name, so a row moved to another connection fails.
 * KEK rotation re-wraps the DEK only; the ciphertext never changes.
 *
 * Fails closed: a missing or malformed KEK throws ConnectionSecretsKeyError
 * naming the env var, never falls back to anything.
 */

export const CONNECTION_SECRETS_KEY_VERSION_ENV = 'CONNECTION_SECRETS_KEY_VERSION';
export const connectionSecretsKeyEnv = (version: number) => `CONNECTION_SECRETS_KEY_V${version}`;

export class ConnectionSecretsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionSecretsKeyError';
  }
}

export interface Keyring {
  /** The version new writes are sealed under. */
  readonly currentVersion: number;
  kek(version: number): Promise<CryptoKey>;
}

/**
 * Reads KEKs from env (pass the Worker's envVar or `(k) => process.env[k]`).
 * CONNECTION_SECRETS_KEY_VERSION picks the write version (default 1).
 */
export function keyringFromEnv(read: (name: string) => string | undefined): Keyring {
  const rawVersion = read(CONNECTION_SECRETS_KEY_VERSION_ENV)?.trim() || '1';
  const currentVersion = Number(rawVersion);
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new ConnectionSecretsKeyError(`${CONNECTION_SECRETS_KEY_VERSION_ENV} must be a positive integer`);
  }
  const cache = new Map<number, Promise<CryptoKey>>();
  return {
    currentVersion,
    kek(version: number) {
      let key = cache.get(version);
      if (!key) {
        key = importKek(read, version);
        cache.set(version, key);
      }
      return key;
    },
  };
}

async function importKek(read: (name: string) => string | undefined, version: number): Promise<CryptoKey> {
  const name = connectionSecretsKeyEnv(version);
  const encoded = read(name);
  if (!encoded) throw new ConnectionSecretsKeyError(`${name} is not configured; connection secrets are unavailable`);
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length !== 32) throw new ConnectionSecretsKeyError(`${name} must be a base64-encoded 32-byte key`);
  return crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export interface SealedSecret {
  keyVersion: number;
  wrappedDek: string;
  dekIv: string;
  ciphertext: string;
  iv: string;
}

export interface SecretAddress {
  orgId: string;
  connectionId: string;
  name: string;
}

// WebCrypto's BufferSource wants an ArrayBuffer-backed view; Buffer's type
// allows SharedArrayBuffer, so copy into a plain Uint8Array.
type Bytes = Uint8Array<ArrayBuffer>;
const bytes = (buf: Uint8Array): Bytes => new Uint8Array(buf);

function aad({ orgId, connectionId, name }: SecretAddress): Bytes {
  return bytes(Buffer.from(`irth:connection_secret:${orgId}:${connectionId}:${name}`, 'utf8'));
}

const b64 = (data: ArrayBuffer | Uint8Array) => Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data)).toString('base64');
const unb64 = (value: string): Bytes => bytes(Buffer.from(value, 'base64'));

async function dekKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrapDek(keyring: Keyring, version: number, dek: Bytes, data: Bytes) {
  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: dekIv, additionalData: data }, await keyring.kek(version), dek);
  return { wrappedDek: b64(wrapped), dekIv: b64(dekIv) };
}

async function unwrapDek(keyring: Keyring, sealed: SealedSecret, data: Bytes): Promise<Bytes> {
  const kek = await keyring.kek(sealed.keyVersion);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.dekIv), additionalData: data }, kek, unb64(sealed.wrappedDek)));
  } catch {
    // Never echo key material or ciphertext; the version is enough to act on.
    throw new ConnectionSecretsKeyError(`connection secret cannot be unwrapped with ${connectionSecretsKeyEnv(sealed.keyVersion)}`);
  }
}

export async function encryptSecret(keyring: Keyring, address: SecretAddress, plaintext: string, version = keyring.currentVersion): Promise<SealedSecret> {
  const data = aad(address);
  const dek = crypto.getRandomValues(new Uint8Array(32));
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: data }, await dekKey(dek), bytes(Buffer.from(plaintext, 'utf8')));
    return { keyVersion: version, ...(await wrapDek(keyring, version, dek, data)), ciphertext: b64(ciphertext), iv: b64(iv) };
  } finally {
    dek.fill(0);
  }
}

export async function decryptSecret(keyring: Keyring, address: SecretAddress, sealed: SealedSecret): Promise<string> {
  const data = aad(address);
  const dek = await unwrapDek(keyring, sealed, data);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: data }, await dekKey(dek), unb64(sealed.ciphertext));
    return Buffer.from(plain).toString('utf8');
  } catch {
    throw new ConnectionSecretsKeyError('connection secret failed authentication');
  } finally {
    dek.fill(0);
  }
}

/** KEK rotation for one row: same DEK and ciphertext, DEK re-wrapped under `toVersion`. */
export async function rewrapSecret(keyring: Keyring, address: SecretAddress, sealed: SealedSecret, toVersion: number): Promise<SealedSecret> {
  const data = aad(address);
  const dek = await unwrapDek(keyring, sealed, data);
  try {
    return { ...sealed, keyVersion: toVersion, ...(await wrapDek(keyring, toVersion, dek, data)) };
  } finally {
    dek.fill(0);
  }
}

/** Shown to humans instead of the value. Short values reveal nothing. */
export function secretLast4(value: string): string | null {
  return value.length >= 12 ? value.slice(-4) : null;
}

type Tx = Pick<DbTx, 'select' | 'insert' | 'update' | 'rollback'>;

/**
 * Creates or rotates (replaces) one secret. Audited with name/version/last4
 * only. The composite FK refuses a connection of another org.
 */
export async function putConnectionSecret(
  tx: Tx,
  ctx: ConnectionOpCtx,
  keyring: Keyring,
  input: { connectionId: string; name: string; value: string },
): Promise<{ name: string; keyVersion: number; last4: string | null; rotated: boolean }> {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(input.name)) throw new Error('Invalid secret name');
  if (input.value.length === 0) throw new Error('Secret value is empty');
  const sealed = await encryptSecret(keyring, { orgId: ctx.orgId, connectionId: input.connectionId, name: input.name }, input.value);
  const last4 = secretLast4(input.value);
  const [existing] = await tx.select({ id: connectionSecrets.id }).from(connectionSecrets)
    .where(and(eq(connectionSecrets.connectionId, input.connectionId), eq(connectionSecrets.orgId, ctx.orgId), eq(connectionSecrets.name, input.name)));
  const now = new Date();
  const [row] = existing
    ? await tx.update(connectionSecrets).set({ ...sealed, last4, rotatedAt: now, updatedAt: now })
      .where(and(eq(connectionSecrets.id, existing.id), eq(connectionSecrets.orgId, ctx.orgId))).returning({ id: connectionSecrets.id })
    : await tx.insert(connectionSecrets).values({ ...sealed, last4, orgId: ctx.orgId, connectionId: input.connectionId, name: input.name })
      .returning({ id: connectionSecrets.id });
  await auditConnectionChange(tx, ctx, existing ? 'CONNECTION_SECRET_ROTATED' : 'CONNECTION_SECRET_SET', 'connection_secrets', row.id, {
    connectionId: input.connectionId, name: input.name, keyVersion: sealed.keyVersion, last4,
  });
  return { name: input.name, keyVersion: sealed.keyVersion, last4, rotated: Boolean(existing) };
}

/** The read path. Returns plaintext — never put the result in a response or log. */
export async function getConnectionSecret(
  tx: Pick<DbTx, 'select'>,
  keyring: Keyring,
  address: SecretAddress,
): Promise<string | null> {
  const [row] = await tx.select({
    keyVersion: connectionSecrets.keyVersion,
    wrappedDek: connectionSecrets.wrappedDek,
    dekIv: connectionSecrets.dekIv,
    ciphertext: connectionSecrets.ciphertext,
    iv: connectionSecrets.iv,
  }).from(connectionSecrets).where(and(
    eq(connectionSecrets.orgId, address.orgId),
    eq(connectionSecrets.connectionId, address.connectionId),
    eq(connectionSecrets.name, address.name),
  ));
  return row ? decryptSecret(keyring, address, row) : null;
}

/**
 * KEK rotation job: re-wraps every row sealed under `fromVersion` to
 * `toVersion`. Covers the rows visible to `tx` — one org under
 * withOrgContext, every org under the owner connection. One audit row per org.
 * ponytail: one pass in one transaction; batch by id if row counts get large.
 */
export async function rotateConnectionSecrets(
  tx: Tx,
  keyring: Keyring,
  versions: { fromVersion: number; toVersion: number },
  audit: Omit<ConnectionOpCtx, 'orgId'> = { userId: null, actorKind: 'system', channel: 'cron' },
): Promise<number> {
  if (versions.fromVersion === versions.toVersion) return 0;
  await keyring.kek(versions.toVersion); // fail closed before touching anything
  // FOR UPDATE: a concurrent putConnectionSecret must not replace a row
  // between this read and the re-wrap below, or the old DEK would be stamped
  // onto new ciphertext and the secret would never decrypt again.
  const rows = await tx.select().from(connectionSecrets)
    .where(eq(connectionSecrets.keyVersion, versions.fromVersion))
    .for('update');
  const perOrg = new Map<string, number>();
  for (const row of rows) {
    const next = await rewrapSecret(keyring, { orgId: row.orgId, connectionId: row.connectionId, name: row.name }, row, versions.toVersion);
    await tx.update(connectionSecrets)
      .set({ keyVersion: next.keyVersion, wrappedDek: next.wrappedDek, dekIv: next.dekIv, updatedAt: new Date() })
      .where(and(
        eq(connectionSecrets.id, row.id),
        eq(connectionSecrets.orgId, row.orgId),
        eq(connectionSecrets.keyVersion, versions.fromVersion),
        // Belt and braces with the row lock: only re-wrap the ciphertext we read.
        eq(connectionSecrets.ciphertext, row.ciphertext),
      ));
    perOrg.set(row.orgId, (perOrg.get(row.orgId) ?? 0) + 1);
  }
  for (const [orgId, count] of perOrg) {
    await auditConnectionChange(tx, { ...audit, orgId }, 'CONNECTION_SECRETS_KEK_ROTATED', 'connection_secrets', null, { ...versions, count });
  }
  return rows.length;
}
