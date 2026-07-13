import { describe, it, expect } from 'vitest';
import { z } from 'zod';

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
