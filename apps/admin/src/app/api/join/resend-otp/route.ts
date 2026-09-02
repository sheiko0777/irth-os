import { NextRequest, NextResponse } from 'next/server';
import { db, orgInvites, organizations, outboxEvents, generateInviteOtp, jsonSafe } from '@irth/db';
import { eq } from 'drizzle-orm';

// See apps/admin/src/server/routers/members.ts's identical constant for why
// this isn't imported from i18n/routing.ts (that module also runs
// next-intl's createNavigation(), unnecessary and unsafe to pull into
// server-only code just to read one string).
const DEFAULT_LOCALE = 'ar';

/**
 * Unauthenticated by session, same as `join/page.tsx` — both are gated by
 * possession of the token, not a logged-in session (the invitee may not
 * have an account yet). This exposes nothing `join/page.tsx` doesn't
 * already show anyone holding the link.
 *
 * Deliberately does NOT reset otpAttempts to 0. Resetting it here would let
 * anyone holding just the token — a weaker secret than the OTP itself —
 * call this endpoint repeatedly to wipe the 5-attempt lockout and keep
 * brute-forcing the 6-digit code indefinitely. Attempts stay cumulative for
 * the life of the invite; only a brand-new invite starts a fresh counter.
 *
 * Direct `outboxEvents` insert, not `emitOutboxEvent`: this route has no
 * transaction handle wrapping the update, and the update + the outbox
 * insert are independent writes with no atomicity requirement between
 * them — nothing downstream depends on them committing together.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : null;
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });

  const [invite] = await db.select().from(orgInvites).where(eq(orgInvites.token, token)).limit(1);
  if (!invite) return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 });
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: 'Invite has expired' }, { status: 410 });

  const { code, expiresAt } = generateInviteOtp();
  await db.update(orgInvites).set({ otpCode: code, otpExpiresAt: expiresAt }).where(eq(orgInvites.id, invite.id));

  const [org] = await db.select({ name: organizations.name }).from(organizations)
    .where(eq(organizations.id, invite.orgId)).limit(1);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const joinUrl = `${appUrl}/${DEFAULT_LOCALE}/join?token=${token}`;

  await db.insert(outboxEvents).values({
    orgId: invite.orgId,
    eventType: 'org.invite.sent',
    payload: JSON.stringify(jsonSafe({
      orgId: invite.orgId, inviteId: invite.id, email: invite.email, orgName: org?.name ?? '',
      role: invite.role, otpCode: code, joinUrl,
    })),
  });

  return NextResponse.json({ data: { resent: true } });
}
