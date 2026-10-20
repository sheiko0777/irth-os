/**
 * CX-07: the API's secrets kernel reads its KEK from the Worker env (envVar →
 * process.env in tests) and fails closed when it is absent. Crypto details are
 * covered in packages/db/src/__tests__/secrets.test.ts.
 */
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '@irth/db/src/secrets';
import { connectionKeyring } from '../integrations/kernel/secrets';

const address = { orgId: '11111111-1111-4111-8111-111111111111', connectionId: '22222222-2222-4222-8222-222222222222', name: 'api_key' };

afterEach(() => {
  delete process.env.CONNECTION_SECRETS_KEY_V1;
  delete process.env.CONNECTION_SECRETS_KEY_VERSION;
});

describe('api secrets kernel', () => {
  it('fails closed when CONNECTION_SECRETS_KEY_V1 is not set', async () => {
    await expect(encryptSecret(connectionKeyring(), address, 'test-only')).rejects.toThrow('CONNECTION_SECRETS_KEY_V1 is not configured');
  });

  it('round-trips with the env KEK', async () => {
    process.env.CONNECTION_SECRETS_KEY_V1 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    const sealed = await encryptSecret(connectionKeyring(), address, 'test-only-value');
    expect(await decryptSecret(connectionKeyring(), address, sealed)).toBe('test-only-value');
  });
});
