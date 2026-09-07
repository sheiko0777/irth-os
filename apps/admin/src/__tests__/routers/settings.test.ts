import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { orgSettings, auditLog } from '@irth/db';
import type { Context } from '@/server/trpc';
import { SETTING_KEYS, SENSITIVE_KEYS, settingKeySchema, type SettingKey } from '@/lib/settings';
import { settingsRouter, encryptSettingValue, decryptSettingValue } from '@/server/routers/settings';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'private-api-secret-سر-12345';
const MASK = '••••••••';
const SECRET_KEY = SETTING_KEYS.eta.client_secret;

// A transactional fake checks router wiring. Actual Postgres rollback and raw
// storage are also exercised in integration/settings.test.ts.
function settingsHarness() {
  let rows = new Map<string, string>();
  let audits: unknown[] = [];
  let failAt = 0;
  let failAudit = false;
  let writes = 0;
  const withOrg = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const pending = new Map(rows);
    const pendingAudits = [...audits];
    const tx = {
      select: () => ({ from: () => ({ where: async () =>
        [...pending].map(([key, value]) => ({ orgId: ORG_ID, key, value })) }) }),
      insert: (table: unknown) => ({ values: (row: { key: string; value: string }) => {
        if (table === auditLog) {
          if (failAudit) throw new Error('audit failed');
          pendingAudits.push(row);
          return Promise.resolve();
        }
        expect(table).toBe(orgSettings);
        return { onConflictDoUpdate: async () => {
          writes++;
          if (writes === failAt) throw new Error('setting write failed');
          pending.set(row.key, row.value);
        } };
      } }),
    };
    const result = await fn(tx);
    rows = pending;
    audits = pendingAudits;
    return result;
  });
  const caller = settingsRouter.createCaller({
    orgId: ORG_ID, userId: 'settings-user', role: 'admin', withOrg,
    session: { user: { id: 'settings-user', email: 'settings@test.com' } },
  } as unknown as Context);
  return {
    caller, withOrg,
    rows: () => rows,
    audits: () => audits,
    seed: (key: string, value: string) => rows.set(key, value),
    failWrite: (n: number) => { failAt = n; },
    failAudit: () => { failAudit = true; },
  };
}

