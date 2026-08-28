import { and, eq, sql } from 'drizzle-orm';
import { orgInvites, orgMembers } from './schema';
import type { DbInstance } from './index';

/**
 * OTP generation for an org invite. 6 digits, 15-minute default window.
 *
 * Plaintext storage on `org_invites.otp_code` (see migration 0046) is a
 * deliberate choice, not an oversight: the real defense against guessing a
 * 6-digit code is `otpAttempts` capping attempts at 5, not hashing a
 * one-in-a-million space — the same reasoning this table's own `token`
 * column already applies (also plaintext).
 */
export function generateInviteOtp(ttlMs = 15 * 60_000): { code: string; expiresAt: Date } {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  return { code, expiresAt: new Date(Date.now() + ttlMs) };
}

export type AcceptInviteResult =
  | { ok: true; orgId: string; role: string }
  | {
      ok: false;
      reason:
        | 'invalid_token'
        | 'expired'
        | 'email_mismatch'
        | 'otp_required'
        | 'otp_invalid'
        | 'otp_expired'
        | 'otp_locked';
    };

/**
 * The single place both apps accept an org invite.
 *
 * Before this, `apps/admin/src/app/api/join/route.ts` and
 * `apps/api/src/routes/orgs.ts`'s `/invite/accept` each had their own,
 * independently-incomplete copy of this logic — the admin route was missing
 * an org-scope on its existing-membership check (a member of ANY org got
 * silently skipped from joining a NEW one, while the invite was deleted
 * anyway), and the api route had no email-match check at all (any
 * authenticated user with a valid token could accept someone else's
 * invite). Unifying isn't just DRY: once OTP is a security precondition on
 * membership creation, an un-unified second path is a bypass, not a
 * duplication.
 *
 * Takes a plain `DbInstance`-shaped handle rather than a transaction —
 * accept is a low-frequency, user-initiated action, and the one step that
 * genuinely needs atomicity (the OTP attempt counter) uses a SQL-level
 * increment below rather than a wrapping transaction.
 */
export async function acceptOrgInvite(
  db: Pick<DbInstance, 'select' | 'insert' | 'update' | 'delete'>,
  input: { token: string; otpCode: string | undefined; userId: string; userEmail: string | null | undefined },
): Promise<AcceptInviteResult> {
  const [invite] = await db.select().from(orgInvites).where(eq(orgInvites.token, input.token)).limit(1);
  if (!invite) return { ok: false, reason: 'invalid_token' };
  if (invite.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  if (invite.email.toLowerCase() !== (input.userEmail ?? '').toLowerCase()) {
    return { ok: false, reason: 'email_mismatch' };
  }

  // NULL otpCode = an invite created before migration 0046 — skip the check
  // rather than lock out an invitee who was never sent a code.
  if (invite.otpCode !== null) {
    if (!input.otpCode) return { ok: false, reason: 'otp_required' };
    if (invite.otpAttempts >= 5) return { ok: false, reason: 'otp_locked' };
    if (!invite.otpExpiresAt || invite.otpExpiresAt < new Date()) return { ok: false, reason: 'otp_expired' };
    if (invite.otpCode !== input.otpCode) {
      // Atomic SQL-level increment, not read-then-write: two concurrent
      // wrong guesses racing a `set({otpAttempts: invite.otpAttempts + 1})`
      // would both compute the same stale value and lose an attempt off
      // the count, letting the lockout be undercounted.
      await db
        .update(orgInvites)
        .set({ otpAttempts: sql`${orgInvites.otpAttempts} + 1` })
        .where(eq(orgInvites.id, invite.id));
      return { ok: false, reason: 'otp_invalid' };
    }
  }

  const [existing] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, invite.orgId), eq(orgMembers.userId, input.userId)))
    .limit(1);

  if (!existing) {
    await db.insert(orgMembers).values({ orgId: invite.orgId, userId: input.userId, role: invite.role });
  }

  // Runs even when membership already existed: the invite has served its
  // purpose either way — an idempotent second accept should clean it up,
  // not leave it dangling for a future accept to stumble over.
  await db.delete(orgInvites).where(eq(orgInvites.id, invite.id));

  return { ok: true, orgId: invite.orgId, role: invite.role };
}
