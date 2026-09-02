import { describe, expect, it, vi } from 'vitest';
import { acceptOrgInvite, generateInviteOtp } from '../invites';

/**
 * Minimal chainable query-builder mock, tailored to the method chains
 * acceptOrgInvite uses (select/from/where/limit/insert/values/update/set/
 * delete). Mirrors orgContext.test.ts's style: each `db.select`/`db.update`/
 * etc. call is configured with `mockReturnValueOnce` per expected query in
 * sequence, so a test can assert not just the result but whether a later
 * step (the membership insert, the delete) was reached at all.
 */
function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'values', 'set']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

function mockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(() => chainable(undefined)),
    update: vi.fn(() => chainable(undefined)),
    delete: vi.fn(() => chainable(undefined)),
  };
}

const baseInvite = {
  id: 'invite-1',
  orgId: 'org-1',
  email: 'invitee@test.com',
  token: 'tok',
  role: 'member',
  expiresAt: new Date(Date.now() + 60_000),
  otpCode: '123456',
  otpExpiresAt: new Date(Date.now() + 60_000),
  otpAttempts: 0,
};

describe('generateInviteOtp', () => {
  it('produces a 6-digit code and an expiry ttlMs in the future', () => {
    const { code, expiresAt } = generateInviteOtp(1000);
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000 + 5);
  });
});

describe('acceptOrgInvite', () => {
  it('invalid token', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([]));

    const result = await acceptOrgInvite(db as never, { token: 'x', otpCode: undefined, userId: 'u1', userEmail: 'a@test.com' });

    expect(result).toEqual({ ok: false, reason: 'invalid_token' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('expired invite', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([{ ...baseInvite, expiresAt: new Date(Date.now() - 1000) }]));

    const result = await acceptOrgInvite(db as never, { token: 'tok', otpCode: '123456', userId: 'u1', userEmail: baseInvite.email });

    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('email mismatch — case-insensitive comparison, but a real mismatch still rejects', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([baseInvite]));

    const result = await acceptOrgInvite(db as never, { token: 'tok', otpCode: '123456', userId: 'u1', userEmail: 'someone-else@test.com' });

    expect(result).toEqual({ ok: false, reason: 'email_mismatch' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('otp required — otpCode present on invite, none supplied', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([baseInvite]));

    const result = await acceptOrgInvite(db as never, { token: 'tok', otpCode: undefined, userId: 'u1', userEmail: baseInvite.email });

    expect(result).toEqual({ ok: false, reason: 'otp_required' });
  });

  it('otp locked — 5 attempts already used', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([{ ...baseInvite, otpAttempts: 5 }]));

    const result = await acceptOrgInvite(db as never, { token: 'tok', otpCode: '000000', userId: 'u1', userEmail: baseInvite.email });

    expect(result).toEqual({ ok: false, reason: 'otp_locked' });
  });

  it('otp expired', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([{ ...baseInvite, otpExpiresAt: new Date(Date.now() - 1000) }]));

    const result = await acceptOrgInvite(db as never, { token: 'tok', otpCode: '123456', userId: 'u1', userEmail: baseInvite.email });

    expect(result).toEqual({ ok: false, reason: 'otp_expired' });
  });

  it('otp invalid — wrong code, atomically increments the attempt counter', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([baseInvite]));

    const result = await acceptOrgInvite(db as never, { token: 'tok', otpCode: 'wrong', userId: 'u1', userEmail: baseInvite.email });

    expect(result).toEqual({ ok: false, reason: 'otp_invalid' });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('NULL otp (pre-migration invite) skips the OTP check entirely', async () => {
    const db = mockDb();
    db.select
      .mockReturnValueOnce(chainable([{ ...baseInvite, otpCode: null, otpExpiresAt: null }])) // invite lookup
      .mockReturnValueOnce(chainable([])); // no existing membership

    const result = await acceptOrgInvite(db as never, { token: 'tok', otpCode: undefined, userId: 'u1', userEmail: baseInvite.email });

    expect(result).toEqual({ ok: true, orgId: 'org-1', role: 'member' });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('already a member of THIS org — idempotent: insert skipped, invite still deleted', async () => {
    const db = mockDb();
    db.select
      .mockReturnValueOnce(chainable([baseInvite]))
      .mockReturnValueOnce(chainable([{ id: 'membership-1' }])); // existing membership in org-1

    const result = await acceptOrgInvite(db as never, { token: 'tok', otpCode: '123456', userId: 'u1', userEmail: baseInvite.email });

    expect(result).toEqual({ ok: true, orgId: 'org-1', role: 'member' });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('regression (Bug 1): a member of a DIFFERENT org still gets inserted into the new one', async () => {
    // The original bug: apps/admin/src/app/api/join/route.ts's existing-
    // membership check was scoped by userId alone, with no eq(orgId,
    // invite.orgId) — so a user already in some OTHER org came back
    // "existing", and the new org's membership insert was silently skipped.
    const db = mockDb();
    db.select
      .mockReturnValueOnce(chainable([baseInvite])) // invite for org-1
      .mockReturnValueOnce(chainable([])); // membership check scoped to org-1 AND user — correctly empty

    const result = await acceptOrgInvite(db as never, { token: 'tok', otpCode: '123456', userId: 'u1', userEmail: baseInvite.email });

    expect(result).toEqual({ ok: true, orgId: 'org-1', role: 'member' });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('success path deletes the invite exactly once', async () => {
    const db = mockDb();
    db.select
      .mockReturnValueOnce(chainable([baseInvite]))
      .mockReturnValueOnce(chainable([]));

    await acceptOrgInvite(db as never, { token: 'tok', otpCode: '123456', userId: 'u1', userEmail: baseInvite.email });

    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
