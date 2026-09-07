import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { protectedProcedure, router, adminProcedure } from '../trpc';
import { eq } from 'drizzle-orm';
import { orgSettings, withAudit } from '@irth/db';
import { DEFAULT_SETTINGS, SENSITIVE_KEYS, settingInputSchema } from '../../lib/settings';

const MASK_STRING = '••••••••';
const ENCRYPTED_PREFIX = 'enc:v1:';
const isSensitive = (key: string) => (SENSITIVE_KEYS as readonly string[]).includes(key);

function encryptionKey(): Buffer {
  const encoded = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!encoded) throw new Error('SETTINGS_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('SETTINGS_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

/**
 * The existing text column stores enc:v1:<base64 IV>:<base64 tag>:<base64 ciphertext>.
 * AES-256-GCM uses a fresh 12-byte IV and a 16-byte authentication tag per value.
 * AAD binds each value to its organization and setting key to prevent row swaps.
 * SETTINGS_ENCRYPTION_KEY is a long-lived, base64-encoded 32-byte server secret.
 * Keep it across deployments; changing it makes existing ciphertext unreadable.
 */
export function encryptSettingValue(value: string, orgId: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(JSON.stringify([orgId, key]), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSettingValue(value: string, orgId: string, key: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) throw new Error('Invalid encrypted setting format');
  const parts = value.slice(ENCRYPTED_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted setting format');
  const buffers = parts.map(part => Buffer.from(part, 'base64'));
  const [iv, tag, ciphertext] = buffers;
  if (iv.length !== 12 || tag.length !== 16 || parts.some((part, i) => buffers[i].toString('base64') !== part)) {
    throw new Error('Invalid encrypted setting format');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(Buffer.from(JSON.stringify([orgId, key]), 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export const settingsRouter = router({
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const dbSettings = await ctx.withOrg(tx => tx
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.orgId, ctx.orgId)));

    const settingsMap: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const setting of dbSettings) {
      if (isSensitive(setting.key)) {
        // Legacy plaintext stays masked during rollout; re-enter and save the
        // actual secrets to encrypt them (saving the mask is a no-op). Never
        // treat a malformed encrypted envelope as plaintext.
        const value = setting.value.startsWith('enc:')
          ? decryptSettingValue(setting.value, ctx.orgId, setting.key)
          : setting.value;
        settingsMap[setting.key] = value ? MASK_STRING : '';
      } else {
        settingsMap[setting.key] = setting.value;
      }
    }
    return { data: settingsMap, error: null, meta: null };
  }),

  set: adminProcedure
    .input(settingInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (isSensitive(input.key) && input.value === MASK_STRING) {
        return { data: { success: true }, error: null, meta: null };
      }
      const value = isSensitive(input.key)
        ? encryptSettingValue(input.value, ctx.orgId, input.key)
        : input.value;

      await ctx.withOrg(tx => withAudit(tx, async () => {
        await tx.insert(orgSettings).values({
          orgId: ctx.orgId, key: input.key, value, updatedBy: ctx.userId,
        }).onConflictDoUpdate({
          target: [orgSettings.orgId, orgSettings.key],
          set: { value, updatedBy: ctx.userId, updatedAt: new Date() },
        });
        return {};
      }, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        action: 'UPDATE_SETTING',
        tableName: 'org_settings',
        // Never write secret values into the audit trail.
        changes: { key: input.key, value: isSensitive(input.key) ? MASK_STRING : input.value },
      }));
      return { data: { success: true }, error: null, meta: null };
    }),

  setMany: adminProcedure
    .input(settingInputSchema.array())
    .mutation(async ({ ctx, input }) => {
      const items = input.filter(item => !(isSensitive(item.key) && item.value === MASK_STRING));
      if (items.length > 0) {
        await ctx.withOrg(tx => withAudit(tx, async () => {
          for (const item of items) {
            const value = isSensitive(item.key)
              ? encryptSettingValue(item.value, ctx.orgId, item.key)
              : item.value;
            await tx.insert(orgSettings).values({
              orgId: ctx.orgId, key: item.key, value, updatedBy: ctx.userId,
            }).onConflictDoUpdate({
              target: [orgSettings.orgId, orgSettings.key],
              set: { value, updatedBy: ctx.userId, updatedAt: new Date() },
            });
          }
          return {};
        }, {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'UPDATE_SETTINGS',
          tableName: 'org_settings',
          // Key names only — values may contain secrets.
          changes: { keys: items.map(item => item.key) },
        }));
      }
      return { data: { success: true }, error: null, meta: null };
    }),
});