beforeEach(() => { vi.stubEnv('SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64')); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('org settings router', () => {
  it('derives the entire key allowlist from SETTING_KEYS', () => {
    const keys = Object.values(SETTING_KEYS).flatMap(group => Object.values(group));
    expect(settingKeySchema.options).toEqual(keys);
    for (const key of keys) expect(settingKeySchema.parse(key)).toBe(key);
  });

  it.each(['set', 'setMany'] as const)('%s rejects unknown keys as BAD_REQUEST before writing', async method => {
    const h = settingsHarness();
    const item = { key: 'org.typo' as SettingKey, value: 'bad' };
    const call = method === 'set' ? h.caller.set(item) : h.caller.setMany([
      { key: SETTING_KEYS.org.name, value: 'valid' }, item,
    ]);
    await expect(call).rejects.toSatisfy((error: unknown) =>
      error instanceof TRPCError && error.code === 'BAD_REQUEST');
    expect(h.withOrg).not.toHaveBeenCalled();
  });

  it.each(['set', 'setMany'] as const)('%s bounds values at 2000 characters', async method => {
    const h = settingsHarness();
    const item = { key: SETTING_KEYS.org.name, value: 'x'.repeat(2001) };
    await expect(method === 'set' ? h.caller.set(item) : h.caller.setMany([item]))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(h.withOrg).not.toHaveBeenCalled();
    item.value = 'x'.repeat(2000);
    await (method === 'set' ? h.caller.set(item) : h.caller.setMany([item]));
    expect(h.rows().get(item.key)).toBe(item.value);
  });

  it.each(SENSITIVE_KEYS)('set encrypts %s and only returns a mask', async key => {
    const h = settingsHarness();
    await h.caller.set({ key, value: SECRET });
    const stored = h.rows().get(key)!;
    expect(stored).not.toContain(SECRET);
    expect(stored).toMatch(/^enc:v1:/);
    expect(decryptSettingValue(stored, ORG_ID, key)).toBe(SECRET);
    expect((await h.caller.getAll()).data[key]).toBe(MASK);
    expect(JSON.stringify(h.audits())).not.toContain(SECRET);
    expect(h.audits()).toEqual([expect.objectContaining({ changes: { key, value: MASK } })]);
    await h.caller.set({ key, value: `${SECRET}-updated` });
    expect(decryptSettingValue(h.rows().get(key)!, ORG_ID, key)).toBe(`${SECRET}-updated`);
  });

  it('setMany encrypts every sensitive key, leaves other values plain and audits once', async () => {
    const h = settingsHarness();
    const items = [
      ...SENSITIVE_KEYS.map(key => ({ key, value: SECRET })),
      { key: SETTING_KEYS.org.name, value: 'IRTH' },
    ];
    await h.caller.setMany(items);
    expect(h.withOrg).toHaveBeenCalledTimes(1);
    for (const key of SENSITIVE_KEYS) {
      expect(h.rows().get(key)).not.toContain(SECRET);
      expect(decryptSettingValue(h.rows().get(key)!, ORG_ID, key)).toBe(SECRET);
    }
    expect(h.rows().get(SETTING_KEYS.org.name)).toBe('IRTH');
    expect(h.audits()).toEqual([expect.objectContaining({
      action: 'UPDATE_SETTINGS', changes: { keys: items.map(item => item.key) },
    })]);
    expect(JSON.stringify(await h.caller.getAll())).not.toContain(SECRET);
  });

  it('preserves masked secrets and empty/no-op batches', async () => {
    const h = settingsHarness();
    await h.caller.set({ key: SECRET_KEY, value: SECRET });
    const stored = h.rows().get(SECRET_KEY);
    h.withOrg.mockClear();
    await h.caller.set({ key: SECRET_KEY, value: MASK });
    await h.caller.setMany([{ key: SECRET_KEY, value: MASK }]);
    await h.caller.setMany([]);
    expect(h.withOrg).not.toHaveBeenCalled();
    expect(h.rows().get(SECRET_KEY)).toBe(stored);
  });

  it('encrypts a cleared secret and preserves the empty read-back value', async () => {
    const h = settingsHarness();
    await h.caller.set({ key: SECRET_KEY, value: '' });
    expect(h.rows().get(SECRET_KEY)).toMatch(/^enc:v1:/);
    expect(decryptSettingValue(h.rows().get(SECRET_KEY)!, ORG_ID, SECRET_KEY)).toBe('');
    expect((await h.caller.getAll()).data[SECRET_KEY]).toBe('');
  });

  it('keeps legacy plaintext masked until explicitly re-saved', async () => {
    const h = settingsHarness();
    h.seed(SECRET_KEY, SECRET);
    expect((await h.caller.getAll()).data[SECRET_KEY]).toBe(MASK);
    await h.caller.set({ key: SECRET_KEY, value: SECRET });
    expect(h.rows().get(SECRET_KEY)).not.toContain(SECRET);
  });

  it('rolls back a batch when its second setting fails', async () => {
    const h = settingsHarness();
    h.failWrite(2);
    await expect(h.caller.setMany([
      { key: SETTING_KEYS.org.name, value: 'first' },
      { key: SETTING_KEYS.org.phone, value: 'second' },
    ])).rejects.toThrow('setting write failed');
    expect(h.rows().size).toBe(0);
    expect(h.audits()).toEqual([]);
    expect(h.withOrg).toHaveBeenCalledTimes(1);
  });

  it.each(['set', 'setMany'] as const)('%s rolls back settings if its audit fails', async method => {
    const h = settingsHarness();
    h.failAudit();
    const item = { key: SETTING_KEYS.org.name, value: 'first' };
    await expect(method === 'set' ? h.caller.set(item) : h.caller.setMany([item])).rejects.toThrow('audit failed');
    expect(h.rows().size).toBe(0);
    expect(h.audits()).toEqual([]);
  });

  it.each([undefined, '', 'bad-key', Buffer.alloc(31).toString('base64'), `${Buffer.alloc(32).toString('base64')}!`])('fails closed with invalid encryption configuration (%s)', async encoded => {
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', encoded);
    const h = settingsHarness();
    await expect(h.caller.set({ key: SECRET_KEY, value: SECRET })).rejects.toThrow('SETTINGS_ENCRYPTION_KEY');
    expect(h.rows().size).toBe(0);
    await expect(h.caller.setMany([
      { key: SETTING_KEYS.org.name, value: 'first' }, { key: SECRET_KEY, value: SECRET },
    ])).rejects.toThrow('SETTINGS_ENCRYPTION_KEY');
    expect(h.rows().size).toBe(0);
    expect(h.audits()).toEqual([]);
  });

  it('never falls back to plaintext for corrupted encrypted rows', async () => {
    const h = settingsHarness();
    h.seed(SECRET_KEY, 'enc:v1:invalid');
    await expect(h.caller.getAll()).rejects.toThrow('Invalid encrypted setting format');
  });
});

describe('settings encryption', () => {
  it('randomizes IVs and authenticates the ciphertext, organization and key', () => {
    const encrypted = encryptSettingValue(SECRET, ORG_ID, SECRET_KEY);
    expect(encryptSettingValue(SECRET, ORG_ID, SECRET_KEY)).not.toBe(encrypted);
    expect(() => decryptSettingValue(encrypted, 'other-org', SECRET_KEY)).toThrow();
    expect(() => decryptSettingValue(encrypted, ORG_ID, SENSITIVE_KEYS[0])).toThrow();
    const parts = encrypted.split(':');
    const ciphertext = Buffer.from(parts[4], 'base64');
    ciphertext[0] ^= 1;
    parts[4] = ciphertext.toString('base64');
    expect(() => decryptSettingValue(parts.join(':'), ORG_ID, SECRET_KEY)).toThrow();
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'));
    expect(() => decryptSettingValue(encrypted, ORG_ID, SECRET_KEY)).toThrow();
  });

  it.each(['plaintext', 'enc:v2:invalid', 'enc:v1:bad:bad:bad', 'enc:v1:'])('rejects malformed ciphertext (%s)', value => {
    expect(() => decryptSettingValue(value, ORG_ID, SECRET_KEY)).toThrow('Invalid encrypted setting format');
  });
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
});

const updateMemberRoleSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(['admin', 'member']),
});

