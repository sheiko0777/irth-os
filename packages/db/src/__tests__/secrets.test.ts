/**
 * CX-07 secrets kernel: envelope AES-256-GCM round trip, fail-closed keys,
 * address binding, and KEK rotation that keeps old rows readable by version.
 * Keys are random per run — no key material is written in this file.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  ConnectionSecretsKeyError,
  decryptSecret,
  encryptSecret,
  keyringFromEnv,
  rewrapSecret,
  secretLast4,
} from '../secrets';

const randomKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');

function envWith(vars: Record<string, string | undefined>) {
  return (name: string) => vars[name];
}

const address = { orgId: '11111111-1111-4111-8111-111111111111', connectionId: '22222222-2222-4222-8222-222222222222', name: 'access_token' };
const value = 'test-only-value-not-a-real-credential';

describe('connection secrets kernel', () => {
  const v1 = randomKey();
  const v2 = randomKey();

  it('round-trips and never stores the plaintext', async () => {
    const keyring = keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_V1: v1 }));
    const sealed = await encryptSecret(keyring, address, value);
    expect(sealed.keyVersion).toBe(1);
    expect(JSON.stringify(sealed)).not.toContain(value);
    expect(Buffer.from(sealed.ciphertext, 'base64').toString('utf8')).not.toContain(value);
    expect(await decryptSecret(keyring, address, sealed)).toBe(value);
  });

  it('uses a fresh data key and iv per write', async () => {
    const keyring = keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_V1: v1 }));
    const a = await encryptSecret(keyring, address, value);
    const b = await encryptSecret(keyring, address, value);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
  });

  it('fails with the wrong key', async () => {
    const sealed = await encryptSecret(keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_V1: v1 })), address, value);
    const wrong = keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_V1: randomKey() }));
    await expect(decryptSecret(wrong, address, sealed)).rejects.toBeInstanceOf(ConnectionSecretsKeyError);
  });

  it('fails when the row is moved to another connection, org or name', async () => {
    const keyring = keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_V1: v1 }));
    const sealed = await encryptSecret(keyring, address, value);
    for (const moved of [
      { ...address, connectionId: '33333333-3333-4333-8333-333333333333' },
      { ...address, orgId: '44444444-4444-4444-8444-444444444444' },
      { ...address, name: 'webhook_secret' },
    ]) {
      await expect(decryptSecret(keyring, moved, sealed)).rejects.toBeInstanceOf(ConnectionSecretsKeyError);
    }
  });

  it('fails closed, naming the env var, when the KEK is missing or malformed', async () => {
    await expect(encryptSecret(keyringFromEnv(envWith({})), address, value))
      .rejects.toThrow('CONNECTION_SECRETS_KEY_V1 is not configured');
    await expect(encryptSecret(keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_V1: 'c2hvcnQ=' })), address, value))
      .rejects.toThrow('CONNECTION_SECRETS_KEY_V1 must be a base64-encoded 32-byte key');
    expect(() => keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_VERSION: 'zero' }))).toThrow(ConnectionSecretsKeyError);
  });

  it('writes under CONNECTION_SECRETS_KEY_VERSION', async () => {
    const keyring = keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_VERSION: '2', CONNECTION_SECRETS_KEY_V2: v2 }));
    expect((await encryptSecret(keyring, address, value)).keyVersion).toBe(2);
  });

  it('rotation re-wraps the data key only; old version stays readable until rotated', async () => {
    const keyring = keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_VERSION: '2', CONNECTION_SECRETS_KEY_V1: v1, CONNECTION_SECRETS_KEY_V2: v2 }));
    const old = await encryptSecret(keyring, address, value, 1);
    expect(await decryptSecret(keyring, address, old)).toBe(value);

    const rotated = await rewrapSecret(keyring, address, old, 2);
    expect(rotated.keyVersion).toBe(2);
    expect(rotated.ciphertext).toBe(old.ciphertext);
    expect(rotated.wrappedDek).not.toBe(old.wrappedDek);
    expect(await decryptSecret(keyring, address, rotated)).toBe(value);

    // After V1 is retired, the rotated row still opens and an unrotated one fails closed.
    const v2only = keyringFromEnv(envWith({ CONNECTION_SECRETS_KEY_VERSION: '2', CONNECTION_SECRETS_KEY_V2: v2 }));
    expect(await decryptSecret(v2only, address, rotated)).toBe(value);
    await expect(decryptSecret(v2only, address, old)).rejects.toThrow('CONNECTION_SECRETS_KEY_V1 is not configured');
  });

  it('last4 reveals nothing for short values', () => {
    expect(secretLast4('short')).toBeNull();
    expect(secretLast4('abcdefghijklmnop')).toBe('mnop');
  });
});
