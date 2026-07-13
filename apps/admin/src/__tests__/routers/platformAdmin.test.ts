import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const orgPlanSchema = z.enum(['starter', 'growth', 'enterprise']);

const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  ownerEmail: z.string().email(),
  plan: orgPlanSchema,
  enabledScreens: z.array(z.string()),
  disabledScreens: z.array(z.string()),
  maxUsers: z.number().int().positive().nullable(),
  notes: z.string().max(1000).nullable(),
});

const setOrgConfigSchema = z.object({
  orgId: z.string().uuid(),
  plan: orgPlanSchema,
  isActive: z.boolean(),
  enabledScreens: z.array(z.string()),
  disabledScreens: z.array(z.string()),
  maxUsers: z.number().int().positive().nullable(),
  notes: z.string().max(1000).nullable(),
});

describe('platformAdmin router — input validation', () => {
  it('createOrg: rejects invalid slug (spaces)', () => {
    expect(() => createOrgSchema.parse({ name: 'X', slug: 'my org', ownerEmail: 'a@b.com', plan: 'starter', enabledScreens: [], disabledScreens: [], maxUsers: null, notes: null })).toThrow();
  });

  it('createOrg: rejects invalid slug (uppercase)', () => {
    expect(() => createOrgSchema.parse({ name: 'X', slug: 'MyOrg', ownerEmail: 'a@b.com', plan: 'starter', enabledScreens: [], disabledScreens: [], maxUsers: null, notes: null })).toThrow();
  });

  it('createOrg: rejects invalid email', () => {
    expect(() => createOrgSchema.parse({ name: 'X', slug: 'my-org', ownerEmail: 'notanemail', plan: 'starter', enabledScreens: [], disabledScreens: [], maxUsers: null, notes: null })).toThrow();
  });

  it('createOrg: rejects invalid plan', () => {
    expect(() => createOrgSchema.parse({ name: 'X', slug: 'my-org', ownerEmail: 'a@b.com', plan: 'free', enabledScreens: [], disabledScreens: [], maxUsers: null, notes: null })).toThrow();
  });

  it('createOrg: accepts valid input', () => {
    const r = createOrgSchema.parse({ name: 'IRTH Demo', slug: 'irth-demo', ownerEmail: 'owner@irth.com', plan: 'growth', enabledScreens: ['orders', 'products'], disabledScreens: [], maxUsers: 10, notes: null });
    expect(r.slug).toBe('irth-demo');
    expect(r.plan).toBe('growth');
  });

  it('setOrgConfig: rejects non-uuid orgId', () => {
    expect(() => setOrgConfigSchema.parse({ orgId: 'bad', plan: 'starter', isActive: true, enabledScreens: [], disabledScreens: [], maxUsers: null, notes: null })).toThrow();
  });

  it('setOrgConfig: rejects negative maxUsers', () => {
    expect(() => setOrgConfigSchema.parse({ orgId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', plan: 'starter', isActive: true, enabledScreens: [], disabledScreens: [], maxUsers: -1, notes: null })).toThrow();
  });

  it('setOrgConfig: allows null maxUsers (unlimited)', () => {
    const r = setOrgConfigSchema.parse({ orgId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', plan: 'enterprise', isActive: true, enabledScreens: ['orders'], disabledScreens: [], maxUsers: null, notes: 'VIP' });
    expect(r.maxUsers).toBeNull();
  });
});