describe('settings router — input validation', () => {
  it('updateOrg: rejects invalid email', () => {
    expect(() => updateOrgSchema.parse({ email: 'bad' })).toThrow();
  });

  it('updateOrg: rejects wrong currency length', () => {
    expect(() => updateOrgSchema.parse({ currency: 'EGPT' })).toThrow();
  });

  it('updateOrg: accepts valid currency', () => {
    const r = updateOrgSchema.parse({ currency: 'EGP' });
    expect(r.currency).toBe('EGP');
  });

  it('updateOrg: all fields optional', () => {
    const r = updateOrgSchema.parse({});
    expect(r).toEqual({});
  });

  it('inviteMember: rejects invalid email', () => {
    expect(() => inviteMemberSchema.parse({ email: 'notvalid', role: 'member' })).toThrow();
  });

  it('inviteMember: rejects owner role (not in enum)', () => {
    expect(() => inviteMemberSchema.parse({ email: 'a@b.com', role: 'owner' })).toThrow();
  });

  it('inviteMember: accepts admin role', () => {
    const r = inviteMemberSchema.parse({ email: 'staff@irth.com', role: 'admin' });
    expect(r.role).toBe('admin');
  });

  it('updateMemberRole: rejects non-uuid memberId', () => {
    expect(() => updateMemberRoleSchema.parse({ memberId: 'bad', role: 'member' })).toThrow();
  });
});
