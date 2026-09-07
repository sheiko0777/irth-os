import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { auditLog, organizations, orgSettings, withOrgContext } from '@irth/db';
import type { Context } from '@/server/trpc';
import { SETTING_KEYS, SENSITIVE_KEYS } from '@/lib/settings';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { settingsRouter, decryptSettingValue } = await import('@/server/routers/settings');

let orgId: string;
beforeEach(async () => {
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  await truncateAll();
  const [org] = await testDb.insert(organizations).values({
    name: 'Settings test', slug: 'settings-test',
  }).returning();
  orgId = org.id;
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(closeTestDb);

function caller() {
  return settingsRouter.createCaller({
    db: testDb, orgId, userId: 'settings-test-user', role: 'admin',
    session: { user: { id: 'settings-test-user', email: 'settings@test.com' } },
    withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, orgId, fn),
  } as unknown as Context);
}

const rows = () => testDb.select().from(orgSettings).where(eq(orgSettings.orgId, orgId));
const audits = () => testDb.select().from(auditLog).where(eq(auditLog.orgId, orgId));

describe('org settings — real Postgres storage and transactions', () => {
  it.each(['set', 'setMany'] as const)('%s stores only encrypted secrets and returns masks', async method => {
    const api = caller();
    const secret = 'raw-database-must-not-expose-this-سر';
    const items = SENSITIVE_KEYS.map(key => ({ key, value: secret }));
    if (method === 'set') {
      for (const item of items) await api.set(item);
    } else {
      await api.setMany(items);
    }
    // Unprivileged client masking cannot hide plaintext from this raw DB read.
    const stored = await rows();
    expect(stored).toHaveLength(SENSITIVE_KEYS.length);
    for (const row of stored) {
      expect(row.value).not.toContain(secret);
      expect(row.value).toMatch(/^enc:v1:/);
      expect(decryptSettingValue(row.value, orgId, row.key)).toBe(secret);
    }
    const response = await api.getAll();
    for (const key of SENSITIVE_KEYS) expect(response.data[key]).toBe('••••••••');
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(JSON.stringify(await audits())).not.toContain(secret);
    expect(await audits()).toHaveLength(method === 'set' ? SENSITIVE_KEYS.length : 1);
  });

  it('rolls back every new key when a database write fails partway through setMany', async () => {
    // A test-only constraint forces Postgres itself to reject the SECOND write.
    await testDb.execute(sql`ALTER TABLE org_settings ADD CONSTRAINT settings_test_failure
      CHECK (value <> '__settings_test_fail__')`);
    try {
      await expect(caller().setMany([
        { key: SETTING_KEYS.org.name, value: 'first write' },
        { key: SETTING_KEYS.org.phone, value: '__settings_test_fail__' },
        { key: SETTING_KEYS.org.email, value: 'third write' },
      ])).rejects.toThrow();
      expect(await rows()).toEqual([]);
      expect(await audits()).toEqual([]);
    } finally {
      await testDb.execute(sql`ALTER TABLE org_settings DROP CONSTRAINT settings_test_failure`);
    }
  });

  it('restores existing values and rolls back inserts when the audit write fails', async () => {
    const api = caller();
    await api.set({ key: SETTING_KEYS.org.name, value: 'original' });
    const originalRows = await rows();
    const originalAudits = await audits();
    await testDb.execute(sql`ALTER TABLE audit_log ADD CONSTRAINT settings_test_audit_failure
      CHECK (action <> 'UPDATE_SETTINGS')`);
    try {
      await expect(api.setMany([
        { key: SETTING_KEYS.org.name, value: 'changed' },
        { key: SETTING_KEYS.eta.client_secret, value: 'new secret' },
      ])).rejects.toThrow();
      expect(await rows()).toEqual(originalRows);
      expect(await audits()).toEqual(originalAudits);
    } finally {
      await testDb.execute(sql`ALTER TABLE audit_log DROP CONSTRAINT settings_test_audit_failure`);
    }
  });
});
