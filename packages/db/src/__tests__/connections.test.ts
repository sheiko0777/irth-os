/**
 * CX-07 connection ops, no database: the zod contracts are what keep secrets
 * out of every op/tRPC output (serializationGate-style, asserted on the schema
 * itself), and credential-looking config is refused at the door.
 */
import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { ConnectionSecretMeta, ConnectionSummary, CreateConnectionInput, connectionSecrets, connections } from '../index';

const SECRET_FIELD = /ciphertext|wrapped|dek|^iv$|iv$|plaintext|value|token|password|kek/i;

const summary = {
  id: '11111111-1111-4111-8111-111111111111',
  provider: 'bosta',
  family: 'courier' as const,
  name: 'Bosta',
  externalAccountId: null,
  brandId: null,
  legalEntityId: null,
  status: 'active' as const,
  priority: 0,
  config: {},
  health: null,
  lastError: null,
  lastHealthAt: null,
  lastWebhookAt: null,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  secrets: [{ name: 'api_key', keyVersion: 1, last4: 'abcd', createdAt: new Date(), rotatedAt: null }],
};

describe('connection ops contracts', () => {
  it('output schemas declare no ciphertext, key or plaintext field', () => {
    const keys = [...Object.keys(ConnectionSummary.shape), ...Object.keys(ConnectionSecretMeta.shape)];
    expect(keys.filter((k) => SECRET_FIELD.test(k))).toEqual([]);
  });

  it('output schemas are strict: a leaked sealed column fails the parse', () => {
    expect(ConnectionSummary.parse(summary).secrets[0].name).toBe('api_key');
    const leaked = { ...summary, secrets: [{ ...summary.secrets[0], ciphertext: 'x', wrappedDek: 'y', iv: 'z' }] };
    expect(() => ConnectionSummary.parse(leaked)).toThrow();
    expect(() => ConnectionSummary.parse({ ...summary, accessToken: 'x' })).toThrow();
  });

  it('every sealed column of connection_secrets is excluded from the metadata schema', () => {
    const sealed = ['wrappedDek', 'dekIv', 'ciphertext', 'iv'];
    expect(Object.keys(getTableColumns(connectionSecrets))).toEqual(expect.arrayContaining(sealed));
    for (const col of sealed) expect(Object.keys(ConnectionSecretMeta.shape)).not.toContain(col);
  });

  it('connections carries no secret column at all', () => {
    expect(Object.keys(getTableColumns(connections)).filter((k) => SECRET_FIELD.test(k))).toEqual([]);
  });

  it('refuses credential-looking keys in config', () => {
    const base = { provider: 'paymob', family: 'payment' as const, name: 'Paymob' };
    expect(CreateConnectionInput.parse(base)).toMatchObject({ status: 'pending', priority: 0, config: {} });
    for (const key of ['apiKey', 'api_key', 'hmacSecret', 'accessToken', 'password']) {
      expect(() => CreateConnectionInput.parse({ ...base, config: { [key]: 'x' } })).toThrow(/credential-like/);
    }
    expect(() => CreateConnectionInput.parse({ ...base, family: 'other' })).toThrow();
    expect(() => CreateConnectionInput.parse({ ...base, provider: 'Bad Name' })).toThrow();
  });
});
